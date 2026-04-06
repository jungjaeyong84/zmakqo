"use strict";

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  return value.summary && typeof value.summary === "object" ? value.summary : value;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function norm(value) {
  return String(value || "").trim() || null;
}

function topValidation(replay = null) {
  const rows = Array.isArray(replay && replay.validations) ? replay.validations : [];
  const summary = readSummary(replay);
  const bestId = norm(summary.best_candidate_id);
  if (bestId) {
    const exact = rows.find((row) => norm(row && row.candidate_id) === bestId);
    if (exact) return exact;
  }
  return rows[0] || null;
}

function sortByObjectiveDesc(rows = []) {
  return rows.slice().sort((a, b) => Number(b.objective_delta || 0) - Number(a.objective_delta || 0));
}

function sortByAvgRetAsc(rows = []) {
  return rows.slice().sort((a, b) => Number(a.avg_ret_net_delta || 0) - Number(b.avg_ret_net_delta || 0));
}

function dominantDragPattern({ strictNegativeMarkets, mixedPositiveReturnDragMarkets, countUpReturnDownMarkets, returnDragMarkets } = {}) {
  if ((strictNegativeMarkets || []).length > 0) return "STRICT_NEGATIVE_MARKET_PRESENT";
  if ((mixedPositiveReturnDragMarkets || []).length > 0) return "POSITIVE_OBJECTIVE_WITH_RETURN_DRAG";
  if ((countUpReturnDownMarkets || []).length > 0) return "COUNT_UP_RETURN_DOWN_MARKET_SPREAD";
  if ((returnDragMarkets || []).length > 0) return "RETURN_DRAG_WITHOUT_COUNT_EXPANSION";
  return "NO_MARKET_DRAG_SIGNAL";
}

function buildMlEvReplayMarketContribution({
  replay = null,
  mlEvReplayDeltaDiagnostics = null,
} = {}) {
  const validation = topValidation(replay);
  const deltaSummary = readSummary(mlEvReplayDeltaDiagnostics);
  const marketRows = Array.isArray(validation && validation.market_objective_deltas)
    ? validation.market_objective_deltas
    : [];

  const normalizedMarkets = marketRows
    .map((row) => ({
      market: norm(row && row.market),
      objective_delta: toNum(row && row.candidate_objective_delta),
      count_delta: toNum(row && row.count_delta),
      avg_ret_net_delta: toNum(row && row.avg_ret_net_delta),
    }))
    .filter((row) => row.market);

  const positiveObjectiveMarkets = normalizedMarkets.filter((row) => (row.objective_delta || 0) > 0);
  const flatObjectiveMarkets = normalizedMarkets.filter((row) => (row.objective_delta || 0) === 0);
  const strictNegativeMarkets = normalizedMarkets.filter((row) => (row.objective_delta || 0) < 0);
  const returnDragMarkets = normalizedMarkets.filter((row) => (row.avg_ret_net_delta || 0) < 0);
  const countUpReturnDownMarkets = normalizedMarkets.filter((row) => (row.count_delta || 0) > 0 && (row.avg_ret_net_delta || 0) < 0);
  const mixedPositiveReturnDragMarkets = positiveObjectiveMarkets.filter((row) => (row.avg_ret_net_delta || 0) < 0);

  const topPositive = sortByObjectiveDesc(positiveObjectiveMarkets)[0] || null;
  const topReturnDrag = sortByAvgRetAsc(returnDragMarkets)[0] || null;
  const topMixed = sortByObjectiveDesc(mixedPositiveReturnDragMarkets)[0] || null;

  return {
    status: "ML_EV_REPLAY_MARKET_CONTRIBUTION_READY",
    candidate_id: norm(validation && validation.candidate_id),
    display_candidate_id: norm(validation && validation.display_candidate_id),
    driver_class: norm(deltaSummary.driver_class),
    overall_objective_delta: toNum(validation && validation.candidate_objective_delta),
    overall_count_delta: toNum(validation && validation.count_delta),
    overall_avg_ret_net_delta: toNum(validation && validation.avg_ret_net_delta),
    before_avg_ret_net: toNum(validation && validation.before_metrics && validation.before_metrics.avg_ret_net),
    after_avg_ret_net: toNum(validation && validation.after_metrics && validation.after_metrics.avg_ret_net),
    market_n: normalizedMarkets.length,
    positive_objective_market_n: positiveObjectiveMarkets.length,
    flat_objective_market_n: flatObjectiveMarkets.length,
    strict_negative_objective_market_n: strictNegativeMarkets.length,
    return_drag_market_n: returnDragMarkets.length,
    count_up_return_down_market_n: countUpReturnDownMarkets.length,
    positive_objective_with_return_drag_market_n: mixedPositiveReturnDragMarkets.length,
    dominant_drag_pattern: dominantDragPattern({
      strictNegativeMarkets,
      mixedPositiveReturnDragMarkets,
      countUpReturnDownMarkets,
      returnDragMarkets,
    }),
    top_positive_market: norm(topPositive && topPositive.market),
    top_positive_market_delta: toNum(topPositive && topPositive.objective_delta),
    top_return_drag_market: norm(topReturnDrag && topReturnDrag.market),
    top_return_drag_market_avg_ret_net_delta: toNum(topReturnDrag && topReturnDrag.avg_ret_net_delta),
    top_mixed_market: norm(topMixed && topMixed.market),
    top_mixed_market_objective_delta: toNum(topMixed && topMixed.objective_delta),
    top_mixed_market_avg_ret_net_delta: toNum(topMixed && topMixed.avg_ret_net_delta),
    top_positive_markets: sortByObjectiveDesc(positiveObjectiveMarkets).slice(0, 3).map((row) => row.market),
    top_return_drag_markets: sortByAvgRetAsc(returnDragMarkets).slice(0, 3).map((row) => row.market),
  };
}

module.exports = {
  buildMlEvReplayMarketContribution,
};
