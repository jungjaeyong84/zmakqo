"use strict";

// Tests for the v4 cross-sectional paper lane's pure logic (2026-08-01).
// Focus: rank/leg selection, the 2-per-leg diversification floor, realized
// return + cost accounting (the exact place the first research script had a
// double-count bug), and no-lookahead-friendly shapes.

const assert = require("assert");
const { computeTargetPositions, computePeriodResult } = require("../v4/crossSectionalSignal");

// helper: build a close series whose trailing `lookback` return is `ret`
function series(ret, lookback = 14, base = 100) {
  const arr = new Array(lookback + 1).fill(base);
  arr[arr.length - 1] = base * (1 + ret);
  return arr;
}

// ---- ranking + legs ---------------------------------------------------------
(() => {
  const closes = {
    A: series(0.50), B: series(0.40), C: series(0.30),
    D: series(0.00), E: series(-0.10), F: series(-0.50),
  };
  const t = computeTargetPositions({ closesBySymbol: closes, lookback: 14 });
  assert.strictEqual(t.eligible_n, 6);
  assert.strictEqual(t.k, 2, "k = floor(6/3)");
  assert.strictEqual(t.positions.A, 1);
  assert.strictEqual(t.positions.B, 1, "top-2 long");
  assert.strictEqual(t.positions.C, 0, "middle flat");
  assert.strictEqual(t.positions.D, 0);
  assert.strictEqual(t.positions.E, -1);
  assert.strictEqual(t.positions.F, -1, "bottom-2 short");
  assert.strictEqual(t.ranked[0].symbol, "A", "ranked strongest first");
  // Map input works identically
  const viaMap = computeTargetPositions({ closesBySymbol: new Map(Object.entries(closes)), lookback: 14 });
  assert.deepStrictEqual(viaMap.positions, t.positions);
})();

// ---- diversification floor: fewer than 2 per leg => stay flat ---------------
(() => {
  const closes = { A: series(0.5), B: series(0.1), C: series(-0.3) }; // k = 1
  const t = computeTargetPositions({ closesBySymbol: closes, lookback: 14 });
  assert.strictEqual(t.k, 1);
  assert.deepStrictEqual(Object.values(t.positions), [0, 0, 0],
    "a 1-per-leg 'factor' is a single-pair bet — the lane must stay flat");
})();

// ---- symbols with insufficient history are excluded, not zero-filled -------
(() => {
  const closes = { A: series(0.5), B: series(0.2), C: series(-0.2), D: series(-0.4), SHORTHIST: [1, 2, 3] };
  const t = computeTargetPositions({ closesBySymbol: closes, lookback: 14 });
  assert.strictEqual(t.eligible_n, 4);
  assert.ok(!("SHORTHIST" in t.positions), "ineligible symbol must not appear at all");
})();

// ---- realized return: long/short both counted, equal weights ---------------
(() => {
  // held: A long, B short, each 50% weight. A +10%, B -10% => gross +10%
  const r = computePeriodResult({
    prevPositions: { A: 1, B: -1, C: 0 },
    newPositions: { A: 1, B: -1, C: 0 },   // no change => no cost
    prevPrices: { A: 100, B: 100, C: 100 },
    currentPrices: { A: 110, B: 90, C: 100 },
    costPct: 0.0009,
  });
  assert.ok(Math.abs(r.gross_return - 0.10) < 1e-9, `gross ${r.gross_return}`);
  assert.strictEqual(r.turnover, 0, "identical target => zero turnover");
  assert.strictEqual(r.cost, 0);
  assert.ok(Math.abs(r.net_return - 0.10) < 1e-9);
  assert.strictEqual(r.held_symbol_n, 2);
})();

// ---- cost is SUBTRACTED in both directions (the research-script bug) -------
(() => {
  const base = {
    prevPrices: { A: 100, B: 100 },
    currentPrices: { A: 100, B: 100 }, // flat market isolates the cost term
    costPct: 0.001,
  };
  // full flip: A long->short, B short->long => turnover 2.0 => cost 0.002
  const flip = computePeriodResult({ ...base, prevPositions: { A: 1, B: -1 }, newPositions: { A: -1, B: 1 } });
  assert.ok(Math.abs(flip.turnover - 2) < 1e-9, `turnover ${flip.turnover}`);
  assert.ok(Math.abs(flip.cost - 0.002) < 1e-9);
  assert.ok(flip.net_return < 0, "cost must reduce return regardless of direction");
  // mirrored positions must incur the SAME cost, never a credit
  const mirror = computePeriodResult({ ...base, prevPositions: { A: -1, B: 1 }, newPositions: { A: 1, B: -1 } });
  assert.ok(Math.abs(mirror.cost - flip.cost) < 1e-9, "reversal costs the same as momentum — no free lunch from mirroring");
  assert.ok(mirror.net_return < 0);
})();

// ---- unpriced symbols are skipped, not treated as zero return -------------
(() => {
  const r = computePeriodResult({
    prevPositions: { A: 1, GONE: -1 },
    newPositions: { A: 1, GONE: -1 },
    prevPrices: { A: 100, GONE: 50 },
    currentPrices: { A: 110 }, // GONE delisted / unfetched this run
    costPct: 0,
  });
  assert.strictEqual(r.priced_symbol_n, 1);
  assert.strictEqual(r.held_symbol_n, 2);
  // A carries 50% weight: +10% * 0.5 = +5%
  assert.ok(Math.abs(r.gross_return - 0.05) < 1e-9, `gross ${r.gross_return}`);
})();

// ---- first run (nothing held) is well-defined ------------------------------
(() => {
  const r = computePeriodResult({ prevPositions: {}, newPositions: { A: 1, B: -1 }, prevPrices: {}, currentPrices: { A: 1, B: 1 } });
  assert.strictEqual(r.gross_return, 0);
  assert.strictEqual(r.held_symbol_n, 0);
})();

console.log("v4-cross-sectional.test.js PASS");
