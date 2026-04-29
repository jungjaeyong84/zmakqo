"use strict";

// 2026-04-29 P1-1.19 — price/pnl math helper extraction tests.
//
// Pin the LONG vs. SHORT branches of each formula explicitly so a
// future "unify the long/short branches" refactor is forced to
// preserve both directions.

const assert = require("assert");

delete require.cache[require.resolve("../utils/priceMathHelpers")];
const {
  computeExitTriggerPrice,
  computeUnrealizedPnlPct,
  computeReplayStopDistancePct,
} = require("../utils/priceMathHelpers");

// ── (A) computeExitTriggerPrice — LONG ─────────────────────────
(function testTriggerLong() {
  // 100 USDT entry, 1× leverage, +5% target → 105.
  assert.strictEqual(
    computeExitTriggerPrice({ avgPrice: 100, leverage: 1, side: "LONG", pnlPct: 0.05 }),
    105,
    "(A1) LONG 100 + 5% = 105"
  );
  // Leverage 4× → price moves 0.05/4 = 1.25% to yield 5% on margin.
  assert.strictEqual(
    computeExitTriggerPrice({ avgPrice: 100, leverage: 4, side: "LONG", pnlPct: 0.05 }),
    101.25,
    "(A2) LONG 4x leverage scales the price move"
  );
  // Negative pnl% → price below entry.
  assert.strictEqual(
    computeExitTriggerPrice({ avgPrice: 100, leverage: 1, side: "LONG", pnlPct: -0.05 }),
    95,
    "(A3) LONG -5% = 95"
  );
})();

// ── (B) computeExitTriggerPrice — SHORT ────────────────────────
(function testTriggerShort() {
  // SHORT uses divide formula: 100 / (1 + 0.05) ≈ 95.238
  const r = computeExitTriggerPrice({ avgPrice: 100, leverage: 1, side: "SHORT", pnlPct: 0.05 });
  assert.ok(Math.abs(r - 100 / 1.05) < 1e-9, `(B1) SHORT divide formula (got ${r})`);
  // Pathological: 1 + move ≤ 0 (extreme negative pnl%) → null.
  assert.strictEqual(
    computeExitTriggerPrice({ avgPrice: 100, leverage: 1, side: "SHORT", pnlPct: -1.5 }),
    null,
    "(B2) SHORT denominator ≤0 → null"
  );
})();

// ── (C) computeExitTriggerPrice — invalid inputs ───────────────
(function testTriggerInvalid() {
  assert.strictEqual(
    computeExitTriggerPrice({ avgPrice: 0, leverage: 1, side: "LONG", pnlPct: 0.05 }),
    null,
    "(C1) avg=0 → null"
  );
  assert.strictEqual(
    computeExitTriggerPrice({ avgPrice: NaN, leverage: 1, side: "LONG", pnlPct: 0.05 }),
    null,
    "(C2) NaN avg → null"
  );
  assert.strictEqual(
    computeExitTriggerPrice({ avgPrice: 100, leverage: 1, side: "LONG", pnlPct: NaN }),
    null,
    "(C3) NaN pnl → null"
  );
  // Non-finite leverage falls back to 1.
  assert.strictEqual(
    computeExitTriggerPrice({ avgPrice: 100, leverage: NaN, side: "LONG", pnlPct: 0.05 }),
    105,
    "(C4) NaN leverage → fallback 1×"
  );
  // Empty side defaults to LONG.
  assert.strictEqual(
    computeExitTriggerPrice({ avgPrice: 100, leverage: 1, side: "", pnlPct: 0.05 }),
    105,
    "(C5) empty side → LONG default"
  );
})();

// ── (D) computeUnrealizedPnlPct ────────────────────────────────
(function testUnrealizedPnl() {
  // LONG positive when price up.
  assert.strictEqual(
    computeUnrealizedPnlPct({
      position: { avg_price: 100 },
      bar: { close: 105 },
      positionSide: "LONG",
    }),
    0.05,
    "(D1) LONG up 5%"
  );
  // SHORT positive when price down.
  assert.strictEqual(
    computeUnrealizedPnlPct({
      position: { avg_price: 100 },
      bar: { close: 95 },
      positionSide: "SHORT",
    }),
    0.05,
    "(D2) SHORT down 5%"
  );
  // SHORT negative when price up.
  assert.strictEqual(
    computeUnrealizedPnlPct({
      position: { avg_price: 100 },
      bar: { close: 105 },
      positionSide: "SHORT",
    }),
    -0.05,
    "(D3) SHORT up 5% → -5% pnl"
  );
  // bar.c alias.
  assert.strictEqual(
    computeUnrealizedPnlPct({
      position: { avg_price: 100 },
      bar: { c: 110 },
      positionSide: "LONG",
    }),
    0.10,
    "(D4) bar.c alias"
  );
  // null/empty → null.
  assert.strictEqual(
    computeUnrealizedPnlPct({ position: { avg_price: 0 }, bar: { close: 100 } }),
    null,
    "(D5) avg=0 → null"
  );
  // Default side LONG when omitted.
  assert.strictEqual(
    computeUnrealizedPnlPct({
      position: { avg_price: 100 },
      bar: { close: 110 },
    }),
    0.10,
    "(D6) no side → LONG default"
  );
})();

// ── (E) computeReplayStopDistancePct — LONG ─────────────────────
(function testReplayStopLong() {
  // LONG, avg 100, SL 0.01 (1%) → stopPx = 100*(1+0.01)=101 (this is
  // a quirk: replay treats SL as a positive distance away from
  // entry; LONG stop is computed as avg*(1+slPct), which is
  // counter-intuitive but pre-existing). Pin it explicitly.
  // Close at 100, stop at 101 → (close - stop)/close * 100 = -1%.
  const r = computeReplayStopDistancePct({
    position: { avg_price: 100 },
    bar: { close: 100 },
    positionSide: "LONG",
    rules: { SL: 0.01 },
  });
  assert.ok(Math.abs(r - -1) < 1e-9,
    `(E1) LONG replay stop formula pre-existing quirk: avg*(1+slPct) (got ${r})`);
})();

// ── (F) computeReplayStopDistancePct — SHORT ───────────────────
(function testReplayStopShort() {
  // SHORT, avg 100, SL 0.01 → stopPx = 100*(1-0.01)=99.
  // Close at 100, stop at 99 → (stop - close)/close * 100 = -1%.
  const r = computeReplayStopDistancePct({
    position: { avg_price: 100 },
    bar: { close: 100 },
    positionSide: "SHORT",
    rules: { SL: 0.01 },
  });
  assert.ok(Math.abs(r - -1) < 1e-9, `(F1) SHORT replay stop (got ${r})`);
})();

// ── (G) computeReplayStopDistancePct — invalid inputs ──────────
(function testReplayStopInvalid() {
  assert.strictEqual(
    computeReplayStopDistancePct({
      position: { avg_price: 100 },
      bar: { close: 0 },
      positionSide: "LONG",
      rules: { SL: 0.01 },
    }),
    null,
    "(G1) close=0 → null"
  );
  assert.strictEqual(
    computeReplayStopDistancePct({
      position: { avg_price: 100 },
      bar: { close: 100 },
      positionSide: "",
      rules: { SL: 0.01 },
    }),
    null,
    "(G2) empty side → null (no fallback for replay-side helper)"
  );
  assert.strictEqual(
    computeReplayStopDistancePct({
      position: { avg_price: 100 },
      bar: { close: 100 },
      positionSide: "LONG",
      rules: { SL: NaN },
    }),
    null,
    "(G3) NaN SL → null"
  );
})();

console.log("PRICE_MATH_HELPERS_TEST_OK");
