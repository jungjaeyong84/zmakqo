"use strict";

const assert = require("assert");
const { buildExecutionBottleneckDelta } = require("../utils/executionBottleneckDelta");

(() => {
  const report = buildExecutionBottleneckDelta({
    currentExecutionQuality: {
      summary: {
        status: "EXECUTION_QUALITY_REVIEW",
        created_to_fill_p95_ms: 70000,
        top_operational_webhook_delay_cause: "IMMEDIATE_EXEC_WEBHOOK_SAVED_LATE_INTENT",
        top_no_fill_reason: "LIVE_EXCEPTION",
      },
    },
    previousExecutionQuality: {
      summary: {
        status: "EXECUTION_QUALITY_REVIEW",
        created_to_fill_p95_ms: 90000,
        top_operational_webhook_delay_cause: "LATE_EXEC_DELAYED_INTENT_FILLED",
        top_no_fill_reason: "POLICY_BLOCK",
      },
    },
    currentStageLatency: {
      summary: {
        status: "EXECUTION_STAGE_LATENCY_READY",
        signal_to_intent_p95_ms: 500000,
        webhook_saved_to_intent_p95_ms: 450000,
        top_operational_signal_to_intent_groups: [{ key: "TV_WEBHOOK|EARLY_SHORT|XRPUSDT" }],
      },
    },
    previousStageLatency: {
      summary: {
        status: "EXECUTION_STAGE_LATENCY_READY",
        signal_to_intent_p95_ms: 700000,
        webhook_saved_to_intent_p95_ms: 650000,
        top_operational_signal_to_intent_groups: [{ key: "TV_WEBHOOK|EARLY_LONG|BTCUSDT" }],
      },
    },
    currentExperimentRegistry: {
      summary: {
        experiment_id: "ML_BASELINE_ENV__new123",
        dataset_version_id: "ML_TRAINING_DATASET__new",
        feature_store_version_id: "ML_FEATURE_STORE__new",
      },
    },
    previousExperimentRegistry: {
      summary: {
        experiment_id: "ML_BASELINE_ENV__old123",
        dataset_version_id: "ML_TRAINING_DATASET__old",
        feature_store_version_id: "ML_FEATURE_STORE__old",
      },
    },
  });

  assert.strictEqual(report.status, "EXECUTION_BOTTLENECK_DELTA_READY");
  assert.strictEqual(report.webhook_delay_cause_changed, true);
  assert.strictEqual(report.operational_signal_group_changed, true);
  assert.strictEqual(report.signal_to_intent_p95_delta_ms, -200000);
  assert.strictEqual(report.webhook_saved_to_intent_p95_delta_ms, -200000);
  assert.strictEqual(report.created_to_fill_p95_delta_ms, -20000);
  assert.strictEqual(report.top_no_fill_reason, "LIVE_EXCEPTION");
  assert.strictEqual(report.same_experiment, false);

  const stale = buildExecutionBottleneckDelta({
    currentExecutionQuality: { summary: { status: "EXECUTION_QUALITY_REVIEW", created_to_fill_p95_ms: 70000, top_operational_webhook_delay_cause: "A" } },
    previousExecutionQuality: { summary: { status: "EXECUTION_QUALITY_REVIEW", created_to_fill_p95_ms: 70000, top_operational_webhook_delay_cause: "A" } },
    currentStageLatency: { summary: { status: "EXECUTION_STAGE_LATENCY_READY", signal_to_intent_p95_ms: 1000, webhook_saved_to_intent_p95_ms: 1000 } },
    previousStageLatency: { summary: { status: "EXECUTION_STAGE_LATENCY_READY", signal_to_intent_p95_ms: 1000, webhook_saved_to_intent_p95_ms: 1000 } },
    currentExperimentRegistry: { summary: { experiment_id: "ML_BASELINE_ENV__same", dataset_version_id: "D1", feature_store_version_id: "F1" } },
    previousExperimentRegistry: { summary: { experiment_id: "ML_BASELINE_ENV__same", dataset_version_id: "D1", feature_store_version_id: "F1" } },
  });
  assert.strictEqual(stale.status, "EXECUTION_BOTTLENECK_DELTA_STALE_COMPARISON");
  assert.strictEqual(stale.same_experiment, true);

  console.log("EXECUTION_BOTTLENECK_DELTA_TEST_OK");
})();
