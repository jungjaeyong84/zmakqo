"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

async function run() {
  assert.strictEqual(typeof __test.resolveNativeProtectionPositionMeta, "function", "resolveNativeProtectionPositionMeta export missing");
  assert.deepStrictEqual(__test.resolveNativeProtectionPositionMeta(null), {}, "null position meta must coerce to empty object");
  const meta = { entry_event_id: "ENTRY__X" };
  assert.strictEqual(__test.resolveNativeProtectionPositionMeta(meta), meta, "object position meta should be passed through");
  assert.strictEqual(typeof __test.buildLiveNativeProtectionRefreshArgs, "function", "buildLiveNativeProtectionRefreshArgs export missing");
  assert.deepStrictEqual(
    __test.buildLiveNativeProtectionRefreshArgs({
      liveCfg: { liveEnabled: true },
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      side: "SELL",
      execPrice: 0.0941,
      priceRef: 0.094,
      leverageMult: 2,
      exitRulesOverride: { TP_P0: 0.008 },
      positionMeta: meta,
    }),
    {
      liveCfg: { liveEnabled: true },
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      fallbackSide: "SELL",
      fallbackEntryPrice: 0.0941,
      fallbackLeverage: 2,
      exitRulesOverride: { TP_P0: 0.008 },
      posMeta: meta,
    },
    "live native refresh args must carry positionMeta into posMeta"
  );

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
