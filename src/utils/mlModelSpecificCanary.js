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

function sameNonEmpty(a, b) {
  return Boolean(norm(a) && norm(b) && norm(a) === norm(b));
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

function uniqueNonEmpty(values = []) {
  return Array.from(new Set(
    (Array.isArray(values) ? values : [])
      .map((value) => norm(value))
      .filter(Boolean)
  ));
}

function buildMlModelSpecificCanary({
  executionServingContract = null,
  executionScopeTrainRun = null,
  canary = null,
} = {}) {
  const serving = readSummary(executionServingContract);
  const scopeTrain = readSummary(executionScopeTrainRun);
  const canarySummary = readSummary(canary);
  const canaryRows = Array.isArray(canary && canary.rows) ? canary.rows : [];

  const preferredModelFamily = norm(serving.preferred_model_family) || "EXECUTION_SCOPE";
  const preferredModelKind = norm(serving.preferred_model_kind || scopeTrain.model_kind);
  const preferredModelArtifactId = norm(serving.preferred_model_artifact_id || scopeTrain.model_artifact_id);
  const preferredTrainRunId = norm(serving.preferred_train_run_id || scopeTrain.train_run_id);
  const preferredExperimentId = norm(serving.experiment_id || scopeTrain.experiment_id);

  const summaryModelArtifactId = norm(canarySummary.model_artifact_id);
  const summaryTrainRunId = norm(canarySummary.train_run_id);
  const rowModelArtifactIds = uniqueNonEmpty(canaryRows.map((row) => row && row.model_artifact_id));
  const rowTrainRunIds = uniqueNonEmpty(canaryRows.map((row) => row && row.train_run_id));

  let bindingMode = "MODEL_BINDING_MISSING";
  let boundModelArtifactId = null;
  let boundTrainRunId = null;

  if (summaryModelArtifactId || summaryTrainRunId) {
    bindingMode = "CANARY_SUMMARY_BINDING";
    boundModelArtifactId = summaryModelArtifactId;
    boundTrainRunId = summaryTrainRunId;
  } else if (rowModelArtifactIds.length === 1 || rowTrainRunIds.length === 1) {
    bindingMode = "CANARY_ROW_BINDING";
    boundModelArtifactId = rowModelArtifactIds.length === 1 ? rowModelArtifactIds[0] : null;
    boundTrainRunId = rowTrainRunIds.length === 1 ? rowTrainRunIds[0] : null;
  }

  const artifactAligned = preferredModelArtifactId
    ? sameNonEmpty(preferredModelArtifactId, boundModelArtifactId)
    : Boolean(boundModelArtifactId);
  const trainRunAligned = preferredTrainRunId
    ? sameNonEmpty(preferredTrainRunId, boundTrainRunId)
    : (preferredModelArtifactId ? true : Boolean(boundTrainRunId));
  const globalCanaryPass = canarySummary.global_canary_pass === true && canarySummary.apply_pass === true;
  const rollbackReadyN = toNum(canarySummary.rollback_ready_n) || 0;

  const blockingReasons = [];
  if (!globalCanaryPass) blockingReasons.push("GLOBAL_CANARY_NOT_READY");
  if (bindingMode === "MODEL_BINDING_MISSING") {
    blockingReasons.push("MODEL_SPECIFIC_CANARY_BINDING_MISSING");
  } else {
    if (!artifactAligned) blockingReasons.push("MODEL_SPECIFIC_CANARY_ARTIFACT_MISMATCH");
    if (!trainRunAligned) blockingReasons.push("MODEL_SPECIFIC_CANARY_TRAIN_RUN_MISMATCH");
  }

  let evidenceStatus = "MODEL_SPECIFIC_CANARY_EVIDENCE_READY";
  if (!globalCanaryPass) evidenceStatus = "MODEL_SPECIFIC_CANARY_GLOBAL_NOT_READY";
  else if (bindingMode === "MODEL_BINDING_MISSING") evidenceStatus = "MODEL_SPECIFIC_CANARY_BINDING_MISSING";
  else if (!artifactAligned) evidenceStatus = "MODEL_SPECIFIC_CANARY_ARTIFACT_MISMATCH";
  else if (!trainRunAligned) evidenceStatus = "MODEL_SPECIFIC_CANARY_TRAIN_RUN_MISMATCH";

  return {
    status: "ML_MODEL_SPECIFIC_CANARY_READY",
    preferred_model_family: preferredModelFamily,
    preferred_model_kind: preferredModelKind,
    preferred_model_artifact_id: preferredModelArtifactId,
    preferred_train_run_id: preferredTrainRunId,
    preferred_experiment_id: preferredExperimentId,
    canary_cycle_id: norm(canary && canary.cycle_id),
    canary_generated_at_kst: norm(canary && canary.generated_at_kst),
    global_canary_pass: canarySummary.global_canary_pass === true,
    apply_pass: canarySummary.apply_pass === true,
    rollback_ready_n: rollbackReadyN,
    total_row_n: canaryRows.length,
    candidate_scope_breakdown: summarizeCounts(canaryRows.map((row) => row && row.candidate_scope)),
    candidate_id_breakdown: summarizeCounts(canaryRows.map((row) => row && row.candidate_id)).slice(0, 10),
    candidate_scope_top: summarizeCounts(canaryRows.map((row) => row && row.candidate_scope))[0]?.key || null,
    binding_mode: bindingMode,
    bound_model_artifact_id: boundModelArtifactId,
    bound_train_run_id: boundTrainRunId,
    model_specific_canary_artifact_aligned: artifactAligned,
    model_specific_canary_train_run_aligned: trainRunAligned,
    model_specific_canary_ready: blockingReasons.length === 0,
    evidence_status: evidenceStatus,
    blocking_reason_n: blockingReasons.length,
    blocking_reasons: blockingReasons,
  };
}

module.exports = {
  buildMlModelSpecificCanary,
};
