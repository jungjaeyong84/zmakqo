"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

async function run() {
  assert.strictEqual(__test.isRetryableLiveInfraError({ code: "EGRESS_PROXY_TIMEOUT" }), true);
  assert.strictEqual(__test.isRetryableLiveInfraError({ message: "fetch failed" }), true);
  assert.strictEqual(__test.isRetryableLiveInfraError({ message: "margin is insufficient" }), false);

  let fetchCalls = 0;
  const exchangeInfoCache = new Map();
  const firstInfo = await __test.fetchFuturesExchangeInfoWithCache("DOGEUSDT", {
    fetchFn: async () => {
      fetchCalls += 1;
      return { minQty: 1, minNotional: 5 };
    },
    cache: exchangeInfoCache,
    nowMs: 1_000,
    ttlMs: 60_000,
  });
  const secondInfo = await __test.fetchFuturesExchangeInfoWithCache("DOGEUSDT", {
    fetchFn: async () => {
      fetchCalls += 1;
      return { minQty: 2, minNotional: 10 };
    },
    cache: exchangeInfoCache,
    nowMs: 2_000,
    ttlMs: 60_000,
  });
  assert.strictEqual(fetchCalls, 1);
  assert.deepStrictEqual(firstInfo, secondInfo);

  const staleInfo = await __test.fetchFuturesExchangeInfoWithCache("DOGEUSDT", {
    fetchFn: async () => {
      throw new Error("EGRESS_PROXY_FETCH_FAIL provider=binancefut action=fetchFuturesExchangeInfo");
    },
    cache: exchangeInfoCache,
    nowMs: 70_000,
    ttlMs: 60_000,
    staleMaxAgeMs: 24 * 60 * 60 * 1000,
    allowStaleOnError: true,
    retryCount: 0,
  });
  assert.deepStrictEqual(staleInfo, firstInfo);

  let leverageSetCalls = 0;
  const exitResult = await __test.ensureLiveFuturesLeverage({
    liveCfg: { apiKey: "k", apiSecret: "s" },
    symbol: "DOGEUSDT",
    leverageMult: 2,
    isExit: true,
    setFn: async () => {
      leverageSetCalls += 1;
    },
  });
  assert.strictEqual(exitResult.ok, true);
  assert.strictEqual(exitResult.reason, "EXIT_REDUCE_ONLY_SKIP");
  assert.strictEqual(leverageSetCalls, 0);

  let transientCalls = 0;
  const leverageCache = new Map();
  const leverageResult = await __test.ensureLiveFuturesLeverage({
    liveCfg: { apiKey: "k", apiSecret: "s" },
    symbol: "AXSUSDT",
    leverageMult: 3,
    isExit: false,
    cache: leverageCache,
    retryCount: 1,
    retryDelayMs: 0,
    setFn: async () => {
      transientCalls += 1;
      if (transientCalls === 1) {
        const err = new Error("EGRESS_PROXY_TIMEOUT provider=binancefut action=setFuturesLeverage");
        err.code = "EGRESS_PROXY_TIMEOUT";
        throw err;
      }
      return { ok: true };
    },
  });
  assert.strictEqual(leverageResult.ok, true);
  assert.strictEqual(transientCalls, 2);
  assert.strictEqual(leverageCache.get("AXSUSDT").value, 3);

  console.log("LIVE_EXECUTION_RUNTIME_GUARDS_TEST_OK");
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
