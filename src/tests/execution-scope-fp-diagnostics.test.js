"use strict";

const assert = require("assert");
const { summarizeExecutionScopeFalsePositiveDiagnostics } = require("../utils/executionScopeFalsePositiveDiagnostics");

(() => {
  const report = summarizeExecutionScopeFalsePositiveDiagnostics({
    executionEntryDataset: {
      rows: [
        {
          row_id: "r1",
          context: { primary_fill_source: "BINANCE_USER_TRADES" },
          execution: { entry_schedule_reason: "LATE_EXEC", status: "CANCELED", signal_to_intent_ms: 9000, created_to_fill_ms: 700, slippage_bps: 0 },
          features: { _entry_exec_timing: "EXEC_CURRENT_BAR", reason: "IN_POSITION_SAME_DIR", action: "ADD", ai_signal: { ai_decision: "ALLOW" } },
        },
        {
          row_id: "r2",
          context: { primary_fill_source: "BINANCE_USER_TRADES" },
          execution: { entry_schedule_reason: "LATE_EXEC", status: "CANCELED", signal_to_intent_ms: 10000, created_to_fill_ms: 800, slippage_bps: 1 },
          features: { _entry_exec_timing: "EXEC_CURRENT_BAR", reason: "IN_POSITION_SAME_DIR", action: "ADD", ai_signal: { ai_decision: "ALLOW" } },
        },
        {
          row_id: "r3",
          context: { primary_fill_source: "BINANCE_USER_TRADES" },
          execution: { entry_schedule_reason: "LATE_EXEC", status: "FAILED", signal_to_intent_ms: 12000, created_to_fill_ms: null, slippage_bps: null },
          features: { _entry_exec_timing: "EXEC_CURRENT_BAR", reason: "IN_POSITION_SAME_DIR", action: "ADD", ai_signal: { ai_decision: "ALLOW" } },
        },
      ],
    },
    executionScopeInference: {
      summary: {
        top_false_positive_groups: [
          { key: "FILLABLE|RUNTIME_EXCEPTION|LIVE_RUNTIME|EMO_SHORT|BTCUSDT", rows_n: 2 },
        ],
      },
      rows: [
        { row_id: "r1", actual_scope: "FILLABLE", pred_class: "RUNTIME_EXCEPTION", source: "LIVE_RUNTIME", event: "EMO_SHORT", market: "BTCUSDT", pred_class_prob: 0.8 },
        { row_id: "r2", actual_scope: "FILLABLE", pred_class: "RUNTIME_EXCEPTION", source: "LIVE_RUNTIME", event: "EMO_SHORT", market: "BTCUSDT", pred_class_prob: 0.81 },
        { row_id: "r3", actual_scope: "RUNTIME_EXCEPTION", pred_class: "RUNTIME_EXCEPTION", source: "LIVE_RUNTIME", event: "EMO_SHORT", market: "BTCUSDT", pred_class_prob: 0.82 },
      ],
    },
  });

  assert.strictEqual(report.summary.status, "EXECUTION_SCOPE_FP_DIAGNOSTICS_READY");
  assert.strictEqual(report.summary.top_false_positive_group, "FILLABLE|RUNTIME_EXCEPTION|LIVE_RUNTIME|EMO_SHORT|BTCUSDT");
  assert.strictEqual(report.summary.top_false_positive_rows_n, 2);
  assert.strictEqual(report.summary.top_shared_feature, "execution.entry_schedule_reason=LATE_EXEC");
  assert.strictEqual(report.summary.top_context_profile, "IN_POSITION_SAME_DIR|ADD|UNKNOWN|UNKNOWN|UNKNOWN");
  assert.strictEqual(report.summary.reference_group_mode, "EXACT_SOURCE_EVENT_MARKET");
  assert.strictEqual(report.summary.reference_rows_n, 1);
  assert.strictEqual(report.summary.reference_top_shared_feature, "execution.entry_schedule_reason=LATE_EXEC");
})();

console.log("EXECUTION_SCOPE_FP_DIAGNOSTICS_TEST_OK");
