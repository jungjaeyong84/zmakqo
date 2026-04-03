"use strict";

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  if (value.display && typeof value.display === "object") return value.display;
  return value;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function extractObjectiveScore(value) {
  const summary = value && typeof value === "object" ? value : {};
  const nested = summary.global_objective_score && typeof summary.global_objective_score === "object"
    ? summary.global_objective_score
    : null;
  return toNum(summary.global_score)
    ?? toNum(summary.objective_score)
    ?? toNum(summary.global_objective_score)
    ?? toNum(nested && nested.objective_score);
}

function deriveObjectiveScoreSnapshot({
  objective = null,
  objectiveSupervisor = null,
  autonomyContract = null,
  objectiveRecoveryGovernor = null,
  objectiveRecoveryEffect = null,
} = {}) {
  const objectiveRaw = unwrapRawReport(objective) || {};
  const supervisorRaw = unwrapRawReport(objectiveSupervisor) || {};
  const contractRaw = unwrapRawReport(autonomyContract) || {};
  const governorRaw = unwrapRawReport(objectiveRecoveryGovernor) || {};
  const effectRaw = unwrapRawReport(objectiveRecoveryEffect) || {};

  const supervisorObjective = supervisorRaw.self_evolution_objective && typeof supervisorRaw.self_evolution_objective === "object"
    ? supervisorRaw.self_evolution_objective
    : (supervisorRaw.objective && typeof supervisorRaw.objective === "object" ? supervisorRaw.objective : null);
  const contractStatus = contractRaw.current_status && typeof contractRaw.current_status === "object"
    ? contractRaw.current_status
    : contractRaw;
  const governorSummary = governorRaw.summary && typeof governorRaw.summary === "object" ? governorRaw.summary : governorRaw;
  const effectSummary = effectRaw.summary && typeof effectRaw.summary === "object" ? effectRaw.summary : effectRaw;

  const candidates = [
    { source: "OBJECTIVE", score: extractObjectiveScore(objectiveRaw) },
    { source: "OBJECTIVE_SUPERVISOR", score: extractObjectiveScore(supervisorObjective) },
    { source: "AUTONOMY_CONTRACT", score: toNum(contractStatus.objective_score) ?? extractObjectiveScore(contractStatus) },
    { source: "OBJECTIVE_RECOVERY_GOVERNOR", score: toNum(governorSummary.objective_score) },
    { source: "OBJECTIVE_RECOVERY_EFFECT", score: toNum(effectSummary.current_objective_score) },
  ];

  const hit = candidates.find((row) => row.score != null) || null;
  return {
    objective_score: hit ? hit.score : null,
    objective_score_source: hit ? hit.source : null,
  };
}

module.exports = {
  unwrapRawReport,
  toNum,
  extractObjectiveScore,
  deriveObjectiveScoreSnapshot,
};
