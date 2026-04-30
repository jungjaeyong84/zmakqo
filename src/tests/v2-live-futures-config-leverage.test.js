"use strict";

// Regression for 2026-04-30 AXSUSDT: productionEntryRoute resolved leverage=3,
// but live transport config still read legacy Firestore futures_leverage=2 and
// sent setFuturesLeverage(2) to Binance. V2 env must be the live-write source
// of truth.

const assert = require("assert");

const runnerPath = require.resolve("../engine/paperBinanceRunner");
delete require.cache[runnerPath];
const { __test } = require("../engine/paperBinanceRunner");

const { resolveV2RuntimeFuturesLeverage } = __test;

{
  const result = resolveV2RuntimeFuturesLeverage({
    cfg: { futures_leverage: 2 },
    env: {
      V2_FUTURES_DEFAULT_LEVERAGE: "3",
      DONBEOLJA_V2_RISK_MAX_ACCOUNT_LEVERAGE: "3",
    },
  });
  assert.strictEqual(result.leverage, 3, "V2 env default must override stale Firestore futures_leverage=2");
  assert.strictEqual(result.source, "V2_FUTURES_DEFAULT_LEVERAGE");
}

{
  const result = resolveV2RuntimeFuturesLeverage({
    cfg: { futures_leverage: 2 },
    env: {
      V2_FUTURES_DEFAULT_LEVERAGE: "5",
      DONBEOLJA_V2_RISK_MAX_ACCOUNT_LEVERAGE: "3",
    },
  });
  assert.strictEqual(result.leverage, 3, "account max must cap V2 env default");
  assert.strictEqual(result.maxLeverage, 3);
}

{
  const result = resolveV2RuntimeFuturesLeverage({
    cfg: { futures_leverage: 2 },
    env: {},
  });
  assert.strictEqual(result.leverage, 2, "legacy Firestore leverage remains fallback when V2 env is absent");
  assert.strictEqual(result.source, "SYSTEM_SETTINGS_FUTURES_LEVERAGE");
}

{
  const result = resolveV2RuntimeFuturesLeverage({
    cfg: { futures_leverage: 2 },
    env: {
      V2_FUTURES_DEFAULT_LEVERAGE: "abc",
      DONBEOLJA_V2_FUTURES_DEFAULT_LEVERAGE: "3",
      DONBEOLJA_V2_RISK_MAX_ACCOUNT_LEVERAGE: "3",
    },
  });
  assert.strictEqual(result.leverage, 3, "DONBEOLJA_ alias is the second V2 env source");
  assert.strictEqual(result.source, "DONBEOLJA_V2_FUTURES_DEFAULT_LEVERAGE");
}

console.log("V2_LIVE_FUTURES_CONFIG_LEVERAGE_TEST_OK");
