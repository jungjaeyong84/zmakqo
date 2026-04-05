"use strict";

const assert = require("assert");
const {
  buildExecutionScopeBaselineModel,
  scoreExecutionScopeBaselineRows,
  filterTrainingRows,
  deriveQualityGate,
  deriveSourceDriftDiagnostics,
} = require("../utils/executionScopeBaselineModel");

function makeRow(index, scope) {
  const families = {
    FILLABLE: { was_filled: true, family: null, reason: null, subtype: null, source: "LIVE_RUNTIME", event: "CORE_LONG" },
    POLICY_BLOCKED: { was_filled: false, family: "POLICY_OR_CAPACITY", reason: "TOTAL_BUDGET_EXCEEDED", subtype: "TOTAL_BUDGET_EXCEEDED", source: "TV_WEBHOOK", event: "EARLY_SHORT" },
    RUNTIME_EXCEPTION: { was_filled: false, family: "RUNTIME_ERROR", reason: "LIVE_EXCEPTION", subtype: "TIMING_IMMEDIATE_EXEC", source: "LIVE_RUNTIME", event: "REAL_SHORT" },
  };
  const cfg = families[scope];
  return {
    row_id: `${scope}-${index}`,
    context: {
      source: cfg.source,
      event: cfg.event,
      side: scope === "FILLABLE" ? "BUY" : "SELL",
      market: scope === "POLICY_BLOCKED" ? "XRPUSDT" : "BTCUSDT",
    },
    execution: {
      signal_bar_close_ms: 1000 + (index * 60000),
      signal_to_intent_ms: scope === "FILLABLE" ? 1000 : (scope === "POLICY_BLOCKED" ? 200000 : 450000),
      webhook_to_intent_ms: scope === "FILLABLE" ? 500 : (scope === "POLICY_BLOCKED" ? 80000 : 120000),
      qty_fraction: scope === "FILLABLE" ? 0.8 : 0.2,
      entry_schedule_reason: scope === "FILLABLE" ? "EXEC_CURRENT_BAR" : "LATE_EXEC",
      webhook_decision: scope === "FILLABLE" ? "SAVED" : "DROP",
      webhook_reason: scope === "FILLABLE" ? "ALLOW" : "LATE",
      no_fill_reason_family: cfg.family,
      no_fill_reason: cfg.reason,
      no_fill_subtype: cfg.subtype,
    },
    labels: {
      was_filled: cfg.was_filled,
    },
    features: {
      score: scope === "FILLABLE" ? 0.9 : (scope === "POLICY_BLOCKED" ? 0.2 : 0.45),
      zz_wave_conf: scope === "FILLABLE" ? 0.8 : (scope === "POLICY_BLOCKED" ? 0.15 : 0.35),
    },
  };
}

(() => {
  const rows = [];
  for (let i = 0; i < 45; i += 1) rows.push(makeRow(i, "FILLABLE"));
  for (let i = 45; i < 75; i += 1) rows.push(makeRow(i, "POLICY_BLOCKED"));
  for (let i = 75; i < 105; i += 1) rows.push(makeRow(i, "RUNTIME_EXCEPTION"));
  const filtered = filterTrainingRows(rows);
  assert.strictEqual(filtered.length, 105);
  const built = buildExecutionScopeBaselineModel({
    rows,
    experimentId: "ML_BASELINE_ENV__scope",
    datasetVersionId: "ML_TRAINING_DATASET__scope",
    featureStoreVersionId: "ML_FEATURE_STORE__scope",
    executionDatasetVersionId: "EXECUTION_MODEL_DATASET__scope",
    trainedAtKst: "2026-04-05 22:30:00 KST",
  });
  assert.strictEqual(built.trainRun.model_kind, "EXECUTION_SCOPE_OVR_LOGISTIC_V1");
  assert.ok(String(built.trainRun.train_run_id || "").startsWith("TRAIN_EXEC_SCOPE__"));
  assert.ok(String(built.modelArtifact.model_artifact_id || "").startsWith("MODEL_EXEC_SCOPE__"));
  assert.strictEqual(Array.isArray(built.trainRun.target_classes), true);
  assert.strictEqual(built.trainRun.metrics_snapshot.test.rows_n > 0, true);
  const scored = scoreExecutionScopeBaselineRows(filtered.slice(0, 5), { summary: built.modelArtifact, model: built.modelArtifact.model_params });
  assert.strictEqual(scored.length, 5);
  assert.strictEqual(typeof scored[0].class_probs.FILLABLE, "number");
  console.log("EXECUTION_SCOPE_BASELINE_MODEL_TEST_OK");
})();

(() => {
  const gate = deriveQualityGate({
    accuracy: 0.7,
    macro_recall: 0.55,
    recall_by_class: {
      FILLABLE: 0.72,
      POLICY_BLOCKED: 0,
      RUNTIME_EXCEPTION: 0.81,
    },
  });
  assert.strictEqual(gate.ready, false);
  assert.strictEqual(gate.status, "POLICY_BLOCKED_RECALL_TOO_LOW");
  console.log("EXECUTION_SCOPE_BASELINE_GATE_TEST_OK");
})();

(() => {
  const trainRows = [];
  const testRows = [];
  for (let i = 0; i < 10; i += 1) trainRows.push(makeRow(i, "FILLABLE"));
  trainRows.push(makeRow(100, "POLICY_BLOCKED"));
  trainRows[trainRows.length - 1].context.source = "LIVE_RUNTIME";
  for (let i = 0; i < 6; i += 1) {
    const row = makeRow(200 + i, "POLICY_BLOCKED");
    row.context.source = "PINE_WEBHOOK";
    testRows.push(row);
  }
  const diagnostics = deriveSourceDriftDiagnostics({ trainRows, testRows });
  const gate = deriveQualityGate({
    accuracy: 0.8,
    macro_recall: 0.7,
    recall_by_class: {
      FILLABLE: 0.8,
      POLICY_BLOCKED: 0.5,
      RUNTIME_EXCEPTION: 0.8,
    },
  }, diagnostics);
  assert.strictEqual(diagnostics.top_policy_blocked_test_source, "PINE_WEBHOOK");
  assert.strictEqual(gate.ready, false);
  assert.strictEqual(gate.status, "POLICY_BLOCKED_SOURCE_SUPPORT_TOO_LOW");
  console.log("EXECUTION_SCOPE_BASELINE_DRIFT_TEST_OK");
})();
