"use strict";

const assert = require("assert");
const { buildExecutionServingContract } = require("../utils/executionServingContract");

(() => {
  const ready = buildExecutionServingContract({
    truthPreservationAudit: { summary: { truth_preservation_ready: true, stale_comparison_active: true } },
    executionScopeTrainRun: { summary: { quality_gate_status: "QUALITY_GATE_PASS", quality_gate_ready: true, model_kind: "EXECUTION_SCOPE_OVR_LOGISTIC_V1", train_run_id: "TRAIN_SCOPE__1", model_artifact_id: "MODEL_SCOPE__1", experiment_id: "EXP__1", dataset_version_id: "DATA__1", feature_store_version_id: "FEAT__1", execution_dataset_version_id: "EXEC__1" } },
    executionScopeInference: { summary: { status: "EXECUTION_SCOPE_INFERENCE_READY", mismatch_rate: 0.08, model_artifact_id: "MODEL_SCOPE__1", train_run_id: "TRAIN_SCOPE__1" } },
    executionFillTrainRun: { summary: { quality_gate_status: "BALANCED_ACCURACY_TOO_LOW", quality_gate_ready: false } },
    executionFillInference: { summary: { status: "EXECUTION_FILL_INFERENCE_READY", mismatch_rate: 0.37 } },
    mlModelContract: { summary: { status: "ML_MODEL_CONTRACT_OFFLINE_ONLY", canary_gate_status: "BLOCK_MODEL_QUALITY" } },
    experimentRegistry: { summary: { experiment_id: "EXP__1", dataset_version_id: "DATA__1", feature_store_version_id: "FEAT__1", execution_dataset_version_id: "EXEC__1" } },
  });

  assert.strictEqual(ready.status, "EXECUTION_SERVING_CONTRACT_READY");
  assert.strictEqual(ready.serving_stage, "SHADOW_READY");
  assert.strictEqual(ready.shadow_ready, true);
  assert.strictEqual(ready.preferred_model_family, "EXECUTION_SCOPE");
  assert.strictEqual(ready.scope_model_artifact_aligned, true);
  assert.strictEqual(ready.scope_train_run_aligned, true);
  assert.strictEqual(ready.scope_registry_aligned, true);
  assert.ok(ready.warning_reasons.includes("FILL_MODEL_QUALITY_NOT_READY"));
  assert.strictEqual(ready.live_serving_allowed, false);

  const blocked = buildExecutionServingContract({
    truthPreservationAudit: { summary: { truth_preservation_ready: false } },
    executionScopeTrainRun: { summary: { quality_gate_status: "QUALITY_GATE_PASS", quality_gate_ready: true, train_run_id: "TRAIN_SCOPE__1", model_artifact_id: "MODEL_SCOPE__1", experiment_id: "EXP__OLD", dataset_version_id: "DATA__OLD", feature_store_version_id: "FEAT__OLD", execution_dataset_version_id: "EXEC__OLD" } },
    executionScopeInference: { summary: { status: "EXECUTION_SCOPE_INFERENCE_READY", mismatch_rate: 0.12, model_artifact_id: "MODEL_SCOPE__2", train_run_id: "TRAIN_SCOPE__2" } },
    experimentRegistry: { summary: { experiment_id: "EXP__NOW", dataset_version_id: "DATA__NOW", feature_store_version_id: "FEAT__NOW", execution_dataset_version_id: "EXEC__NOW" } },
  });

  assert.strictEqual(blocked.shadow_ready, false);
  assert.ok(blocked.blocking_reasons.includes("TRUTH_PRESERVATION_NOT_READY"));
  assert.ok(blocked.blocking_reasons.includes("SCOPE_MODEL_ARTIFACT_MISMATCH"));
  assert.ok(blocked.blocking_reasons.includes("SCOPE_TRAIN_RUN_MISMATCH"));
  assert.ok(blocked.blocking_reasons.includes("SCOPE_EXPERIMENT_MISMATCH"));
  assert.ok(blocked.blocking_reasons.includes("SCOPE_DATASET_VERSION_MISMATCH"));
  assert.ok(blocked.blocking_reasons.includes("SCOPE_FEATURE_STORE_VERSION_MISMATCH"));
  assert.ok(blocked.blocking_reasons.includes("SCOPE_EXECUTION_DATASET_VERSION_MISMATCH"));
  assert.ok(blocked.blocking_reasons.includes("SCOPE_MISMATCH_TOO_HIGH"));

  const liveReady = buildExecutionServingContract({
    truthPreservationAudit: { summary: { truth_preservation_ready: true } },
    executionScopeTrainRun: { summary: { quality_gate_status: "QUALITY_GATE_PASS", quality_gate_ready: true, model_kind: "EXECUTION_SCOPE_OVR_LOGISTIC_V1", train_run_id: "TRAIN_SCOPE__2", model_artifact_id: "MODEL_SCOPE__2", experiment_id: "EXP__2", dataset_version_id: "DATA__2", feature_store_version_id: "FEAT__2", execution_dataset_version_id: "EXEC__2" } },
    executionScopeInference: { summary: { status: "EXECUTION_SCOPE_INFERENCE_READY", mismatch_rate: 0.01, model_artifact_id: "MODEL_SCOPE__2", train_run_id: "TRAIN_SCOPE__2" } },
    executionFillTrainRun: { summary: { quality_gate_status: "QUALITY_GATE_PASS", quality_gate_ready: true } },
    executionFillInference: { summary: { status: "EXECUTION_FILL_INFERENCE_READY", mismatch_rate: 0.03 } },
    mlModelContract: { summary: { status: "ML_MODEL_CONTRACT_CANARY_READY", canary_gate_status: "PASS" } },
    experimentRegistry: { summary: { experiment_id: "EXP__2", dataset_version_id: "DATA__2", feature_store_version_id: "FEAT__2", execution_dataset_version_id: "EXEC__2" } },
    shadowCanaryGate: { summary: { status: "PASS", reason: "READY", promotion_blocked: false } },
  });

  assert.strictEqual(liveReady.serving_stage, "SHADOW_READY");
  assert.strictEqual(liveReady.live_serving_allowed, true);

  const gateBlocked = buildExecutionServingContract({
    truthPreservationAudit: { summary: { truth_preservation_ready: true } },
    executionScopeTrainRun: { summary: { quality_gate_status: "QUALITY_GATE_PASS", quality_gate_ready: true, train_run_id: "TRAIN_SCOPE__3", model_artifact_id: "MODEL_SCOPE__3", experiment_id: "EXP__3", dataset_version_id: "DATA__3", feature_store_version_id: "FEAT__3", execution_dataset_version_id: "EXEC__3" } },
    executionScopeInference: { summary: { status: "EXECUTION_SCOPE_INFERENCE_READY", mismatch_rate: 0.01, model_artifact_id: "MODEL_SCOPE__3", train_run_id: "TRAIN_SCOPE__3" } },
    experimentRegistry: { summary: { experiment_id: "EXP__3", dataset_version_id: "DATA__3", feature_store_version_id: "FEAT__3", execution_dataset_version_id: "EXEC__3" } },
    shadowCanaryGate: { summary: { status: "BLOCK", reason: "ROLLBACK", promotion_blocked: true } },
  });

  assert.strictEqual(gateBlocked.serving_stage, "BLOCKED_SHADOW_CANARY");
  assert.strictEqual(gateBlocked.live_serving_allowed, false);
  assert.ok(gateBlocked.blocking_reasons.includes("SHADOW_CANARY_GATE_BLOCK"));

  console.log("EXECUTION_SERVING_CONTRACT_TEST_OK");
})();
