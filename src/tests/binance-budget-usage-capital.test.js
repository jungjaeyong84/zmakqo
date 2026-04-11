"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

function run() {
  assert.strictEqual(typeof __test.resolveBudgetUsedFromNotional, "function");
  assert.strictEqual(typeof __test.resolveBinanceBudgetUsedKrw, "function");

  const marginUsed = __test.resolveBudgetUsedFromNotional({
    notional: 4079.395,
    leverage: 2,
  });
  assert.ok(Math.abs(marginUsed - 2039.6975) < 1e-9);

  const derived = __test.resolveBinanceBudgetUsedKrw({
    position: {
      exchange: "BINANCEFUT",
      symbol_or_pair_id: "SOLUSDT",
      qty_base: 43.7,
      avg_price: 93.35,
      size_pct: 1,
      budget_max_krw: 257,
      budget_used_krw: 4079.395,
      meta: { leverage: 2 },
    },
    riskBudget: {
      enabled: true,
      maxKrw: 257,
      byMarket: { SOLUSDT: 257 },
    },
  });
  assert.ok(Math.abs(derived - 2039.6975) < 1e-9);

  const fallbackToCap = __test.resolveBinanceBudgetUsedKrw({
    position: {
      exchange: "BINANCEFUT",
      symbol_or_pair_id: "AXSUSDT",
      size_pct: 1,
      budget_max_krw: 257,
      budget_used_krw: 9999,
      meta: {},
    },
    riskBudget: {
      enabled: true,
      maxKrw: 257,
      byMarket: { AXSUSDT: 257 },
    },
  });
  assert.strictEqual(fallbackToCap, 257);

  console.log("BINANCE_BUDGET_USAGE_CAPITAL_TEST_OK");
}

run();
