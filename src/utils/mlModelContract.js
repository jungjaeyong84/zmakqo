"use strict";

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  return value.summary && typeof value.summary === "object" ? value.summary : value;
}

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildMlModelContract({
  trainRun = null,
  experimentRegistry = null,
  canary = null,
  mlRollbackArm = null,
  serverPrimaryCanary = null,
} = {}) {
  const trainRunSummary = readSummary(trainRun);
  const registrySummary = readSummary(experimentRegistry);
  const canarySummary = readSummary(canary);
  const rollbackArmSummary = readSummary(mlRollbackArm);
  const serverPrimarySummary = readSummary(serverPrimaryCanary);

  const trainRunStatus = toUpper(trainRunSummary.status) || "N_A";
  const hasTrainRun = trainRunStatus === "ML_TRAIN_RUN_REPORTED" && String(trainRunSummary.train_run_id || "").trim();
  const qualityGateReady = trainRunSummary.quality_gate_ready === true;
  const qualityGateStatus = toUpper(trainRunSummary.quality_gate_status) || "N_A";
  const globalCanaryPass = canarySummary.global_canary_pass === true && canarySummary.apply_pass === true;
  const serverPrimaryPass = serverPrimarySummary.apply_pass === true && serverPrimarySummary.acceptance_ready === true;
  const rollbackReady = rollbackArmSummary.rollback_arm_ready === true;

  let status = "ML_MODEL_CONTRACT_INCOMPLETE";
  let deploymentStage = "NOT_READY";
  let canaryGateStatus = "NOT_STARTED";
  let promotionStatus = "HOLD";
  if (hasTrainRun) {
    status = "ML_MODEL_CONTRACT_OFFLINE_ONLY";
    deploymentStage = "OFFLINE_ONLY";
    if (!qualityGateReady) {
      canaryGateStatus = "BLOCK_MODEL_QUALITY";
      promotionStatus = "HOLD_MODEL_QUALITY";
    } else if (globalCanaryPass && rollbackReady && serverPrimaryPass) {
      status = "ML_MODEL_CONTRACT_CANARY_READY";
      deploymentStage = "CANARY_READY";
      canaryGateStatus = "PASS";
      promotionStatus = "READY_FOR_REVIEW";
    } else if (!globalCanaryPass) {
      canaryGateStatus = "BLOCK_GLOBAL_CANARY";
      promotionStatus = "HOLD_OFFLINE_ONLY";
    } else if (!rollbackReady) {
      canaryGateStatus = "BLOCK_ROLLBACK_NOT_ARMED";
      promotionStatus = "HOLD_ROLLBACK_NOT_ARMED";
    } else if (!serverPrimaryPass) {
      canaryGateStatus = "BLOCK_SERVER_PRIMARY";
      promotionStatus = "HOLD_SERVER_PRIMARY";
    }
  }

  return {
    status,
    deployment_stage: deploymentStage,
    experiment_id: String(trainRunSummary.experiment_id || registrySummary.experiment_id || "").trim() || null,
    dataset_version_id: String(trainRunSummary.dataset_version_id || registrySummary.dataset_version_id || "").trim() || null,
    feature_store_version_id: String(trainRunSummary.feature_store_version_id || registrySummary.feature_store_version_id || "").trim() || null,
    execution_dataset_version_id: String(trainRunSummary.execution_dataset_version_id || registrySummary.execution_dataset_version_id || "").trim() || null,
    train_run_status: trainRunStatus,
    train_run_id: String(trainRunSummary.train_run_id || "").trim() || null,
    model_kind: String(trainRunSummary.model_kind || "").trim() || null,
    model_artifact_id: String(trainRunSummary.model_artifact_id || "").trim() || null,
    quality_gate_status: qualityGateStatus,
    quality_gate_ready: qualityGateReady,
    canary_gate_status: canaryGateStatus,
    server_primary_gate_status: serverPrimaryPass ? "PASS" : "BLOCK",
    rollback_status: rollbackReady ? "READY" : "NOT_ARMED",
    rollback_arm_status: String(rollbackArmSummary.status || "").trim() || null,
    rollback_evidence_status: String(rollbackArmSummary.evidence_status || "").trim() || null,
    rollback_binding_source: String(rollbackArmSummary.rollback_binding_source || "").trim() || null,
    rollback_target_path: String(rollbackArmSummary.rollback_target_path || "").trim() || null,
    rollback_engine_bundle_id: String(rollbackArmSummary.rollback_engine_bundle_id || "").trim() || null,
    promotion_status: promotionStatus,
    metrics_snapshot: trainRunSummary.metrics_snapshot && typeof trainRunSummary.metrics_snapshot === "object"
      ? trainRunSummary.metrics_snapshot
      : null,
  };
}

module.exports = {
  buildMlModelContract,
};
