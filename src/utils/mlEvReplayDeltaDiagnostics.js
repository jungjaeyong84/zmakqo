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

function classifyDriver({ objectiveDelta, countDelta, avgRetNetDelta } = {}) {
  if (objectiveDelta == null) return "UNKNOWN";
  if (objectiveDelta >= 0) return "NON_NEGATIVE";
  if ((countDelta || 0) > 0 && (avgRetNetDelta || 0) < 0) return "COUNT_UP_RETURN_DOWN";
  if ((countDelta || 0) <= 0 && (avgRetNetDelta || 0) < 0) return "RETURN_DOWN";
  if ((countDelta || 0) > 0 && (avgRetNetDelta || 0) >= 0) return "OTHER_COMPOSITE_DRAG";
  return "NEGATIVE_DELTA_OTHER";
}

function roleFromGap({ historicalAppliedGapN, blockers = [] } = {}) {
  const normalized = Array.isArray(blockers)
    ? blockers.map((row) => String(row || "").trim().toUpperCase()).filter(Boolean)
    : [];
  if ((historicalAppliedGapN || 0) <= 0) return "NO_GAP";
  if (normalized.some((row) => row.includes("NO_HISTORICAL") || row.includes("NO_EFFECT_CHANGESET"))) {
    return "BLOCKER";
  }
  return "REFERENCE_ONLY";
}

function sortMarketDeltas(rows = []) {
  return (Array.isArray(rows) ? rows.slice() : [])
    .filter((row) => row && row.market)
    .sort((a, b) => Number(b.candidate_objective_delta || 0) - Number(a.candidate_objective_delta || 0));
}

function buildMlEvReplayDeltaDiagnostics({
  replay = null,
  evReplaySampleGap = null,
} = {}) {
  const validation = topValidation(replay);
  const sampleGap = readSummary(evReplaySampleGap);
  const marketDeltas = sortMarketDeltas(validation && validation.market_objective_deltas);
  const topPositive = marketDeltas[0] || null;
  const topNegative = marketDeltas.slice().sort((a, b) => Number(a.candidate_objective_delta || 0) - Number(b.candidate_objective_delta || 0))[0] || null;
  const historicalAppliedGapN = toNum(sampleGap.historical_applied_gap_n);
  const blockers = Array.isArray(validation && validation.blockers) ? validation.blockers : [];

  return {
    status: "ML_EV_REPLAY_DELTA_DIAGNOSTICS_READY",
    candidate_id: norm(validation && validation.candidate_id),
    display_candidate_id: norm(validation && validation.display_candidate_id),
    validation_verdict: norm(validation && validation.validation_verdict),
    objective_delta: toNum(validation && validation.candidate_objective_delta),
    projected_objective_score: toNum(validation && validation.projected_objective_score),
    count_delta: toNum(validation && validation.count_delta),
    avg_ret_net_delta: toNum(validation && validation.avg_ret_net_delta),
    before_avg_ret_net: toNum(validation && validation.before_metrics && validation.before_metrics.avg_ret_net),
    after_avg_ret_net: toNum(validation && validation.after_metrics && validation.after_metrics.avg_ret_net),
    before_win_rate: toNum(validation && validation.before_metrics && validation.before_metrics.win_rate),
    after_win_rate: toNum(validation && validation.after_metrics && validation.after_metrics.win_rate),
    driver_class: classifyDriver({
      objectiveDelta: toNum(validation && validation.candidate_objective_delta),
      countDelta: toNum(validation && validation.count_delta),
      avgRetNetDelta: toNum(validation && validation.avg_ret_net_delta),
    }),
    historical_applied_n: toNum(validation && validation.historical_applied_n),
    historical_applied_gap_n: historicalAppliedGapN,
    historical_applied_gap_role: roleFromGap({ historicalAppliedGapN, blockers }),
    blocker_n: blockers.length,
    blockers,
    top_positive_market: norm(topPositive && topPositive.market),
    top_positive_market_delta: toNum(topPositive && topPositive.candidate_objective_delta),
    top_negative_market: norm(topNegative && topNegative.market),
    top_negative_market_delta: toNum(topNegative && topNegative.candidate_objective_delta),
  };
}

module.exports = {
  buildMlEvReplayDeltaDiagnostics,
};
