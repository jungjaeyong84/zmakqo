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
    if (!key) continue;
    counts.set(key, (counts.get(key) || 0) + 1);
  }
  return Array.from(counts.entries())
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0) || String(a[0]).localeCompare(String(b[0])))
    .map(([key, count]) => ({ key, count }));
}

function buildMlGlobalCanaryEvidence({
  canary = null,
  replayEvidence = null,
  evReplaySampleGap = null,
  replayUnblockProjection = null,
} = {}) {
  const summary = readSummary(canary);
  const replay = readSummary(replayEvidence);
  const sampleGap = readSummary(evReplaySampleGap);
  const replayProjection = readSummary(replayUnblockProjection);
  const rows = Array.isArray(canary && canary.rows) ? canary.rows : [];

  const totalN = toNum(summary.total_n) || rows.length;
  const blockedN = toNum(summary.blocked_n) || 0;
  const readyN = toNum(summary.ready_n) || 0;
  const rollbackReadyN = toNum(summary.rollback_ready_n) || 0;
  const globalCanaryPass = summary.global_canary_pass === true;
  const applyPass = summary.apply_pass === true;
  const shadowGlobalDrift = toNum(summary.shadow_global_drift) || 0;
  const goldenGlobalDrift = toNum(summary.golden_global_drift) || 0;
  const blockerCounts = summarizeCounts(
    rows.flatMap((row) => Array.isArray(row && row.blockers) ? row.blockers : [])
  );
  const stageCounts = summarizeCounts(rows.map((row) => row && row.current_stage));
  const verdictCounts = summarizeCounts(rows.map((row) => row && row.canary_verdict));
  const dominantBlocker = blockerCounts[0] && blockerCounts[0].key || null;
  const replayEvidenceStatus = norm(replay.evidence_status);
  const replayDominantIssue = norm(replay.dominant_issue);

  const blockingReasons = [];
  if (!globalCanaryPass || !applyPass) {
    if (rollbackReadyN > 0) blockingReasons.push("GLOBAL_CANARY_ROLLBACK_READY");
    if (shadowGlobalDrift > 0) blockingReasons.push("GLOBAL_CANARY_GLOBAL_SHADOW_DRIFT");
    if (goldenGlobalDrift > 0) blockingReasons.push("GLOBAL_CANARY_GLOBAL_GOLDEN_DRIFT");
    if (dominantBlocker) blockingReasons.push(`GLOBAL_CANARY_BLOCKER_${dominantBlocker}`);
    if (!blockingReasons.length) blockingReasons.push("GLOBAL_CANARY_APPLY_BLOCKED");
  }

  let evidenceStatus = "GLOBAL_CANARY_EVIDENCE_READY";
  if (globalCanaryPass && applyPass) evidenceStatus = "GLOBAL_CANARY_PASS_READY";
  else if (rollbackReadyN > 0) evidenceStatus = "GLOBAL_CANARY_ROLLBACK_READY";
  else if (shadowGlobalDrift > 0 || goldenGlobalDrift > 0) evidenceStatus = "GLOBAL_CANARY_DRIFT_BLOCKED";
  else if (dominantBlocker === "SELF_EVOLUTION_REPLAY_NOT_PASS") evidenceStatus = "GLOBAL_CANARY_REPLAY_BLOCKED";
  else if (dominantBlocker === "WAVE_NOT_OPEN") evidenceStatus = "GLOBAL_CANARY_WAVE_BLOCKED";
  else if (dominantBlocker === "OBJECTIVE_SCORE_NEGATIVE") evidenceStatus = "GLOBAL_CANARY_OBJECTIVE_BLOCKED";
  else if (dominantBlocker) evidenceStatus = `GLOBAL_CANARY_BLOCKED_${dominantBlocker}`;
  else if (!applyPass) evidenceStatus = "GLOBAL_CANARY_APPLY_BLOCKED";

  return {
    status: "ML_GLOBAL_CANARY_EVIDENCE_READY",
    global_canary_ready: globalCanaryPass && applyPass,
    evidence_status: evidenceStatus,
    total_n: totalN,
    ready_n: readyN,
    blocked_n: blockedN,
    rollback_ready_n: rollbackReadyN,
    global_canary_pass: globalCanaryPass,
    apply_pass: applyPass,
    shadow_global_drift: shadowGlobalDrift,
    golden_global_drift: goldenGlobalDrift,
    dominant_blocker: dominantBlocker,
    replay_evidence_status: replayEvidenceStatus,
    replay_dominant_issue: replayDominantIssue,
    replay_sample_gap_status: norm(sampleGap.evidence_status),
    replay_sample_requirement_source: norm(sampleGap.requirement_source),
    replay_sample_required_realized_n: toNum(sampleGap.required_realized_n),
    replay_sample_current_effective_realized_n: toNum(sampleGap.governance_effective_realized_n),
    replay_sample_gap_n: toNum(sampleGap.governance_effective_gap_n),
    replay_sample_dominant_dimension: norm(sampleGap.dominant_sample_dimension),
    replay_projected_ready_if_sample_gap_closed: replayProjection.projected_replay_ready_if_sample_gap_closed === true,
    replay_projected_residual_issue_after_sample_gap_closed: norm(replayProjection.projected_residual_issue_after_sample_gap_closed),
    top_ready_market: norm(summary.top_ready_market),
    top_rollback_market: norm(summary.top_rollback_market),
    top_shadow_drift_market: norm(summary.top_shadow_drift_market),
    top_golden_drift_market: norm(summary.top_golden_drift_market),
    current_open_wave: toNum(summary.current_open_wave),
    open_wave: toNum(summary.open_wave),
    scale_allowed: summary.scale_allowed === true,
    scale_block_reason: norm(summary.scale_block_reason),
    model_binding_source: norm(summary.model_binding_source),
    model_artifact_id: norm(summary.model_artifact_id),
    train_run_id: norm(summary.train_run_id),
    blocker_breakdown: blockerCounts,
    stage_breakdown: stageCounts,
    verdict_breakdown: verdictCounts,
    blocking_reason_n: blockingReasons.length,
    blocking_reasons: blockingReasons,
  };
}

module.exports = {
  buildMlGlobalCanaryEvidence,
};
