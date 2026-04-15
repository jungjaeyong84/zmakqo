"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

function run() {
  assert.strictEqual(
    __test.shouldExecuteImmediateNativeProtectionRefresh({
      liveDryRun: false,
      opening: true,
      closing: false,
      remainingQtyBase: 1,
    }),
    true,
    "entry/opening fills must arm protection immediately"
  );

  assert.strictEqual(
    __test.shouldExecuteImmediateNativeProtectionRefresh({
      liveDryRun: false,
      opening: false,
      closing: true,
      remainingQtyBase: 0.25,
    }),
    true,
    "partial exits with runner remaining must refresh protection immediately"
  );

  assert.strictEqual(
    __test.shouldExecuteImmediateNativeProtectionRefresh({
      liveDryRun: false,
      opening: false,
      closing: true,
      remainingQtyBase: 0,
    }),
    false,
    "fully closed positions do not need immediate protection refresh"
  );

  assert.strictEqual(
    __test.shouldExecuteImmediateNativeProtectionRefresh({
      liveDryRun: true,
      opening: true,
      closing: false,
      remainingQtyBase: 1,
    }),
    false,
    "dry-run mode must never request immediate live protection execution"
  );

  console.log("NATIVE_PROTECTION_REFRESH_TIMING_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("NATIVE_PROTECTION_REFRESH_TIMING_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
