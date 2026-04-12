"use strict";

const assert = require("assert");
const { buildMlPromotionGate } = require("../utils/mlPromotionGate");

(() => {
  const shadowOnly = buildMlPromotionGate({
    truthPreservationAudit: { summary: { truth_preservation_ready: true } },
    executionServingContract: {
      summary: {
        shadow_ready: true,
        preferred_model_family: "EXECUTION_SCOPE",
        preferred_model_kind: "EXECUTION_SCOPE_OVR_LOGISTIC_V1",
        preferred_model_artifact_id: "MODEL_SCOPE__1",
        preferred_train_run_id: "TRAIN_SCOPE__1",
        scope_inference_mismatch_rate: 0.08,
      },
    },
    executionScopeTrainRun: { summary: { quality_gate_ready: true, train_run_id: "TRAIN_SCOPE__1" } },
    mlGlobalCanaryEvidence: {
      summary: {
        status: "ML_GLOBAL_CANARY_EVIDENCE_READY",
        global_canary_ready: false,
        evidence_status: "GLOBAL_CANARY_REPLAY_BLOCKED",
        dominant_blocker: "SELF_EVOLUTION_REPLAY_NOT_PASS",
        replay_evidence_status: "REPLAY_WARN_INSUFFICIENT_SAMPLE",
        replay_dominant_issue: "EV_TUNER_INSUFFICIENT_SAMPLE",
        replay_sample_gap_status: "EV_REPLAY_SAMPLE_GAP",
        replay_sample_required_realized_n: 8,
        replay_sample_current_effective_realized_n: 7,
        replay_sample_gap_n: 1,
        replay_sample_dominant_dimension: "GOVERNANCE_EFFECTIVE_REALIZED",
        replay_projected_ready_if_sample_gap_closed: false,
        replay_projected_residual_issue_after_sample_gap_closed: "NEGATIVE_OBJECTIVE_DELTA",
      },
    },
    eventTruthAlphaValidation: {
      summary: {
        status: "EVENT_TRUTH_ALPHA_VALIDATION_READY",
        alpha_ready: true,
        evidence_status: "EVENT_TRUTH_ALPHA_PASS",
        positive_rate: 0.57,
        avg_realized_ret_net: 0.0042,
      },
    },
    feePnlKpiAuthority: {
      summary: {
        status: "FEE_PNL_KPI_AUTHORITY_READY",
        kpi_ready: true,
        evidence_status: "FEE_PNL_KPI_PASS",
        realized_n: 48,
        cost_to_abs_realized_ratio: 0.18,
        top_fee_drag_market: "BTCUSDT",
      },
    },
    failureLearningLoop: {
      summary: {
        status: "FAILURE_LEARNING_LOOP_READY",
        learning_ready: true,
        evidence_status: "FAILURE_LEARNING_PASS",
        fail_rate: 0.33,
        dominant_failure_pattern: "TP0_NO_TP1_CONVERT",
      },
    },
    modelSpecificCanary: {
      summary: {
        status: "ML_MODEL_SPECIFIC_CANARY_READY",
        binding_mode: "MODEL_BINDING_MISSING",
        evidence_status: "MODEL_SPECIFIC_CANARY_BINDING_MISSING",
        global_canary_pass: false,
        apply_pass: false,
        rollback_ready_n: 0,
        model_specific_canary_artifact_aligned: false,
        model_specific_canary_train_run_aligned: false,
        model_specific_canary_ready: false,
      },
    },
    mlRollbackArm: {
      summary: {
        status: "ML_ROLLBACK_ARM_READY",
        rollback_arm_ready: false,
        rollback_binding_source: "DEPLOYMENT_PLAN",
        evidence_status: "ROLLBACK_ARM_TARGET_MISSING",
      },
    },
    serverPrimaryCanary: { summary: { apply_pass: true, acceptance_ready: true } },
  });

  assert.strictEqual(shadowOnly.status, "ML_PROMOTION_GATE_READY");
  assert.strictEqual(shadowOnly.promotion_stage, "SHADOW_READY");
  assert.strictEqual(shadowOnly.promotion_decision, "HOLD_MODEL_SPECIFIC_CANARY");
  assert.strictEqual(shadowOnly.replay_gate_status, "PASS");
  assert.strictEqual(shadowOnly.event_truth_alpha_gate_status, "PASS");
  assert.strictEqual(shadowOnly.failure_learning_gate_status, "PASS");
  assert.strictEqual(shadowOnly.shadow_gate_status, "PASS");
  assert.strictEqual(shadowOnly.global_canary_gate_status, "BLOCK");
  assert.strictEqual(shadowOnly.global_canary_evidence_status, "GLOBAL_CANARY_REPLAY_BLOCKED");
  assert.strictEqual(shadowOnly.global_canary_replay_evidence_status, "REPLAY_WARN_INSUFFICIENT_SAMPLE");
  assert.strictEqual(shadowOnly.global_canary_replay_sample_gap_status, "EV_REPLAY_SAMPLE_GAP");
  assert.strictEqual(shadowOnly.global_canary_replay_sample_gap_n, 1);
  assert.strictEqual(shadowOnly.global_canary_replay_projected_ready_if_sample_gap_closed, false);
  assert.strictEqual(shadowOnly.global_canary_replay_projected_residual_issue_after_sample_gap_closed, "NEGATIVE_OBJECTIVE_DELTA");
  assert.strictEqual(shadowOnly.model_specific_canary_gate_status, "BLOCK");
  assert.strictEqual(shadowOnly.model_specific_canary_binding_mode, "MODEL_BINDING_MISSING");
  assert.strictEqual(shadowOnly.model_specific_canary_evidence_status, "MODEL_SPECIFIC_CANARY_BINDING_MISSING");
  assert.strictEqual(shadowOnly.rollback_gate_status, "NOT_ARMED");
  assert.ok(shadowOnly.blocking_reasons.includes("MODEL_SPECIFIC_CANARY_EVIDENCE_MISSING"));

  const canaryReady = buildMlPromotionGate({
    truthPreservationAudit: { summary: { truth_preservation_ready: true } },
    executionServingContract: { summary: { shadow_ready: true, preferred_model_artifact_id: "MODEL_SCOPE__2", preferred_train_run_id: "TRAIN_SCOPE__2" } },
    executionScopeTrainRun: { summary: { quality_gate_ready: true, train_run_id: "TRAIN_SCOPE__2" } },
    mlGlobalCanaryEvidence: {
      summary: {
        status: "ML_GLOBAL_CANARY_EVIDENCE_READY",
        global_canary_ready: true,
        evidence_status: "GLOBAL_CANARY_PASS_READY",
        replay_evidence_status: "REPLAY_PASS_READY",
      },
    },
    eventTruthAlphaValidation: {
      summary: {
        status: "EVENT_TRUTH_ALPHA_VALIDATION_READY",
        alpha_ready: true,
        evidence_status: "EVENT_TRUTH_ALPHA_PASS",
        positive_rate: 0.61,
        avg_realized_ret_net: 0.0061,
      },
    },
    feePnlKpiAuthority: {
      summary: {
        status: "FEE_PNL_KPI_AUTHORITY_READY",
        kpi_ready: true,
        evidence_status: "FEE_PNL_KPI_PASS",
        realized_n: 64,
        cost_to_abs_realized_ratio: 0.14,
        top_fee_drag_market: "ETHUSDT",
      },
    },
    failureLearningLoop: {
      summary: {
        status: "FAILURE_LEARNING_LOOP_READY",
        learning_ready: true,
        evidence_status: "FAILURE_LEARNING_PASS",
        fail_rate: 0.28,
        dominant_failure_pattern: "SL_FIRST",
      },
    },
    modelSpecificCanary: {
      summary: {
        status: "ML_MODEL_SPECIFIC_CANARY_READY",
        binding_mode: "CANARY_SUMMARY_BINDING",
        evidence_status: "MODEL_SPECIFIC_CANARY_EVIDENCE_READY",
        global_canary_pass: true,
        apply_pass: true,
        rollback_ready_n: 1,
        preferred_model_artifact_id: "MODEL_SCOPE__2",
        preferred_train_run_id: "TRAIN_SCOPE__2",
        bound_model_artifact_id: "MODEL_SCOPE__2",
        bound_train_run_id: "TRAIN_SCOPE__2",
        model_specific_canary_artifact_aligned: true,
        model_specific_canary_train_run_aligned: true,
        model_specific_canary_ready: true,
      },
    },
    mlRollbackArm: {
      summary: {
        status: "ML_ROLLBACK_ARM_READY",
        rollback_arm_ready: true,
        rollback_binding_source: "DEPLOYMENT_PLAN",
        evidence_status: "ROLLBACK_ARM_EVIDENCE_READY",
      },
    },
    serverPrimaryCanary: { summary: { apply_pass: true, acceptance_ready: true } },
  });
  assert.strictEqual(canaryReady.promotion_stage, "CANARY_READY");
  assert.strictEqual(canaryReady.promotion_decision, "READY_FOR_CANARY_REVIEW");
  assert.strictEqual(canaryReady.model_specific_canary_gate_status, "PASS");
  assert.strictEqual(canaryReady.global_canary_gate_status, "PASS");
  assert.strictEqual(canaryReady.event_truth_alpha_gate_status, "PASS");
  assert.strictEqual(canaryReady.failure_learning_gate_status, "PASS");

  const alphaBlocked = buildMlPromotionGate({
    truthPreservationAudit: { summary: { truth_preservation_ready: true } },
    executionServingContract: { summary: { shadow_ready: true } },
    executionScopeTrainRun: { summary: { quality_gate_ready: true } },
    mlGlobalCanaryEvidence: { summary: { global_canary_ready: true, evidence_status: "GLOBAL_CANARY_PASS_READY" } },
    eventTruthAlphaValidation: {
      summary: {
        status: "EVENT_TRUTH_ALPHA_VALIDATION_READY",
        alpha_ready: false,
        evidence_status: "EVENT_TRUTH_ALPHA_NOT_POSITIVE",
      },
    },
    feePnlKpiAuthority: {
      summary: {
        status: "FEE_PNL_KPI_AUTHORITY_READY",
        kpi_ready: true,
        evidence_status: "FEE_PNL_KPI_PASS",
        realized_n: 36,
        cost_to_abs_realized_ratio: 0.16,
      },
    },
    failureLearningLoop: {
      summary: {
        status: "FAILURE_LEARNING_LOOP_READY",
        learning_ready: true,
        evidence_status: "FAILURE_LEARNING_PASS",
      },
    },
    modelSpecificCanary: { summary: { model_specific_canary_ready: true, model_specific_canary_artifact_aligned: true, model_specific_canary_train_run_aligned: true } },
    mlRollbackArm: { summary: { rollback_arm_ready: true } },
    serverPrimaryCanary: { summary: { apply_pass: true, acceptance_ready: true } },
  });
  assert.strictEqual(alphaBlocked.promotion_decision, "HOLD_EVENT_TRUTH_ALPHA");
  assert.strictEqual(alphaBlocked.event_truth_alpha_gate_status, "BLOCK");
  assert.ok(alphaBlocked.blocking_reasons.includes("EVENT_TRUTH_ALPHA_NOT_READY"));

  const failureBlocked = buildMlPromotionGate({
    truthPreservationAudit: { summary: { truth_preservation_ready: true } },
    executionServingContract: { summary: { shadow_ready: true } },
    executionScopeTrainRun: { summary: { quality_gate_ready: true } },
    mlGlobalCanaryEvidence: { summary: { global_canary_ready: true, evidence_status: "GLOBAL_CANARY_PASS_READY" } },
    eventTruthAlphaValidation: {
      summary: {
        status: "EVENT_TRUTH_ALPHA_VALIDATION_READY",
        alpha_ready: true,
        evidence_status: "EVENT_TRUTH_ALPHA_PASS",
      },
    },
    feePnlKpiAuthority: {
      summary: {
        status: "FEE_PNL_KPI_AUTHORITY_READY",
        kpi_ready: true,
        evidence_status: "FEE_PNL_KPI_PASS",
        realized_n: 52,
        cost_to_abs_realized_ratio: 0.19,
      },
    },
    failureLearningLoop: {
      summary: {
        status: "FAILURE_LEARNING_LOOP_READY",
        learning_ready: true,
        evidence_status: "FAILURE_LEARNING_FAIL_RATE_HIGH",
        fail_rate: 0.62,
      },
    },
    modelSpecificCanary: { summary: { model_specific_canary_ready: true, model_specific_canary_artifact_aligned: true, model_specific_canary_train_run_aligned: true } },
    mlRollbackArm: { summary: { rollback_arm_ready: true } },
    serverPrimaryCanary: { summary: { apply_pass: true, acceptance_ready: true } },
  });
  assert.strictEqual(failureBlocked.promotion_stage, "SHADOW_READY");
  assert.strictEqual(failureBlocked.promotion_decision, "HOLD_FAILURE_LEARNING");
  assert.strictEqual(failureBlocked.failure_learning_gate_status, "BLOCK");
  assert.ok(failureBlocked.blocking_reasons.includes("FAILURE_LEARNING_NOT_READY"));

  const failureReviewAllowed = buildMlPromotionGate({
    truthPreservationAudit: { summary: { truth_preservation_ready: true } },
    executionServingContract: { summary: { shadow_ready: true } },
    executionScopeTrainRun: { summary: { quality_gate_ready: true } },
    mlGlobalCanaryEvidence: { summary: { global_canary_ready: true, evidence_status: "GLOBAL_CANARY_PASS_READY" } },
    eventTruthAlphaValidation: {
      summary: {
        status: "EVENT_TRUTH_ALPHA_VALIDATION_READY",
        alpha_ready: true,
        evidence_status: "EVENT_TRUTH_ALPHA_PASS",
      },
    },
    feePnlKpiAuthority: {
      summary: {
        status: "FEE_PNL_KPI_AUTHORITY_READY",
        kpi_ready: true,
        evidence_status: "FEE_PNL_KPI_PASS",
      },
    },
    failureLearningLoop: {
      summary: {
        status: "FAILURE_LEARNING_LOOP_READY",
        learning_ready: true,
        evidence_status: "FAILURE_LEARNING_NEGATIVE_REVIEW",
        fail_rate: 0.28,
      },
    },
    modelSpecificCanary: { summary: { model_specific_canary_ready: true, model_specific_canary_artifact_aligned: true, model_specific_canary_train_run_aligned: true } },
    mlRollbackArm: { summary: { rollback_arm_ready: true } },
    serverPrimaryCanary: { summary: { apply_pass: true, acceptance_ready: true } },
  });
  assert.strictEqual(failureReviewAllowed.failure_learning_gate_status, "PASS");

  const feeBlocked = buildMlPromotionGate({
    truthPreservationAudit: { summary: { truth_preservation_ready: true } },
    executionServingContract: { summary: { shadow_ready: true } },
    executionScopeTrainRun: { summary: { quality_gate_ready: true } },
    mlGlobalCanaryEvidence: { summary: { global_canary_ready: true, evidence_status: "GLOBAL_CANARY_PASS_READY" } },
    eventTruthAlphaValidation: {
      summary: {
        status: "EVENT_TRUTH_ALPHA_VALIDATION_READY",
        alpha_ready: true,
        evidence_status: "EVENT_TRUTH_ALPHA_PASS",
      },
    },
    feePnlKpiAuthority: {
      summary: {
        status: "FEE_PNL_KPI_AUTHORITY_READY",
        kpi_ready: true,
        evidence_status: "FEE_PNL_KPI_REVIEW",
        realized_n: 80,
        cost_to_abs_realized_ratio: 0.39,
        top_fee_drag_market: "DOGEUSDT",
      },
    },
    failureLearningLoop: {
      summary: {
        status: "FAILURE_LEARNING_LOOP_READY",
        learning_ready: true,
        evidence_status: "FAILURE_LEARNING_PASS",
      },
    },
    modelSpecificCanary: { summary: { model_specific_canary_ready: true, model_specific_canary_artifact_aligned: true, model_specific_canary_train_run_aligned: true } },
    mlRollbackArm: { summary: { rollback_arm_ready: true } },
    serverPrimaryCanary: { summary: { apply_pass: true, acceptance_ready: true } },
  });
  assert.strictEqual(feeBlocked.promotion_decision, "HOLD_FEE_PNL_KPI");
  assert.strictEqual(feeBlocked.fee_pnl_gate_status, "BLOCK");
  assert.ok(feeBlocked.blocking_reasons.includes("FEE_PNL_KPI_NOT_READY"));

  console.log("ML_PROMOTION_GATE_TEST_OK");
})();
