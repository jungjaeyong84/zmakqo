"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  if (value.display && typeof value.display === "object") return value.display;
  return value;
}

function readSummary(value) {
  const raw = unwrapRawReport(value) || {};
  return raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
}

function readRows(value, key = "by_market") {
  const raw = unwrapRawReport(value) || {};
  return Array.isArray(raw[key]) ? raw[key] : [];
}

function clamp(value, min, max) {
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  return Math.max(min, Math.min(max, n));
}

function buildPenaltySets(executionQualitySummary = {}, reversePolicySummary = {}) {
  const executionPenaltyMarkets = new Set([
    executionQualitySummary.top_latency_market,
    executionQualitySummary.top_slippage_market,
    executionQualitySummary.top_partial_market,
  ].map((row) => upper(row)).filter(Boolean));
  const reversePenaltyMarkets = new Set([
    reversePolicySummary.top_watch_market,
    ...(Array.isArray(reversePolicySummary.top_watch_markets)
      ? reversePolicySummary.top_watch_markets.map((row) => upper(row && row.market))
      : []),
  ].filter(Boolean));
  return { executionPenaltyMarkets, reversePenaltyMarkets };
}

function classifyAction({ market, score, production, exploration, deferred, executionPenalty, reversePenalty, objectiveBand }) {
  const severeDrag = objectiveBand === "SEVERE_DRAG" || score <= -3;
  if (deferred && (executionPenalty || reversePenalty || severeDrag)) return "QUARANTINE";
  if (severeDrag && (executionPenalty || reversePenalty)) return "QUARANTINE";
  if (production && score >= 1.5) return "INCREASE";
  if (production && score > -1) return "HOLD";
  if (exploration && score >= 0) return "EXPLORE_LIGHT";
  if (exploration) return "HOLD";
  if (score <= -1.5 || deferred) return "REDUCE";
  return "HOLD";
}

function deriveServerMarketCapitalAllocator({
  marketObjectiveScore = null,
  executionQuality = null,
  reversePolicy = null,
  explorationBudget = null,
} = {}) {
  const objectiveSummary = readSummary(marketObjectiveScore);
  const objectiveRows = readRows(marketObjectiveScore, "by_market");
  const executionSummary = readSummary(executionQuality);
  const reverseSummary = readSummary(reversePolicy);
  const budgetSummary = readSummary(explorationBudget);

  const productionMarkets = new Set((Array.isArray(budgetSummary.production_markets) ? budgetSummary.production_markets : []).map((row) => upper(row)).filter(Boolean));
  const explorationMarkets = new Set((Array.isArray(budgetSummary.exploration_markets) ? budgetSummary.exploration_markets : []).map((row) => upper(row)).filter(Boolean));
  const deferredMarkets = new Set((Array.isArray(budgetSummary.deferred_penalty_markets) ? budgetSummary.deferred_penalty_markets : []).map((row) => upper(row)).filter(Boolean));
  const { executionPenaltyMarkets, reversePenaltyMarkets } = buildPenaltySets(executionSummary, reverseSummary);

  const rows = objectiveRows.map((row) => {
    const market = upper(row.market);
    const objectiveScore = toNum(row.objective_score) || 0;
    const recoveryPriorityScore = toNum(row.recovery_priority_score) || 0;
    const avgProxy = toNum(row.drop_avg_horizon_pnl_quote_proxy) || 0;
    const production = productionMarkets.has(market);
    const exploration = explorationMarkets.has(market);
    const deferred = deferredMarkets.has(market);
    const executionPenalty = executionPenaltyMarkets.has(market);
    const reversePenalty = reversePenaltyMarkets.has(market);
    const baseScore = objectiveScore + clamp(recoveryPriorityScore / 4, -2, 3) + clamp(avgProxy / 20, -1, 2);
    const slotBoost = production ? 1.25 : (exploration ? 0.5 : 0);
    const penaltyScore = (executionPenalty ? 1.5 : 0) + (reversePenalty ? 1.0 : 0) + (deferred ? 1.0 : 0);
    const allocationScore = Number((baseScore + slotBoost - penaltyScore).toFixed(4));
    const action = classifyAction({
      market,
      score: allocationScore,
      production,
      exploration,
      deferred,
      executionPenalty,
      reversePenalty,
      objectiveBand: upper(row.objective_band),
    });
    return {
      market,
      active: row.active === true,
      objective_score: toNum(row.objective_score),
      recovery_priority_score: toNum(row.recovery_priority_score),
      avg_horizon_pnl_quote_proxy: toNum(row.drop_avg_horizon_pnl_quote_proxy),
      objective_band: upper(row.objective_band),
      drop_verdict: upper(row.drop_verdict),
      production_slot: production,
      exploration_slot: exploration,
      deferred_penalty: deferred,
      execution_quality_penalty: executionPenalty,
      reverse_policy_penalty: reversePenalty,
      allocation_score: allocationScore,
      recommended_action: action,
    };
  }).sort((a, b) => b.allocation_score - a.allocation_score || String(a.market).localeCompare(String(b.market)));

  const activeRows = rows.filter((row) => row.active);
  const increaseRows = activeRows.filter((row) => row.recommended_action === "INCREASE");
  const reduceRows = activeRows.filter((row) => row.recommended_action === "REDUCE");
  const quarantineRows = activeRows.filter((row) => row.recommended_action === "QUARANTINE");
  const exploreRows = activeRows.filter((row) => row.recommended_action === "EXPLORE_LIGHT");

  const topIncrease = increaseRows[0] || null;
  const topReduce = reduceRows.slice().sort((a, b) => a.allocation_score - b.allocation_score)[0] || null;
  const topQuarantine = quarantineRows.slice().sort((a, b) => a.allocation_score - b.allocation_score)[0] || null;
  const topExplore = exploreRows[0] || null;

  const status = quarantineRows.length > 0
    ? "QUARANTINE_REVIEW"
    : (increaseRows.length > 0 || exploreRows.length > 0 ? "CAPITAL_ALLOCATION_ACTIVE" : "CAPITAL_ALLOCATION_HOLD");

  return {
    status,
    market_n: rows.length,
    active_market_n: activeRows.length,
    increase_market_n: increaseRows.length,
    reduce_market_n: reduceRows.length,
    quarantine_market_n: quarantineRows.length,
    explore_market_n: exploreRows.length,
    top_increase_market: topIncrease ? topIncrease.market : null,
    top_increase_score: topIncrease ? topIncrease.allocation_score : null,
    top_reduce_market: topReduce ? topReduce.market : null,
    top_reduce_score: topReduce ? topReduce.allocation_score : null,
    top_quarantine_market: topQuarantine ? topQuarantine.market : null,
    top_quarantine_score: topQuarantine ? topQuarantine.allocation_score : null,
    top_explore_market: topExplore ? topExplore.market : null,
    top_explore_score: topExplore ? topExplore.allocation_score : null,
    production_markets: Array.from(productionMarkets),
    exploration_markets: Array.from(explorationMarkets),
    deferred_penalty_markets: Array.from(deferredMarkets),
    top_watch_markets: activeRows.slice(0, 8).map((row) => ({
      market: row.market,
      allocation_score: row.allocation_score,
      recommended_action: row.recommended_action,
      production_slot: row.production_slot,
      exploration_slot: row.exploration_slot,
      deferred_penalty: row.deferred_penalty,
      execution_quality_penalty: row.execution_quality_penalty,
      reverse_policy_penalty: row.reverse_policy_penalty,
    })),
    global_objective_score: toNum(objectiveSummary.global_objective_score),
  };
}

module.exports = {
  deriveServerMarketCapitalAllocator,
};
