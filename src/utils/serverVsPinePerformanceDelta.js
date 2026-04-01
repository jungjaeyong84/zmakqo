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

function buildCountMap(rows = []) {
  return new Map(
    (Array.isArray(rows) ? rows : [])
      .map((row) => [toUpper(row && (row.market || row.key)), toNum(row && row.count) || 0])
      .filter(([key]) => Boolean(key))
  );
}

function buildFirstMatchMap(rows = [], selector) {
  const map = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const key = toUpper(selector(row));
    if (!key || map.has(key)) continue;
    map.set(key, row);
  }
  return map;
}

function buildServerVsPinePerformanceRows({
  marketObjectiveScore = null,
  authority = null,
  quality = null,
} = {}) {
  const marketRows = Array.isArray(marketObjectiveScore && marketObjectiveScore.by_market)
    ? marketObjectiveScore.by_market
    : [];
  const authorityRows = authority && authority.rows && typeof authority.rows === "object"
    ? authority.rows
    : {};
  const qualityRows = quality && quality.rows && typeof quality.rows === "object"
    ? quality.rows
    : {};

  const serverCountMap = buildCountMap(authorityRows.by_market_server);
  const shadowCountMap = buildCountMap(authorityRows.by_market_shadow);
  const mismatchCountMap = buildCountMap(qualityRows.top_market);
  const mismatchExampleMap = buildFirstMatchMap(qualityRows.mismatch_examples, (row) => row && row.market);

  const rows = [];
  for (const row of marketRows) {
    const market = toUpper(row && row.market);
    if (!market) continue;
    const serverCount = serverCountMap.get(market) || 0;
    const shadowCount = shadowCountMap.get(market) || 0;
    const mismatchCount = mismatchCountMap.get(market) || 0;
    const mismatchExample = mismatchExampleMap.get(market) || null;
    const objectiveScore = toNum(row.objective_score) || 0;
    const realizedRet = toNum(row.avg_realized_ret_net) || 0;
    const winRate = toNum(row.win_rate);
    const avgDropProxy = toNum(row.drop_avg_horizon_pnl_quote_proxy) || 0;
    const dropVerdict = toUpper(row.drop_verdict) || "NO_DROP_VIEW";
    const serverEdge = objectiveScore
      + clamp(realizedRet * 120, -4, 4)
      + (winRate != null ? clamp((winRate - 0.5) * 4, -2, 2) : 0);
    const shadowPressureBase = dropVerdict === "FAVOR_RESCUE"
      ? 2.5
      : (dropVerdict === "MIXED" ? 1 : 0);
    const shadowPressure = shadowPressureBase + clamp(avgDropProxy / 10, -4, 4);
    const mismatchPenalty = mismatchCount * 0.75;
    const countDeltaScore = clamp(((serverCount - shadowCount) / Math.max(1, serverCount + shadowCount)) * 3, -1.5, 1.5);
    const performanceDeltaScore = Number((serverEdge + countDeltaScore - shadowPressure - mismatchPenalty).toFixed(4));
    let verdict = "MIXED";
    if (performanceDeltaScore >= 1.5) verdict = "SERVER_EDGE";
    else if (performanceDeltaScore <= -1) verdict = "SHADOW_GAP_REVIEW";
    rows.push({
      market,
      active: row.active === true,
      objective_score: toNum(row.objective_score),
      avg_realized_ret_net: toNum(row.avg_realized_ret_net),
      win_rate: winRate,
      server_signal_count: serverCount,
      shadow_signal_count: shadowCount,
      mismatch_count: mismatchCount,
      mismatch_reason: mismatchExample ? toUpper(mismatchExample.reason) : null,
      mismatch_scope: mismatchExample ? toUpper(mismatchExample.scope) : null,
      drop_verdict: dropVerdict,
      drop_action: toUpper(row.drop_action),
      drop_avg_horizon_pnl_quote_proxy: toNum(row.drop_avg_horizon_pnl_quote_proxy),
      performance_delta_score: performanceDeltaScore,
      verdict,
      recommended_action: verdict === "SHADOW_GAP_REVIEW"
        ? (toUpper(row.drop_action) || "REVIEW_MARKET_DELTA")
        : (verdict === "SERVER_EDGE" ? "KEEP_SERVER_PRIORITY" : "MONITOR_DELTA"),
    });
  }

  return rows.sort((a, b) =>
    (a.performance_delta_score - b.performance_delta_score)
    || ((a.objective_score ?? Infinity) - (b.objective_score ?? Infinity))
    || a.market.localeCompare(b.market));
}

function buildServerVsPinePerformanceSummary({
  authority = null,
  quality = null,
  rows = [],
} = {}) {
  const authoritySummary = authority && authority.summary && typeof authority.summary === "object"
    ? authority.summary
    : {};
  const qualitySummary = quality && quality.summary && typeof quality.summary === "object"
    ? quality.summary
    : {};
  const activeRows = rows.filter((row) => row.active);
  const orderedWatchRows = [
    ...activeRows,
    ...rows.filter((row) => row.active !== true),
  ];
  const topShadowGap = activeRows[0] || rows[0] || null;
  const topServerEdge = activeRows.slice().sort((a, b) => b.performance_delta_score - a.performance_delta_score)[0] || null;
  const shadowGapRows = activeRows.filter((row) => row.verdict === "SHADOW_GAP_REVIEW");
  const avgDelta = activeRows.length
    ? activeRows.reduce((sum, row) => sum + (toNum(row.performance_delta_score) || 0), 0) / activeRows.length
    : null;
  let status = "MIXED";
  if (shadowGapRows.length >= 2 || (topShadowGap && topShadowGap.performance_delta_score <= -1)) {
    status = "SHADOW_GAP_REVIEW";
  } else if (avgDelta != null && avgDelta >= 1) {
    status = "SERVER_EDGE_STABLE";
  }
  return {
    status,
    active_market_n: activeRows.length,
    parity_mismatch_rate: toNum(authoritySummary.parity_mismatch_rate),
    parity_mismatch_n: toNum(authoritySummary.parity_mismatch_n) || 0,
    authoritative_server_24h_n: toNum(authoritySummary.authoritative_server_24h_n) || 0,
    pine_shadow_24h_n: toNum(authoritySummary.pine_shadow_24h_n) || 0,
    authoritative_entry_signal_24h_n: toNum(qualitySummary.authoritative_entry_signal_24h_n) || 0,
    order_intent_24h_n: toNum(qualitySummary.order_intent_24h_n) || 0,
    fill_24h_n: toNum(qualitySummary.fill_24h_n) || 0,
    avg_active_delta_score: avgDelta != null ? Number(avgDelta.toFixed(4)) : null,
    top_server_edge_market: topServerEdge ? topServerEdge.market : null,
    top_server_edge_score: topServerEdge ? topServerEdge.performance_delta_score : null,
    top_shadow_gap_market: topShadowGap ? topShadowGap.market : null,
    top_shadow_gap_score: topShadowGap ? topShadowGap.performance_delta_score : null,
    top_shadow_gap_reason: topShadowGap ? topShadowGap.mismatch_reason || topShadowGap.drop_action : null,
    top_shadow_gap_action: topShadowGap ? topShadowGap.recommended_action : null,
    top_watch_markets: orderedWatchRows.slice(0, 8).map((row) => ({
      market: row.market,
      active: row.active,
      verdict: row.verdict,
      performance_delta_score: row.performance_delta_score,
      objective_score: row.objective_score,
      mismatch_count: row.mismatch_count,
      recommended_action: row.recommended_action,
    })),
  };
}

module.exports = {
  buildServerVsPinePerformanceRows,
  buildServerVsPinePerformanceSummary,
};
