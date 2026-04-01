"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function objectiveBand(score) {
  const n = toNum(score);
  if (!Number.isFinite(n)) return "UNKNOWN";
  if (n >= 2) return "STRONG_POSITIVE";
  if (n > 0) return "POSITIVE";
  if (n <= -4) return "SEVERE_DRAG";
  if (n < 0) return "NEGATIVE";
  return "NEUTRAL";
}

function buildMarketObjectiveRows({
  objective = null,
  dropValidation = null,
  runtime = null,
} = {}) {
  const objectiveMarkets = Array.isArray(objective && objective.market_objective_scores)
    ? objective.market_objective_scores
    : [];
  const dropMarkets = Array.isArray(dropValidation && dropValidation.by_market)
    ? dropValidation.by_market
    : [];
  const activeMarkets = new Set(
    (
      Array.isArray(runtime && runtime.summary && runtime.summary.markets_preview)
        ? runtime.summary.markets_preview
        : (Array.isArray(runtime && runtime.current_status && runtime.current_status.markets_preview)
          ? runtime.current_status.markets_preview
          : (Array.isArray(runtime && runtime.rows && runtime.rows.markets)
            ? runtime.rows.markets
            : []))
    ).map((row) => toUpper(row)).filter(Boolean)
  );
  const dropMap = new Map(dropMarkets.map((row) => [toUpper(row && row.market), row]));
  const marketNames = new Set([
    ...objectiveMarkets.map((row) => toUpper(row && row.market)).filter(Boolean),
    ...dropMarkets.map((row) => toUpper(row && row.market)).filter(Boolean),
  ]);
  const rows = [];
  for (const market of marketNames) {
    const objectiveRow = objectiveMarkets.find((row) => toUpper(row && row.market) === market) || {};
    const dropRow = dropMap.get(market) || {};
    const score = toNum(objectiveRow.objective_score);
    const avgProxy = toNum(dropRow.avg_horizon_pnl_quote_proxy);
    const recentDropN = toNum(dropRow.recent_drop_n) || 0;
    const verdict = toUpper(dropRow.verdict) || "NO_DROP_VIEW";
    const dragScore = score != null && score < 0 ? Math.abs(score) : 0;
    const rescueBoost = verdict === "FAVOR_RESCUE" ? 4 : (verdict === "MIXED" ? 2 : 0);
    const keepPenalty = verdict === "KEEP_DROP" ? 1.5 : 0;
    const sampleBoost = clamp(recentDropN / 500, 0, 3);
    const pnlBoost = clamp((avgProxy || 0) / 10, -2, 3);
    const recoveryPriorityScore = Number((dragScore + rescueBoost + sampleBoost + pnlBoost - keepPenalty).toFixed(4));
    rows.push({
      market,
      active: activeMarkets.has(market),
      objective_score: score,
      objective_band: objectiveBand(score),
      sampled_n: toNum(objectiveRow.sampled_n) || 0,
      executed_n: toNum(objectiveRow.executed_n) || 0,
      realized_n: toNum(objectiveRow.realized_n) || 0,
      avg_realized_ret_net: toNum(objectiveRow.avg_realized_ret_net),
      win_rate: toNum(objectiveRow.win_rate),
      tp1_first_rate: toNum(objectiveRow.tp1_first_rate),
      mode: String(objectiveRow.mode || "").trim().toUpperCase() || null,
      drop_verdict: verdict,
      drop_action: toUpper(dropRow.recommended_action),
      drop_dominant_family: toUpper(dropRow.dominant_family),
      drop_dominant_reason: toUpper(dropRow.dominant_reason),
      drop_recent_drop_n: recentDropN,
      drop_matured_n: toNum(dropRow.matured_n) || 0,
      drop_avg_horizon_ret_net: toNum(dropRow.avg_horizon_ret_net),
      drop_avg_horizon_pnl_quote_proxy: avgProxy,
      recovery_priority_score: recoveryPriorityScore,
    });
  }
  return rows.sort((a, b) =>
    (b.recovery_priority_score - a.recovery_priority_score)
    || ((a.objective_score ?? Infinity) - (b.objective_score ?? Infinity))
    || b.drop_recent_drop_n - a.drop_recent_drop_n
    || a.market.localeCompare(b.market));
}

function buildMarketObjectiveSummary({
  objective = null,
  dropValidation = null,
  runtime = null,
  rows = [],
} = {}) {
  const globalObjective = objective && objective.global_objective_score && typeof objective.global_objective_score === "object"
    ? objective.global_objective_score
    : {};
  const concentration = objective && objective.market_concentration && typeof objective.market_concentration === "object"
    ? objective.market_concentration
    : {};
  const activeRows = rows.filter((row) => row.active);
  const positiveRows = rows.filter((row) => Number.isFinite(row.objective_score) && row.objective_score > 0);
  const negativeRows = rows.filter((row) => Number.isFinite(row.objective_score) && row.objective_score < 0);
  const rescueRows = rows.filter((row) => row.drop_verdict === "FAVOR_RESCUE");
  const topRecovery = activeRows.find((row) => row.drop_verdict === "FAVOR_RESCUE") || rescueRows[0] || null;
  const topDrag = negativeRows.slice().sort((a, b) => a.objective_score - b.objective_score)[0] || null;
  const topPositive = positiveRows.slice().sort((a, b) => b.objective_score - a.objective_score)[0] || null;
  const status = topRecovery
    ? "RECOVERY_PRIORITY_ACTIVE"
    : (topDrag ? "DRAG_MARKET_REVIEW" : "BALANCED");
  return {
    status,
    global_objective_score: toNum(globalObjective.objective_score),
    market_n: rows.length,
    active_market_n: activeRows.length,
    concentration_flag: concentration.concentration_flag === true,
    dominant_negative_market: concentration.dominant_negative_market || null,
    dominant_negative_share: toNum(concentration.dominant_negative_share),
    top_positive_market: topPositive ? topPositive.market : null,
    top_positive_objective_score: topPositive ? topPositive.objective_score : null,
    top_drag_market: topDrag ? topDrag.market : null,
    top_drag_objective_score: topDrag ? topDrag.objective_score : null,
    top_recovery_market: topRecovery ? topRecovery.market : null,
    top_recovery_objective_score: topRecovery ? topRecovery.objective_score : null,
    top_recovery_drop_action: topRecovery ? topRecovery.drop_action : null,
    top_recovery_drop_reason: topRecovery ? topRecovery.drop_dominant_reason : null,
    top_recovery_avg_horizon_pnl_quote_proxy: topRecovery ? topRecovery.drop_avg_horizon_pnl_quote_proxy : null,
    top_watch_markets: rows.slice(0, 8).map((row) => ({
      market: row.market,
      active: row.active,
      objective_score: row.objective_score,
      objective_band: row.objective_band,
      drop_verdict: row.drop_verdict,
      drop_action: row.drop_action,
      recovery_priority_score: row.recovery_priority_score,
    })),
    runtime_exec_tf: runtime && runtime.summary ? runtime.summary.exec_tf || null : null,
  };
}

module.exports = {
  toNum,
  buildMarketObjectiveRows,
  buildMarketObjectiveSummary,
};
