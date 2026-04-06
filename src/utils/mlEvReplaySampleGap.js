"use strict";

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  return value.summary && typeof value.summary === "object" ? value.summary : value;
}

function readRaw(value) {
  if (!value || typeof value !== "object") return {};
  return value.raw && typeof value.raw === "object" ? value.raw : value;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function norm(value) {
  return String(value || "").trim() || null;
}

function buildGap(required, current) {
  if (required == null || current == null) return null;
  return Math.max(0, required - current);
}

function deriveDominantDimension({ governanceEffectiveGapN, historicalAppliedGapN, historicalRealizedGapN } = {}) {
  if ((governanceEffectiveGapN || 0) > 0) return "GOVERNANCE_EFFECTIVE_REALIZED";
  if ((historicalAppliedGapN || 0) > 0) return "HISTORICAL_APPLIED";
  if ((historicalRealizedGapN || 0) > 0) return "HISTORICAL_REALIZED_MATCH";
  return "NONE";
}

function buildMlEvReplaySampleGap({
  objectiveSupervisor = null,
  replayEvidence = null,
} = {}) {
  const objectiveRaw = readRaw(objectiveSupervisor);
  const replaySummary = readSummary(replayEvidence);
  const sampleReadiness = objectiveRaw.sample_readiness && typeof objectiveRaw.sample_readiness === "object"
    ? objectiveRaw.sample_readiness
    : {};

  const requiredRealizedN = toNum(sampleReadiness.governance_realized_min_sample);
  const governanceStrictRealizedN = toNum(sampleReadiness.governance_realized_n);
  const governanceMonthlySourceRealizedN = toNum(sampleReadiness.governance_monthly_source_realized_n);
  const governanceEffectiveRealizedN = toNum(sampleReadiness.governance_effective_realized_n);
  const bestHistoricalRealizedMatchN = toNum(replaySummary.best_historical_realized_match_n);
  const bestHistoricalAppliedN = toNum(replaySummary.best_historical_applied_n);
  const governanceEffectiveGapN = buildGap(requiredRealizedN, governanceEffectiveRealizedN);
  const historicalRealizedGapN = buildGap(requiredRealizedN, bestHistoricalRealizedMatchN);
  const historicalAppliedGapN = buildGap(requiredRealizedN, bestHistoricalAppliedN);
  const dominantSampleDimension = deriveDominantDimension({
    governanceEffectiveGapN,
    historicalAppliedGapN,
    historicalRealizedGapN,
  });

  let evidenceStatus = "EV_REPLAY_SAMPLE_GAP_UNKNOWN";
  let sampleGapReady = false;
  if (requiredRealizedN == null) {
    evidenceStatus = "EV_REPLAY_SAMPLE_REQUIREMENT_MISSING";
  } else if (governanceEffectiveRealizedN == null) {
    evidenceStatus = "EV_REPLAY_SAMPLE_CURRENT_MISSING";
  } else if ((governanceEffectiveGapN || 0) > 0) {
    evidenceStatus = "EV_REPLAY_SAMPLE_GAP";
  } else {
    evidenceStatus = "EV_REPLAY_SAMPLE_READY";
    sampleGapReady = true;
  }

  const blockingReasons = [];
  if (!sampleGapReady) {
    if (requiredRealizedN == null) blockingReasons.push("EV_REPLAY_SAMPLE_REQUIREMENT_MISSING");
    if (requiredRealizedN != null && governanceEffectiveRealizedN == null) blockingReasons.push("EV_REPLAY_SAMPLE_CURRENT_MISSING");
    if ((governanceEffectiveGapN || 0) > 0) blockingReasons.push("EV_REPLAY_GOVERNANCE_EFFECTIVE_GAP");
  }
  if ((historicalAppliedGapN || 0) > 0) blockingReasons.push("EV_REPLAY_HISTORICAL_APPLIED_GAP");
  if ((historicalRealizedGapN || 0) > 0) blockingReasons.push("EV_REPLAY_HISTORICAL_REALIZED_GAP");

  return {
    status: "ML_EV_REPLAY_SAMPLE_GAP_READY",
    sample_gap_ready: sampleGapReady,
    evidence_status: evidenceStatus,
    requirement_source: "OBJECTIVE_SUPERVISOR_GOVERNANCE_EFFECTIVE_REALIZED",
    replay_dominant_issue: norm(replaySummary.dominant_issue),
    replay_best_candidate_id: norm(replaySummary.best_candidate_id),
    replay_best_display_candidate_id: norm(replaySummary.best_display_candidate_id),
    required_realized_n: requiredRealizedN,
    governance_strict_realized_n: governanceStrictRealizedN,
    governance_monthly_source_realized_n: governanceMonthlySourceRealizedN,
    governance_effective_realized_n: governanceEffectiveRealizedN,
    governance_effective_gap_n: governanceEffectiveGapN,
    best_historical_realized_match_n: bestHistoricalRealizedMatchN,
    best_historical_applied_n: bestHistoricalAppliedN,
    historical_realized_match_gap_n: historicalRealizedGapN,
    historical_applied_gap_n: historicalAppliedGapN,
    dominant_sample_dimension: dominantSampleDimension,
    blocking_reason_n: blockingReasons.length,
    blocking_reasons: blockingReasons,
  };
}

module.exports = {
  buildMlEvReplaySampleGap,
};
