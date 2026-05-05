"use strict";

const assert = require("assert");
const {
  resolveBinanceRepairLiveCfg,
  __test,
} = require("../v2/binanceRepairLiveCfgResolver");

const positionCycle = Object.freeze({
  position_cycle_id: "PCY__BINANCEFUT__ETHUSDT__LONG__livecfg",
  exchange: "BINANCEFUT",
  symbol: "ETHUSDT",
  position_side: "LONG",
  entry_price: 2500,
});

(async function resolverPassesExchangeSymbolAndEnvFromPositionCycle() {
  const calls = [];
  const env = { DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "1" };
  const cfg = await resolveBinanceRepairLiveCfg({
    env,
    positionCycle,
    resolveLiveFuturesConfigFn: async (args) => {
      calls.push(args);
      return {
        executionMode: "LIVE",
        liveEnabled: true,
        liveDryRun: false,
        apiKey: "key",
        apiSecret: "secret",
        leverage: 2,
      };
    },
  });
  assert.deepStrictEqual(calls, [{ exchange: "BINANCEFUT", symbol: "ETHUSDT", env }]);
  assert.strictEqual(cfg.apiKey, "key");
  assert.strictEqual(cfg.apiSecret, "secret");
  assert.strictEqual(cfg.executionMode, "LIVE");
})();

(async function resolverAllowsLiveDryRunForNonWritingValidationMode() {
  const cfg = await resolveBinanceRepairLiveCfg({
    positionCycle,
    resolveLiveFuturesConfigFn: async () => ({
      executionMode: "LIVE_DRY_RUN",
      liveEnabled: false,
      liveDryRun: true,
      apiKey: "key",
      apiSecret: "secret",
    }),
  });
  assert.strictEqual(cfg.liveDryRun, true);
})();

(async function resolverRejectsMissingKeysAndDisabledLiveCfg() {
  let err = null;
  try {
    await resolveBinanceRepairLiveCfg({
      positionCycle,
      resolveLiveFuturesConfigFn: async () => ({
        executionMode: "LIVE",
        liveEnabled: true,
        apiKey: "",
        apiSecret: "",
      }),
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "BINANCE_REPAIR_LIVE_KEYS_MISSING");

  err = null;
  try {
    await resolveBinanceRepairLiveCfg({
      positionCycle,
      resolveLiveFuturesConfigFn: async () => ({
        executionMode: "PAPER",
        liveEnabled: false,
        liveDryRun: false,
        apiKey: "key",
        apiSecret: "secret",
        reason: "MARKET_NOT_ALLOWED",
      }),
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "BINANCE_REPAIR_LIVE_CFG_NOT_ENABLED");
})();

(function resolverRejectsInvalidPositionCycleWithoutParsingId() {
  let err = null;
  try {
    __test.validatePositionCycleForLiveCfg({
      position_cycle_id: "PCY__BINANCEFUT__BTCUSDT__LONG__livecfg",
      exchange: "BINANCEFUT",
      symbol: "",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "BINANCE_REPAIR_SYMBOL_REQUIRED");

  err = null;
  try {
    __test.validatePositionCycleForLiveCfg({
      exchange: "UPBIT",
      symbol: "BTCUSDT",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "BINANCE_REPAIR_EXCHANGE_NOT_BINANCE");
})();

console.log("V2_BINANCE_REPAIR_LIVE_CFG_RESOLVER_TEST_OK");
