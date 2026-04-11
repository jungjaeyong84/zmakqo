"use strict";

const assert = require("assert");
const { buildMlServingState, __test } = require("../services/mlServingRuntime");

(() => {
  const state = buildMlServingState({
    exchange: "BINANCEFUT",
    shadowCanaryGate: {
      generated_at: "2026-04-11T00:00:00.000Z",
      gate: {
        status: "PASS",
        enough_samples: true,
        promotion_blocked: false,
      },
    },
    executionServingContract: {
      summary: {
        shadow_ready: true,
        live_serving_allowed: true,
        preferred_model_artifact_id: "MODEL__1",
        preferred_train_run_id: "TRAIN__1",
      },
    },
    mlModelContract: {
      summary: {
        status: "ML_MODEL_CONTRACT_CANARY_READY",
        model_artifact_id: "MODEL__1",
        train_run_id: "TRAIN__1",
      },
    },
    liveServingArmed: true,
    nowMs: Date.parse("2026-04-11T00:05:00.000Z"),
  });

  assert.strictEqual(state.status, "PASS");
  assert.strictEqual(state.serving_mode, "LIVE_ACTIVE");
  assert.strictEqual(state.live_serving_allowed, true);
})();

(() => {
  const normalized = __test.normalizeLoadedServingState({
    status: "PASS",
    reason: "ML_LIVE_SERVING_ACTIVE",
    live_serving_allowed: true,
    block_new_entries: false,
    fail_closed: true,
    generated_at_ms: Date.parse("2026-04-10T00:00:00.000Z"),
    max_age_ms: 60 * 1000,
  }, Date.parse("2026-04-10T01:10:00.000Z"));

  assert.strictEqual(normalized.stale, true);
  assert.strictEqual(normalized.live_serving_allowed, false);
  assert.strictEqual(normalized.status, "BLOCK");
  assert.strictEqual(normalized.reason, "ML_SERVING_GATE_STALE");
  assert.strictEqual(normalized.block_new_entries, true);
})();

console.log("ML_SERVING_RUNTIME_TEST_OK");
