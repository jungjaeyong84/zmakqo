"use strict";

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  return value;
}

function deriveDeploymentGuards({
  objectiveSupervisor = null,
  candidateChangeSet = null,
  replayReport = null,
  canaryReport = null,
  memoryLedger = null,
} = {}) {
  const supervisor = unwrapRawReport(objectiveSupervisor) || {};
  const promotion = supervisor.promotion && typeof supervisor.promotion === "object" ? supervisor.promotion : {};
  const rollback = supervisor.rollback && typeof supervisor.rollback === "object" ? supervisor.rollback : {};
  const objective = supervisor.self_evolution_objective && typeof supervisor.self_evolution_objective === "object"
    ? supervisor.self_evolution_objective
    : {};
  const candidates = unwrapRawReport(candidateChangeSet);
  const candidateSummary = candidates && candidates.summary && typeof candidates.summary === "object" ? candidates.summary : {};
  const replay = unwrapRawReport(replayReport);
  const replaySummary = replay && replay.summary && typeof replay.summary === "object" ? replay.summary : {};
  const validations = Array.isArray(replay && replay.validations) ? replay.validations : [];
  const canary = unwrapRawReport(canaryReport);
  const canarySummary = canary && canary.summary && typeof canary.summary === "object" ? canary.summary : {};
  const canaryRows = Array.isArray(canary && canary.rows) ? canary.rows : [];
  const memory = unwrapRawReport(memoryLedger);
  const memorySummary = memory && memory.summary && typeof memory.summary === "object" ? memory.summary : {};

  const targetCandidateId = String(
    promotion.candidate_id
    || replaySummary.best_candidate_id
    || candidateSummary.top_candidate_id
    || ""
  ).trim() || null;
  const targetReplay = targetCandidateId
    ? (validations.find((row) => String(row && row.candidate_id || "").trim() === targetCandidateId) || null)
    : null;
  const targetCanaryRows = targetCandidateId
    ? canaryRows.filter((row) => String(row && row.candidate_id || "").trim() === targetCandidateId)
    : [];
  const memoryBlockedIds = new Set(
    (Array.isArray(memorySummary.blocked_candidate_ids) ? memorySummary.blocked_candidate_ids : [])
      .map((row) => String(row || "").trim())
      .filter(Boolean)
  );

  const blockers = [];
  if (!targetCandidateId) blockers.push("NO_TARGET_CANDIDATE");
  if (objective.count_floor_pass === false) blockers.push("SELF_EVOLUTION_COUNT_FLOOR_FAIL");
  if (objective.replacement_floor_pass === false) blockers.push("SELF_EVOLUTION_REPLACEMENT_FLOOR_FAIL");
  if (objective.latency_budget_pass === false) blockers.push("SELF_EVOLUTION_LATENCY_BUDGET_FAIL");
  if (!targetReplay) blockers.push("SELF_EVOLUTION_REPLAY_MISSING");
  else if (String(targetReplay.validation_verdict || "").trim().toUpperCase() !== "PASS") blockers.push("SELF_EVOLUTION_REPLAY_NOT_PASS");
  if (canarySummary.apply_pass !== true) blockers.push("SELF_EVOLUTION_CANARY_APPLY_BLOCK");
  if (Number(canarySummary.rollback_ready_n || 0) > 0) blockers.push("SELF_EVOLUTION_CANARY_ROLLBACK_READY");
  if (memoryBlockedIds.has(targetCandidateId)) blockers.push("SELF_EVOLUTION_MEMORY_BLOCK");
  if (supervisor.guards && supervisor.guards.canary_pass === false) blockers.push("FILTER_CANARY_DRIFT");

  const deployPass = promotion.ready === true && blockers.length === 0;
  const rollbackOnly = rollback.ready === true && deployPass !== true;
  const rows = canaryRows.map((row) => ({
    market: String(row && row.market || "").trim().toUpperCase() || "UNKNOWN",
    wave: toNum(row && row.wave),
    current_stage: String(row && row.current_stage || "").trim().toUpperCase() || "SHADOW",
    candidate_id: String(row && row.candidate_id || "").trim() || null,
    deploy_pass: String(row && row.canary_verdict || "").trim().toUpperCase() === "READY"
      && (String(row && row.current_stage || "").trim().toUpperCase() === "SOFT"
        || String(row && row.current_stage || "").trim().toUpperCase() === "HARD"),
    blockers: Array.isArray(row && row.blockers) ? row.blockers.slice() : [],
  }));

  return {
    summary: {
      target_candidate_id: targetCandidateId,
      deploy_pass: deployPass,
      rollback_only: rollbackOnly,
      blockers,
      replay_verdict: String(targetReplay && targetReplay.validation_verdict || "").trim().toUpperCase() || null,
      canary_open_wave: toNum(canarySummary.open_wave) || 1,
      market_ready_n: rows.filter((row) => row.deploy_pass).length,
      market_total_n: rows.length,
      memory_blocked_candidate_n: toNum(memorySummary.blocked_candidate_n) || 0,
    },
    rows,
  };
}

module.exports = {
  deriveDeploymentGuards,
  unwrapRawReport,
};
