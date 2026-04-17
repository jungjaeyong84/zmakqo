"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

async function run() {
  assert.strictEqual(typeof __test.resolveNativeProtectionPositionMeta, "function", "resolveNativeProtectionPositionMeta export missing");
  const resolvedNullMeta = __test.resolveNativeProtectionPositionMeta(null);
  assert.ok(resolvedNullMeta && typeof resolvedNullMeta === "object", "null position meta must coerce to an object");
  assert.ok(Object.keys(resolvedNullMeta).every((key) => key === "simplified_exit_v2_enabled"),
    `unexpected null-meta keys: ${JSON.stringify(resolvedNullMeta)}`);
  const meta = { entry_event_id: "ENTRY__X" };
  const resolvedMeta = __test.resolveNativeProtectionPositionMeta(meta);
  assert.strictEqual(resolvedMeta.entry_event_id, "ENTRY__X", "position meta must preserve the entry lineage");
  assert.ok(Object.keys(resolvedMeta).every((key) => key === "entry_event_id" || key === "simplified_exit_v2_enabled"),
    `unexpected position-meta keys: ${JSON.stringify(resolvedMeta)}`);
  const prevSimplifiedExitV2Env = process.env.SIMPLIFIED_EXIT_V2_ENABLED;
  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "1";
  assert.deepStrictEqual(
    __test.resolveNativeProtectionPositionMeta({ entry_event_id: "ENTRY__Y" }),
    {
      entry_event_id: "ENTRY__Y",
      simplified_exit_v2_enabled: true,
    },
    "native protection refresh meta must inherit simplified exit v2 flag before first fill meta upsert"
  );
  if (prevSimplifiedExitV2Env == null) delete process.env.SIMPLIFIED_EXIT_V2_ENABLED;
  else process.env.SIMPLIFIED_EXIT_V2_ENABLED = prevSimplifiedExitV2Env;
  assert.strictEqual(typeof __test.buildLiveNativeProtectionRefreshArgs, "function", "buildLiveNativeProtectionRefreshArgs export missing");
  const refreshArgs = __test.buildLiveNativeProtectionRefreshArgs({
    liveCfg: { liveEnabled: true },
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    side: "SELL",
    execPrice: 0.0941,
    priceRef: 0.094,
    leverageMult: 2,
    exitRulesOverride: { TP_P0: 0.008 },
    positionMeta: meta,
  });
  assert.deepStrictEqual(
    {
      liveCfg: refreshArgs.liveCfg,
      exchange: refreshArgs.exchange,
      symbol: refreshArgs.symbol,
      fallbackSide: refreshArgs.fallbackSide,
      fallbackEntryPrice: refreshArgs.fallbackEntryPrice,
      fallbackLeverage: refreshArgs.fallbackLeverage,
      exitRulesOverride: refreshArgs.exitRulesOverride,
    },
    {
      liveCfg: { liveEnabled: true },
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      fallbackSide: "SELL",
      fallbackEntryPrice: 0.0941,
      fallbackLeverage: 2,
      exitRulesOverride: { TP_P0: 0.008 },
    },
    "live native refresh args must preserve the entry-side protection inputs"
  );
  assert.strictEqual(refreshArgs.posMeta.entry_event_id, "ENTRY__X");
  assert.ok(Object.keys(refreshArgs.posMeta).every((key) => key === "entry_event_id" || key === "simplified_exit_v2_enabled"),
    `unexpected refresh posMeta keys: ${JSON.stringify(refreshArgs.posMeta)}`);

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "1";
  assert.deepStrictEqual(
    __test.buildLiveNativeProtectionRefreshArgs({
      liveCfg: { liveEnabled: true },
      exchange: "BINANCEFUT",
      symbol: "DOGEUSDT",
      side: "SELL",
      execPrice: 0.0941,
      priceRef: 0.094,
      leverageMult: 2,
      exitRulesOverride: { TP_P1: 0.0168 },
      positionMeta: { entry_event_id: "ENTRY__Z" },
    }).posMeta,
    {
      entry_event_id: "ENTRY__Z",
      simplified_exit_v2_enabled: true,
    },
    "native refresh args must propagate simplified exit v2 into immediate post-entry refresh"
  );
  if (prevSimplifiedExitV2Env == null) delete process.env.SIMPLIFIED_EXIT_V2_ENABLED;
  else process.env.SIMPLIFIED_EXIT_V2_ENABLED = prevSimplifiedExitV2Env;

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

  assert.strictEqual(
    __test.shouldFailClosedForIncompleteTp1Protection({
      tpEnabled: true,
      stageState: { tp1Eligible: true },
      tpStatus: "FAILED",
      tpOrder: null,
    }),
    true,
    "pre-TP1 native refresh must fail closed when TP1 placement failed"
  );
  assert.strictEqual(
    __test.shouldFailClosedForIncompleteTp1Protection({
      tpEnabled: true,
      stageState: { tp1Eligible: true },
      tpStatus: "OK",
      tpOrder: { orderId: "tp1-order-1" },
    }),
    false,
    "healthy pre-TP1 TP1 placement must not fail closed"
  );
  assert.strictEqual(
    __test.shouldFailClosedForIncompleteTp1Protection({
      tpEnabled: true,
      stageState: { tp1Eligible: false },
      tpStatus: "FAILED",
      tpOrder: null,
    }),
    false,
    "trail/post-TP1 stage must not require TP1 fail-closed"
  );

  let skippedCalled = 0;
  const skippedResult = await __test.notifyNativeProtectionResult({
    nativeProtection: {
      ok: false,
      skipped: true,
      reason: "REPAIR_REQUESTED_NON_AUTHORITY_LAYER",
      attempts: 0,
    },
    symbol: "ETHUSDT",
    exchange: "BINANCEFUT",
    alertFn: async () => {
      skippedCalled += 1;
      return { ok: true };
    },
  });
  assert.strictEqual(skippedCalled, 0, "request-only native protection should not alert");
  assert.strictEqual(skippedResult.ok, true, "request-only native protection should be treated as non-failure");
  assert.strictEqual(skippedResult.reason, "REPAIR_REQUESTED_NON_AUTHORITY_LAYER");
}

run()
  .then(() => {
    console.log("NATIVE_PROTECTION_ALERT_GUARD_TEST_OK");
  })
  .catch((err) => {
    console.error("NATIVE_PROTECTION_ALERT_GUARD_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
