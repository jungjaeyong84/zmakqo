"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-trail-runner-floor-live-separation");

function run() {
  const buildSeparatedReport = __test && __test.buildSeparatedReport;
  assert.strictEqual(typeof buildSeparatedReport, "function", "buildSeparatedReport export missing");

  const report = buildSeparatedReport({
    generated_at: "2026-04-13T00:00:00.000Z",
    lookback_days: 7,
    violation_n: 1,
    violation_total_n: 3,
    top_violations: [
      { symbol: "ETHUSDT", backfilled: false, run_id: "RUN1" },
    ],
    top_violations_all: [
      { symbol: "ETHUSDT", backfilled: false, run_id: "RUN1" },
      { symbol: "BTCUSDT", backfilled: true, run_id: "RUN2" },
      { symbol: "ETHUSDT", backfilled: true, run_id: "RUN3" },
    ],
  });

  assert.strictEqual(report.live_violation_n, 1);
  assert.strictEqual(report.historical_backfilled_violation_n, 2);
  assert.deepStrictEqual(report.live_symbols, ["ETHUSDT"]);
  assert.deepStrictEqual(report.historical_backfilled_symbols, ["BTCUSDT", "ETHUSDT"]);
  assert.deepStrictEqual(report.overlap_symbols, ["ETHUSDT"]);

  console.log("TRAIL_RUNNER_FLOOR_LIVE_SEPARATION_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("TRAIL_RUNNER_FLOOR_LIVE_SEPARATION_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
