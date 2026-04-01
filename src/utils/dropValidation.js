"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeFamily(reasonRaw = "") {
  const reason = String(reasonRaw || "").trim().toUpperCase();
  if (!reason) return "OTHER";
  if (reason.includes("EV_GATE")) return "EV_POLICY";
  if (reason.includes("WAIT_ONE_BAR") || reason.includes("COOLDOWN")) return "COOLDOWN_POLICY";
  if (reason.includes("STRATEGY_ID_MISMATCH") || reason.includes("STRATEGY_GATE")) return "STRATEGY_GATE";
  if (
    reason.includes("GATE_SCORE")
    || reason.includes("GATE_CONF")
    || reason.includes("GATE_REGIME")
    || reason.includes("ENTRY_QUALITY")
  ) return "ENTRY_QUALITY";
  if (reason.startsWith("LIVE_RESCUE_")) return "LIVE_RESCUE";
  return "OTHER";
}

function classifyCounterfactual(row = {}) {
  const matured = toNum(row.matured_n) || 0;
  const tp1Rate = toNum(row.tp1_first_rate);
  const slRate = toNum(row.sl_first_rate);
  const horizonPosRate = toNum(row.horizon_pos_rate);
  const avgRet = toNum(row.avg_horizon_ret_net);

  if (matured < 8) return "HOLD_SAMPLE";
  if (
    Number.isFinite(avgRet)
    && Number.isFinite(tp1Rate)
    && Number.isFinite(slRate)
    && Number.isFinite(horizonPosRate)
    && (
      avgRet >= 0.003
      || (tp1Rate - slRate) >= 0.08
    )
    && horizonPosRate >= 0.52
  ) return "FAVOR_RESCUE";
  if (
    Number.isFinite(avgRet)
    && Number.isFinite(tp1Rate)
    && Number.isFinite(slRate)
    && Number.isFinite(horizonPosRate)
    && (
      avgRet <= -0.003
      || (slRate - tp1Rate) >= 0.10
    )
    && horizonPosRate <= 0.45
  ) return "KEEP_DROP";
  return "MIXED";
}

function aggregateRows(rows = []) {
  const total = {
    matured_n: 0,
    tp1_first_n: 0,
    sl_first_n: 0,
    ambiguous_both_n: 0,
    hold_n: 0,
    horizon_pos_n: 0,
    horizon_neg_n: 0,
    avg_horizon_ret_net_sum: 0,
    avg_horizon_ret_net_n: 0,
  };
  for (const row of Array.isArray(rows) ? rows : []) {
    total.matured_n += toNum(row.matured_n) || 0;
    total.tp1_first_n += toNum(row.tp1_first_n) || 0;
    total.sl_first_n += toNum(row.sl_first_n) || 0;
    total.ambiguous_both_n += toNum(row.ambiguous_both_n) || 0;
    total.hold_n += toNum(row.hold_n) || 0;
    total.horizon_pos_n += toNum(row.horizon_pos_n) || 0;
    total.horizon_neg_n += toNum(row.horizon_neg_n) || 0;
    total.avg_horizon_ret_net_sum += toNum(row.avg_horizon_ret_net_sum) || 0;
    total.avg_horizon_ret_net_n += toNum(row.avg_horizon_ret_net_n) || 0;
  }
  total.tp1_first_rate = total.matured_n > 0 ? total.tp1_first_n / total.matured_n : null;
  total.sl_first_rate = total.matured_n > 0 ? total.sl_first_n / total.matured_n : null;
  total.ambiguous_both_rate = total.matured_n > 0 ? total.ambiguous_both_n / total.matured_n : null;
  total.hold_rate = total.matured_n > 0 ? total.hold_n / total.matured_n : null;
  total.horizon_pos_rate = total.matured_n > 0 ? total.horizon_pos_n / total.matured_n : null;
  total.avg_horizon_ret_net = total.avg_horizon_ret_net_n > 0 ? total.avg_horizon_ret_net_sum / total.avg_horizon_ret_net_n : null;
  return total;
}

function buildReasonRows(dropCounterfactual = {}) {
  const reasons = Array.isArray(dropCounterfactual.top_reasons) ? dropCounterfactual.top_reasons : [];
  return reasons.map((row) => ({
    family: normalizeFamily(row.reason),
    reason: String(row.reason || "").trim().toUpperCase() || "UNKNOWN",
    matured_n: toNum(row.matured_n) || 0,
    tp1_first_n: toNum(row.tp1_first_n) || 0,
    sl_first_n: toNum(row.sl_first_n) || 0,
    ambiguous_both_n: toNum(row.ambiguous_both_n) || 0,
    hold_n: toNum(row.hold_n) || 0,
    horizon_pos_n: toNum(row.horizon_pos_n) || 0,
    horizon_neg_n: toNum(row.horizon_neg_n) || 0,
    avg_horizon_ret_net_sum: toNum(row.avg_horizon_ret_net_sum) || 0,
    avg_horizon_ret_net_n: toNum(row.avg_horizon_ret_net_n) || 0,
    tp1_first_rate: toNum(row.tp1_first_rate),
    sl_first_rate: toNum(row.sl_first_rate),
    hold_rate: toNum(row.hold_rate),
    horizon_pos_rate: toNum(row.horizon_pos_rate),
    avg_horizon_ret_net: toNum(row.avg_horizon_ret_net),
    verdict: classifyCounterfactual(row),
  }));
}

function buildFamilyRows(reasonRows = [], byReasonMarket = [], droppedDocs = []) {
  const byFamily = new Map();
  const recentFamilyCounts = new Map();

  for (const row of Array.isArray(droppedDocs) ? droppedDocs : []) {
    const reason = String(row.drop_reason_code || row.reason || "").trim().toUpperCase();
    const family = normalizeFamily(reason);
    recentFamilyCounts.set(family, (recentFamilyCounts.get(family) || 0) + 1);
  }

  for (const family of new Set(reasonRows.map((row) => row.family))) {
    const familyReasonRows = reasonRows.filter((row) => row.family === family);
    const familyStats = aggregateRows(familyReasonRows);
    const familyMarkets = (Array.isArray(byReasonMarket) ? byReasonMarket : [])
      .filter((row) => normalizeFamily(row.reason) === family)
      .map((row) => ({
        market: String(row.market || "").trim().toUpperCase() || "UNKNOWN",
        reason: String(row.reason || "").trim().toUpperCase() || "UNKNOWN",
        matured_n: toNum(row.matured_n) || 0,
        tp1_first_rate: toNum(row.tp1_first_rate),
        sl_first_rate: toNum(row.sl_first_rate),
        horizon_pos_rate: toNum(row.horizon_pos_rate),
        avg_horizon_ret_net: toNum(row.avg_horizon_ret_net),
        verdict: classifyCounterfactual(row),
      }))
      .sort((a, b) => b.matured_n - a.matured_n || a.market.localeCompare(b.market));
    const topReason = familyReasonRows
      .slice()
      .sort((a, b) => b.matured_n - a.matured_n || a.reason.localeCompare(b.reason))[0] || null;
    const topMarket = familyMarkets[0] || null;
    byFamily.set(family, {
      family,
      recent_drop_n: recentFamilyCounts.get(family) || 0,
      reason_n: familyReasonRows.length,
      matured_n: familyStats.matured_n,
      tp1_first_rate: familyStats.tp1_first_rate,
      sl_first_rate: familyStats.sl_first_rate,
      hold_rate: familyStats.hold_rate,
      horizon_pos_rate: familyStats.horizon_pos_rate,
      avg_horizon_ret_net: familyStats.avg_horizon_ret_net,
      verdict: classifyCounterfactual(familyStats),
      top_reason: topReason ? topReason.reason : null,
      top_reason_matured_n: topReason ? topReason.matured_n : 0,
      top_market: topMarket ? topMarket.market : null,
      top_market_reason: topMarket ? topMarket.reason : null,
      top_market_matured_n: topMarket ? topMarket.matured_n : 0,
    });
  }

  return Array.from(byFamily.values())
    .sort((a, b) => {
      const verdictOrder = { FAVOR_RESCUE: 0, MIXED: 1, KEEP_DROP: 2, HOLD_SAMPLE: 3 };
      return (verdictOrder[a.verdict] ?? 9) - (verdictOrder[b.verdict] ?? 9)
        || b.matured_n - a.matured_n
        || a.family.localeCompare(b.family);
    });
}

function deriveRecommendedActions(familyRows = []) {
  const actions = [];
  for (const row of Array.isArray(familyRows) ? familyRows : []) {
    if (row.verdict === "FAVOR_RESCUE") {
      if (row.family === "EV_POLICY") actions.push({ family: row.family, action: "RELAX_EV_POLICY_REVIEW" });
      else if (row.family === "COOLDOWN_POLICY") actions.push({ family: row.family, action: "RELAX_COOLDOWN_POLICY_REVIEW" });
      else if (row.family === "ENTRY_QUALITY") actions.push({ family: row.family, action: "RECHECK_ENTRY_QUALITY_GATE" });
      else actions.push({ family: row.family, action: "REVIEW_DROP_RULE" });
    } else if (row.verdict === "KEEP_DROP") {
      actions.push({ family: row.family, action: "KEEP_DROP_RULE" });
    } else if (row.verdict === "MIXED") {
      actions.push({ family: row.family, action: "MONITOR_WITH_MORE_SAMPLE" });
    } else {
      actions.push({ family: row.family, action: "HOLD_SAMPLE" });
    }
  }
  return actions;
}

function deriveActionFromVerdictAndFamily({ verdict = null, family = null } = {}) {
  const v = String(verdict || "").trim().toUpperCase();
  const f = String(family || "").trim().toUpperCase();
  if (v === "FAVOR_RESCUE") {
    if (f === "EV_POLICY") return "RELAX_EV_POLICY_REVIEW";
    if (f === "COOLDOWN_POLICY") return "RELAX_COOLDOWN_POLICY_REVIEW";
    if (f === "ENTRY_QUALITY") return "RECHECK_ENTRY_QUALITY_GATE";
    return "REVIEW_DROP_RULE";
  }
  if (v === "KEEP_DROP") return "KEEP_DROP_RULE";
  if (v === "MIXED") return "MONITOR_WITH_MORE_SAMPLE";
  return "HOLD_SAMPLE";
}

function buildMarketRows(reasonRows = [], byReasonMarket = [], droppedDocs = []) {
  const recentMarketCounts = new Map();
  for (const row of Array.isArray(droppedDocs) ? droppedDocs : []) {
    const market = String(row.symbol_or_pair_id || row.symbol || row.market || "").trim().toUpperCase() || "UNKNOWN";
    const reason = String(row.drop_reason_code || row.reason || "").trim().toUpperCase() || "UNKNOWN";
    const family = normalizeFamily(reason);
    const bucket = recentMarketCounts.get(market) || {
      recent_drop_n: 0,
      family_counts: new Map(),
      reason_counts: new Map(),
    };
    bucket.recent_drop_n += 1;
    bucket.family_counts.set(family, (bucket.family_counts.get(family) || 0) + 1);
    bucket.reason_counts.set(reason, (bucket.reason_counts.get(reason) || 0) + 1);
    recentMarketCounts.set(market, bucket);
  }

  const marketNames = new Set();
  for (const row of Array.isArray(byReasonMarket) ? byReasonMarket : []) {
    marketNames.add(String(row.market || "").trim().toUpperCase() || "UNKNOWN");
  }
  for (const market of recentMarketCounts.keys()) marketNames.add(market);

  const rows = [];
  for (const market of marketNames) {
    const marketReasonRows = (Array.isArray(byReasonMarket) ? byReasonMarket : [])
      .filter((row) => (String(row.market || "").trim().toUpperCase() || "UNKNOWN") === market)
      .map((row) => ({
        family: normalizeFamily(row.reason),
        reason: String(row.reason || "").trim().toUpperCase() || "UNKNOWN",
        matured_n: toNum(row.matured_n) || 0,
        tp1_first_n: toNum(row.tp1_first_n) || 0,
        sl_first_n: toNum(row.sl_first_n) || 0,
        ambiguous_both_n: toNum(row.ambiguous_both_n) || 0,
        hold_n: toNum(row.hold_n) || 0,
        horizon_pos_n: toNum(row.horizon_pos_n) || 0,
        horizon_neg_n: toNum(row.horizon_neg_n) || 0,
        avg_horizon_ret_net_sum: toNum(row.avg_horizon_ret_net_sum) || 0,
        avg_horizon_ret_net_n: toNum(row.avg_horizon_ret_net_n) || 0,
      }));
    const stats = aggregateRows(marketReasonRows);
    const recent = recentMarketCounts.get(market) || { recent_drop_n: 0, family_counts: new Map(), reason_counts: new Map() };
    const dominantReasonRow = marketReasonRows
      .slice()
      .sort((a, b) => b.matured_n - a.matured_n || a.reason.localeCompare(b.reason))[0] || null;
    const dominantFamily = dominantReasonRow
      ? dominantReasonRow.family
      : Array.from(recent.family_counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
    const dominantReason = dominantReasonRow
      ? dominantReasonRow.reason
      : Array.from(recent.reason_counts.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] || null;
    const verdict = classifyCounterfactual(stats);
    rows.push({
      market,
      recent_drop_n: recent.recent_drop_n || 0,
      matured_n: stats.matured_n,
      tp1_first_rate: stats.tp1_first_rate,
      sl_first_rate: stats.sl_first_rate,
      hold_rate: stats.hold_rate,
      horizon_pos_rate: stats.horizon_pos_rate,
      avg_horizon_ret_net: stats.avg_horizon_ret_net,
      dominant_family: dominantFamily,
      dominant_reason: dominantReason,
      verdict,
      recommended_action: deriveActionFromVerdictAndFamily({ verdict, family: dominantFamily }),
    });
  }

  return rows.sort((a, b) => {
    const verdictOrder = { FAVOR_RESCUE: 0, MIXED: 1, KEEP_DROP: 2, HOLD_SAMPLE: 3 };
    return (verdictOrder[a.verdict] ?? 9) - (verdictOrder[b.verdict] ?? 9)
      || b.recent_drop_n - a.recent_drop_n
      || b.matured_n - a.matured_n
      || a.market.localeCompare(b.market);
  });
}

module.exports = {
  toNum,
  normalizeFamily,
  classifyCounterfactual,
  aggregateRows,
  buildReasonRows,
  buildFamilyRows,
  deriveRecommendedActions,
  buildMarketRows,
  deriveActionFromVerdictAndFamily,
};
