"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

function run() {
  assert.strictEqual(typeof __test.resolveEntryMinOrderBudgetAdjustment, "function", "resolveEntryMinOrderBudgetAdjustment export missing");

  const availableBudgetBump = __test.resolveEntryMinOrderBudgetAdjustment({
    minRequiredQuote: 10,
    notionalQuote: 6.5,
    budgetMax: 10,
    leverageMult: 2,
    maxFractionAllowed: 0.325,
    qtyFraction: 0.325,
    maxEntryNotional: 20,
    marketCapBudget: 10,
    currentPosBudgetUsed: 0,
  });
  assert.strictEqual(availableBudgetBump.ok, true);
  assert.strictEqual(availableBudgetBump.adjusted, true);
  assert.strictEqual(availableBudgetBump.notionalQuote, 10);
  assert.strictEqual(availableBudgetBump.adjustmentSource, "AVAILABLE_NOTIONAL_MIN_BUMP");

  const fractionAllowedBump = __test.resolveEntryMinOrderBudgetAdjustment({
    minRequiredQuote: 10,
    notionalQuote: 6.5,
    budgetMax: 10,
    leverageMult: 2,
    maxFractionAllowed: 0.75,
    qtyFraction: 0.325,
    maxEntryNotional: 20,
    marketCapBudget: 10,
    currentPosBudgetUsed: 0,
  });
  assert.strictEqual(fractionAllowedBump.ok, true);
  assert.strictEqual(fractionAllowedBump.adjusted, true);
  assert.strictEqual(fractionAllowedBump.notionalQuote, 10);
  assert.strictEqual(fractionAllowedBump.adjustmentSource, "FRACTIONAL_MIN_BUMP");

  const insufficientBudget = __test.resolveEntryMinOrderBudgetAdjustment({
    minRequiredQuote: 10,
    notionalQuote: 6.5,
    budgetMax: 10,
    leverageMult: 2,
    maxFractionAllowed: 0.325,
    qtyFraction: 0.325,
    maxEntryNotional: 8,
    marketCapBudget: 4,
    currentPosBudgetUsed: 0,
  });
  assert.strictEqual(insufficientBudget.ok, false);
  assert.strictEqual(insufficientBudget.reason, "MIN_ORDER_EXCEEDS_BUDGET");
  assert.match(insufficientBudget.note, /max_entry_notional=8/);

  console.log("BINANCE_LIVE_MIN_ORDER_BUDGET_TEST_OK");
}

run();
