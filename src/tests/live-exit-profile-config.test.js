const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

async function run() {
  const fn = __test && __test.resolveConfiguredFuturesExitProfileMode;
  assert.strictEqual(typeof fn, "function", "resolveConfiguredFuturesExitProfileMode export missing");

  assert.strictEqual(fn(undefined, null), null);
  assert.strictEqual(fn("", null), null);
  assert.strictEqual(fn(null, null), null);
  assert.strictEqual(fn("BASE", null), "BASE");
  assert.strictEqual(fn("AGGRESSIVE", null), "AGGRESSIVE");
  assert.strictEqual(fn("invalid", null), "BASE");

  console.log("LIVE_EXIT_PROFILE_CONFIG_TEST_OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
