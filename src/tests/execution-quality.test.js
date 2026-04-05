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
        top_context_profile: "IN_POSITION_SAME_DIR|ADD|SHORT|-20-0|SAME_BAR_FAST_FILL",
        reference_rows_n: 4,
        reference_group_mode: "EXACT_SOURCE_EVENT_MARKET",
      },
    },
    executionScopeTierComparison: {
      summary: {
        status: "EXECUTION_SCOPE_TIER_COMPARISON_READY",
        weaker_tier: "EARLY",
        weaker_tier_by_mismatch: "CORE",
        weaker_tier_by_macro_recall: "EARLY",
        mismatch_rate_gap: 0.06,
        macro_recall_gap: 0.16,
        weakness_scores: { EARLY: 0.49, CORE: 0.38 },
      },
    },
    executionScopeTierRawDiff: {
      summary: {
        status: "EXECUTION_SCOPE_TIER_RAW_DIFF_READY",
        target_tier: "EARLY",
        top_false_positive_group: "FILLABLE|RUNTIME_EXCEPTION|LIVE_RUNTIME|EARLY_SHORT|BNBUSDT",
        reference_group_mode: "EXACT_SOURCE_EVENT_MARKET",
        mismatch_profile: {
          top_reason: "IN_POSITION_SAME_DIR",
          top_action: "ADD",
          top_pos_state: "SHORT",
          top_schedule_profile: "EXEC_CURRENT_BAR",
          top_signal_to_intent_bucket: "5S_30S",
          top_policy_block_hint: "NONE",
          top_webhook_execution_profile: "WEBHOOK_OTHER",
          top_webhook_bar_timing_profile: "POST_BAR_CLOSE_FAST",
        },
        mismatch_top_webhook_execution_profiles: [
          { key: "WEBHOOK_OTHER", rows_n: 2 },
          { key: "WEBHOOK_SAVED_NO_PROBE", rows_n: 1 },
          { key: "WEBHOOK_PRE_BAR_CLOSE_FILLED", rows_n: 3 },
        ],
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
  assert.strictEqual(report.summary.execution_scope_fp_diagnostics_top_context_profile, "IN_POSITION_SAME_DIR|ADD|SHORT|-20-0|SAME_BAR_FAST_FILL");
  assert.strictEqual(report.summary.execution_scope_fp_diagnostics_reference_rows_n, 4);
  assert.strictEqual(report.summary.execution_scope_tier_weaker_tier, "EARLY");
  assert.strictEqual(report.summary.execution_scope_tier_weaker_tier_by_mismatch, "CORE");
  assert.strictEqual(report.summary.execution_scope_tier_weaker_tier_by_macro_recall, "EARLY");
  assert.strictEqual(report.summary.execution_scope_tier_early_weakness_score, 0.49);
  assert.strictEqual(report.summary.execution_scope_tier_core_weakness_score, 0.38);
  assert.strictEqual(report.summary.execution_scope_tier_raw_diff_status, "EXECUTION_SCOPE_TIER_RAW_DIFF_READY");
  assert.strictEqual(report.summary.execution_scope_tier_raw_diff_top_reason, "IN_POSITION_SAME_DIR");
  assert.strictEqual(report.summary.execution_scope_tier_raw_diff_top_action, "ADD");
  assert.strictEqual(report.summary.execution_scope_tier_raw_diff_top_pos_state, "SHORT");
  assert.strictEqual(report.summary.execution_scope_tier_raw_diff_top_webhook_execution_profile, "WEBHOOK_OTHER");
  assert.strictEqual(report.summary.execution_scope_tier_raw_diff_top_webhook_bar_timing_profile, "POST_BAR_CLOSE_FAST");
  assert.strictEqual(report.summary.execution_scope_tier_raw_diff_top_webhook_execution_profile_rows_n, 2);
  assert.strictEqual(report.summary.execution_scope_tier_raw_diff_saved_no_probe_rows_n, 1);
  assert.strictEqual(report.summary.execution_scope_tier_raw_diff_pre_bar_close_rows_n, 3);
  assert.strictEqual(report.by_market[0].market, "BTCUSDT");
  assert.strictEqual(report.by_market[1].market, "SOLUSDT");
})();

console.log("EXECUTION_QUALITY_TEST_OK");
