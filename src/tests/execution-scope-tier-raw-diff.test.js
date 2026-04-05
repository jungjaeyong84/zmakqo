"use strict";

const assert = require("assert");
const { summarizeExecutionScopeTierRawDiff } = require("../utils/executionScopeTierRawDiff");

const report = summarizeExecutionScopeTierRawDiff({
  executionEntryDataset: {
    rows: [
      {
        row_id: "r1",
        execution: { entry_schedule_profile: "EXEC_CURRENT_BAR", signal_to_intent_bucket: "5S_30S", signal_to_intent_ms: 12000, created_to_fill_ms: 500 },
        features: { reason: "IN_POSITION_SAME_DIR", action: "ADD", pos_state: "SHORT", pro_conflict: false, score_bucket: "<-60", policy_block_hint: "NONE", webhook_execution_profile: "WEBHOOK_OTHER", webhook_bar_timing_profile: "POST_BAR_CLOSE_FAST" },
      },
      {
        row_id: "r2",
        execution: { entry_schedule_profile: "EXEC_CURRENT_BAR", signal_to_intent_bucket: "5S_30S", signal_to_intent_ms: 15000, created_to_fill_ms: 700 },
        features: { reason: "IN_POSITION_SAME_DIR", action: "ADD", pos_state: "SHORT", pro_conflict: true, score_bucket: "<-60", policy_block_hint: "NONE", webhook_execution_profile: "WEBHOOK_OTHER", webhook_bar_timing_profile: "POST_BAR_CLOSE_FAST" },
      },
      {
        row_id: "r3",
        execution: { entry_schedule_profile: "WAIT_NEXT_BAR_ONE_BAR", signal_to_intent_bucket: "2M_15M", signal_to_intent_ms: 180000, created_to_fill_ms: null },
        features: { reason: "RISK_BUDGET_DISABLED", action: "ENTRY", pos_state: "SHORT", pro_conflict: false, score_bucket: "-20-0", policy_block_hint: "RISK_BUDGET_DISABLED", webhook_execution_profile: "WEBHOOK_SAVED_NO_PROBE", webhook_bar_timing_profile: "POST_BAR_CLOSE_DELAYED" },
      },
    ],
  },
  executionScopeInference: {
    rows: [
      { row_id: "r1", actual_scope: "FILLABLE", pred_class: "RUNTIME_EXCEPTION", source: "LIVE_RUNTIME", event: "EARLY_SHORT", market: "BNBUSDT", pred_class_prob: 0.81 },
      { row_id: "r2", actual_scope: "FILLABLE", pred_class: "RUNTIME_EXCEPTION", source: "LIVE_RUNTIME", event: "EARLY_SHORT", market: "BNBUSDT", pred_class_prob: 0.8 },
      { row_id: "r3", actual_scope: "RUNTIME_EXCEPTION", pred_class: "RUNTIME_EXCEPTION", source: "LIVE_RUNTIME", event: "EARLY_SHORT", market: "BNBUSDT", pred_class_prob: 0.75 },
    ],
  },
  executionScopeTierDiagnostics: {
    summary: {
      target_tier: "EARLY",
      top_false_positive_group: "FILLABLE|RUNTIME_EXCEPTION|LIVE_RUNTIME|EARLY_SHORT|BNBUSDT",
    },
  },
});

assert.strictEqual(report.summary.status, "EXECUTION_SCOPE_TIER_RAW_DIFF_READY");
assert.strictEqual(report.summary.target_tier, "EARLY");
assert.strictEqual(report.summary.top_false_positive_rows_n, 2);
assert.strictEqual(report.summary.reference_group_mode, "EXACT_SOURCE_EVENT_MARKET");
assert.strictEqual(report.summary.mismatch_profile.top_reason, "IN_POSITION_SAME_DIR");
assert.strictEqual(report.summary.mismatch_profile.top_webhook_execution_profile, "WEBHOOK_OTHER");
assert.strictEqual(report.summary.mismatch_profile.top_webhook_bar_timing_profile, "POST_BAR_CLOSE_FAST");
assert.strictEqual(report.summary.reference_profile.top_policy_block_hint, "RISK_BUDGET_DISABLED");
assert.strictEqual(report.rows.length, 2);
console.log("EXECUTION_SCOPE_TIER_RAW_DIFF_TEST_OK");
