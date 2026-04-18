"use strict";

// Regression guard for the TP1→trail-arm gap fix (2026-04-18 hotfix).
//
// Before the fix, computeRunnerMinProfitStopPrice required BOTH
// tpP1Done AND trailActive, which meant the leftover 75% runner had
// no floor during the ~1-bar TRAIL_DELAY window after TP1 filled.
// The runner frequently got swept to the original SL in that gap.
//
// After the fix, the floor arms the moment tpP1Done=true regardless
// of trailActive. Trail is still respected downstream: the existing
// max/min picker in computeRunnerExitStopPrice preserves whichever
// stop (trail or floor) is better for the holder.

const assert = require("assert");

// computeRunnerExitStopPrice / computeRunnerMinProfitStopPrice are NOT
// exported — we load the module and pluck them via the same interface
// the engine uses. The engine already goes through a small helper that
// exports both in __test; if that export isn't wired, fall back to
// calling computeRunnerExitStopPrice directly (it's already exported).
const signalEngine = require("../engine/signalEngine");
const { computeRunnerExitStopPrice } = signalEngine;

(function run() {
  assert.strictEqual(typeof computeRunnerExitStopPrice, "function",
    "computeRunnerExitStopPrice must be exported");

  // LONG: tpP1Done=true + trailActive=false → floor must arm.
  // entry 100 × (1 + 0.02) = 102 at 1x leverage.
  {
    const result = computeRunnerExitStopPrice({
      avg: 100,
      leverageEff: 1,
      side: "LONG",
      rules: { RUNNER_MIN_PROFIT_PCT: 0.02, TRAIL_PCT: 0.01, TRAIL_R_MULTIPLE: null },
      tpP1Done: true,
      trailActive: false, // ← critical: trail NOT yet armed
      trailHigh: null,
      trailLow: null,
      entryRDistance: null,
    });
    assert.ok(Number.isFinite(result.runnerFloorStop),
      "runner floor must be computed when tpP1Done=true even if trail not yet active");
    assert.ok(Math.abs(result.runnerFloorStop - 102) < 1e-6,
      `expected runnerFloorStop ≈ 102, got ${result.runnerFloorStop}`);
  }

  // SHORT mirror: floor below entry.
  {
    const result = computeRunnerExitStopPrice({
      avg: 100,
      leverageEff: 1,
      side: "SHORT",
      rules: { RUNNER_MIN_PROFIT_PCT: 0.02, TRAIL_PCT: 0.01, TRAIL_R_MULTIPLE: null },
      tpP1Done: true,
      trailActive: false,
      trailHigh: null,
      trailLow: null,
      entryRDistance: null,
    });
    assert.ok(Number.isFinite(result.runnerFloorStop),
      "SHORT runner floor must also compute without trailActive");
    assert.ok(Math.abs(result.runnerFloorStop - 98) < 1e-6,
      `expected SHORT runnerFloorStop ≈ 98, got ${result.runnerFloorStop}`);
  }

  // Pre-TP1 must still return no floor — we don't want to arm prematurely.
  {
    const result = computeRunnerExitStopPrice({
      avg: 100,
      leverageEff: 1,
      side: "LONG",
      rules: { RUNNER_MIN_PROFIT_PCT: 0.02, TRAIL_PCT: 0.01 },
      tpP1Done: false,
      trailActive: false,
      trailHigh: null,
      trailLow: null,
      entryRDistance: null,
    });
    assert.strictEqual(result.runnerFloorStop, null,
      "runner floor must NOT activate before TP1 hits");
  }

  // When trail is moderately active and trail stop > floor, trail wins.
  // entry 100, trail_high 105, 1% trail → 103.95. floor 102. Max=103.95.
  {
    const result = computeRunnerExitStopPrice({
      avg: 100,
      leverageEff: 1,
      side: "LONG",
      rules: { RUNNER_MIN_PROFIT_PCT: 0.02, TRAIL_PCT: 0.01, TRAIL_R_MULTIPLE: null },
      tpP1Done: true,
      trailActive: true,
      trailHigh: 105,
      trailLow: null,
      entryRDistance: null,
    });
    assert.strictEqual(result.stopSource, "TRAIL",
      `expected TRAIL to beat floor 102 with trail 103.95, got ${result.stopSource}`);
  }

  // Weak trail: trail_high barely above entry, floor should win.
  // entry 100, trail_high 101, 1% trail → 99.99. floor 102. Max=102.
  {
    const result = computeRunnerExitStopPrice({
      avg: 100,
      leverageEff: 1,
      side: "LONG",
      rules: { RUNNER_MIN_PROFIT_PCT: 0.02, TRAIL_PCT: 0.01, TRAIL_R_MULTIPLE: null },
      tpP1Done: true,
      trailActive: true,
      trailHigh: 101,
      trailLow: null,
      entryRDistance: null,
    });
    assert.strictEqual(result.stopSource, "RUNNER_FLOOR",
      `expected RUNNER_FLOOR to win against weak trail, got ${result.stopSource}`);
    assert.ok(Math.abs(result.stopPrice - 102) < 1e-6);
  }

  console.log("RUNNER_FLOOR_AFTER_TP1_TEST_OK");
})();
