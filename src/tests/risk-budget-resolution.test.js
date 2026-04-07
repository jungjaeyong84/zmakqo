"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperUpbitRunner");

async function run() {
  assert.strictEqual(typeof __test.resolveRiskBudget, "function", "resolveRiskBudget export missing");

  const originalEnv = {
    BINANCE_API_KEY: process.env.BINANCE_API_KEY,
    BINANCE_API_SECRET: process.env.BINANCE_API_SECRET,
  };
  const originalFetcher = global.fetch;
  const originalConsoleWarn = console.warn;
  process.env.BINANCE_API_KEY = "";
  process.env.BINANCE_API_SECRET = "";
  global.fetch = async () => ({
    ok: true,
    json: async () => ({
      provider: "BINANCEFUT",
      source: "ai_allocation",
      enabled: false,
      on_exceed: "SKIP",
      default_max_krw: 3577,
      total_max_krw: 3578.2025161,
      unit: "USDT",
      by_market: {
        BNBUSDT: 17,
      },
      side_allocation: {
        enabled: false,
      },
    }),
  });
  console.warn = () => {};

  try {
    const budget = await __test.resolveRiskBudget("BNBUSDT", "BINANCEFUT");
    assert.strictEqual(budget.enabled, true, "effective budget should stay enabled when by_market/default exists");
    assert.strictEqual(budget.configuredEnabled, false, "configured enabled flag should preserve raw config");
    assert.strictEqual(budget.maxKrw, 17);
    assert.ok(Number.isFinite(budget.totalMaxKrw) && budget.totalMaxKrw > 0, "total budget should remain populated");
    assert.strictEqual(budget.onExceed, "SKIP");

    const disabledBudget = await __test.resolveRiskBudget("XLMUSDT", "BINANCEFUT");
    assert.strictEqual(disabledBudget.enabled, true, "default budget should also activate effective budget");
    assert.strictEqual(disabledBudget.maxKrw, 3577);
  } finally {
    if (typeof originalEnv.BINANCE_API_KEY === "undefined") delete process.env.BINANCE_API_KEY;
    else process.env.BINANCE_API_KEY = originalEnv.BINANCE_API_KEY;
    if (typeof originalEnv.BINANCE_API_SECRET === "undefined") delete process.env.BINANCE_API_SECRET;
    else process.env.BINANCE_API_SECRET = originalEnv.BINANCE_API_SECRET;
    global.fetch = originalFetcher;
    console.warn = originalConsoleWarn;
  }
}

run()
  .then(() => {
    console.log("RISK_BUDGET_RESOLUTION_TEST_OK");
  })
  .catch((err) => {
    console.error("RISK_BUDGET_RESOLUTION_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
