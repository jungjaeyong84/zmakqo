"use strict";

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  return value.summary && typeof value.summary === "object" ? value.summary : value;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
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

function buildExecutionServingContract({
  truthPreservationAudit = null,
  executionScopeTrainRun = null,
  executionScopeInference = null,
  executionFillTrainRun = null,
  executionFillInference = null,
  mlModelContract = null,
  experimentRegistry = null,
  shadowCanaryGate = null,
} = {}) {
  const truth = readSummary(truthPreservationAudit);
  const scopeTrain = readSummary(executionScopeTrainRun);
  const scopeInference = readSummary(executionScopeInference);
  const fillTrain = readSummary(executionFillTrainRun);
  const fillInference = readSummary(executionFillInference);
  const modelContract = readSummary(mlModelContract);
  const registry = readSummary(experimentRegistry);
  const canaryGate = readSummary(shadowCanaryGate);

  const truthReady = truth.truth_preservation_ready === true;
  const scopeQualityReady = scopeTrain.quality_gate_ready === true;
  const scopeInferenceReady = toUpper(scopeInference.status) === "EXECUTION_SCOPE_INFERENCE_READY";
  const scopeArtifactAligned = sameNonEmpty(scopeTrain.model_artifact_id, scopeInference.model_artifact_id);
  const scopeTrainRunAligned = sameNonEmpty(scopeTrain.train_run_id, scopeInference.train_run_id);
  const scopeExperimentAligned = sameNonEmpty(scopeTrain.experiment_id, registry.experiment_id);
  const scopeDatasetVersionAligned = sameNonEmpty(scopeTrain.dataset_version_id, registry.dataset_version_id);
  const scopeFeatureStoreVersionAligned = sameNonEmpty(scopeTrain.feature_store_version_id, registry.feature_store_version_id);
  const scopeExecutionDatasetVersionAligned = sameNonEmpty(scopeTrain.execution_dataset_version_id, registry.execution_dataset_version_id);
  const scopeRegistryAligned = (
    scopeExperimentAligned
    && scopeDatasetVersionAligned
    && scopeFeatureStoreVersionAligned
    && scopeExecutionDatasetVersionAligned
  );
  const scopeMismatchRate = toNum(scopeInference.mismatch_rate);
  const scopeMismatchReady = scopeMismatchRate != null && scopeMismatchRate <= 0.10;

  const fillQualityReady = fillTrain.quality_gate_ready === true;
  const fillInferenceReady = toUpper(fillInference.status) === "EXECUTION_FILL_INFERENCE_READY";
  const shadowGatePass = canaryGate.promotion_blocked !== true;
  const shadowGateAvailable = Object.keys(canaryGate).length > 0;
  const modelCanaryReady = toUpper(modelContract.status) === "ML_MODEL_CONTRACT_CANARY_READY";

  const blockingReasons = [];
  if (!truthReady) blockingReasons.push("TRUTH_PRESERVATION_NOT_READY");
  if (!scopeQualityReady) blockingReasons.push("SCOPE_MODEL_QUALITY_NOT_READY");
  if (!scopeInferenceReady) blockingReasons.push("SCOPE_INFERENCE_NOT_READY");
  if (!scopeArtifactAligned) blockingReasons.push("SCOPE_MODEL_ARTIFACT_MISMATCH");
  if (!scopeTrainRunAligned) blockingReasons.push("SCOPE_TRAIN_RUN_MISMATCH");
  if (!scopeExperimentAligned) blockingReasons.push("SCOPE_EXPERIMENT_MISMATCH");
  if (!scopeDatasetVersionAligned) blockingReasons.push("SCOPE_DATASET_VERSION_MISMATCH");
  if (!scopeFeatureStoreVersionAligned) blockingReasons.push("SCOPE_FEATURE_STORE_VERSION_MISMATCH");
  if (!scopeExecutionDatasetVersionAligned) blockingReasons.push("SCOPE_EXECUTION_DATASET_VERSION_MISMATCH");
  if (!scopeMismatchReady) blockingReasons.push("SCOPE_MISMATCH_TOO_HIGH");
  if (shadowGateAvailable && !shadowGatePass) blockingReasons.push("SHADOW_CANARY_GATE_BLOCK");

  const warningReasons = [];
  if (!fillQualityReady) warningReasons.push("FILL_MODEL_QUALITY_NOT_READY");
  if (!fillInferenceReady) warningReasons.push("FILL_INFERENCE_NOT_READY");
  if (toUpper(modelContract.status) === "ML_MODEL_CONTRACT_OFFLINE_ONLY") warningReasons.push("GLOBAL_MODEL_CONTRACT_OFFLINE_ONLY");
  if (truth.stale_comparison_active === true) warningReasons.push("STALE_COMPARISON_ACTIVE");

  const shadowReady = blockingReasons.length === 0;

  let servingStage = "OFFLINE_ONLY";
  let servingDecision = "HOLD_OFFLINE_ONLY";
  if (!truthReady) {
    servingStage = "BLOCKED_TRUTH";
    servingDecision = "HOLD_TRUTH";
  } else if (!scopeQualityReady) {
    servingStage = "BLOCKED_SCOPE_QUALITY";
    servingDecision = "HOLD_SCOPE_QUALITY";
  } else if (!scopeInferenceReady) {
    servingStage = "BLOCKED_SCOPE_INFERENCE";
    servingDecision = "HOLD_SCOPE_INFERENCE";
  } else if (!scopeArtifactAligned) {
    servingStage = "BLOCKED_ARTIFACT_ALIGNMENT";
    servingDecision = "HOLD_SCOPE_ALIGNMENT";
  } else if (!scopeTrainRunAligned) {
    servingStage = "BLOCKED_TRAIN_RUN_ALIGNMENT";
    servingDecision = "HOLD_SCOPE_TRAIN_RUN_ALIGNMENT";
  } else if (!scopeRegistryAligned) {
    servingStage = "BLOCKED_REGISTRY_ALIGNMENT";
    servingDecision = "HOLD_SCOPE_REGISTRY_ALIGNMENT";
  } else if (!scopeMismatchReady) {
    servingStage = "BLOCKED_SCOPE_MISMATCH";
    servingDecision = "HOLD_SCOPE_MISMATCH";
  } else if (shadowGateAvailable && !shadowGatePass) {
    servingStage = "BLOCKED_SHADOW_CANARY";
    servingDecision = "ROLLBACK_SHADOW_CANARY";
  } else {
    servingStage = "SHADOW_READY";
    servingDecision = "ENABLE_SCOPE_SHADOW";
  }

  const liveServingAllowed = (
    shadowReady
    && shadowGatePass
    && modelCanaryReady
  );

  return {
    status: "EXECUTION_SERVING_CONTRACT_READY",
    serving_stage: servingStage,
    serving_decision: servingDecision,
    shadow_ready: shadowReady,
    live_serving_allowed: liveServingAllowed,
    preferred_model_family: "EXECUTION_SCOPE",
    preferred_model_kind: String(scopeTrain.model_kind || "").trim() || null,
    preferred_train_run_id: String(scopeTrain.train_run_id || "").trim() || null,
    preferred_model_artifact_id: String(scopeTrain.model_artifact_id || "").trim() || null,
    experiment_id: String(scopeTrain.experiment_id || registry.experiment_id || "").trim() || null,
    dataset_version_id: String(scopeTrain.dataset_version_id || registry.dataset_version_id || "").trim() || null,
    feature_store_version_id: String(scopeTrain.feature_store_version_id || registry.feature_store_version_id || "").trim() || null,
    execution_dataset_version_id: String(scopeTrain.execution_dataset_version_id || registry.execution_dataset_version_id || "").trim() || null,
    truth_preservation_ready: truthReady,
    scope_quality_gate_status: String(scopeTrain.quality_gate_status || "").trim().toUpperCase() || null,
    scope_quality_gate_ready: scopeQualityReady,
    scope_inference_status: toUpper(scopeInference.status) || null,
    scope_inference_mismatch_rate: scopeMismatchRate,
    scope_model_artifact_aligned: scopeArtifactAligned,
    scope_train_run_aligned: scopeTrainRunAligned,
    scope_experiment_aligned: scopeExperimentAligned,
    scope_dataset_version_aligned: scopeDatasetVersionAligned,
    scope_feature_store_version_aligned: scopeFeatureStoreVersionAligned,
    scope_execution_dataset_version_aligned: scopeExecutionDatasetVersionAligned,
    scope_registry_aligned: scopeRegistryAligned,
    fill_quality_gate_status: String(fillTrain.quality_gate_status || "").trim().toUpperCase() || null,
    fill_quality_gate_ready: fillQualityReady,
    fill_inference_status: toUpper(fillInference.status) || null,
    fill_inference_mismatch_rate: toNum(fillInference.mismatch_rate),
    global_model_contract_status: toUpper(modelContract.status) || null,
    global_model_contract_canary_gate_status: String(modelContract.canary_gate_status || "").trim().toUpperCase() || null,
    shadow_canary_gate_available: shadowGateAvailable,
    shadow_canary_gate_status: toUpper(canaryGate.status) || null,
    shadow_canary_gate_reason: toUpper(canaryGate.reason) || null,
    shadow_canary_gate_pass: shadowGatePass,
    blocking_reason_n: blockingReasons.length,
    blocking_reasons: blockingReasons,
    warning_reason_n: warningReasons.length,
    warning_reasons: warningReasons,
  };
}

module.exports = {
  buildExecutionServingContract,
};
