"use strict";

const assert = require("assert");
const { deriveServerSignalRuntime } = require("../../src/utils/serverSignalRuntime");

(() => {
  const report = deriveServerSignalRuntime({
    provider: "BINANCEFUT",
    systemSettings: {
      scheduler_enabled: true,
      scheduler_interval_sec: 900,
      canonical_engine_source_mode: "SERVER_PRIMARY",
      canonical_engine_shadow_enabled: true,
      ev_gate_tp1_prob_min_by_market: { BTCUSDT: 0.515 },
      ev_gate_tp1_prob_min_by_market_report_only_enabled: true,
      ev_gate_tp1_prob_min_by_market_report_only: { SOLUSDT: 0.501, ETHUSDT: 0.501 },
      ev_gate_unknown_gen_relax_enabled: true,
      ev_gate_unknown_gen_relax_started_at: new Date().toISOString(),
      ev_gate_unknown_gen_relax_window_hours: 6,
      ev_gate_unknown_gen_relax_review_after_hours: 4,
      ev_gate_unknown_gen_relax_tp1_prob_min_delta: 0.04,
      ev_gate_unknown_gen_relax_tp1_prob_full_delta: 0.03,
      ev_gate_unknown_gen_relax_tp1_prob_kill_delta: 0.02,
      tp1_ladder_enabled: true,
      tp1_ladder_stage1_realized_n_min: 8,
      tp1_ladder_stage1_tp0_hit_rate_min: 0.55,
      tp1_ladder_stage1_tp0_to_tp1_conversion_min: 0.20,
      tp1_ladder_stage1_fee_adjusted_expectancy_min: -0.0005,
      tp1_ladder_stage2_realized_n_min: 16,
      tp1_ladder_stage2_tp0_hit_rate_min: 0.60,
      tp1_ladder_stage2_tp1_hit_rate_min: 0.30,
      tp1_ladder_stage2_tp0_to_tp1_conversion_min: 0.35,
      tp1_ladder_stage2_fee_adjusted_expectancy_min: 0,
      opposite_signal_cooldown_bars: 3,
      opposite_signal_cooldown_bars_mixed: 1,
      opposite_signal_cooldown_bars_rescue: 0,
      opposite_time_cooldown_ms: 300000,
      opposite_time_cooldown_ms_mixed: 60000,
      opposite_time_cooldown_ms_rescue: 0,
      reverse_exception_mixed_bypass_tier_block: true,
      reverse_exception_rescue_bypass_tier_block: true,
    },
    exchangeSettings: {
      exec_tf: "15m",
      tf_allowlist: ["15m", "60m"],
      markets: ["BTCUSDT", "ETHUSDT", "AXSUSDT"],
    },
    watchdog: { summary: { verdict: "PASS" } },
  });

  assert.strictEqual(report.summary.runtime_status, "READY");
  assert.strictEqual(report.summary.exec_tf, "15m");
  assert.strictEqual(report.summary.market_count, 3);
  assert.strictEqual(report.summary.ev_gate_tp1_prob_min_by_market_n, 1);
  assert.strictEqual(report.summary.ev_gate_tp1_prob_min_by_market_report_only_enabled, true);
  assert.strictEqual(report.summary.ev_gate_tp1_prob_min_by_market_report_only_n, 2);
  assert.strictEqual(report.summary.ev_gate_unknown_gen_relax_enabled, true);
  assert.strictEqual(report.summary.ev_gate_unknown_gen_relax_mode, "REPORT_ONLY");
  assert.strictEqual(report.summary.ev_gate_unknown_gen_relax_active_window, true);
  assert.strictEqual(report.summary.ev_gate_unknown_gen_relax_window_hours, 6);
  assert.strictEqual(report.summary.ev_gate_unknown_gen_relax_review_after_hours, 4);
  assert.strictEqual(report.summary.ev_gate_unknown_gen_relax_auto_rollback_enabled, false);
  assert.strictEqual(report.summary.ev_gate_unknown_gen_relax_tp1_prob_min_delta, 0.04);
  assert.strictEqual(report.current_status.ev_gate_unknown_gen_relax_enabled, true);
  assert.strictEqual(report.current_status.ev_gate_unknown_gen_relax_mode, "REPORT_ONLY");
  assert.strictEqual(report.current_status.ev_gate_unknown_gen_relax_review_after_hours, 4);
  assert.strictEqual(report.summary.tp1_ladder_enabled, true);
  assert.strictEqual(report.summary.tp1_ladder_stage1_realized_n_min, 8);
  assert.strictEqual(report.summary.tp1_ladder_stage2_tp1_hit_rate_min, 0.30);
  assert.strictEqual(report.summary.opposite_cooldown_bars_base, 3);
  assert.strictEqual(report.summary.opposite_cooldown_bars_mixed, 1);
  assert.strictEqual(report.summary.opposite_cooldown_bars_rescue, 0);
  assert.strictEqual(report.summary.opposite_cooldown_ms_mixed, 60000);
  assert.strictEqual(report.summary.reverse_exception_mixed_bypass_tier_block, true);
  assert.strictEqual(report.current_status.reverse_exception_rescue_bypass_tier_block, true);
  assert.strictEqual(report.summary.pine_shadow_transition_progress_pct, 100);
  assert.strictEqual(report.current_status.execution_shadow_policy, "EXCLUDE_FROM_EXECUTION_DEFAULT");
  console.log("SERVER_SIGNAL_RUNTIME_TEST_OK");
})();
