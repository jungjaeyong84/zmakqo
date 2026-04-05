"use strict";

const assert = require("assert");
const { summarizeExecutionScopeTierDiagnostics } = require("../utils/executionScopeTierDiagnostics");

const report = summarizeExecutionScopeTierDiagnostics({
  executionEntryDataset: {
    rows: [
      {
        row_id: "r1",
        execution: { no_fill_reason: "TOTAL_BUDGET_EXCEEDED", entry_schedule_reason: "WAIT_NEXT_BAR", entry_schedule_profile: "WAIT_NEXT_BAR_ONE_BAR" },
        features: { reason: "TOTAL_BUDGET_EXCEEDED", action: "ENTRY", pos_state: "FLAT", pro_conflict: false, score_bucket: "-20-0" },
      },
      {
        row_id: "r2",
        execution: { no_fill_reason: "TOTAL_BUDGET_EXCEEDED", entry_schedule_reason: "WAIT_NEXT_BAR", entry_schedule_profile: "WAIT_NEXT_BAR_ONE_BAR" },
        features: { reason: "TOTAL_BUDGET_EXCEEDED", action: "ENTRY", pos_state: "FLAT", score_bucket: "-20-0" },
      },
      {
        row_id: "r3",
        execution: { no_fill_reason: "LIVE_EXCEPTION", entry_schedule_reason: "LATE_EXEC", entry_schedule_profile: "LATE_EXEC_ONE_BAR" },
        features: { reason: "LIVE_EXCEPTION", action: "ENTRY", pos_state: "FLAT", pro_conflict: true, score_bucket: "-20-0" },
      },
    ],
  },
  executionScopeInference: {
    rows: [
      { row_id: "r1", event: "CORE_LONG", source: "PINE_WEBHOOK", market: "BTCUSDT", actual_scope: "POLICY_BLOCKED", pred_class: "FILLABLE" },
      { row_id: "r2", event: "CORE_LONG", source: "PINE_WEBHOOK", market: "ETHUSDT", actual_scope: "POLICY_BLOCKED", pred_class: "FILLABLE" },
      { row_id: "r3", event: "CORE_SHORT", source: "TV_WEBHOOK", market: "XRPUSDT", actual_scope: "RUNTIME_EXCEPTION", pred_class: "FILLABLE" },
      { row_id: "r4", event: "EARLY_LONG", source: "TV_WEBHOOK", market: "BTCUSDT", actual_scope: "FILLABLE", pred_class: "FILLABLE" },
    ],
  },
  executionScopeTierComparison: {
    summary: { weaker_tier: "CORE" },
  },
});

assert.strictEqual(report.summary.status, "EXECUTION_SCOPE_TIER_DIAGNOSTICS_READY");
assert.strictEqual(report.summary.target_tier, "CORE");
assert.strictEqual(report.summary.top_false_positive_group, "POLICY_BLOCKED|FILLABLE|PINE_WEBHOOK|CORE_LONG|BTCUSDT");
assert.strictEqual(report.summary.top_false_negative_group, "FILLABLE|POLICY_BLOCKED|PINE_WEBHOOK|CORE_LONG|BTCUSDT");
assert.strictEqual(report.summary.policy_blocked_top_source, "PINE_WEBHOOK");
assert.strictEqual(report.summary.policy_blocked_top_no_fill_reason, "TOTAL_BUDGET_EXCEEDED");
assert.strictEqual(typeof report.summary.policy_blocked_lowest_coverage_feature, "string");
console.log("EXECUTION_SCOPE_TIER_DIAGNOSTICS_TEST_OK");
