"use strict";

const assert = require("assert");
const { buildExecutionFillBaselineModel } = require("../utils/executionFillBaselineModel");

function makeRow(index, filled, overrides = {}) {
  return {
    row_id: `row-${index}`,
    context: {
      source: filled ? "LIVE_RUNTIME" : "TV_WEBHOOK",
      event: filled ? "CORE_LONG" : "EARLY_SHORT",
      side: filled ? "BUY" : "SELL",
      market: filled ? "BTCUSDT" : "XRPUSDT",
    },
    execution: {
      signal_bar_close_ms: 1000 + (index * 60000),
      signal_to_intent_ms: filled ? 1200 : 620000,
      webhook_to_intent_ms: filled ? 800 : 400000,
      qty_fraction: filled ? 0.8 : 0.2,
      entry_schedule_reason: filled ? "EXEC_CURRENT_BAR" : "LATE_EXEC",
      webhook_decision: filled ? "SAVED" : "DROP",
      webhook_reason: filled ? "ALLOW" : "LATE",
    },
    labels: {
      was_filled: filled,
    },
    features: {
      score: filled ? 0.9 : 0.1,
      zz_wave_conf: filled ? 0.8 : 0.2,
    },
    ...overrides,
  };
}

(() => {
  const rows = [];
  for (let i = 0; i < 80; i += 1) rows.push(makeRow(i, i % 2 === 0));
  const built = buildExecutionFillBaselineModel({
    rows,
    experimentId: "ML_BASELINE_ENV__abc123",
    datasetVersionId: "ML_TRAINING_DATASET__abc123",
    featureStoreVersionId: "ML_FEATURE_STORE__def456",
    executionDatasetVersionId: "EXECUTION_MODEL_DATASET__xyz789",
    trainedAtKst: "2026-04-05 22:00:00 KST",
  });

  assert.strictEqual(built.trainRun.status, "ML_TRAIN_RUN_REPORTED");
  assert.strictEqual(built.trainRun.model_kind, "EXECUTION_FILL_LOGISTIC_V1");
  assert.ok(String(built.trainRun.train_run_id || "").startsWith("TRAIN_EXEC_FILL__"));
  assert.ok(String(built.trainRun.model_artifact_id || "").startsWith("MODEL_EXEC_FILL__"));
  assert.strictEqual(built.modelArtifact.status, "EXECUTION_FILL_MODEL_READY");
  assert.strictEqual(built.modelArtifact.train_run_id, built.trainRun.train_run_id);
  assert.strictEqual(built.modelArtifact.feature_count > 0, true);
  assert.strictEqual(built.trainRun.metrics_snapshot.test.rows_n > 0, true);
  assert.strictEqual(built.trainRun.metrics_snapshot.test.brier_score < 0.3, true);
  assert.strictEqual(typeof built.trainRun.quality_gate_status, "string");
  assert.strictEqual(typeof built.trainRun.quality_gate_ready, "boolean");
  assert.strictEqual(Array.isArray(built.modelArtifact.weight_summary.top_positive), true);

  console.log("EXECUTION_FILL_BASELINE_MODEL_TEST_OK");
})();
