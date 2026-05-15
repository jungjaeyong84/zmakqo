"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const { buildV3PaperExitLedgerReport } = require("../v3/localPaperExitLedger");

function tmpFile(name) {
  return path.join(fs.mkdtempSync(path.join(os.tmpdir(), "v3-exit-ledger-")), name);
}

(() => {
  const exitLedgerPath = tmpFile("exit-ledger.jsonl");
  const entryRows = [
    {
      v3_paper_entry_id: "entry-1",
      signal_id: "sig-1",
      symbol: "SUIUSDT",
      exchange: "BINANCEFUT",
      tf: "15m",
      side: "LONG",
      setup_type: "MOMENTUM_CONTINUATION",
      structural_regime: "TREND",
      edge_cohort: "BUILDABLE_EDGE",
      cohort_key: "LONG | MOMENTUM_CONTINUATION | TREND | BUILDABLE_EDGE | CORE",
      profile_id: "LONG_MC_TREND_BUILDABLE_CORE",
      entry_grade: "CORE",
      market_quality_score: 0.82,
      spread_bps: 1.1,
      funding_rate: 0.00008,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
      feature_lineage_source: "V3_LOCAL_PUBLIC_KLINE_GENERATOR",
      signal_price: 10,
      stop_price: 9,
      target_price: 11,
      status: "OPEN",
    },
  ];
  const report = buildV3PaperExitLedgerReport(entryRows, {
    exitLedgerPath,
    candlePathsBySignalId: {
      "sig-1": [
        {
          open_time: "2026-05-11T00:00:00.000Z",
          close_time: "2026-05-11T00:00:59.999Z",
          high: 11.2,
          low: 8.8,
        },
      ],
    },
  });
  assert.strictEqual(report.appended_exit_n, 1);
  assert.strictEqual(report.remaining_open_position_n, 0);
  assert.strictEqual(report.new_exits[0].exit_event, "SL_HIT");
  assert.strictEqual(report.new_exits[0].structural_regime, "TREND");
  assert.strictEqual(report.new_exits[0].edge_cohort, "BUILDABLE_EDGE");
  assert.strictEqual(report.new_exits[0].realized_r, -1);
  assert.strictEqual(report.new_exits[0].market_quality_score, 0.82);
  assert.strictEqual(report.new_exits[0].spread_bps, 1.1);
  assert.strictEqual(report.new_exits[0].price_source, "BINANCE_FAPI_1M_KLINES_AMBIGUOUS_CONSERVATIVE_STOP");
})();

(() => {
  const exitLedgerPath = tmpFile("exit-ledger.jsonl");
  const entryRows = [
    {
      v3_paper_entry_id: "entry-2",
      signal_id: "sig-2",
      symbol: "BTCUSDT",
      exchange: "BINANCEFUT",
      tf: "15m",
      side: "SHORT",
      setup_type: "MOMENTUM_CONTINUATION",
      entry_grade: "CORE",
      signal_price: 100,
      stop_price: 105,
      target_price: 90,
      status: "OPEN",
    },
  ];
  const report = buildV3PaperExitLedgerReport(entryRows, {
    exitLedgerPath,
    candlePathsBySignalId: {
      "sig-2": [
        {
          open_time: "2026-05-11T00:00:00.000Z",
          close_time: "2026-05-11T00:00:59.999Z",
          high: 105.5,
          low: 99.5,
        },
      ],
    },
  });
  assert.strictEqual(report.appended_exit_n, 1);
  assert.strictEqual(report.new_exits[0].exit_event, "SL_HIT");
  assert.strictEqual(report.new_exits[0].realized_r, -1);
})();

(() => {
  const exitLedgerPath = tmpFile("exit-ledger.jsonl");
  const entryRows = [
    {
      v3_paper_entry_id: "entry-3",
      signal_id: "sig-3",
      symbol: "ETHUSDT",
      exchange: "BINANCEFUT",
      tf: "15m",
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      entry_grade: "CORE",
      status: "OPEN",
    },
  ];
  const report = buildV3PaperExitLedgerReport(entryRows, {
    exitLedgerPath,
    candlePathsBySignalId: {
      "sig-3": [
        {
          open_time: "2026-05-11T00:00:00.000Z",
          close_time: "2026-05-11T00:00:59.999Z",
          high: 2100,
          low: 1990,
        },
      ],
    },
    signalLookup: {
      "sig-3": {
        signal_price: 2000,
        stop_price: 1950,
        target_price: 2100,
      },
    },
  });
  assert.strictEqual(report.hydrated_open_entry_n, 1);
  assert.strictEqual(report.appended_exit_n, 1);
  assert.strictEqual(report.new_exits[0].exit_event, "TP_HIT");
})();

(() => {
  const exitLedgerPath = tmpFile("exit-ledger.jsonl");
  fs.writeFileSync(exitLedgerPath, `${JSON.stringify({
    v3_paper_exit_id: "existing",
    signal_id: "sig-4",
    status: "CLOSED",
  })}\n`);
  const entryRows = [
    {
      v3_paper_entry_id: "entry-4",
      signal_id: "sig-4",
      symbol: "XRPUSDT",
      exchange: "BINANCEFUT",
      tf: "15m",
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      entry_grade: "CORE",
      signal_price: 1,
      stop_price: 0.95,
      target_price: 1.05,
      status: "OPEN",
    },
  ];
  const report = buildV3PaperExitLedgerReport(entryRows, {
    exitLedgerPath,
    candlePathsBySignalId: {
      "sig-4": [
        {
          open_time: "2026-05-11T00:00:00.000Z",
          close_time: "2026-05-11T00:00:59.999Z",
          high: 1.05,
          low: 0.99,
        },
      ],
    },
  });
  assert.strictEqual(report.appended_exit_n, 0);
  assert.strictEqual(report.eligible_open_entry_n, 0);
})();

(() => {
  const exitLedgerPath = tmpFile("exit-ledger.jsonl");
  const entryRows = [
    {
      v3_paper_entry_id: "entry-5",
      signal_id: "sig-5",
      symbol: "TAOUSDT",
      exchange: "BINANCEFUT",
      tf: "15m",
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      entry_grade: "EARLY",
      signal_price: 100,
      stop_price: 95,
      target_price: 110,
      status: "OPEN",
    },
  ];
  const report = buildV3PaperExitLedgerReport(entryRows, {
    exitLedgerPath,
    candlePathsBySignalId: {},
  });
  assert.strictEqual(report.appended_exit_n, 0);
  assert.strictEqual(report.blocked_reason_counts.V3_EXIT_PATH_UNAVAILABLE, 1);
})();

console.log("v3-local-paper-exit-ledger.test.js PASS");
