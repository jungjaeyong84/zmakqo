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

function summarizeCounts(values = []) {
  const counts = new Map();
  for (const value of Array.isArray(values) ? values : []) {
    const key = String(value || "").trim().toUpperCase();
    if (!key || !/^[A-Z0-9_]+$/.test(key)) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0) || String(a[0]).localeCompare(String(b[0])))
    .map(([key, count]) => ({ key, count }));
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

function collectIssueTokens(validation = null) {
  if (!validation || typeof validation !== "object") return [];
  const blockers = Array.isArray(validation.blockers) ? validation.blockers : [];
  const riskFlags = Array.isArray(validation.risk_flags) ? validation.risk_flags : [];
  const summary = norm(validation.summary);
  const tokens = [...blockers, ...riskFlags];
  if (summary) tokens.push(summary);
  return tokens;
}

function deriveReplayEvidenceStatus({ bestVerdict, bestObjectiveDelta, dominantIssue }) {
  if (bestVerdict === "PASS" && bestObjectiveDelta != null && bestObjectiveDelta > 0) {
    return "REPLAY_PASS_READY";
  }
  if (bestVerdict === "WARN") {
    if (dominantIssue === "EV_TUNER_INSUFFICIENT_SAMPLE" || dominantIssue === "INSUFFICIENT_SAMPLE") {
      return "REPLAY_WARN_INSUFFICIENT_SAMPLE";
    }
    if (dominantIssue === "EV_TUNER_STALE") {
      return "REPLAY_WARN_STALE_ARTIFACT";
    }
    if (bestObjectiveDelta != null && bestObjectiveDelta <= 0) {
      return "REPLAY_WARN_NEGATIVE_OBJECTIVE_DELTA";
    }
    return "REPLAY_WARN_REVIEW";
  }
  if (bestVerdict === "BLOCK") {
    if (dominantIssue) return `REPLAY_BLOCKED_${dominantIssue}`;
    return "REPLAY_BLOCKED";
  }
  return "REPLAY_EVIDENCE_MISSING";
}

function buildMlReplayEvidence({
  replay = null,
} = {}) {
  const summary = readSummary(replay);
  const validation = topValidation(replay);
  const validations = Array.isArray(replay && replay.validations) ? replay.validations : [];
  const issueBreakdown = summarizeCounts(
    validations.flatMap((row) => collectIssueTokens(row))
  );
  const bestIssueBreakdown = summarizeCounts(collectIssueTokens(validation));
  const dominantIssue = bestIssueBreakdown[0] && bestIssueBreakdown[0].key
    || issueBreakdown[0] && issueBreakdown[0].key
    || null;
  const bestVerdict = String(validation && validation.validation_verdict || summary.best_verdict || "").trim().toUpperCase() || null;
  const bestObjectiveDelta = toNum(validation && validation.candidate_objective_delta);
  const replayReady = bestVerdict === "PASS" && bestObjectiveDelta != null && bestObjectiveDelta > 0;
  const evidenceStatus = deriveReplayEvidenceStatus({
    bestVerdict,
    bestObjectiveDelta,
    dominantIssue,
  });

  const blockingReasons = [];
  if (!replayReady) {
    if (bestVerdict) blockingReasons.push(`REPLAY_VERDICT_${bestVerdict}`);
    if (dominantIssue) blockingReasons.push(`REPLAY_ISSUE_${dominantIssue}`);
    if (bestObjectiveDelta != null && bestObjectiveDelta <= 0) {
      blockingReasons.push("REPLAY_OBJECTIVE_DELTA_NOT_POSITIVE");
    }
  }

  return {
    status: "ML_REPLAY_EVIDENCE_READY",
    replay_ready: replayReady,
    evidence_status: evidenceStatus,
    best_candidate_id: norm(summary.best_candidate_id || validation && validation.candidate_id),
    best_display_candidate_id: norm(validation && validation.display_candidate_id),
    best_canonical_candidate_id: norm(validation && validation.canonical_candidate_id),
    best_candidate_review_mode: norm(validation && validation.ev_policy_review_mode),
    best_candidate_profile_target_n: toNum(validation && validation.ev_profile_review_target_n),
    best_candidate_top_return_drag_profile: norm(validation && validation.ev_profile_top_return_drag_profile),
    best_candidate_top_return_drag_driver: norm(validation && validation.ev_profile_top_return_drag_driver),
    best_candidate_top_mixed_profile: norm(validation && validation.ev_profile_top_mixed_profile),
    best_candidate_top_mixed_driver: norm(validation && validation.ev_profile_top_mixed_driver),
    best_validation_verdict: bestVerdict,
    best_objective_delta: bestObjectiveDelta,
    total_n: toNum(summary.total_n),
    pass_n: toNum(summary.pass_n),
    warn_n: toNum(summary.warn_n),
    block_n: toNum(summary.block_n),
    dominant_issue: dominantIssue,
    issue_breakdown: issueBreakdown,
    best_issue_breakdown: bestIssueBreakdown,
    best_validation_summary: norm(validation && validation.summary),
    best_validation_mode: norm(validation && validation.validation_mode),
    best_historical_match_n: toNum(validation && validation.historical_match_n),
    best_historical_realized_match_n: toNum(validation && validation.historical_realized_match_n),
    best_historical_applied_n: toNum(validation && validation.historical_applied_n),
    blocking_reason_n: blockingReasons.length,
    blocking_reasons: blockingReasons,
  };
}

module.exports = {
  buildMlReplayEvidence,
};
