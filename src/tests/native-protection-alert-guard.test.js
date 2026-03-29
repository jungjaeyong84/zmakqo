"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperUpbitRunner");

async function run() {
  let called = 0;
  const result = await __test.notifyNativeProtectionResult({
    nativeProtection: {
      ok: false,
      reason: "NATIVE_PLACE_FAIL",
      error: "simulated",
      attempts: 1,
    },
    symbol: "BTCUSDT",
    exchange: "BINANCEFUT",
    alertFn: async () => {
      called += 1;
      throw new Error("alert sender exploded");
    },
  });

  assert.strictEqual(called, 1, "alert function must be called once");
  assert.strictEqual(result.ok, false, "failed native protection should stay failed");
  assert.strictEqual(result.reason, "NATIVE_PLACE_FAIL");
}

run()
  .then(() => {
    console.log("NATIVE_PROTECTION_ALERT_GUARD_TEST_OK");
  })
  .catch((err) => {
    console.error("NATIVE_PROTECTION_ALERT_GUARD_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
