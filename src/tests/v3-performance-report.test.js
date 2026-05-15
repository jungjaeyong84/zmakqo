"use strict";

const assert = require("assert");

const { buildV3PaperPerformanceReport } = require("../v3/performanceReport");

(() => {
  const entryRows = [
    {
      v3_paper_entry_id: "entry-1",
      signal_id: "sig-1",
      symbol: "SUIUSDT",
      side: "LONG",
      setup_type: "MOMENTUM_CONTINUATION",
      entry_grade: "CORE",
      status: "OPEN",
      created_at: "2026-05-11T00:00:00.000Z",
      signal_price: 1.33,
      stop_price: 1.28,
      target_price: 1.42,
    },
    {
      v3_paper_entry_id: "entry-2",
      signal_id: "sig-2",
      symbol: "BTCUSDT",
      side: "SHORT",
      setup_type: "MOMENTUM_CONTINUATION",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      cohort_key: "SHORT | MOMENTUM_CONTINUATION | TREND | MARGINAL_EDGE | CORE",
      profile_id: "SHORT_MC_TREND_MARGINAL_CORE",
      entry_grade: "CORE",
      status: "OPEN",
      created_at: "2026-05-10T10:00:00.000Z",
      signal_price: 100,
      stop_price: 105,
      target_price: 90,
    },
    {
      v3_paper_entry_id: "entry-3",
      signal_id: "sig-3",
      symbol: "ETHUSDT",
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      cohort_key: "LONG | BREAKOUT_RETEST | TREND | MARGINAL_EDGE | CORE",
      profile_id: "LONG_BR_TREND_MARGINAL_CORE",
      entry_grade: "CORE",
      status: "OPEN",
      created_at: "2026-05-10T11:00:00.000Z",
      signal_price: 50,
      stop_price: 48,
      target_price: 53,
    },
  ];

  const exitRows = [
    {
      v3_paper_exit_id: "exit-2",
      signal_id: "sig-2",
      symbol: "BTCUSDT",
      status: "CLOSED",
      closed_at: "2026-05-11T01:00:00.000Z",
      exit_event: "TP_HIT",
      realized_r: 1.4,
      realized_pnl_pct: 10,
    },
    {
      v3_paper_exit_id: "exit-3",
      signal_id: "sig-3",
      symbol: "ETHUSDT",
      status: "CLOSED",
      closed_at: "2026-05-11T02:00:00.000Z",
      exit_event: "SL_HIT",
      realized_r: -1,
      realized_pnl_pct: -5,
    },
    {
      v3_paper_exit_id: "exit-4",
      signal_id: "sig-4",
      symbol: "SOLUSDT",
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      structural_regime: "RANGE",
      edge_cohort: "MARGINAL_EDGE",
      cohort_key: "LONG | BREAKOUT_RETEST | RANGE | MARGINAL_EDGE | CORE",
      profile_id: "LONG_BR_RANGE_MARGINAL_CORE",
      entry_grade: "CORE",
      status: "CLOSED",
      closed_at: "2026-05-11T03:00:00.000Z",
      exit_event: "TP_HIT",
      realized_r: 0.8,
      realized_pnl_pct: 4,
    },
  ];

  const report = buildV3PaperPerformanceReport(entryRows, exitRows, {
    now: new Date("2026-05-11T03:00:00.000Z"),
  });

  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.source_entry_n, 3);
  assert.strictEqual(report.source_exit_n, 3);
  assert.strictEqual(report.open_position_n, 1);
  assert.strictEqual(report.today_closed_trade_n, 3);
  assert.strictEqual(report.current_policy_closed_trade_n, 2);
  assert.strictEqual(report.today_metrics_r.sample_n, 3);
  assert.strictEqual(report.current_policy_metrics_r.sample_n, 2);
  assert.strictEqual(report.today_metrics_r.win_rate_pct, 66.67);
  assert.strictEqual(report.today_metrics_r.net, 1.2);
  assert.strictEqual(report.today_metrics_r.expectancy, 0.4);
  assert.strictEqual(report.current_policy_metrics_r.win_rate_pct, 50);
  assert.strictEqual(report.all_time_side_metrics_r.LONG.sample_n, 2);
  assert.strictEqual(report.all_time_side_metrics_r.SHORT.sample_n, 1);
  assert.strictEqual(report.current_policy_side_metrics_r.LONG.sample_n, 1);
  assert.strictEqual(report.current_policy_side_metrics_r.SHORT.sample_n, 1);
  assert.strictEqual(report.group_metric_basis, "EXACT_COHORT");
  assert.strictEqual(report.all_time_group_metrics_r.length, 3);
  assert.strictEqual(report.current_policy_group_metrics_r.length, 2);
  assert.strictEqual(report.all_time_group_metrics_r[0].cohort_key, "SHORT | MOMENTUM_CONTINUATION | TREND | MARGINAL_EDGE | CORE");
  assert.strictEqual(report.all_time_group_metrics_r[1].cohort_key, "LONG | BREAKOUT_RETEST | RANGE | MARGINAL_EDGE | CORE");
  assert.strictEqual(report.all_time_group_metrics_r[2].cohort_key, "LONG | BREAKOUT_RETEST | TREND | MARGINAL_EDGE | CORE");
  assert.strictEqual(report.open_positions[0].signal_id, "sig-1");
})();

console.log("v3-performance-report.test.js PASS");
