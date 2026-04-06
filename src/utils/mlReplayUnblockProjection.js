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

function normalizeReasons(values = []) {
  return Array.isArray(values)
    ? values.map((row) => String(row || "").trim().toUpperCase()).filter(Boolean)
    : [];
}

function classifyResidualIssue(reasons = [], bestObjectiveDelta = null) {
  if (reasons.includes("REPLAY_OBJECTIVE_DELTA_NOT_POSITIVE") || (bestObjectiveDelta != null && bestObjectiveDelta <= 0)) {
    return "NEGATIVE_OBJECTIVE_DELTA";
  }
  if (reasons.some((row) => row.includes("STALE"))) return "STALE_ARTIFACT";
  if (reasons.some((row) => row.includes("NO_HISTORICAL"))) return "NO_HISTORICAL_MATCH";
  if (reasons.some((row) => row.includes("COUNT_GUARD") || row.includes("BLOCKED_SOURCE_ACTION"))) return "STRUCTURAL_REPLAY_BLOCKER";
  return reasons[0] || "NONE";
}

function buildMlReplayUnblockProjection({
  replayEvidence = null,
  evReplaySampleGap = null,
} = {}) {
  const replay = readSummary(replayEvidence);
  const sampleGap = readSummary(evReplaySampleGap);
  const blockingReasons = normalizeReasons(replay.blocking_reasons);
  const bestObjectiveDelta = toNum(replay.best_objective_delta);
  const sampleGapN = toNum(sampleGap.governance_effective_gap_n);
  const sampleGapPresent = (sampleGapN || 0) > 0;

  const residualReasons = blockingReasons.filter((reason) => {
    if (reason === "REPLAY_VERDICT_WARN") return false;
    if (reason === "REPLAY_ISSUE_EV_TUNER_INSUFFICIENT_SAMPLE") return false;
    if (reason === "REPLAY_ISSUE_INSUFFICIENT_SAMPLE") return false;
    return true;
  });

  const autoUnblockIfSampleGapClosed = sampleGapPresent && residualReasons.length === 0 && !(bestObjectiveDelta != null && bestObjectiveDelta <= 0);
  const projectedReplayReadyIfSampleGapClosed = autoUnblockIfSampleGapClosed;
  const projectedResidualIssue = classifyResidualIssue(residualReasons, bestObjectiveDelta);

  let evidenceStatus = "REPLAY_UNBLOCK_PROJECTION_READY";
  if (!sampleGapPresent) evidenceStatus = "REPLAY_UNBLOCK_PROJECTION_SAMPLE_GAP_NOT_ACTIVE";
  else if (projectedReplayReadyIfSampleGapClosed) evidenceStatus = "REPLAY_UNBLOCK_PROJECTION_AUTO_READY";
  else evidenceStatus = "REPLAY_UNBLOCK_PROJECTION_RESIDUAL_BLOCKERS";

  return {
    status: "ML_REPLAY_UNBLOCK_PROJECTION_READY",
    evidence_status: evidenceStatus,
    sample_gap_active: sampleGapPresent,
    governance_effective_gap_n: sampleGapN,
    current_replay_evidence_status: norm(replay.evidence_status),
    current_replay_dominant_issue: norm(replay.dominant_issue),
    current_best_objective_delta: bestObjectiveDelta,
    projected_replay_ready_if_sample_gap_closed: projectedReplayReadyIfSampleGapClosed,
    auto_unblock_if_sample_gap_closed: autoUnblockIfSampleGapClosed,
    projected_residual_issue_after_sample_gap_closed: projectedResidualIssue,
    projected_residual_blocking_reasons: residualReasons,
    projected_residual_blocking_reason_n: residualReasons.length,
  };
}

module.exports = {
  buildMlReplayUnblockProjection,
};
