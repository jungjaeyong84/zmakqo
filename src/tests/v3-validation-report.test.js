"use strict";

const assert = require("assert");

const { buildV3PaperValidationReport } = require("../v3/validationReport");

function exitRow(id, side, realizedR, closedAt) {
  return {
    v3_paper_exit_id: `exit-${id}`,
    signal_id: `sig-${id}`,
    symbol: `SYM${id}`,
    side,
    setup_type: "MOMENTUM_CONTINUATION",
    structural_regime: "TREND",
    edge_cohort: "MARGINAL_EDGE",
    entry_grade: "CORE",
    status: "CLOSED",
    closed_at: closedAt,
    realized_r: realizedR,
    realized_pnl_pct: realizedR * 5,
  };
}

(() => {
  const bootstrap = {
    retained_sample_n: 55,
    retained_metrics: {
      win_rate_pct: 58.5,
      expectancy_usdt: 0.23,
    },
    retained_live_metrics_r: {
      sample_n: 6,
      expectancy_r: 0.12,
    },
    target_hit: true,
    // gate_breakdown is how validationReport reads the bootstrap gate
    // (static_usdt / live_r .hit + .positive). The fixture must supply it
    // or every bootstrap-gated assertion fails regardless of target_hit.
    gate_breakdown: {
      static_usdt: { sample_n: 32, win_rate_pct: 58.5, expectancy_usdt: 0.23, profit_factor: 1.6, hit: true, positive: true },
      live_r: { sample_n: 6, win_rate_pct: 50, expectancy_r: 0.12, profit_factor: 1.4, hit: true, positive: true },
      both_required: true,
    },
  };
  const exitRows = [
    exitRow(1, "LONG", 1.2, "2026-05-01T00:00:00.000Z"),
    exitRow(2, "LONG", 0.8, "2026-05-02T00:00:00.000Z"),
    exitRow(3, "SHORT", -0.2, "2026-05-03T00:00:00.000Z"),
    exitRow(4, "LONG", 1.0, "2026-05-04T00:00:00.000Z"),
  ];

  const report = buildV3PaperValidationReport({
    bootstrap,
    entryRows: [],
    exitRows,
    now: new Date("2026-05-05T00:00:00.000Z"),
    thresholds: {
      min_retained_sample_n: 50,
      min_closed_trade_n: 4,
      min_paper_win_rate_pct: 50,
      min_paper_expectancy_r: 0,
      trade_windows: [2, 4],
      day_windows: [7],
    },
  });

  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.bootstrap_gate.ok, true);
  assert.strictEqual(report.paper_gate.ok, true);
  assert.strictEqual(report.readiness, "READY_FOR_RUNTIME_LANE_REVIEW");
  assert.strictEqual(report.rolling_trade_windows[0].label, "last_2_trades");
  assert.strictEqual(report.rolling_trade_windows[1].metrics.sample_n, 4);
})();

(() => {
  const bootstrap = {
    retained_sample_n: 31,
    retained_metrics: {
      win_rate_pct: 54.84,
      expectancy_usdt: 0.1892,
    },
    target_hit: false,
  };
  const exitRows = [
    exitRow(1, "LONG", -1.0744, "2026-05-11T05:45:48.939Z"),
  ];

  const report = buildV3PaperValidationReport({
    bootstrap,
    entryRows: [],
    exitRows,
    now: new Date("2026-05-11T06:00:00.000Z"),
    thresholds: {
      min_retained_sample_n: 50,
      min_closed_trade_n: 30,
      min_paper_win_rate_pct: 52,
      min_paper_expectancy_r: 0,
      trade_windows: [10],
      day_windows: [7],
    },
  });

  assert.strictEqual(report.bootstrap_gate.ok, false);
  assert.strictEqual(report.paper_gate.sample_ok, false);
  assert.strictEqual(report.readiness, "WAIT_BOOTSTRAP_EXPANSION");
  assert.ok(report.summary_lines.some((line) => line.includes("bootstrap retained sample")));
  assert.ok(report.summary_lines.some((line) => line.includes("paper closed trade")));
})();

(() => {
  const bootstrap = {
    retained_sample_n: 55,
    retained_metrics: {
      win_rate_pct: 58.5,
      expectancy_usdt: 0.23,
    },
    retained_live_metrics_r: {
      sample_n: 5,
      expectancy_r: 0.05,
    },
    target_hit: true,
    gate_breakdown: {
      static_usdt: { sample_n: 32, win_rate_pct: 58.5, expectancy_usdt: 0.23, profit_factor: 1.6, hit: true, positive: true },
      live_r: { sample_n: 5, win_rate_pct: 50, expectancy_r: 0.05, profit_factor: 1.35, hit: true, positive: true },
      both_required: true,
    },
    seed_mix: {
      live_seed_source_n: 5,
      static_seed_source_n: 399,
      effective_static_reference_n: 50,
      effective_live_seed_share_pct: 9.09,
    },
  };
  const exitRows = [
    exitRow(1, "LONG", 1.0, "2026-05-01T00:00:00.000Z"),
    exitRow(2, "LONG", 0.8, "2026-05-02T00:00:00.000Z"),
    exitRow(3, "SHORT", -0.2, "2026-05-03T00:00:00.000Z"),
    exitRow(4, "LONG", 0.9, "2026-05-04T00:00:00.000Z"),
  ];

  const report = buildV3PaperValidationReport({
    bootstrap,
    entryRows: [],
    exitRows,
    now: new Date("2026-05-05T00:00:00.000Z"),
    thresholds: {
      min_retained_sample_n: 50,
      min_closed_trade_n: 4,
      min_paper_win_rate_pct: 50,
      min_paper_expectancy_r: 0,
      min_live_seed_activation_n: 5,
      min_live_seed_mature_n: 10,
      min_live_seed_share_pct: 10,
      live_seed_static_reference_cap_n: 50,
      trade_windows: [2, 4],
      day_windows: [7],
    },
  });

  assert.strictEqual(report.bootstrap_gate.ok, true);
  assert.strictEqual(report.seed_mix_gate.active, true);
  assert.strictEqual(report.seed_mix_gate.ok, false);
  assert.strictEqual(report.readiness, "WAIT_LIVE_SEED_MIX_EXPANSION");
  assert.ok(report.summary_lines.some((line) => line.includes("live seed 비중")));
})();

(() => {
  const bootstrap = {
    retained_sample_n: 55,
    retained_metrics: {
      win_rate_pct: 58.5,
      expectancy_usdt: 0.23,
    },
    retained_live_metrics_r: {
      sample_n: 12,
      expectancy_r: -0.11,
    },
    target_hit: true,
    seed_mix: {
      live_seed_source_n: 12,
      static_seed_source_n: 399,
      effective_static_reference_n: 50,
      effective_live_seed_share_pct: 19.35,
    },
  };
  const exitRows = [
    exitRow(1, "LONG", 1.0, "2026-05-01T00:00:00.000Z"),
    exitRow(2, "LONG", 0.8, "2026-05-02T00:00:00.000Z"),
    exitRow(3, "SHORT", -0.2, "2026-05-03T00:00:00.000Z"),
    exitRow(4, "LONG", 0.9, "2026-05-04T00:00:00.000Z"),
  ];

  const report = buildV3PaperValidationReport({
    bootstrap,
    entryRows: [],
    exitRows,
    now: new Date("2026-05-05T00:00:00.000Z"),
    thresholds: {
      min_retained_sample_n: 50,
      min_closed_trade_n: 4,
      min_paper_win_rate_pct: 50,
      min_paper_expectancy_r: 0,
      min_live_seed_activation_n: 5,
      min_live_seed_mature_n: 10,
      min_live_seed_share_pct: 10,
      live_seed_static_reference_cap_n: 50,
      trade_windows: [2, 4],
      day_windows: [7],
    },
  });

  assert.strictEqual(report.bootstrap_gate.ok, false);
  assert.strictEqual(report.bootstrap_gate.live_positive_expectancy, false);
  assert.strictEqual(report.readiness, "WAIT_BOOTSTRAP_EXPANSION");
  assert.ok(report.summary_lines.some((line) => line.includes("bootstrap live expectancy")));
})();

console.log("v3-validation-report.test.js PASS");
