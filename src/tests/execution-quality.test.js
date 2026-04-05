"use strict";

const assert = require("assert");
const { summarizeExecutionQuality } = require("../utils/executionQuality");

(() => {
  const report = summarizeExecutionQuality({
    microstructure: {
      metrics: {
        latency: { created_to_fill_p95_ms: 61000 },
        slippage: { adverse_p95_bps: 82 },
        partial_fill: { partial_fill_rate_pct: 61 },
      },
    },
    bridgeLatency: {
      webhook_to_fill_ms: { p95: 62000 },
    },
    executionModelDataset: {
      summary: {
        top_operational_webhook_delay_causes: [{ key: "IMMEDIATE_EXEC_TRUE_INTENT_DELAY", rows_n: 12 }],
        top_operational_immediate_intent_delay_groups: [{ key: "TV_WEBHOOK|EARLY_LONG|BTCUSDT", rows_n: 4 }],
        top_no_fill_reasons: [{ key: "LIVE_EXCEPTION", rows_n: 5 }],
        top_no_fill_subtypes: [{ key: "TIMING_IMMEDIATE_EXEC", rows_n: 4 }],
      },
    },
    executionScopeTrainRun: {
      summary: {
        status: "ML_TRAIN_RUN_REPORTED",
        quality_gate_status: "POLICY_BLOCKED_RECALL_TOO_LOW",
        quality_gate_ready: false,
      },
    },
    executionScopeInference: {
      summary: {
        status: "EXECUTION_SCOPE_INFERENCE_READY",
        mismatch_rate: 0.29,
        top_false_positive_groups: [{ key: "FILLABLE|POLICY_BLOCKED|LIVE_RUNTIME|EMO_LONG|KRW-BCH", rows_n: 9 }],
      },
    },
    executionScopeFalsePositiveDiagnostics: {
      summary: {
        status: "EXECUTION_SCOPE_FP_DIAGNOSTICS_READY",
        top_shared_feature: "execution.entry_schedule_reason=LATE_EXEC",
        top_context_profile: "IN_POSITION_SAME_DIR|ADD|SHORT|-20-0|LATE_EXEC_CURRENT_BAR",
        reference_rows_n: 4,
        reference_group_mode: "EXACT_SOURCE_EVENT_MARKET",
      },
    },
    intents: [
      { intent_id: "i1", created_at: "2026-04-01T00:00:00.000Z" },
      { intent_id: "i2", created_at: "2026-04-01T00:10:00.000Z" },
    ],
    fills: [
      { intent_id: "i1", symbol: "SOLUSDT", created_at: "2026-04-01T00:01:00.000Z", slippage_bps: 12 },
      { intent_id: "i1", symbol: "SOLUSDT", created_at: "2026-04-01T00:01:20.000Z", slippage_bps: 16 },
      { intent_id: "i2", symbol: "BTCUSDT", created_at: "2026-04-01T00:12:00.000Z", slippage_bps: 4 },
    ],
  });

  assert.strictEqual(report.summary.status, "EXECUTION_QUALITY_REVIEW");
  assert.ok(report.summary.review_reasons.includes("CREATED_TO_FILL_P95_HIGH"));
  assert.ok(report.summary.review_reasons.includes("ADVERSE_SLIPPAGE_P95_HIGH"));
  assert.ok(report.summary.review_reasons.includes("PARTIAL_FILL_RATE_HIGH"));
  assert.ok(report.summary.review_reasons.includes("WEBHOOK_TO_FILL_P95_HIGH"));
  assert.ok(report.summary.review_reasons.includes("OPERATIONAL_WEBHOOK_DELAY_PRESENT"));
  assert.ok(report.summary.review_reasons.includes("NO_FILL_REASON_PRESENT"));
  assert.strictEqual(report.summary.top_partial_market, "SOLUSDT");
  assert.strictEqual(report.summary.top_operational_webhook_delay_cause, "IMMEDIATE_EXEC_TRUE_INTENT_DELAY");
  assert.strictEqual(report.summary.top_operational_immediate_intent_delay_group, "TV_WEBHOOK|EARLY_LONG|BTCUSDT");
  assert.strictEqual(report.summary.top_no_fill_reason, "LIVE_EXCEPTION");
  assert.strictEqual(report.summary.top_no_fill_subtype, "TIMING_IMMEDIATE_EXEC");
  assert.strictEqual(report.summary.execution_scope_quality_gate_status, "POLICY_BLOCKED_RECALL_TOO_LOW");
  assert.strictEqual(report.summary.execution_scope_quality_gate_ready, false);
  assert.strictEqual(report.summary.execution_scope_inference_mismatch_rate, 0.29);
  assert.strictEqual(report.summary.execution_scope_top_false_positive_group, "FILLABLE|POLICY_BLOCKED|LIVE_RUNTIME|EMO_LONG|KRW-BCH");
  assert.strictEqual(report.summary.execution_scope_fp_diagnostics_status, "EXECUTION_SCOPE_FP_DIAGNOSTICS_READY");
  assert.strictEqual(report.summary.execution_scope_fp_diagnostics_top_shared_feature, "execution.entry_schedule_reason=LATE_EXEC");
  assert.strictEqual(report.summary.execution_scope_fp_diagnostics_top_context_profile, "IN_POSITION_SAME_DIR|ADD|SHORT|-20-0|LATE_EXEC_CURRENT_BAR");
  assert.strictEqual(report.summary.execution_scope_fp_diagnostics_reference_rows_n, 4);
  assert.strictEqual(report.by_market[0].market, "BTCUSDT");
  assert.strictEqual(report.by_market[1].market, "SOLUSDT");
})();

console.log("EXECUTION_QUALITY_TEST_OK");
