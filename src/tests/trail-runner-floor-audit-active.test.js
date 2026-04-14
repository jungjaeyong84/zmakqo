"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-trail-runner-floor-audit");

function run() {
  assert.strictEqual(typeof __test.activeStopViolationDirection, "function");
  assert.strictEqual(typeof __test.buildActiveRunnerFloorViolation, "function");

  assert.strictEqual(__test.activeStopViolationDirection({
    side: "LONG",
    stopPrice: 0.0913,
    floorPrice: 0.093579,
  }), "BELOW_FLOOR_LONG");

  const violation = __test.buildActiveRunnerFloorViolation({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    position_state: "SCALE_OUT",
    position_side: "LONG",
    qty_base: 8182,
    avg_price: 0.09206,
    meta: {
      tp_p0_done: true,
      tp_p1_done: true,
      trail_active: true,
      native_protection_stop_price: 0.0913,
      native_protection_refresh_status: "OK",
      trail_high: 0.09305,
      exit_rules_override: {
        TP_P0: 0.008,
        TP_P1: 0.0165,
        TP_P0_QTY: 0.25,
        TP_P1_QTY: 0.5,
        RUNNER_MIN_PROFIT_PCT: 0.0165,
        TRAIL_R_MULTIPLE: 0.6,
        SL: -0.0165,
      },
    },
  });
  assert.ok(violation, "active native stop deficit must be detected");
  assert.strictEqual(violation.symbol, "DOGEUSDT");
  assert.strictEqual(violation.violation, "BELOW_FLOOR_LONG");
  assert.ok(Number(violation.expected_stop_price) > Number(violation.native_stop_price));

  console.log("TRAIL_RUNNER_FLOOR_AUDIT_ACTIVE_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("TRAIL_RUNNER_FLOOR_AUDIT_ACTIVE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
