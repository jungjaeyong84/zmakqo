"use strict";

const assert = require("assert");

const { buildV3BootstrapLiveSeedReport } = require("../v3/bootstrapLiveSeed");

(() => {
  const staticSeedRows = [
    { realized_pnl: -0.5 },
    { realized_pnl: 0.7 },
    { realized_pnl: -0.9 },
  ];
  const entryRows = [
    {
      v3_paper_entry_id: "entry-inj",
      signal_id: "sig-inj",
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      entry_grade: "CORE",
      market_quality_score: 0.83,
      spread_bps: 1.2,
      funding_rate: -0.00011,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
      feature_lineage_source: "V3_LOCAL_PUBLIC_KLINE_GENERATOR",
      profile_id: "LONG_BR_TREND_MARGINAL_CORE",
      cohort_key: "LONG | BREAKOUT_RETEST | TREND | MARGINAL_EDGE | CORE",
      signal_price: 10,
      stop_price: 9,
      target_price: 11.55,
    },
    {
      v3_paper_entry_id: "entry-legacy",
      signal_id: "sig-legacy",
      side: "LONG",
      setup_type: "MOMENTUM_CONTINUATION",
      entry_grade: "CORE",
    },
    {
      v3_paper_entry_id: "entry-hydrate",
      signal_id: "sig-hydrate",
      side: "SHORT",
      setup_type: "BREAKOUT_RETEST",
      entry_grade: "EARLY",
    },
    {
      v3_paper_entry_id: "entry-open-ready",
      signal_id: "sig-open-ready",
      status: "OPEN",
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      entry_grade: "CORE",
      market_quality_score: 0.81,
      spread_bps: 1.1,
      funding_rate: -0.00008,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
    },
    {
      v3_paper_entry_id: "entry-open-incomplete",
      signal_id: "sig-open-incomplete",
      status: "OPEN",
      side: "SHORT",
      setup_type: "BREAKOUT_RETEST",
      entry_grade: "EARLY",
    },
  ];
  const exitRows = [
    {
      v3_paper_exit_id: "exit-inj",
      signal_id: "sig-inj",
      status: "CLOSED",
      exit_event: "TP_HIT",
      realized_r: 1.4,
      realized_pnl_pct: 14,
      closed_at: "2026-05-11T08:30:00.000Z",
    },
    {
      v3_paper_exit_id: "exit-legacy",
      signal_id: "sig-legacy",
      status: "CLOSED",
      exit_event: "SL_HIT",
      realized_r: -1,
      realized_pnl_pct: -4,
      closed_at: "2026-05-11T09:00:00.000Z",
    },
    {
      v3_paper_exit_id: "exit-hydrate",
      signal_id: "sig-hydrate",
      status: "CLOSED",
      exit_event: "TP_HIT",
      realized_r: 1.1,
      realized_pnl_pct: 5.5,
      closed_at: "2026-05-11T09:15:00.000Z",
    },
  ];

  const report = buildV3BootstrapLiveSeedReport({
    entryRows,
    exitRows,
    staticSeedRows,
    signalLookup: {
      "sig-hydrate": {
        structural_regime: "TRANSITION",
        edge_cohort: "MARGINAL_EDGE",
        market_quality_score: 0.75,
        spread_bps: 1.6,
        funding_rate: -0.00009,
        btc_1h_trend: "SHORT",
        mtf_1h_direction: "SHORT",
        feature_lineage_source: "V3_LOCAL_PUBLIC_KLINE_GENERATOR",
        signal_price: 20,
        stop_price: 21,
        target_price: 18.45,
      },
    },
  });

  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.risk_unit_usdt, 0.7);
  assert.strictEqual(report.live_seed_row_n, 2);
  assert.strictEqual(report.blocked_reason_counts.V3_LIVE_SEED_CONTEXT_INCOMPLETE, 1);
  assert.strictEqual(report.pending_open_entry_n, 2);
  assert.strictEqual(report.pending_open_entry_live_seed_ready_n, 1);
  assert.strictEqual(report.pending_open_entry_context_incomplete_n, 1);
  assert.strictEqual(report.pending_open_entry_missing_field_counts.structural_regime, 1);
  assert.strictEqual(report.live_seed_rows[0].realized_pnl, null);
  assert.strictEqual(report.live_seed_rows[0].synthetic_realized_pnl_usdt, 0.98);
  assert.strictEqual(report.live_seed_rows[0].adjudication_family, "MODEL");
  assert.strictEqual(report.live_seed_rows[0].evidence.market_quality_score, 0.83);
  assert.strictEqual(report.live_seed_rows[0].evidence.spread_bps, 1.2);
  assert.strictEqual(report.live_seed_rows[0].evidence.btc_1h_trend, "LONG");
  assert.strictEqual(report.live_seed_rows[1].side, "SHORT");
  assert.strictEqual(report.live_seed_rows[1].evidence.market_quality_score, 0.75);
  assert.strictEqual(report.live_seed_rows[1].evidence.mtf_1h_direction, "SHORT");
})();

console.log("v3-bootstrap-live-seed.test.js PASS");
