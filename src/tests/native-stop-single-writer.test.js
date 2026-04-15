"use strict";

const assert = require("assert");
const paperBinanceRunner = require("../engine/paperBinanceRunner");

async function run() {
  assert.ok(paperBinanceRunner.__test, "__test export missing");
  assert.strictEqual(
    paperBinanceRunner.__test.isAuthorizedBinanceNativeStopWriter("BINANCE_TICK_EXIT"),
    true,
    "tick exit must remain the only authorized native stop writer"
  );
  assert.strictEqual(
    paperBinanceRunner.__test.isAuthorizedBinanceNativeStopWriter("LIVE_EXECUTOR"),
    false,
    "non-authority runtime layers must not write native stops directly"
  );

  const unauthorized = await paperBinanceRunner.refreshBinanceNativeProtectionWithRetry({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    writerSource: "LIVE_EXECUTOR",
  });
  assert.strictEqual(unauthorized.ok, false);
  assert.strictEqual(unauthorized.skipped, true);
  assert.strictEqual(unauthorized.reason, "NATIVE_STOP_WRITE_NON_AUTHORITY_LAYER");

  console.log("NATIVE_STOP_SINGLE_WRITER_TEST_OK");
}

run().catch((err) => {
  console.error("NATIVE_STOP_SINGLE_WRITER_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
