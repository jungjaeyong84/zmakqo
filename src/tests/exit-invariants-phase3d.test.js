"use strict";

// Phase 3d regression tests — perf recovery instruments.
// Pins: operator override (already in its own file), grid search tool,
// bottleneck analyzer.

const assert = require("assert");

const grid = require("../../scripts/backtest-exit-params-grid");
const analyzer = require("../../scripts/analyze-execution-bottleneck");

// ---------- Grid search tool basic properties -----------------------------
(() => {
  const d = grid.defaultGrid();
  assert.ok(Array.isArray(d.sl) && d.sl.length >= 3, "sl grid must have ≥ 3 values");
  assert.ok(Array.isArray(d.tp1) && d.tp1.length >= 3, "tp1 grid must have ≥ 3 values");
  assert.ok(d.sl.includes(1.65), "current SL 1.65 must be in the sweep");
  assert.ok(d.tp1.includes(3.25), "current TP1 3.25 must be in the sweep");
  assert.ok(d.tp1Qty.includes(0.375), "current TP1_QTY 0.375 must be in the sweep");
  assert.ok(d.trailR.includes(0.9), "current trail R 0.9 must be in the sweep");

  const combos = grid.__test.cartesian(d);
  assert.strictEqual(combos.length, d.sl.length * d.tp1.length * d.tp1Qty.length * d.trailR.length);
})();

// ---------- Synthetic run produces deterministic output -------------------
(() => {
  const eps = grid.buildSyntheticEpisodes(20, { seed: 1 });
  assert.strictEqual(eps.length, 20);
  assert.ok(eps[0].path && eps[0].path.length > 0, "synthetic episode must carry a price path");
  const results = grid.simulateGrid(eps, {
    sl: [1.65],
    tp1: [3.25],
    tp1Qty: [0.375],
    trailR: [0.9],
  });
  assert.strictEqual(results.length, 1);
  const r = results[0];
  assert.strictEqual(r.episode_n, 20);
  assert.ok(Number.isFinite(r.total_ret_net));
  assert.ok(Number.isFinite(r.tp1_first_rate));
  assert.ok(r.tp1_first_n + r.sl_first_n <= r.episode_n,
    "tp1_first + sl_first cannot exceed episode_n");
})();

// ---------- Episode simulator invariants ---------------------------------
(() => {
  // Crafted episode that guarantees an immediate SL hit for LONG.
  const epLong = {
    side: "LONG",
    entry_price: 100,
    leverage: 1,
    entry_qty_abs: 1,
    path: [
      { high: 100, low: 98, close: 98, ms: 0 }, // 2% drop — below SL=1.65%
    ],
  };
  const outLong = grid.simulateEpisode(epLong, { sl: 1.65, tp1: 3.25, tp1Qty: 0.375, trailR: 0.9 });
  assert.strictEqual(outLong.outcome, "SL_FIRST");
  assert.strictEqual(outLong.sl_first, true);
  assert.ok(outLong.realised_ret_net < 0, "SL hit must be a negative return");

  // Crafted episode that guarantees a clean TP1 hit then trail exit near TP1.
  const epWin = {
    side: "LONG",
    entry_price: 100,
    leverage: 1,
    entry_qty_abs: 1,
    path: [
      { high: 104, low: 100, close: 103.5, ms: 0 },           // hit TP1 3.25
      { high: 104.5, low: 103, close: 103, ms: 60000 },        // drift down
      { high: 103, low: 100.5, close: 100.5, ms: 120000 },     // hit floor
    ],
  };
  const outWin = grid.simulateEpisode(epWin, { sl: 1.65, tp1: 3.25, tp1Qty: 0.375, trailR: 0.9 });
  assert.ok(["TRAIL_FINAL", "OPEN_RUNNER"].includes(outWin.outcome), `expected trail path, got ${outWin.outcome}`);
  assert.ok(outWin.tp1_first, "TP1 first must be flagged when TP1 hits before any SL");
})();

// ---------- Bottleneck analyzer stage classification ---------------------
(() => {
  // Reasonable stage values → dominant is intent_to_fill_measured.
  const cls = analyzer.__test.classifyBottleneck({
    signal_to_intent: 30_000,
    webhook_saved_to_intent: 200_000,
    intent_to_fill_measured: 400_000,
    intent_to_fill_fallback: 50_000,
    created_to_fill_guarded: 4_000,
  });
  assert.strictEqual(cls.stage, "intent_to_fill_measured");
  assert.strictEqual(cls.noise_dropped, false);

  // Huge signal_to_intent (MANUAL_REPLAY pollution > 1 week) → dropped.
  const cls2 = analyzer.__test.classifyBottleneck({
    signal_to_intent: 450_421_989_000, // 5+ million seconds — noise
    webhook_saved_to_intent: 300_000,
    intent_to_fill_measured: 200_000,
  });
  assert.ok(cls2.stage !== "signal_to_intent",
    `manual-replay pollution must be dropped, got ${cls2.stage}`);
  assert.strictEqual(cls2.stage, "webhook_saved_to_intent");
})();

// ---------- Bottleneck analyzer recommendations ---------------------------
(() => {
  const recs = analyzer.__test.buildRecommendations({
    stages: { signal_to_intent: 10_000, intent_to_fill_measured: 500_000 },
    bottleneck: { stage: "intent_to_fill_measured", ms: 500_000 },
    quality: { partial_fill_rate_pct: 75, adverse_slippage_p95_bps: 90 },
    perMarket: [
      { market: "DOGEUSDT", partial_fill_rate_pct: 90 },
      { market: "BNBUSDT", partial_fill_rate_pct: 80 },
    ],
  });
  // Must include the intent_to_fill IOC/FOK recommendation.
  assert.ok(recs.some((r) => r.action.includes("IOC/FOK") || r.action.includes("LIMIT→MARKET")),
    `expected IOC/FOK recommendation, got ${JSON.stringify(recs)}`);
  assert.ok(recs.some((r) => r.action.includes("Partial fill rate")),
    "partial fill severity must be recommended");
  assert.ok(recs.some((r) => r.action.includes("eaten by entry slippage")),
    "slippage recommendation must include TP1 edge math");
  assert.ok(recs.some((r) => r.action.includes("partial-fill emergency")),
    "per-market partial-fill emergency must be raised");
})();

// ---------- Bottleneck analyzer: empty / missing inputs -----------------
(() => {
  const cls = analyzer.__test.classifyBottleneck({});
  assert.strictEqual(cls.stage, null, "empty stages map returns null stage");
  const recs = analyzer.__test.buildRecommendations({
    stages: {},
    bottleneck: { stage: null, ms: null },
    quality: {},
    perMarket: [],
  });
  assert.strictEqual(recs.length, 1);
  assert.strictEqual(recs[0].severity, "INFO");
})();

console.log("EXIT_INVARIANTS_PHASE3D_TEST_OK");
