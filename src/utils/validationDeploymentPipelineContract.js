"use strict";

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  if (value.display && typeof value.display === "object") return value.display;
  return value;
}

function readSummary(value) {
  const raw = unwrapRawReport(value) || {};
  return raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function deriveValidationDeploymentPipelineContract({
  executionServingContract = null,
  mlPromotionGate = null,
  mlRollbackArm = null,
  mlGlobalCanaryEvidence = null,
  serverPrimaryCanary = null,
} = {}) {
  const serving = readSummary(executionServingContract);
  const promotion = readSummary(mlPromotionGate);
  const rollback = readSummary(mlRollbackArm);
  const globalCanary = readSummary(mlGlobalCanaryEvidence);
  const serverPrimary = readSummary(serverPrimaryCanary);

  const shadowNumericGateReady = serving.shadow_ready === true
    && upper(serving.serving_stage) === "SHADOW_READY"
    && upper(serving.scope_quality_gate_status) === "QUALITY_GATE_PASS";
  const canaryNumericGateReady = upper(promotion.global_canary_gate_status) === "PASS"
    && promotion.model_specific_canary_ready === true;
  const liveNumericGateReady = canaryNumericGateReady
    && rollback.rollback_arm_ready === true
    && upper(promotion.server_primary_gate_status) === "PASS";
  const automaticRollbackReady = rollback.rollback_arm_ready === true
    && upper(rollback.evidence_status) === "ROLLBACK_ARM_EVIDENCE_READY";
  const numericJudgementReady = upper(promotion.replay_gate_status) === "PASS"
    && upper(promotion.shadow_gate_status) === "PASS"
    && automaticRollbackReady;

  const blockingReasons = [];
  if (!shadowNumericGateReady) blockingReasons.push("SHADOW_NUMERIC_GATE_NOT_READY");
  if (!automaticRollbackReady) blockingReasons.push("AUTOMATIC_ROLLBACK_NOT_READY");
  if (!canaryNumericGateReady) blockingReasons.push("CANARY_NUMERIC_GATE_NOT_READY");
  if (!liveNumericGateReady) blockingReasons.push("LIVE_NUMERIC_GATE_NOT_READY");

  const status = blockingReasons.length === 0
    ? "VALIDATION_DEPLOYMENT_PIPELINE_CONTRACT_READY"
    : (shadowNumericGateReady || automaticRollbackReady
      ? "VALIDATION_DEPLOYMENT_PIPELINE_CONTRACT_BOOTSTRAPPING"
      : "VALIDATION_DEPLOYMENT_PIPELINE_CONTRACT_BLOCKED");

  return {
    status,
    contract_mode: "SHADOW_CANARY_LIVE_NUMERIC_GATES",
    current_deployment_stage: String(promotion.promotion_stage || serving.serving_stage || "").trim() || null,
    shadow_numeric_gate_ready: shadowNumericGateReady,
    canary_numeric_gate_ready: canaryNumericGateReady,
    live_numeric_gate_ready: liveNumericGateReady,
    numeric_judgement_ready: numericJudgementReady,
    automatic_rollback_ready: automaticRollbackReady,
    serving_stage: String(serving.serving_stage || "").trim() || null,
    serving_decision: String(serving.serving_decision || "").trim() || null,
    promotion_stage: String(promotion.promotion_stage || "").trim() || null,
    promotion_decision: String(promotion.promotion_decision || "").trim() || null,
    replay_gate_status: String(promotion.replay_gate_status || "").trim() || null,
    shadow_gate_status: String(promotion.shadow_gate_status || "").trim() || null,
    global_canary_gate_status: String(promotion.global_canary_gate_status || "").trim() || null,
    global_canary_evidence_status: String(globalCanary.evidence_status || promotion.global_canary_evidence_status || "").trim() || null,
    global_canary_dominant_blocker: String(globalCanary.dominant_blocker || promotion.global_canary_dominant_blocker || "").trim() || null,
    model_specific_canary_gate_status: String(promotion.model_specific_canary_gate_status || "").trim() || null,
    model_specific_canary_ready: promotion.model_specific_canary_ready === true,
    rollback_gate_status: String(promotion.rollback_gate_status || "").trim() || null,
    rollback_binding_source: String(rollback.rollback_binding_source || promotion.rollback_binding_source || "").trim() || null,
    rollback_target_path: String(rollback.rollback_target_path || "").trim() || null,
    preferred_model_family: String(promotion.preferred_model_family || serving.preferred_model_family || "").trim() || null,
    preferred_model_artifact_id: String(promotion.preferred_model_artifact_id || serving.preferred_model_artifact_id || "").trim() || null,
    preferred_train_run_id: String(promotion.preferred_train_run_id || serving.preferred_train_run_id || "").trim() || null,
    replay_sample_gap_n: toNum(globalCanary.replay_sample_gap_n || promotion.global_canary_replay_sample_gap_n),
    replay_projected_ready_if_gap_closed: globalCanary.replay_projected_ready_if_sample_gap_closed === true
      || promotion.global_canary_replay_projected_ready_if_sample_gap_closed === true,
    replay_projected_residual_issue_after_sample_gap_closed: String(
      globalCanary.replay_projected_residual_issue_after_sample_gap_closed
      || promotion.global_canary_replay_projected_residual_issue_after_sample_gap_closed
      || ""
    ).trim() || null,
    server_primary_acceptance_ready: serverPrimary.acceptance_ready === true,
    blocking_reason_n: blockingReasons.length,
    blocking_reasons: blockingReasons,
  };
}

module.exports = {
  deriveValidationDeploymentPipelineContract,
};
