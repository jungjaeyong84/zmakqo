"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-binance-exit-qty-live-separation");

function run() {
  const buildSeparatedReport = __test && __test.buildSeparatedReport;
  assert.strictEqual(typeof buildSeparatedReport, "function", "buildSeparatedReport export missing");

  const report = buildSeparatedReport({
    generated_at_iso: "2026-04-12T00:00:00.000Z",
    lookback_days: 7,
    issue_code_counts: [{ code: "TP1_ABS_OVER", count: 1 }],
    issue_code_total_counts: [{ code: "TP1_ABS_OVER", count: 3 }],
    issues: [
      { symbol: "ETHUSDT", chain_key: "LIVE1", backfilled: false, issues: [{ code: "TP1_ABS_OVER" }] },
    ],
    issues_total: [
      { symbol: "ETHUSDT", chain_key: "LIVE1", backfilled: false, issues: [{ code: "TP1_ABS_OVER" }] },
      { symbol: "BTCUSDT", chain_key: "HIST1", backfilled: true, issues: [{ code: "TP0_ABS_OVER" }] },
      { symbol: "ETHUSDT", chain_key: "HIST2", backfilled: true, issues: [{ code: "TRAIL_REMAINDER_OVER" }] },
    ],
  });

  assert.strictEqual(report.live_issue_chain_n, 1);
  assert.strictEqual(report.historical_backfilled_issue_chain_n, 2);
  assert.deepStrictEqual(report.live_symbols, ["ETHUSDT"]);
  assert.deepStrictEqual(report.historical_backfilled_symbols, ["BTCUSDT", "ETHUSDT"]);
  assert.deepStrictEqual(report.overlap_symbols, ["ETHUSDT"]);

  console.log("BINANCE_EXIT_QTY_LIVE_SEPARATION_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("BINANCE_EXIT_QTY_LIVE_SEPARATION_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
