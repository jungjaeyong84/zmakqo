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

function buildMlPromotionGate({
  truthPreservationAudit = null,
  executionServingContract = null,
  executionScopeTrainRun = null,
  mlGlobalCanaryEvidence = null,
  modelSpecificCanary = null,
  mlRollbackArm = null,
  serverPrimaryCanary = null,
  eventTruthAlphaValidation = null,
  failureLearningLoop = null,
  feePnlKpiAuthority = null,
} = {}) {
  const truth = readSummary(truthPreservationAudit);
  const serving = readSummary(executionServingContract);
  const scopeTrain = readSummary(executionScopeTrainRun);
  const globalCanaryEvidenceSummary = readSummary(mlGlobalCanaryEvidence);
  const modelSpecificCanarySummary = readSummary(modelSpecificCanary);
  const rollbackArmSummary = readSummary(mlRollbackArm);
  const serverPrimarySummary = readSummary(serverPrimaryCanary);
  const alphaSummary = readSummary(eventTruthAlphaValidation);
  const failureLearningSummary = readSummary(failureLearningLoop);
  const feePnlSummary = readSummary(feePnlKpiAuthority);

  const preferredModelArtifactId = norm(serving.preferred_model_artifact_id || scopeTrain.model_artifact_id);
  const preferredTrainRunId = norm(serving.preferred_train_run_id || scopeTrain.train_run_id);
  const canaryModelArtifactId = norm(modelSpecificCanarySummary.bound_model_artifact_id);
  const canaryTrainRunId = norm(modelSpecificCanarySummary.bound_train_run_id);
  const replayPass = truth.truth_preservation_ready === true && scopeTrain.quality_gate_ready === true;
  const shadowPass = serving.shadow_ready === true;
  const globalCanaryPass = globalCanaryEvidenceSummary.global_canary_ready === true;
  const modelSpecificCanaryArtifactAligned = modelSpecificCanarySummary.model_specific_canary_artifact_aligned === true;
  const modelSpecificCanaryTrainRunAligned = modelSpecificCanarySummary.model_specific_canary_train_run_aligned === true;
  const modelSpecificCanaryReady = modelSpecificCanarySummary.model_specific_canary_ready === true;
  const serverPrimaryPass = serverPrimarySummary.apply_pass === true && serverPrimarySummary.acceptance_ready === true;
  const rollbackReady = rollbackArmSummary.rollback_arm_ready === true;
  const alphaPass = alphaSummary.alpha_ready === true;
  const failureLearningPass = !/FAIL_RATE_HIGH|NEGATIVE_DOMINANT/.test(String(failureLearningSummary.evidence_status || "").toUpperCase());
  const feePnlPass = feePnlSummary.kpi_ready === true && String(feePnlSummary.evidence_status || "").trim().toUpperCase() === "FEE_PNL_KPI_PASS";
  const bindingMode = toUpper(modelSpecificCanarySummary.binding_mode);
  const evidenceStatus = toUpper(modelSpecificCanarySummary.evidence_status);
  const globalCanaryEvidenceStatus = toUpper(globalCanaryEvidenceSummary.evidence_status);
  const rollbackBindingSource = norm(rollbackArmSummary.rollback_binding_source);
  const rollbackEvidenceStatus = toUpper(rollbackArmSummary.evidence_status);

  let promotion_stage = "OFFLINE_ONLY";
  let promotion_decision = "HOLD_OFFLINE_ONLY";
  if (!replayPass) {
    promotion_stage = "OFFLINE_ONLY";
    promotion_decision = "HOLD_REPLAY";
  } else if (!alphaPass) {
    promotion_stage = "OFFLINE_ONLY";
    promotion_decision = "HOLD_EVENT_TRUTH_ALPHA";
  } else if (!feePnlPass) {
    promotion_stage = "SHADOW_READY";
    promotion_decision = "HOLD_FEE_PNL_KPI";
  } else if (!failureLearningPass) {
    promotion_stage = "SHADOW_READY";
    promotion_decision = "HOLD_FAILURE_LEARNING";
  } else if (!shadowPass) {
    promotion_stage = "OFFLINE_ONLY";
    promotion_decision = "HOLD_SHADOW_READINESS";
  } else if (!modelSpecificCanaryReady) {
    promotion_stage = "SHADOW_READY";
    promotion_decision = "HOLD_MODEL_SPECIFIC_CANARY";
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
  if (!alphaPass) blockingReasons.push("EVENT_TRUTH_ALPHA_NOT_READY");
  if (!feePnlPass) blockingReasons.push("FEE_PNL_KPI_NOT_READY");
  if (!failureLearningPass) blockingReasons.push("FAILURE_LEARNING_NOT_READY");
  if (!shadowPass) blockingReasons.push("SHADOW_GATE_NOT_READY");
  if (!globalCanaryPass) blockingReasons.push("GLOBAL_CANARY_NOT_READY");
  if (bindingMode === "MODEL_BINDING_MISSING") blockingReasons.push("MODEL_SPECIFIC_CANARY_EVIDENCE_MISSING");
  if (bindingMode !== "MODEL_BINDING_MISSING" && (evidenceStatus === "MODEL_SPECIFIC_CANARY_ARTIFACT_MISMATCH" || !modelSpecificCanaryArtifactAligned)) {
    blockingReasons.push("MODEL_SPECIFIC_CANARY_ARTIFACT_MISMATCH");
  }
  if (bindingMode !== "MODEL_BINDING_MISSING" && (evidenceStatus === "MODEL_SPECIFIC_CANARY_TRAIN_RUN_MISMATCH" || (preferredTrainRunId && !modelSpecificCanaryTrainRunAligned))) {
    blockingReasons.push("MODEL_SPECIFIC_CANARY_TRAIN_RUN_MISMATCH");
  }
  if (!rollbackReady) blockingReasons.push("ROLLBACK_NOT_ARMED");
  if (!serverPrimaryPass) blockingReasons.push("SERVER_PRIMARY_NOT_READY");

  return {
    status: "ML_PROMOTION_GATE_READY",
    promotion_stage,
    promotion_decision,
    replay_gate_status: replayPass ? "PASS" : "BLOCK",
    shadow_gate_status: shadowPass ? "PASS" : "BLOCK",
    global_canary_gate_status: globalCanaryPass ? "PASS" : "BLOCK",
    global_canary_evidence_status: globalCanaryEvidenceStatus,
    global_canary_dominant_blocker: norm(globalCanaryEvidenceSummary.dominant_blocker),
    global_canary_replay_evidence_status: norm(globalCanaryEvidenceSummary.replay_evidence_status),
    global_canary_replay_dominant_issue: norm(globalCanaryEvidenceSummary.replay_dominant_issue),
    global_canary_replay_best_candidate_id: norm(globalCanaryEvidenceSummary.replay_best_candidate_id),
    global_canary_replay_best_display_candidate_id: norm(globalCanaryEvidenceSummary.replay_best_display_candidate_id),
    global_canary_replay_best_canonical_candidate_id: norm(globalCanaryEvidenceSummary.replay_best_canonical_candidate_id),
    global_canary_replay_best_candidate_review_mode: norm(globalCanaryEvidenceSummary.replay_best_candidate_review_mode),
    global_canary_replay_best_candidate_profile_target_n: toNum(globalCanaryEvidenceSummary.replay_best_candidate_profile_target_n),
    global_canary_replay_best_candidate_top_return_drag_profile: norm(globalCanaryEvidenceSummary.replay_best_candidate_top_return_drag_profile),
    global_canary_replay_best_candidate_top_return_drag_driver: norm(globalCanaryEvidenceSummary.replay_best_candidate_top_return_drag_driver),
    global_canary_replay_best_candidate_top_mixed_profile: norm(globalCanaryEvidenceSummary.replay_best_candidate_top_mixed_profile),
    global_canary_replay_best_candidate_top_mixed_driver: norm(globalCanaryEvidenceSummary.replay_best_candidate_top_mixed_driver),
    global_canary_replay_sample_gap_status: norm(globalCanaryEvidenceSummary.replay_sample_gap_status),
    global_canary_replay_sample_required_realized_n: toNum(globalCanaryEvidenceSummary.replay_sample_required_realized_n),
    global_canary_replay_sample_current_effective_realized_n: toNum(globalCanaryEvidenceSummary.replay_sample_current_effective_realized_n),
    global_canary_replay_sample_gap_n: toNum(globalCanaryEvidenceSummary.replay_sample_gap_n),
    global_canary_replay_sample_dominant_dimension: norm(globalCanaryEvidenceSummary.replay_sample_dominant_dimension),
    global_canary_replay_projected_ready_if_sample_gap_closed: globalCanaryEvidenceSummary.replay_projected_ready_if_sample_gap_closed === true,
    global_canary_replay_projected_residual_issue_after_sample_gap_closed: norm(globalCanaryEvidenceSummary.replay_projected_residual_issue_after_sample_gap_closed),
    model_specific_canary_gate_status: modelSpecificCanaryReady ? "PASS" : "BLOCK",
    server_primary_gate_status: serverPrimaryPass ? "PASS" : "BLOCK",
    rollback_gate_status: rollbackReady ? "READY" : "NOT_ARMED",
    rollback_binding_source: rollbackBindingSource,
    rollback_evidence_status: rollbackEvidenceStatus,
    rollback_arm_status: String(rollbackArmSummary.status || "").trim() || null,
    rollback_arm_ready: rollbackReady,
    rollback_target_path: norm(rollbackArmSummary.rollback_target_path),
    rollback_engine_bundle_id: norm(rollbackArmSummary.rollback_engine_bundle_id),
    model_specific_canary_status: String(modelSpecificCanarySummary.status || "").trim() || null,
    model_specific_canary_binding_mode: bindingMode,
    model_specific_canary_evidence_status: evidenceStatus,
    preferred_model_family: String(serving.preferred_model_family || "").trim() || "EXECUTION_SCOPE",
    preferred_model_kind: String(serving.preferred_model_kind || scopeTrain.model_kind || "").trim() || null,
    preferred_model_artifact_id: preferredModelArtifactId,
    preferred_train_run_id: preferredTrainRunId,
    canary_model_artifact_id: canaryModelArtifactId,
    canary_train_run_id: canaryTrainRunId,
    model_specific_canary_artifact_aligned: modelSpecificCanaryArtifactAligned,
    model_specific_canary_train_run_aligned: modelSpecificCanaryTrainRunAligned,
    model_specific_canary_ready: modelSpecificCanaryReady,
    truth_preservation_ready: truth.truth_preservation_ready === true,
    scope_quality_gate_ready: scopeTrain.quality_gate_ready === true,
    event_truth_alpha_gate_status: alphaPass ? "PASS" : "BLOCK",
    event_truth_alpha_status: String(alphaSummary.status || "").trim() || null,
    event_truth_alpha_evidence_status: norm(alphaSummary.evidence_status),
    event_truth_alpha_positive_rate: toNum(alphaSummary.positive_rate),
    event_truth_alpha_avg_realized_ret_net: toNum(alphaSummary.avg_realized_ret_net),
    fee_pnl_gate_status: feePnlPass ? "PASS" : "BLOCK",
    fee_pnl_status: String(feePnlSummary.status || "").trim() || null,
    fee_pnl_evidence_status: norm(feePnlSummary.evidence_status),
    fee_pnl_realized_n: toNum(feePnlSummary.realized_n),
    fee_pnl_cost_to_abs_realized_ratio: toNum(feePnlSummary.cost_to_abs_realized_ratio),
    fee_pnl_top_fee_drag_market: norm(feePnlSummary.top_fee_drag_market),
    failure_learning_gate_status: failureLearningPass ? "PASS" : "BLOCK",
    failure_learning_status: String(failureLearningSummary.status || "").trim() || null,
    failure_learning_evidence_status: norm(failureLearningSummary.evidence_status),
    failure_learning_fail_rate: toNum(failureLearningSummary.fail_rate),
    failure_learning_dominant_pattern: norm(failureLearningSummary.dominant_failure_pattern),
    scope_mismatch_rate: toNum(serving.scope_inference_mismatch_rate),
    blocking_reason_n: blockingReasons.length,
    blocking_reasons: blockingReasons,
  };
}

module.exports = {
  buildMlPromotionGate,
};
