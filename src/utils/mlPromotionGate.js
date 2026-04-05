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

function buildMlPromotionGate({
  truthPreservationAudit = null,
  executionServingContract = null,
  executionScopeTrainRun = null,
  canary = null,
  serverPrimaryCanary = null,
} = {}) {
  const truth = readSummary(truthPreservationAudit);
  const serving = readSummary(executionServingContract);
  const scopeTrain = readSummary(executionScopeTrainRun);
  const canarySummary = readSummary(canary);
  const serverPrimarySummary = readSummary(serverPrimaryCanary);

  const replayPass = truth.truth_preservation_ready === true && scopeTrain.quality_gate_ready === true;
  const shadowPass = serving.shadow_ready === true;
  const globalCanaryPass = canarySummary.global_canary_pass === true && canarySummary.apply_pass === true;
  const serverPrimaryPass = serverPrimarySummary.apply_pass === true && serverPrimarySummary.acceptance_ready === true;
  const rollbackReady = (toNum(canarySummary.rollback_ready_n) || 0) > 0;

  let promotion_stage = "OFFLINE_ONLY";
  let promotion_decision = "HOLD_OFFLINE_ONLY";
  if (!replayPass) {
    promotion_stage = "OFFLINE_ONLY";
    promotion_decision = "HOLD_REPLAY";
  } else if (!shadowPass) {
    promotion_stage = "OFFLINE_ONLY";
    promotion_decision = "HOLD_SHADOW_READINESS";
  } else if (!globalCanaryPass) {
    promotion_stage = "SHADOW_READY";
    promotion_decision = "HOLD_GLOBAL_CANARY";
  } else if (!rollbackReady) {
    promotion_stage = "SHADOW_READY";
    promotion_decision = "HOLD_ROLLBACK_NOT_ARMED";
  } else if (!serverPrimaryPass) {
    promotion_stage = "SHADOW_READY";
    promotion_decision = "HOLD_SERVER_PRIMARY";
  } else {
    promotion_stage = "CANARY_READY";
    promotion_decision = "READY_FOR_CANARY_REVIEW";
  }

  const blockingReasons = [];
  if (!replayPass) blockingReasons.push("REPLAY_GATE_NOT_READY");
  if (!shadowPass) blockingReasons.push("SHADOW_GATE_NOT_READY");
  if (!globalCanaryPass) blockingReasons.push("GLOBAL_CANARY_NOT_READY");
  if (!rollbackReady) blockingReasons.push("ROLLBACK_NOT_ARMED");
  if (!serverPrimaryPass) blockingReasons.push("SERVER_PRIMARY_NOT_READY");

  return {
    status: "ML_PROMOTION_GATE_READY",
    promotion_stage,
    promotion_decision,
    replay_gate_status: replayPass ? "PASS" : "BLOCK",
    shadow_gate_status: shadowPass ? "PASS" : "BLOCK",
    global_canary_gate_status: globalCanaryPass ? "PASS" : "BLOCK",
    server_primary_gate_status: serverPrimaryPass ? "PASS" : "BLOCK",
    rollback_gate_status: rollbackReady ? "READY" : "NOT_ARMED",
    preferred_model_family: String(serving.preferred_model_family || "").trim() || "EXECUTION_SCOPE",
    preferred_model_kind: String(serving.preferred_model_kind || scopeTrain.model_kind || "").trim() || null,
    preferred_model_artifact_id: String(serving.preferred_model_artifact_id || scopeTrain.model_artifact_id || "").trim() || null,
    preferred_train_run_id: String(serving.preferred_train_run_id || scopeTrain.train_run_id || "").trim() || null,
    truth_preservation_ready: truth.truth_preservation_ready === true,
    scope_quality_gate_ready: scopeTrain.quality_gate_ready === true,
    scope_mismatch_rate: toNum(serving.scope_inference_mismatch_rate),
    blocking_reason_n: blockingReasons.length,
    blocking_reasons: blockingReasons,
  };
}

module.exports = {
  buildMlPromotionGate,
};
