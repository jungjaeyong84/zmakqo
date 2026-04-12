"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-binance-exit-execution-drilldown");

function run() {
  const fills = [
    {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      event: "EXIT_TP_P0_0.8P",
      qty_pct: 0.25,
      created_at: "2026-04-12T00:00:00.000Z",
      _stage: "TP0",
      _qty_pct: 0.25,
    },
    {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      event: "EXIT_TP_P1_1.65P",
      qty_pct: 0.375,
      created_at: "2026-04-12T00:01:00.000Z",
      _stage: "TP1",
      _qty_pct: 0.375,
    },
    {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      event: "EXIT_TRAIL",
      qty_pct: 0.375,
      created_at: "2026-04-12T00:02:00.000Z",
      _stage: "TRAIL",
      _qty_pct: 0.375,
    },
    {
      exchange: "BINANCEFUT",
      symbol: "BNBUSDT",
      event: "EXIT_TRAIL",
      qty_pct: 1,
      created_at: "2026-04-12T00:03:00.000Z",
      _stage: "TRAIL",
      _qty_pct: 1,
    },
  ];

  const report = __test.buildReport(fills, {
    issues: [
      { symbol: "BNBUSDT" },
    ],
    issues_total: [
      { symbol: "BNBUSDT" },
      { symbol: "BTCUSDT" },
    ],
  });

  assert.strictEqual(report.symbol_n, 2);
  assert.strictEqual(report.unresolved_symbol_n, 1);
  assert.strictEqual(report.backfilled_only_symbol_n, 1);
  assert.strictEqual(report.clean_symbol_n, 0);
  assert.strictEqual(report.top_historical_symbols[0].symbol, "BNBUSDT");
  assert.strictEqual(report.top_historical_symbols[0].contract_state, "UNRESOLVED_ISSUE");
  const btc = report.symbols.find((row) => row.symbol === "BTCUSDT");
  assert.ok(btc);
  assert.strictEqual(btc.contract_state, "BACKFILLED_ONLY");
  assert.strictEqual(btc.tp0_fill_n, 1);
  assert.strictEqual(btc.tp1_fill_n, 1);
  assert.strictEqual(btc.trail_fill_n, 1);
  assert.strictEqual(btc.tp1_qty_pct_sum, 0.375);
}

try {
  run();
  console.log("BINANCE_EXIT_EXECUTION_DRILLDOWN_TEST_OK");
} catch (err) {
  console.error(err);
  process.exit(1);
}
