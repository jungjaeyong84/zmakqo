"use strict";

const assert = require("assert");
const {
  evaluateEntryBudgetGuard,
  resolveEntryBudgetGuardFeasibleBand,
} = require("../utils/entryBudgetGuard");

async function run() {
  const nonEntry = await evaluateEntryBudgetGuard({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    intent: "EXIT",
    qtyPct: 0.5,
  });
  assert.strictEqual(nonEntry.applicable, false);
  assert.strictEqual(nonEntry.reason, "NON_ENTRY");

  const ethBlocked = await evaluateEntryBudgetGuard({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    intent: "ENTRY",
    qtyPct: 0.65,
    getSystemSettings: async () => ({
      data: {
        execution_mode: "LIVE",
        futures_leverage: 2,
        live_min_order_krw: 5,
      },
    }),
    getRiskBudget: async () => ({
      data: {
        by_market: { ETHUSDT: 15 },
        default_max_krw: 15,
      },
    }),
    fetchExchangeInfo: async () => ({
      minNotional: 20,
      minQty: 0.001,
    }),
  });
  assert.strictEqual(ethBlocked.applicable, true);
  assert.strictEqual(ethBlocked.ok, false);
  assert.strictEqual(ethBlocked.reason, "MIN_ORDER_EXCEEDS_BUDGET");
  assert.strictEqual(ethBlocked.notionalQuote, 19.5);
  assert.strictEqual(ethBlocked.minRequiredQuote, 20);
  assert.ok(Math.abs(ethBlocked.requiredQtyPct - (20 / (15 * 2))) < 1e-9);
  assert.ok(Math.abs(ethBlocked.requiredBudget - (20 / (0.65 * 2))) < 1e-9);

  const dogePass = await evaluateEntryBudgetGuard({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    intent: "ENTRY",
    qtyPct: 0.2,
    getSystemSettings: async () => ({
      data: {
        execution_mode: "LIVE",
        futures_leverage: 2,
        live_min_order_krw: 5,
      },
    }),
    getRiskBudget: async () => ({
      data: {
        by_market: { DOGEUSDT: 15 },
        default_max_krw: 15,
      },
    }),
    fetchExchangeInfo: async () => ({
      minNotional: 5,
      minQty: 1,
    }),
  });
  assert.strictEqual(dogePass.applicable, true);
  assert.strictEqual(dogePass.ok, true);
  assert.strictEqual(dogePass.reason, "ENTRY_BUDGET_GUARD_OK");
  assert.strictEqual(dogePass.notionalQuote, 6);
  assert.strictEqual(dogePass.minRequiredQuote, 5);

  assert.deepStrictEqual(
    resolveEntryBudgetGuardFeasibleBand({
      applicable: true,
      ok: false,
      reason: "MIN_ORDER_EXCEEDS_BUDGET",
      requiredQtyPct: 0.25,
    }),
    {
      band: "REDUCED_FEASIBLE",
      fullOnly: false,
      minTradableQtyPct: 0.25,
    }
  );

  assert.deepStrictEqual(
    resolveEntryBudgetGuardFeasibleBand({
      applicable: true,
      ok: false,
      reason: "MIN_ORDER_EXCEEDS_BUDGET",
      requiredQtyPct: 0.85,
    }),
    {
      band: "FULL_ONLY",
      fullOnly: true,
      minTradableQtyPct: 0.85,
    }
  );

  const paperSkip = await evaluateEntryBudgetGuard({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    intent: "ENTRY",
    qtyPct: 1,
    getSystemSettings: async () => ({
      data: {
        execution_mode: "PAPER",
        futures_leverage: 2,
      },
    }),
    getRiskBudget: async () => ({
      data: {
        by_market: { BTCUSDT: 15 },
        default_max_krw: 15,
      },
    }),
    fetchExchangeInfo: async () => ({
      minNotional: 50,
      minQty: 0.001,
    }),
  });
  assert.strictEqual(paperSkip.applicable, false);
  assert.strictEqual(paperSkip.reason, "NON_LIVE_MODE");

  console.log("ENTRY_BUDGET_GUARD_TEST_OK");
}

run().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
