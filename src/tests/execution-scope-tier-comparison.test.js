"use strict";

const assert = require("assert");
const { summarizeExecutionScopeTierComparison } = require("../utils/executionScopeTierComparison");

const report = summarizeExecutionScopeTierComparison({
  inference: {
    summary: { model_artifact_id: "MODEL_EXEC_SCOPE__x1", train_run_id: "TRAIN_EXEC_SCOPE__x1" },
    rows: [
      { event: "EARLY_LONG", actual_scope: "FILLABLE", pred_class: "FILLABLE" },
      { event: "EARLY_SHORT", actual_scope: "POLICY_BLOCKED", pred_class: "FILLABLE" },
      { event: "CORE_LONG", actual_scope: "FILLABLE", pred_class: "FILLABLE" },
      { event: "CORE_SHORT", actual_scope: "RUNTIME_EXCEPTION", pred_class: "RUNTIME_EXCEPTION" },
    ],
  },
  trainRun: {
    summary: {
      metrics_by_entry_grade: {
        test: {
          EARLY: { rows_n: 2, accuracy: 0.5, macro_recall: 0.4, recall_by_class: { FILLABLE: 1 } },
          CORE: { rows_n: 2, accuracy: 1, macro_recall: 0.8, recall_by_class: { FILLABLE: 1 } },
        },
      },
    },
  },
});

assert.strictEqual(report.summary.status, "EXECUTION_SCOPE_TIER_COMPARISON_READY");
assert.strictEqual(report.summary.weaker_tier, "EARLY");
assert.strictEqual(report.summary.weaker_tier_by_mismatch, "EARLY");
assert.strictEqual(report.summary.weaker_tier_by_macro_recall, "EARLY");
assert.strictEqual(report.summary.tiers.length, 2);
assert.strictEqual(report.summary.tiers[0].tier, "EARLY");
assert.strictEqual(report.summary.tiers[0].inference_mismatch_rate, 0.5);
assert.strictEqual(report.summary.tiers[1].tier, "CORE");
assert.strictEqual(report.summary.tiers[1].inference_mismatch_rate, 0);
assert.ok(report.summary.weakness_scores.EARLY > report.summary.weakness_scores.CORE);
console.log("EXECUTION_SCOPE_TIER_COMPARISON_TEST_OK");
