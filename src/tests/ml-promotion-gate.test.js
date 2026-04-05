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
    executionScopeTrainRun: { summary: { quality_gate_ready: true } },
    canary: { summary: { global_canary_pass: false, apply_pass: false, rollback_ready_n: 0 } },
    serverPrimaryCanary: { summary: { apply_pass: true, acceptance_ready: true } },
  });

  assert.strictEqual(shadowOnly.status, "ML_PROMOTION_GATE_READY");
  assert.strictEqual(shadowOnly.promotion_stage, "SHADOW_READY");
  assert.strictEqual(shadowOnly.promotion_decision, "HOLD_GLOBAL_CANARY");
  assert.strictEqual(shadowOnly.replay_gate_status, "PASS");
  assert.strictEqual(shadowOnly.shadow_gate_status, "PASS");
  assert.strictEqual(shadowOnly.global_canary_gate_status, "BLOCK");
  assert.strictEqual(shadowOnly.rollback_gate_status, "NOT_ARMED");

  const canaryReady = buildMlPromotionGate({
    truthPreservationAudit: { summary: { truth_preservation_ready: true } },
    executionServingContract: { summary: { shadow_ready: true, preferred_model_artifact_id: "MODEL_SCOPE__2" } },
    executionScopeTrainRun: { summary: { quality_gate_ready: true } },
    canary: { summary: { global_canary_pass: true, apply_pass: true, rollback_ready_n: 1 } },
    serverPrimaryCanary: { summary: { apply_pass: true, acceptance_ready: true } },
  });
  assert.strictEqual(canaryReady.promotion_stage, "CANARY_READY");
  assert.strictEqual(canaryReady.promotion_decision, "READY_FOR_CANARY_REVIEW");

  console.log("ML_PROMOTION_GATE_TEST_OK");
})();
