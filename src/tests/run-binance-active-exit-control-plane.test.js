"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/run-binance-active-exit-control-plane");

function run() {
  assert.strictEqual(typeof __test.buildDailyOpsScripts, "function", "buildDailyOpsScripts export missing");
  assert.deepStrictEqual(__test.buildDailyOpsScripts(), [
    "report-tp1-fail-closed-events.js",
    "daily-system-ops-check.js",
  ]);
}

try {
  run();
  console.log("RUN_BINANCE_ACTIVE_EXIT_CONTROL_PLANE_TEST_OK");
} catch (err) {
  console.error("RUN_BINANCE_ACTIVE_EXIT_CONTROL_PLANE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
