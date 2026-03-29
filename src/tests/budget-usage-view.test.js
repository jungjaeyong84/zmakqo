const assert = require("assert");
const {
  resolvePositionBudgetUsedKrw,
  resolveFillBudgetUsedKrw,
} = require("../utils/budgetUsageView");

const pos = {
  exchange: "BINANCEFUT",
  qty_base: 2,
  avg_price: 100,
  leverage: 2,
  size_pct: 1,
  budget_used_krw: 500,
};

const used = resolvePositionBudgetUsedKrw({
  exchange: "BINANCEFUT",
  position: pos,
  budgetMaxKrw: 500,
});
assert.strictEqual(used, 100);

const fillUsed = resolveFillBudgetUsedKrw({
  exchange: "BINANCEFUT",
  fill: {
    notional_krw: 200,
    leverage_applied: 2,
  },
  budgetMaxKrw: 500,
});
assert.strictEqual(fillUsed, 100);

const upbitUsed = resolvePositionBudgetUsedKrw({
  exchange: "UPBIT",
  position: { size_pct: 0.4 },
  budgetMaxKrw: 1000,
});
assert.strictEqual(upbitUsed, 400);

console.log("BUDGET_USAGE_VIEW_TEST_OK");
