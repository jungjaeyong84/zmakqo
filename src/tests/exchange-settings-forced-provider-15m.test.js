"use strict";

const assert = require("assert");
const {
  getExchangeSettingsForProvider,
  __test,
} = require("../utils/exchangeSettings");
const {
  BINANCEFUT_CORE_MARKETS,
  defaultTfAllowlistFromEnv,
  defaultMarketsFromEnv,
  normalizeMarketsList,
  ensureProviderMarkets,
} = require("../utils/marketConfig");

async function run() {
  const prev = {
    EXCHANGE_PROVIDERS: process.env.EXCHANGE_PROVIDERS,
    EXCHANGE_TF_ALLOWLIST: process.env.EXCHANGE_TF_ALLOWLIST,
    EXCHANGE_EXEC_TF: process.env.EXCHANGE_EXEC_TF,
    EXCHANGE_MARKETS_BINANCEFUT: process.env.EXCHANGE_MARKETS_BINANCEFUT,
    BINANCEFUT_MARKETS: process.env.BINANCEFUT_MARKETS,
  };

  process.env.EXCHANGE_PROVIDERS = "BINANCEFUT";
  process.env.EXCHANGE_TF_ALLOWLIST = "15m";
  process.env.EXCHANGE_EXEC_TF = "15m";
  process.env.EXCHANGE_MARKETS_BINANCEFUT = "BTCUSDT,ETHUSDT,AVAXUSDT,SUIUSDT";
  process.env.BINANCEFUT_MARKETS = "BTCUSDT,ETHUSDT,BNBUSDT,XRPUSDT,SOLUSDT,AXSUSDT,DOGEUSDT,LINKUSDT,AVAXUSDT";

  try {
    const cfg = await getExchangeSettingsForProvider("BINANCEFUT", 0);
    assert.strictEqual(cfg.provider, "BINANCEFUT");
    assert.strictEqual(cfg.locked_by_env, true);
    assert.deepStrictEqual(cfg.tf_allowlist, ["15m"]);
    assert.strictEqual(cfg.exec_tf, "15m");
    assert.deepStrictEqual(cfg.markets, BINANCEFUT_CORE_MARKETS);
    assert.deepStrictEqual(defaultMarketsFromEnv("BINANCEFUT"), BINANCEFUT_CORE_MARKETS);
    // 2026-04-29 — universe expanded to include SUIUSDT (and 7 other
    // BTC-decoupled symbols). normalizeMarketsList still drops anything
    // not in BINANCEFUT_CORE_MARKETS; AVAXUSDT remains absent so the
    // expected output is BTC + ETH + SUI.
    assert.deepStrictEqual(
      normalizeMarketsList(["BTCUSDT", "AVAXUSDT", "ETHUSDT", "SUIUSDT"], "BINANCEFUT"),
      ["BTCUSDT", "ETHUSDT", "SUIUSDT"]
    );
    assert.deepStrictEqual(
      ensureProviderMarkets(["ETHUSDT", "AVAXUSDT"], "BINANCEFUT"),
      BINANCEFUT_CORE_MARKETS
    );

    assert.deepStrictEqual(__test.harmonizeTfAllowlist(["60m"], "15m"), ["15m"]);
    assert.deepStrictEqual(__test.harmonizeTfAllowlist([], "15m"), ["15m"]);
  } finally {
    for (const [k, v] of Object.entries(prev)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  }

  const prev2 = {
    EXCHANGE_TF_ALLOWLIST: process.env.EXCHANGE_TF_ALLOWLIST,
    SIGNAL_TF_ALLOWLIST: process.env.SIGNAL_TF_ALLOWLIST,
    EXCHANGE_EXEC_TF: process.env.EXCHANGE_EXEC_TF,
    EXECUTION_TF: process.env.EXECUTION_TF,
    EXEC_TF: process.env.EXEC_TF,
  };
  delete process.env.EXCHANGE_TF_ALLOWLIST;
  delete process.env.SIGNAL_TF_ALLOWLIST;
  process.env.EXCHANGE_EXEC_TF = "15m";
  delete process.env.EXECUTION_TF;
  delete process.env.EXEC_TF;
  try {
    assert.deepStrictEqual(defaultTfAllowlistFromEnv(), ["15m"]);
  } finally {
    for (const [k, v] of Object.entries(prev2)) {
      if (v == null) delete process.env[k];
      else process.env[k] = v;
    }
  }
}

run()
  .then(() => {
    console.log("EXCHANGE_SETTINGS_FORCED_PROVIDER_15M_TEST_OK");
  })
  .catch((err) => {
    console.error("EXCHANGE_SETTINGS_FORCED_PROVIDER_15M_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
