"use strict";

const assert = require("assert");
const { deriveServerSignalRuntime } = require("../../src/utils/serverSignalRuntime");
const { __test: runtimeReportTest } = require("../../scripts/report-server-signal-runtime");

(() => {
  const report = deriveServerSignalRuntime({
    provider: "BINANCEFUT",
    systemSettings: {
      scheduler_enabled: true,
      scheduler_interval_sec: 900,
      canonical_engine_source_mode: "SERVER_PRIMARY",
      canonical_engine_shadow_enabled: true,
      ev_gate_global_report_only_enabled: true,
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
      tp1_ladder_freeze: true,
      signal_overlap_enabled: true,
      signal_overlap_bars: 4,
      same_direction_trail_profit_cooldown_enabled: true,
      same_direction_trail_profit_cooldown_ms: 21600000,
      tp1_ladder_stage1_realized_n_min: 12,
      tp1_ladder_stage1_tp0_hit_rate_min: 0.60,
      tp1_ladder_stage1_tp0_to_tp1_conversion_min: 0.28,
      tp1_ladder_stage1_fee_adjusted_expectancy_min: 0,
      tp1_ladder_stage2_realized_n_min: 24,
      tp1_ladder_stage2_tp0_hit_rate_min: 0.68,
      tp1_ladder_stage2_tp1_hit_rate_min: 0.38,
      tp1_ladder_stage2_tp0_to_tp1_conversion_min: 0.45,
      tp1_ladder_stage2_fee_adjusted_expectancy_min: 0.001,
      opposite_signal_cooldown_bars: 4,
      opposite_signal_cooldown_bars_mixed: 4,
      opposite_signal_cooldown_bars_rescue: 4,
      opposite_time_cooldown_ms: 900000,
      opposite_time_cooldown_ms_mixed: 3600000,
      opposite_time_cooldown_ms_rescue: 3600000,
      opposite_transition_enabled: false,
      opposite_transition_reduce_fraction: 0,
      opposite_transition_confirm_bars: 4,
      reverse_exception_mixed_bypass_tier_block: true,
      reverse_exception_rescue_bypass_tier_block: true,
    },
    exchangeSettings: {
      exec_tf: "15m",
      tf_allowlist: ["15m", "60m"],
      markets: ["BTCUSDT", "ETHUSDT", "AXSUSDT"],
    },
    livePositionHealth: {
      active_position_n: 2,
      projection_out_of_sync_n: 1,
      self_heal_required_n: 1,
      native_stop_missing_n: 0,
      trail_without_tp1_n: 0,
      tp1_done_with_tp_order_n: 1,
      invariant_counts: { TP1_DONE_WITH_TP_ORDER: 1 },
      fill_projection_audit_issue_n: 3,
      fill_projection_legacy_partial_tp_missing_n: 1,
      fill_projection_tp0_missing_n: 1,
      fill_projection_tp1_missing_n: 0,
      fill_projection_tp1_trail_inactive_n: 1,
      fill_projection_native_protection_not_ok_n: 1,
      fill_projection_issue_by_code: {
        LEGACY_PARTIAL_TP_FILL_PROJECTION_MISSING: 1,
        TP1_FILL_TRAIL_INACTIVE: 1,
        NATIVE_PROTECTION_NOT_OK: 1,
      },
    },
    watchdog: { summary: { verdict: "PASS" } },
  });

  assert.strictEqual(report.summary.runtime_status, "READY");
  assert.strictEqual(report.summary.exec_tf, "15m");
  assert.strictEqual(report.summary.market_count, 3);
  assert.strictEqual(report.summary.ev_gate_tp1_prob_min_by_market_n, 1);
  assert.strictEqual(report.summary.ev_gate_global_report_only_enabled, true);
  assert.strictEqual(report.summary.ev_gate_global_report_only_mode, "REPORT_ONLY");
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
  assert.strictEqual(report.current_status.ev_gate_global_report_only_enabled, true);
  assert.strictEqual(report.current_status.ev_gate_global_report_only_mode, "REPORT_ONLY");
  assert.strictEqual(report.current_status.ev_gate_unknown_gen_relax_mode, "REPORT_ONLY");
  assert.strictEqual(report.current_status.ev_gate_unknown_gen_relax_review_after_hours, 4);
  assert.strictEqual(report.summary.tp1_ladder_enabled, true);
  assert.strictEqual(report.summary.tp1_ladder_stage1_realized_n_min, 12);
  assert.strictEqual(report.summary.tp1_ladder_stage2_tp1_hit_rate_min, 0.38);
  assert.strictEqual(report.summary.tp1_ladder_default_profile, "RESCUE");
  assert.strictEqual(report.summary.tp1_ladder_promotion_mode, "RESCUE_FIRST_FROZEN");
  assert.strictEqual(report.summary.signal_overlap_enabled, true);
  assert.strictEqual(report.summary.signal_overlap_bars, 4);
  assert.strictEqual(report.summary.same_direction_trail_profit_cooldown_enabled, true);
  assert.strictEqual(report.summary.same_direction_trail_profit_cooldown_ms, 21600000);
  assert.strictEqual(report.summary.opposite_cooldown_bars_base, 4);
  assert.strictEqual(report.summary.opposite_cooldown_bars_mixed, 4);
  assert.strictEqual(report.summary.opposite_cooldown_bars_rescue, 4);
  assert.strictEqual(report.summary.opposite_cooldown_ms_mixed, 3600000);
  assert.strictEqual(report.summary.opposite_cooldown_default_profile, "RESCUE");
  assert.strictEqual(report.summary.opposite_cooldown_promotion_mode, "RESCUE_FIRST_FROZEN");
  assert.strictEqual(report.summary.opposite_transition_enabled, false);
  assert.strictEqual(report.summary.opposite_transition_reduce_fraction, 0);
  assert.strictEqual(report.summary.opposite_transition_confirm_bars, 4);
  assert.strictEqual(report.summary.reverse_exception_mixed_bypass_tier_block, true);
  assert.deepStrictEqual(report.summary.operational_drop_watch_reasons, ["POSITION_FULL", "LIVE_RESCUE_ADD_*", "DROP_OVERLAP"]);
  assert.strictEqual(report.summary.binance_live_state_self_heal_enabled, true);
  assert.strictEqual(report.summary.binance_live_state_self_heal_max_positions, 12);
  assert.strictEqual(report.summary.binance_live_state_projection_ssot, "EXCHANGE_LIVE_STATE");
  assert.strictEqual(report.summary.binance_live_state_projection_writer_mode, "RECONCILE_FIRST");
  assert.strictEqual(report.summary.binance_live_state_active_position_n, 2);
  assert.strictEqual(report.summary.binance_live_state_projection_out_of_sync_n, 1);
  assert.strictEqual(report.summary.binance_live_state_self_heal_required_n, 1);
  assert.strictEqual(report.summary.binance_live_state_tp1_done_with_tp_order_n, 1);
  assert.deepStrictEqual(report.summary.binance_live_state_invariant_counts, { TP1_DONE_WITH_TP_ORDER: 1 });
  assert.strictEqual(report.summary.binance_fill_projection_audit_issue_n, 3);
  assert.strictEqual(report.summary.binance_fill_projection_legacy_partial_tp_missing_n, 1);
  assert.strictEqual(report.summary.binance_fill_projection_tp0_missing_n, 1);
  assert.strictEqual(report.summary.binance_fill_projection_tp1_trail_inactive_n, 1);
  assert.strictEqual(report.current_status.binance_fill_projection_native_protection_not_ok_n, 1);
  assert.deepStrictEqual(report.current_status.binance_fill_projection_issue_by_code, {
    LEGACY_PARTIAL_TP_FILL_PROJECTION_MISSING: 1,
    TP1_FILL_TRAIL_INACTIVE: 1,
    NATIVE_PROTECTION_NOT_OK: 1,
  });
  assert.strictEqual(typeof runtimeReportTest.buildRuntimeIntegrityAlertSections, "function");
  const sections = runtimeReportTest.buildRuntimeIntegrityAlertSections(report);
  assert.strictEqual(sections.length, 2);
  assert.ok(sections[0].lines.some((line) => line.includes("out_of_sync=1")));
  assert.ok(sections[1].lines.some((line) => line.includes("issue=3")));
  assert.deepStrictEqual(runtimeReportTest.buildRuntimeIntegrityAlertSections({
    summary: {
      binance_fill_projection_audit_issue_n: 0,
      binance_live_state_projection_out_of_sync_n: 0,
      binance_live_state_self_heal_required_n: 0,
      binance_live_state_native_stop_missing_n: 0,
    },
  }), []);
  assert.strictEqual(report.current_status.reverse_exception_rescue_bypass_tier_block, true);
  assert.strictEqual(report.summary.pine_shadow_transition_progress_pct, 100);
  assert.strictEqual(report.current_status.execution_shadow_policy, "EXCLUDE_FROM_EXECUTION_DEFAULT");
  console.log("SERVER_SIGNAL_RUNTIME_TEST_OK");
})();
