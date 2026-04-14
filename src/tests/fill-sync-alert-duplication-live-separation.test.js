"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-fill-sync-alert-duplication-live-separation");

function run() {
  const buildSeparatedReport = __test && __test.buildSeparatedReport;
  assert.strictEqual(typeof buildSeparatedReport, "function", "buildSeparatedReport export missing");

  const report = buildSeparatedReport({
    generated_at: "2026-04-13T00:00:00.000Z",
    lookback_days: 7,
    top_duplicate_groups: [
      { symbol: "ETHUSDT", event: "EXIT_TP_P0_0.8P", backfilled: false },
    ],
    top_duplicate_groups_all: [
      { symbol: "ETHUSDT", event: "EXIT_TP_P0_0.8P", backfilled: false },
      { symbol: "BTCUSDT", event: "EXIT_TRAIL", backfilled: true },
      { symbol: "ETHUSDT", event: "EXIT_TP_P1_1.65P", backfilled: true },
    ],
    historical_backfilled_duplicate_groups: [
      { symbol: "BTCUSDT", event: "EXIT_TRAIL", backfilled: true },
      { symbol: "ETHUSDT", event: "EXIT_TP_P1_1.65P", backfilled: true },
    ],
  });

  assert.strictEqual(report.live_duplicate_group_n, 1);
  assert.strictEqual(report.historical_backfilled_duplicate_group_n, 2);
  assert.deepStrictEqual(report.live_symbols, ["ETHUSDT"]);
  assert.deepStrictEqual(report.historical_backfilled_symbols, ["BTCUSDT", "ETHUSDT"]);
  assert.deepStrictEqual(report.overlap_symbols, ["ETHUSDT"]);

  console.log("FILL_SYNC_ALERT_DUPLICATION_LIVE_SEPARATION_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("FILL_SYNC_ALERT_DUPLICATION_LIVE_SEPARATION_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
