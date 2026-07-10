"use strict";

// Tests for the 2026-07-10 honest-measurement pass:
//   1. cost model — every closed paper exit records cost_r (round-trip fee +
//      slippage expressed in R at that trade's own risk width) and
//      realized_r_net, and the validation gate judges NET R, not gross.
//      Rationale: at the 1.86% median risk width the unmodeled live cost is
//      ~0.075R/trade, which had made an on-exchange -EV strategy look +EV.
//   2. equity-curve state — OBSERVE-ONLY stamp on admitted entries (trailing
//      window of closed net R). It must never block an entry; it exists to
//      accumulate forward evidence for a possible future promotion.

const assert = require("assert");
const os = require("os");
const path = require("path");
const fs = require("fs");

const exitLedger = require("../v3/localPaperExitLedger");
const entryLedger = require("../v3/localPaperEntryLedger");
const validation = require("../v3/validationReport");

const { resolveCostConfig, computeCostR } = exitLedger;
const { computeEquityCurveState, resolveEquityCurveWindowN } = entryLedger.__test;
const { toNetRealizedR, toNetRealizedExitRows, buildEquityCurveObservation } = validation.__test;

function withEnv(pairs, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(pairs)) {
    prev[k] = process.env[k];
    if (v === undefined) delete process.env[k]; else process.env[k] = v;
  }
  try { return fn(); } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
}

// ---- cost config resolver ---------------------------------------------------
withEnv({ V3_COST_ROUND_TRIP_FEE_PCT: undefined, V3_COST_ROUND_TRIP_SLIPPAGE_PCT: undefined }, () => {
  const config = resolveCostConfig();
  assert.strictEqual(config.round_trip_fee_pct, 0.10, "default round-trip fee is taker 0.05% x 2");
  assert.strictEqual(config.round_trip_slippage_pct, 0.04, "default round-trip slippage is 0.02% x 2");
});
withEnv({ V3_COST_ROUND_TRIP_FEE_PCT: "0.04", V3_COST_ROUND_TRIP_SLIPPAGE_PCT: "0" }, () => {
  const config = resolveCostConfig();
  assert.strictEqual(config.round_trip_fee_pct, 0.04);
  assert.strictEqual(config.round_trip_slippage_pct, 0, "explicit zero slippage is honored, not defaulted");
});

// ---- computeCostR -----------------------------------------------------------
// 2% risk width, 0.14% round-trip cost -> 0.07R.
assert.strictEqual(
  computeCostR({ signal_price: 100, stop_price: 98 }, { round_trip_fee_pct: 0.10, round_trip_slippage_pct: 0.04 }),
  0.07
);
// SHORT (stop above entry) uses the same absolute width.
assert.strictEqual(
  computeCostR({ signal_price: 100, stop_price: 102 }, { round_trip_fee_pct: 0.10, round_trip_slippage_pct: 0.04 }),
  0.07
);
assert.strictEqual(computeCostR({ signal_price: 100 }), null, "missing stop -> no cost estimate");
assert.strictEqual(computeCostR({ signal_price: 100, stop_price: 100 }), null, "zero risk width -> no cost estimate");

// ---- exit ledger writes cost fields + passes the equity-curve stamp through --
(() => {
  const ledgerPath = path.join(os.tmpdir(), `v3-cost-${process.pid}-${Date.now()}.jsonl`);
  const entry = {
    v3_paper_entry_id: "V3ENTRY__sig-cost-1",
    signal_id: "sig-cost-1",
    symbol: "ETHUSDT",
    exchange: "BINANCEFUT",
    tf: "15m",
    side: "LONG",
    status: "OPEN",
    signal_price: 100,
    stop_price: 98,
    target_price: 103.1,
    equity_curve_state: "on",
    equity_curve_window_n: 20,
  };
  const candlePath = [
    { open_time: "2026-07-10T00:00:00.000Z", close_time: "2026-07-10T00:01:00.000Z", high: 103.2, low: 100.5 },
  ];
  const report = withEnv({ V3_COST_ROUND_TRIP_FEE_PCT: undefined, V3_COST_ROUND_TRIP_SLIPPAGE_PCT: undefined }, () => (
    exitLedger.buildV3PaperExitLedgerReport([entry], {
      exitLedgerPath: ledgerPath,
      candlePathsBySignalId: { "sig-cost-1": candlePath },
    })
  ));
  assert.strictEqual(report.appended_exit_n, 1);
  const row = report.new_exits[0];
  assert.strictEqual(row.exit_event, "TP_HIT");
  assert.strictEqual(row.realized_r, 1.55);
  assert.strictEqual(row.cost_r, 0.07, "0.14% round-trip cost at 2% risk width");
  assert.strictEqual(row.realized_r_net, 1.48);
  assert.strictEqual(row.cost_round_trip_fee_pct, 0.10);
  assert.strictEqual(row.cost_round_trip_slippage_pct, 0.04);
  assert.strictEqual(row.equity_curve_state, "ON", "entry stamp survives to the exit row");
  assert.strictEqual(row.equity_curve_window_n, 20);
  fs.rmSync(ledgerPath, { force: true });
})();

// ---- computeEquityCurveState ------------------------------------------------
function closedExit(i, netR, closedAtMs) {
  return {
    status: "CLOSED",
    closed_at: new Date(closedAtMs).toISOString(),
    realized_r: netR + 0.07,
    realized_r_net: netR,
  };
}
(() => {
  const t0 = Date.parse("2026-07-01T00:00:00.000Z");
  const nowMs = t0 + 100 * 60_000;
  // 19 closed trades < window 20 -> no state yet.
  const few = Array.from({ length: 19 }, (_, i) => closedExit(i, 1, t0 + i * 60_000));
  assert.strictEqual(computeEquityCurveState(few, nowMs, 20).state, null);

  // 20 winners -> ON; then 20 losers appended later -> OFF (trailing window moved).
  const winners = Array.from({ length: 20 }, (_, i) => closedExit(i, 1, t0 + i * 60_000));
  assert.strictEqual(computeEquityCurveState(winners, nowMs, 20).state, "ON");
  const losers = Array.from({ length: 20 }, (_, i) => closedExit(100 + i, -1, t0 + (50 + i) * 60_000));
  const flipped = computeEquityCurveState([...winners, ...losers], nowMs, 20);
  assert.strictEqual(flipped.state, "OFF");
  assert.strictEqual(flipped.trailing_net_r, -20);

  // rows closed at/after the decision time are invisible (no lookahead).
  const future = closedExit(999, 100, nowMs + 60_000);
  assert.strictEqual(computeEquityCurveState([...winners, ...losers, future], nowMs, 20).state, "OFF");

  // legacy rows without realized_r_net fall back to gross minus modeled cost.
  const legacy = Array.from({ length: 20 }, (_, i) => ({
    status: "CLOSED",
    closed_at: new Date(t0 + i * 60_000).toISOString(),
    realized_r: 0.05,
    signal_price: 100,
    stop_price: 98,
  }));
  const legacyState = withEnv({ V3_COST_ROUND_TRIP_FEE_PCT: undefined, V3_COST_ROUND_TRIP_SLIPPAGE_PCT: undefined }, () => (
    computeEquityCurveState(legacy, nowMs, 20)
  ));
  assert.strictEqual(legacyState.state, "OFF", "+0.05R gross is -0.02R net at the default cost model");

  withEnv({ V3_EQUITY_CURVE_WINDOW: "5" }, () => {
    assert.strictEqual(resolveEquityCurveWindowN(), 5);
  });
  withEnv({ V3_EQUITY_CURVE_WINDOW: undefined }, () => {
    assert.strictEqual(resolveEquityCurveWindowN(), 20);
  });
})();

// ---- entry ledger stamps the state and NEVER blocks on it --------------------
(() => {
  const ledgerPath = path.join(os.tmpdir(), `v3-eq-${process.pid}-${Date.now()}.jsonl`);
  // closes sit 3 days back so the daily-drawdown kill switch (which only
  // counts trades closed since 00:00 UTC today) stays out of this test.
  const t0 = Date.now() - 3 * 86_400_000;
  // 20 losing closed trades -> state OFF at admit time.
  const exitRows = Array.from({ length: 20 }, (_, i) => closedExit(i, -1, t0 + i * 60_000));
  const queueRow = {
    signal_id: `V3SIG__BINANCEFUT__ETHUSDT__15m__${Date.now()}__LONG`,
    created_at: new Date(Date.now() - 60 * 1000).toISOString(),
    symbol: "ETHUSDT",
    exchange: "BINANCEFUT",
    tf: "15m",
    side: "LONG",
    setup_type: "MOMENTUM_CONTINUATION",
    structural_regime: "TREND",
    edge_cohort: "MARGINAL_EDGE",
    cohort_key: "LONG | MC | TREND | MARGINAL_EDGE | CORE",
    profile_id: "LONG_MC_TREND_MARGINAL_CORE",
    entry_grade: "CORE",
    market_state: "BULL",
    htf_bias: "BULL",
    opportunity_score: 0.73,
    confidence: 0.74,
    setup_quality_score: 0.73,
    structure_alignment: 0.9,
    htf_alignment_score: 0.9,
    market_quality_score: 0.8,
    spread_bps: 1.2,
    funding_rate: 0.0001,
    btc_1h_trend: "LONG",
    mtf_1h_direction: "LONG",
    feature_lineage_source: "V3_LOCAL_PUBLIC_KLINE_GENERATOR",
    rr: 1.55,
    signal_price: 100,
    stop_price: 98,
    target_price: 103.1,
  };
  const report = entryLedger.buildV3PaperEntryLedgerReport([queueRow], {
    ledgerPath,
    exitRows,
    nowMs: Date.now(),
  });
  assert.strictEqual(report.appended_entry_n, 1, "OFF state must not block the entry — observe-only");
  assert.strictEqual(report.new_entries[0].equity_curve_state, "OFF");
  assert.strictEqual(report.new_entries[0].equity_curve_window_n, 20);
  assert.strictEqual(report.new_entries[0].equity_curve_trailing_net_r, -20);
  assert.strictEqual(report.equity_curve.state, "OFF");
  fs.rmSync(ledgerPath, { force: true });
})();

// ---- validation gate judges NET R -------------------------------------------
(() => {
  // gross +0.05R/trade looks alive; net (-0.02R at default costs) must fail
  // the positive-rolling gate. Prices give a 2% risk width -> cost 0.07R.
  function pricedExit(i, grossR, closedAt) {
    return {
      v3_paper_exit_id: `exit-${i}`,
      signal_id: `sig-${i}`,
      symbol: `SYM${i}`,
      side: "LONG",
      setup_type: "MOMENTUM_CONTINUATION",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      entry_grade: "CORE",
      status: "CLOSED",
      closed_at: closedAt,
      realized_r: grossR,
      realized_pnl_pct: grossR * 2,
      signal_price: 100,
      stop_price: 98,
    };
  }
  const bootstrap = {
    retained_sample_n: 55,
    retained_metrics: { win_rate_pct: 58.5, expectancy_usdt: 0.23 },
    retained_live_metrics_r: { sample_n: 6, expectancy_r: 0.12 },
    target_hit: true,
    gate_breakdown: {
      static_usdt: { sample_n: 32, win_rate_pct: 58.5, expectancy_usdt: 0.23, profit_factor: 1.6, hit: true, positive: true },
      live_r: { sample_n: 6, win_rate_pct: 50, expectancy_r: 0.12, profit_factor: 1.4, hit: true, positive: true },
      both_required: true,
    },
  };
  const exitRows = Array.from({ length: 4 }, (_, i) => (
    pricedExit(i, 0.05, new Date(Date.parse("2026-05-01T00:00:00.000Z") + i * 86_400_000).toISOString())
  ));
  const report = withEnv({ V3_COST_ROUND_TRIP_FEE_PCT: undefined, V3_COST_ROUND_TRIP_SLIPPAGE_PCT: undefined }, () => (
    validation.buildV3PaperValidationReport({
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
    })
  ));
  assert.strictEqual(report.paper_gate.metric_basis, "NET_OF_COSTS");
  assert.strictEqual(report.paper_gate.gross_expectancy_r, 0.05);
  assert.strictEqual(report.paper_gate.expectancy_r, -0.02, "gate expectancy is net of the modeled cost");
  assert.strictEqual(report.paper_gate.rolling_ok, false, "gross-positive but net-negative windows must fail");
  assert.strictEqual(report.paper_gate.ok, false);
  assert.strictEqual(report.readiness, "PAPER_SAMPLE_FAILS_QUALITY");
  assert.ok(report.equity_curve_observation, "observe-only equity-curve split is reported");
  assert.strictEqual(report.equity_curve_observation.mode, "OBSERVE_ONLY");
  assert.strictEqual(report.equity_curve_observation.window_n, 20);

  // helper-level: recorded realized_r_net wins over recomputation.
  assert.strictEqual(toNetRealizedR({ realized_r: 1.55, realized_r_net: 1.48 }, resolveCostConfig()), 1.48);
  const mapped = toNetRealizedExitRows([{ status: "CLOSED", realized_r: 1.55, signal_price: 100, stop_price: 98 }]);
  assert.strictEqual(Math.round(mapped[0].realized_r * 100) / 100, 1.48);
})();

// ---- equity-curve observation splits ON/OFF walk-forward ---------------------
(() => {
  const t0 = Date.parse("2026-06-01T00:00:00.000Z");
  const mk = (i, netR, entryMs, closedMs) => ({
    exit: {
      v3_paper_entry_id: `E${i}`,
      status: "CLOSED",
      closed_at: new Date(closedMs).toISOString(),
      realized_r: netR,
      realized_r_net: netR,
    },
    entry: { v3_paper_entry_id: `E${i}`, created_at: new Date(entryMs).toISOString() },
  });
  const rows = [];
  // 5 winners then 5 losers, each entering after the previous closed.
  for (let i = 0; i < 5; i += 1) rows.push(mk(i, 1, t0 + i * 2 * 60_000, t0 + (i * 2 + 1) * 60_000));
  for (let i = 5; i < 10; i += 1) rows.push(mk(i, -1, t0 + i * 2 * 60_000, t0 + (i * 2 + 1) * 60_000));
  const observation = buildEquityCurveObservation(
    rows.map((r) => r.entry),
    rows.map((r) => r.exit),
    { windowN: 3 }
  );
  // walk-forward: trades 3..6 enter with a positive trailing-3 -> ON
  // (trade 6 still sees +1: two winners and one loser); 7..9 enter negative -> OFF.
  assert.strictEqual(observation.on_metrics.sample_n, 4);
  assert.strictEqual(observation.off_metrics.sample_n, 3);
  assert.strictEqual(observation.off_metrics.net_r, -3);
})();

console.log("v3-cost-model-and-equity-curve.test.js passed");
