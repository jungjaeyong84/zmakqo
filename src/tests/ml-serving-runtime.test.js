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

(() => {
  const state = buildMlServingState({
    exchange: "BINANCEFUT",
    shadowCanaryGate: {
      generated_at: "2026-04-11T00:00:00.000Z",
      gate: {
        status: "PASS",
        reason: "CANARY_STABLE_SHADOW_TARGET_MET",
        enough_samples: true,
        promotion_blocked: false,
        policy_candidate_ready_for_shadow: true,
        shadow_future_effective_meets_target: true,
        shadow_raw_retained_meets_target: false,
        runtime_blocked_historical_debt_sample_n: 5,
      },
    },
    executionServingContract: {
      summary: {
        shadow_ready: true,
        live_serving_allowed: false,
      },
    },
    mlModelContract: {
      summary: {
        status: "ML_MODEL_CONTRACT_CANARY_READY",
      },
    },
    liveServingArmed: false,
    nowMs: Date.parse("2026-04-11T00:05:00.000Z"),
  });

  assert.strictEqual(state.status, "PASS");
  assert.strictEqual(state.serving_mode, "SHADOW_ONLY");
  assert.strictEqual(state.reason, "ML_SHADOW_READY_TARGET_MET");
  assert.strictEqual(state.shadow_future_effective_meets_target, true);
  assert.strictEqual(state.runtime_blocked_historical_debt_sample_n, 5);
})();

(() => {
  assert.strictEqual(__test.resolvePrimaryLearningLane({
    OPENCLAW_PRIMARY_LEARNING_LANE: "V3_PAPER",
  }), "V3_PAPER");
  assert.strictEqual(__test.resolvePrimaryLearningLane({
    DONBEOLJA_OPENCLAW_LEARNING_SCOPE: "V3_PAPER_ONLY",
  }), "V3_PAPER");
})();

(() => {
  const state = __test.buildMlServingStateFromV3LearningState({
    generated_at: "2026-05-11T00:00:00.000Z",
    learning_scope: "V3_PAPER_ONLY",
    status: "WARN",
    reason: "V3_PAPER_SAMPLE_ACCUMULATING",
    shadow_observation_ready: true,
    shadow_evaluation_ready: false,
    shadow_ready: false,
    v1_learning_blocked: true,
    v2_learning_blocked: true,
    bootstrap_metrics: {
      target_hit: false,
    },
    validation_gate: {
      paper_sample_ok: false,
    },
    source_lane: "V3_LOCAL_PAPER",
  }, Date.parse("2026-05-11T00:05:00.000Z"));

  assert.strictEqual(state.serving_mode, "SHADOW_ONLY");
  assert.strictEqual(state.reason, "V3_PAPER_SAMPLE_ACCUMULATING");
  assert.strictEqual(state.learning_scope, "V3_PAPER_ONLY");
  assert.strictEqual(state.v1_learning_blocked, true);
  assert.strictEqual(state.v2_learning_blocked, true);
  assert.strictEqual(state.shadow_observation_ready, true);
  assert.strictEqual(state.shadow_evaluation_ready, false);
  assert.strictEqual(state.shadow_ready, false);
  assert.strictEqual(state.policy_candidate_ready_for_shadow, false);
  assert.strictEqual(state.live_serving_allowed, false);
})();

console.log("ML_SERVING_RUNTIME_TEST_OK");
