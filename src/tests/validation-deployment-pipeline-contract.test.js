"use strict";

const assert = require("assert");
const {
  deriveValidationDeploymentPipelineContract,
} = require("../../src/utils/validationDeploymentPipelineContract");

(() => {
  const report = deriveValidationDeploymentPipelineContract({
    executionServingContract: {
      summary: {
        serving_stage: "SHADOW_READY",
        serving_decision: "ENABLE_SCOPE_SHADOW",
        shadow_ready: true,
        scope_quality_gate_status: "QUALITY_GATE_PASS",
        preferred_model_family: "EXECUTION_SCOPE",
        preferred_model_artifact_id: "MODEL_EXEC_SCOPE__1",
        preferred_train_run_id: "TRAIN_EXEC_SCOPE__1",
      },
    },
    mlPromotionGate: {
      summary: {
        promotion_stage: "CANARY_READY",
        promotion_decision: "READY_FOR_CANARY_REVIEW",
        replay_gate_status: "PASS",
        shadow_gate_status: "PASS",
        global_canary_gate_status: "PASS",
        model_specific_canary_gate_status: "PASS",
        model_specific_canary_ready: true,
        rollback_gate_status: "READY",
        server_primary_gate_status: "PASS",
      },
    },
    mlRollbackArm: {
      summary: {
        rollback_arm_ready: true,
        evidence_status: "ROLLBACK_ARM_EVIDENCE_READY",
        rollback_binding_source: "DEPLOYMENT_PLAN",
        rollback_target_path: "/tmp/x",
      },
    },
    mlGlobalCanaryEvidence: {
      summary: {
        evidence_status: "GLOBAL_CANARY_PASS",
        dominant_blocker: null,
        replay_sample_gap_n: 0,
        replay_projected_ready_if_gap_closed: true,
      },
    },
    serverPrimaryCanary: { summary: { acceptance_ready: true } },
  });

  assert.strictEqual(report.status, "VALIDATION_DEPLOYMENT_PIPELINE_CONTRACT_READY");
  assert.strictEqual(report.shadow_numeric_gate_ready, true);
  assert.strictEqual(report.canary_numeric_gate_ready, true);
  assert.strictEqual(report.live_numeric_gate_ready, true);
  assert.strictEqual(report.automatic_rollback_ready, true);
  assert.deepStrictEqual(report.blocking_reasons, []);
})();

(() => {
  const report = deriveValidationDeploymentPipelineContract({
    executionServingContract: {
      summary: {
        serving_stage: "SHADOW_READY",
        shadow_ready: true,
        scope_quality_gate_status: "QUALITY_GATE_PASS",
      },
    },
    mlPromotionGate: {
      summary: {
        promotion_stage: "SHADOW_READY",
        promotion_decision: "HOLD_MODEL_SPECIFIC_CANARY",
        replay_gate_status: "PASS",
        shadow_gate_status: "PASS",
        global_canary_gate_status: "BLOCK",
        global_canary_evidence_status: "GLOBAL_CANARY_REPLAY_BLOCKED",
        global_canary_dominant_blocker: "SELF_EVOLUTION_REPLAY_NOT_PASS",
        model_specific_canary_gate_status: "BLOCK",
        model_specific_canary_ready: false,
        rollback_gate_status: "READY",
        server_primary_gate_status: "PASS",
      },
    },
    mlRollbackArm: {
      summary: {
        rollback_arm_ready: true,
        evidence_status: "ROLLBACK_ARM_EVIDENCE_READY",
      },
    },
    mlGlobalCanaryEvidence: {
      summary: {
        evidence_status: "GLOBAL_CANARY_REPLAY_BLOCKED",
        dominant_blocker: "SELF_EVOLUTION_REPLAY_NOT_PASS",
        replay_sample_gap_n: 1,
        replay_projected_ready_if_gap_closed: false,
        replay_projected_residual_issue_after_sample_gap_closed: "NEGATIVE_OBJECTIVE_DELTA",
      },
    },
    serverPrimaryCanary: { summary: { acceptance_ready: true } },
  });

  assert.strictEqual(report.status, "VALIDATION_DEPLOYMENT_PIPELINE_CONTRACT_BOOTSTRAPPING");
  assert.strictEqual(report.shadow_numeric_gate_ready, true);
  assert.strictEqual(report.canary_numeric_gate_ready, false);
  assert.strictEqual(report.live_numeric_gate_ready, false);
  assert.strictEqual(report.automatic_rollback_ready, true);
  assert.ok(report.blocking_reasons.includes("CANARY_NUMERIC_GATE_NOT_READY"));
  assert.ok(report.blocking_reasons.includes("LIVE_NUMERIC_GATE_NOT_READY"));
})();

console.log("VALIDATION_DEPLOYMENT_PIPELINE_CONTRACT_TEST_OK");
