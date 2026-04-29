"use strict";

// 2026-04-29 P1-1.2 — qty/budget calculation helper extraction
// unit tests.
//
// These five helpers + POS_SIZE_EPSILON used to live inline in
// src/engine/paperBinanceRunner.js. They are extracted to
// src/utils/qtyCalculation.js with no behavioural change. The
// tests below pin the contract from the new module's perspective
// so a future P1-1.x extraction (or any unrelated change in
// qtyCalculation) can't silently regress the behaviour that the
// runner-internal callers and live-rescue-add-plan.test.js depend
// on.
//
// What this file does NOT replace: live-rescue-add-plan.test.js
// continues to exercise these helpers through the
// paperBinanceRunner.__test re-export surface, which is the
// integration contract. This file is the unit-level pin.

const assert = require("assert");

delete require.cache[require.resolve("../utils/qtyCalculation")];
const {
  POS_SIZE_EPSILON,
  resolveCurrentQtyPctForCap,
  resolveLogicalCurrentQtyPctForBudget,
  resolveLiveExitCurrentQtyPct,
  resolveIntentFillCloseRatio,
  resolveSyncedAddChainBaseQtyPct,
} = require("../utils/qtyCalculation");

// ── (Z) POS_SIZE_EPSILON ───────────────────────────────────────
(function testEpsilon() {
  assert.ok(Number.isFinite(POS_SIZE_EPSILON), "(Z1) epsilon is finite");
  assert.ok(POS_SIZE_EPSILON >= 0, "(Z2) epsilon non-negative");
  assert.ok(POS_SIZE_EPSILON > 0 && POS_SIZE_EPSILON < 0.01,
    "(Z3) epsilon is a sane fractional floor (default 0.0001)");
})();

// ── (A) resolveCurrentQtyPctForCap ─────────────────────────────
(function testCap() {
  assert.strictEqual(resolveCurrentQtyPctForCap({ currentQtyPct: 0.25 }, 0.15), 0.25,
    "(A1) state.currentQtyPct wins over fallback");
  assert.strictEqual(resolveCurrentQtyPctForCap(null, 0.15), 0.15,
    "(A2) null state → fallback");
  assert.strictEqual(resolveCurrentQtyPctForCap(undefined, 0.42), 0.42,
    "(A3) undefined state → fallback");
  assert.strictEqual(resolveCurrentQtyPctForCap({}, 0.30), 0.30,
    "(A4) state without currentQtyPct → fallback");
  assert.strictEqual(resolveCurrentQtyPctForCap({ currentQtyPct: "garbage" }, 0.30), 0.30,
    "(A5) non-finite currentQtyPct → fallback");
  assert.strictEqual(resolveCurrentQtyPctForCap(null), 0,
    "(A6) no fallback supplied → 0 (default param)");
  assert.strictEqual(resolveCurrentQtyPctForCap(null, "garbage"), 0,
    "(A7) non-finite fallback → 0");
})();

// ── (B) resolveLogicalCurrentQtyPctForBudget ───────────────────
(function testBudget() {
  assert.strictEqual(
    resolveLogicalCurrentQtyPctForBudget({ budgetMaxKrw: 1000, budgetUsedKrw: 250 }),
    0.25,
    "(B1) used/max"
  );
  assert.strictEqual(
    resolveLogicalCurrentQtyPctForBudget({ budgetMaxKrw: 1000, budgetUsedKrw: 1500 }),
    1,
    "(B2) clamped to 1"
  );
  assert.strictEqual(
    resolveLogicalCurrentQtyPctForBudget({ budgetMaxKrw: 0, budgetUsedKrw: 250 }),
    null,
    "(B3) zero max → null"
  );
  assert.strictEqual(
    resolveLogicalCurrentQtyPctForBudget({ budgetMaxKrw: 1000, budgetUsedKrw: 0 }),
    null,
    "(B4) zero used → null (no budget recorded)"
  );
  assert.strictEqual(
    resolveLogicalCurrentQtyPctForBudget({ budgetMaxKrw: -1, budgetUsedKrw: 250 }),
    null,
    "(B5) negative max → null"
  );
  assert.strictEqual(
    resolveLogicalCurrentQtyPctForBudget({}),
    null,
    "(B6) empty → null"
  );
  assert.strictEqual(
    resolveLogicalCurrentQtyPctForBudget(),
    null,
    "(B7) no arg → null"
  );
})();

// ── (C) resolveLiveExitCurrentQtyPct ───────────────────────────
(function testLiveExit() {
  // Binance + budget present → trust budget.
  assert.strictEqual(
    resolveLiveExitCurrentQtyPct({
      exchange: "BINANCE",
      position: { budget_max_krw: 1000, budget_used_krw: 500 },
      fallbackQtyPct: 0.10,
    }),
    0.5,
    "(C1) Binance + budget → use budget over fallback"
  );
  // Binance + missing budget → fall through to fallback.
  assert.strictEqual(
    resolveLiveExitCurrentQtyPct({
      exchange: "BINANCE",
      position: {},
      fallbackQtyPct: 0.10,
    }),
    0.10,
    "(C2) Binance + no budget → fallback"
  );
  // Non-Binance → use fallback regardless of budget.
  assert.strictEqual(
    resolveLiveExitCurrentQtyPct({
      exchange: "BITHUMB",
      position: { budget_max_krw: 1000, budget_used_krw: 500 },
      fallbackQtyPct: 0.20,
    }),
    0.20,
    "(C3) Non-Binance ignores budget, uses fallback"
  );
  // Sub-epsilon fallback → null.
  assert.strictEqual(
    resolveLiveExitCurrentQtyPct({
      exchange: "BINANCE",
      position: {},
      fallbackQtyPct: 0,
    }),
    null,
    "(C4) sub-epsilon fallback → null"
  );
  // No usable input → null.
  assert.strictEqual(
    resolveLiveExitCurrentQtyPct({}),
    null,
    "(C5) empty input → null"
  );
  // Case-insensitive exchange match.
  assert.strictEqual(
    resolveLiveExitCurrentQtyPct({
      exchange: "binance_futures",
      position: { budget_max_krw: 1000, budget_used_krw: 750 },
      fallbackQtyPct: 0.10,
    }),
    0.75,
    "(C6) lowercase exchange still matches BINANCE"
  );
})();

// ── (D) resolveIntentFillCloseRatio ────────────────────────────
(function testIntentFill() {
  // Budget mode: qty is absolute fraction; clamp to [0,1].
  assert.strictEqual(
    resolveIntentFillCloseRatio({ qtyFraction: 0.5, prevSize: 100, useBudget: true }),
    0.5,
    "(D1) budget mode ignores prevSize"
  );
  assert.strictEqual(
    resolveIntentFillCloseRatio({ qtyFraction: 1.5, prevSize: 100, useBudget: true }),
    1,
    "(D2) budget mode clamps to 1"
  );
  // Non-budget mode: qty / prevSize.
  assert.strictEqual(
    resolveIntentFillCloseRatio({ qtyFraction: 50, prevSize: 100, useBudget: false }),
    0.5,
    "(D3) qty/prev when prev>0"
  );
  assert.strictEqual(
    resolveIntentFillCloseRatio({ qtyFraction: 150, prevSize: 100, useBudget: false }),
    1,
    "(D4) over-fill clamped to 1"
  );
  // Non-budget mode + prevSize missing → treat qty as fraction.
  assert.strictEqual(
    resolveIntentFillCloseRatio({ qtyFraction: 0.4, prevSize: 0, useBudget: false }),
    0.4,
    "(D5) prev=0 → qty as direct fraction"
  );
  // Reject zero / negative qty.
  assert.strictEqual(
    resolveIntentFillCloseRatio({ qtyFraction: 0, prevSize: 100 }),
    null,
    "(D6) qty=0 → null"
  );
  assert.strictEqual(
    resolveIntentFillCloseRatio({ qtyFraction: -1, prevSize: 100 }),
    null,
    "(D7) qty<0 → null"
  );
  assert.strictEqual(
    resolveIntentFillCloseRatio({}),
    null,
    "(D8) empty → null"
  );
})();

// ── (E) resolveSyncedAddChainBaseQtyPct ────────────────────────
(function testAddChainBase() {
  // No active chain → null.
  assert.strictEqual(
    resolveSyncedAddChainBaseQtyPct({ active: false }),
    null,
    "(E1) inactive → null"
  );
  // Active + budget + add_chain_count=0 → base = current.
  assert.strictEqual(
    resolveSyncedAddChainBaseQtyPct({
      active: true,
      posMeta: { add_chain_count: 0 },
      budgetMaxKrw: 1000,
      budgetUsedKrw: 300,
    }),
    0.3,
    "(E2) addCount=0 → base equals current"
  );
  // Active + budget + add_chain_count=2 → base = current/3.
  // Use a tolerance for the fp division.
  const e3 = resolveSyncedAddChainBaseQtyPct({
    active: true,
    posMeta: { add_chain_count: 2 },
    budgetMaxKrw: 1000,
    budgetUsedKrw: 600,
  });
  assert.ok(Math.abs(e3 - 0.2) < 1e-12,
    `(E3) addCount=2 → base = current/(1+addCount) (got ${e3})`);
  // Active + missing budget → null.
  assert.strictEqual(
    resolveSyncedAddChainBaseQtyPct({
      active: true,
      posMeta: { add_chain_count: 1 },
    }),
    null,
    "(E4) no budget → null"
  );
  // Garbage add_chain_count → treated as 0.
  assert.strictEqual(
    resolveSyncedAddChainBaseQtyPct({
      active: true,
      posMeta: { add_chain_count: "garbage" },
      budgetMaxKrw: 1000,
      budgetUsedKrw: 400,
    }),
    0.4,
    "(E5) non-finite addCount → 0"
  );
  // Negative add_chain_count clamped to 0.
  assert.strictEqual(
    resolveSyncedAddChainBaseQtyPct({
      active: true,
      posMeta: { add_chain_count: -3 },
      budgetMaxKrw: 1000,
      budgetUsedKrw: 400,
    }),
    0.4,
    "(E6) negative addCount → 0"
  );
})();

// ── (F) paperBinanceRunner __test re-exports the SAME refs ─────
(function testPaperRunnerReExports() {
  delete require.cache[require.resolve("../engine/paperBinanceRunner")];
  const { __test: paperTest } = require("../engine/paperBinanceRunner");
  // Identity — the runner must re-export the SAME function refs,
  // not a re-implementation. (POS_SIZE_EPSILON is a constant so we
  // check the value matches, not identity, since constants are not
  // exported through __test directly.)
  assert.strictEqual(paperTest.resolveCurrentQtyPctForCap, resolveCurrentQtyPctForCap,
    "(F1) same ref for resolveCurrentQtyPctForCap");
  assert.strictEqual(paperTest.resolveLogicalCurrentQtyPctForBudget, resolveLogicalCurrentQtyPctForBudget,
    "(F2) same ref for resolveLogicalCurrentQtyPctForBudget");
  assert.strictEqual(paperTest.resolveLiveExitCurrentQtyPct, resolveLiveExitCurrentQtyPct,
    "(F3) same ref for resolveLiveExitCurrentQtyPct");
  assert.strictEqual(paperTest.resolveIntentFillCloseRatio, resolveIntentFillCloseRatio,
    "(F4) same ref for resolveIntentFillCloseRatio");
  assert.strictEqual(paperTest.resolveSyncedAddChainBaseQtyPct, resolveSyncedAddChainBaseQtyPct,
    "(F5) same ref for resolveSyncedAddChainBaseQtyPct");
})();

console.log("QTY_CALCULATION_TEST_OK");
