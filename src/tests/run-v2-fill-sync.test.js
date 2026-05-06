"use strict";

const assert = require("assert");
const path = require("path");

const syncModulePath = require.resolve("../../src/services/binanceFuturesFillsSync");
const exchangeSettingsPath = require.resolve("../../src/utils/exchangeSettings");
const marketConfigPath = require.resolve("../../src/utils/marketConfig");
const runnerPath = require.resolve("../../scripts/run-v2-fill-sync");

const originalSyncModule = require.cache[syncModulePath];
const originalExchangeModule = require.cache[exchangeSettingsPath];
const originalMarketConfigModule = require.cache[marketConfigPath];
delete require.cache[runnerPath];

let captured = null;
require.cache[syncModulePath] = {
  id: syncModulePath,
  filename: syncModulePath,
  loaded: true,
  exports: {
    syncBinanceFuturesFills: async (payload) => {
      captured = payload;
      return { ok: true, synced_n: 3 };
    },
  },
};
require.cache[exchangeSettingsPath] = {
  id: exchangeSettingsPath,
  filename: exchangeSettingsPath,
  loaded: true,
  exports: {
    getExchangeSettingsForProvider: async () => ({
      exec_tf: "15m",
      markets: ["BTCUSDT", "ETHUSDT"],
    }),
  },
};
require.cache[marketConfigPath] = {
  id: marketConfigPath,
  filename: marketConfigPath,
  loaded: true,
  exports: {
    defaultExecTfFromEnv: () => "15m",
  },
};

const runner = require(runnerPath);

(async () => {
  const result = await runner.main({
    env: {
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: "SOLUSDT|DOGEUSDT",
      BINANCEFUT_FILLS_SYNC_CRON_LOOKBACK_HOURS: "6",
      BINANCEFUT_FILLS_SYNC_CRON_REPROCESS_EXISTING: "1",
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.market_n, 2);
  assert.deepStrictEqual(captured.markets, ["SOLUSDT", "DOGEUSDT"]);
  assert.strictEqual(captured.executionMode, "LIVE");
  assert.strictEqual(captured.liveEnabled, true);
  assert.strictEqual(captured.lookbackMs, 6 * 60 * 60 * 1000);
  assert.strictEqual(captured.reprocessExisting, true);
  assert.strictEqual(captured.force, true);
  assert.strictEqual(captured.execTf, "15m");

  console.log("RUN_V2_FILL_SYNC_TEST_OK");
})().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exitCode = 1;
}).finally(() => {
  delete require.cache[runnerPath];
  if (originalSyncModule) require.cache[syncModulePath] = originalSyncModule;
  else delete require.cache[syncModulePath];
  if (originalExchangeModule) require.cache[exchangeSettingsPath] = originalExchangeModule;
  else delete require.cache[exchangeSettingsPath];
  if (originalMarketConfigModule) require.cache[marketConfigPath] = originalMarketConfigModule;
  else delete require.cache[marketConfigPath];
});
