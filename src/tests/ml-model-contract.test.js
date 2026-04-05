"use strict";

const assert = require("assert");
const { buildMlModelContract } = require("../utils/mlModelContract");

(() => {
  const offlineOnly = buildMlModelContract({
    trainRun: {
      summary: {
        status: "ML_TRAIN_RUN_REPORTED",
        train_run_id: "TRAIN__001",
        model_artifact_id: "MODEL__001",
        model_kind: "EXECUTION_FILL_LOGISTIC_V1",
      },
    },
    experimentRegistry: { summary: { experiment_id: "ML_BASELINE_ENV__abc123" } },
    canary: { summary: { global_canary_pass: false, apply_pass: false, rollback_ready_n: 0 } },
    serverPrimaryCanary: { summary: { apply_pass: true, acceptance_ready: true } },
  });
  assert.strictEqual(offlineOnly.status, "ML_MODEL_CONTRACT_OFFLINE_ONLY");
  assert.strictEqual(offlineOnly.canary_gate_status, "BLOCK_GLOBAL_CANARY");
  assert.strictEqual(offlineOnly.promotion_status, "HOLD_OFFLINE_ONLY");

  const canaryReady = buildMlModelContract({
    trainRun: {
      summary: {
        status: "ML_TRAIN_RUN_REPORTED",
        train_run_id: "TRAIN__002",
        model_artifact_id: "MODEL__002",
      },
    },
    canary: { summary: { global_canary_pass: true, apply_pass: true, rollback_ready_n: 1 } },
    serverPrimaryCanary: { summary: { apply_pass: true, acceptance_ready: true } },
  });
  assert.strictEqual(canaryReady.status, "ML_MODEL_CONTRACT_CANARY_READY");
  assert.strictEqual(canaryReady.canary_gate_status, "PASS");
  assert.strictEqual(canaryReady.rollback_status, "READY");

  console.log("ML_MODEL_CONTRACT_TEST_OK");
})();
