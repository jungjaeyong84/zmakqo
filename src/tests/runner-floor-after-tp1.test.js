"use strict";

// Regression guard for the retired TP1→runner-floor path.
//
// Before the fix:
//   computeRunnerMinProfitStopPrice required BOTH tpP1Done AND trailActive,
//   and RUNNER_MIN_PROFIT_PCT had no default in charterExpectations. The
//   runner's leftover 75% had no floor during the ~1-bar trail-delay
//   window and got swept to the original SL ~33% of the time. Data audit
//   showed TP1 hits averaging only +0.70% versus the 1.65% target.
//
// After the fix:
//   1) computeRunnerMinProfitStopPrice fires the moment tpP1Done=true,
//      without waiting for trailActive.
//   2) charterExpectations default RUNNER_MIN_PROFIT_PCT = 0.003 (0.3%)
//      so the floor is always armed once TP1 fills.

const assert = require("assert");
const {
  computeRunnerExitStopPrice,
} = require("../engine/signalEngine");
const { CHARTER_EXPECTATIONS } = require("../config/charterExpectations");

(function run() {
  // ── Charter default must exist ────────────────────────────────────
  const expDefault = CHARTER_EXPECTATIONS.signal_engine.default;
  const expBinance = CHARTER_EXPECTATIONS.signal_engine.by_exchange.BINANCEFUT;
  assert.strictEqual(expDefault.RUNNER_MIN_PROFIT_PCT, null,
    "current V2 full-TP contract must not arm a runner floor by default");
  assert.strictEqual(expBinance.RUNNER_MIN_PROFIT_PCT, null,
    "BINANCEFUT current V2 full-TP contract must not arm a runner floor");

  // ── Runner floor must activate the moment TP1 is done, regardless ──
  // ── of trailActive state. This is the entire point of the fix.    ──
  {
    const result = computeRunnerExitStopPrice({
      avg: 100,
      leverageEff: 1,
      side: "LONG",
      rules: { RUNNER_MIN_PROFIT_PCT: 0.003, TRAIL_PCT: 0.01, TRAIL_R_MULTIPLE: null },
      tpP1Done: true,
      trailActive: false, // ← key: trail is NOT yet active
      trailHigh: null,
      trailLow: null,
      entryRDistance: null,
    });
    assert.ok(Number.isFinite(result.runnerFloorStop),
      "runner floor must be computed when tpP1Done=true even if trail not yet active");
    // 100 × (1 + 0.003) = 100.3
    assert.ok(Math.abs(result.runnerFloorStop - 100.3) < 1e-6,
      `expected runnerFloorStop ≈ 100.3, got ${result.runnerFloorStop}`);
  }

  // ── SHORT equivalent: floor goes below entry by runner_min_profit_pct
  {
    const result = computeRunnerExitStopPrice({
      avg: 100,
      leverageEff: 1,
      side: "SHORT",
      rules: { RUNNER_MIN_PROFIT_PCT: 0.003, TRAIL_PCT: 0.01, TRAIL_R_MULTIPLE: null },
      tpP1Done: true,
      trailActive: false,
      trailHigh: null,
      trailLow: null,
      entryRDistance: null,
    });
    assert.ok(Number.isFinite(result.runnerFloorStop),
      "SHORT runner floor must also compute without trailActive");
    assert.ok(Math.abs(result.runnerFloorStop - 99.7) < 1e-6,
      `expected SHORT runnerFloorStop ≈ 99.7, got ${result.runnerFloorStop}`);
  }

  // ── Pre-TP1 must still return null — floor should NOT arm early.  ──
  {
    const result = computeRunnerExitStopPrice({
      avg: 100,
      leverageEff: 1,
      side: "LONG",
      rules: { RUNNER_MIN_PROFIT_PCT: 0.003, TRAIL_PCT: 0.01 },
      tpP1Done: false,
      trailActive: false,
      trailHigh: null,
      trailLow: null,
      entryRDistance: null,
    });
    assert.strictEqual(result.runnerFloorStop, null,
      "runner floor must NOT activate before TP1 hits");
  }

  // ── When both trail and floor are computable, the stopPrice picker  ──
  // ── must prefer the BETTER stop (max for LONG, min for SHORT).     ──
  {
    // LONG, trail_high=105, trail_pct=1% → trail_stop = 103.95
    // runner floor = 100.3 → trail_stop (103.95) is better for LONG
    const result = computeRunnerExitStopPrice({
      avg: 100,
      leverageEff: 1,
      side: "LONG",
      rules: { RUNNER_MIN_PROFIT_PCT: 0.003, TRAIL_PCT: 0.01, TRAIL_R_MULTIPLE: null },
      tpP1Done: true,
      trailActive: true,
      trailHigh: 105,
      trailLow: null,
      entryRDistance: null,
    });
    assert.ok(Number.isFinite(result.trailStop), "trail stop must compute");
    assert.ok(Number.isFinite(result.runnerFloorStop), "runner floor must also compute");
    assert.ok(result.stopPrice >= result.runnerFloorStop - 1e-9,
      "LONG stopPrice must not drop below runner floor");
    // trail_stop 103.95 > floor 100.3, so stopSource = TRAIL
    assert.strictEqual(result.stopSource, "TRAIL");
  }

  {
    // LONG with trail barely moved (trail_high=100.5, 1% trail → 99.495)
    // runner floor = 100.3 → floor should win
    const result = computeRunnerExitStopPrice({
      avg: 100,
      leverageEff: 1,
      side: "LONG",
      rules: { RUNNER_MIN_PROFIT_PCT: 0.003, TRAIL_PCT: 0.01, TRAIL_R_MULTIPLE: null },
      tpP1Done: true,
      trailActive: true,
      trailHigh: 100.5,
      trailLow: null,
      entryRDistance: null,
    });
    assert.strictEqual(result.stopSource, "RUNNER_FLOOR",
      `expected RUNNER_FLOOR to win over weak trail, got ${result.stopSource}`);
    assert.ok(Math.abs(result.stopPrice - 100.3) < 1e-6);
  }

  // ── Leverage scaling: higher leverage = smaller price move covers  ──
  // ── the same pct. Not used by live Binance (we stay at 1x), but    ──
  // ── verify the math anyway.                                         ──
  {
    const result = computeRunnerExitStopPrice({
      avg: 100,
      leverageEff: 3,
      side: "LONG",
      rules: { RUNNER_MIN_PROFIT_PCT: 0.003, TRAIL_PCT: 0.01 },
      tpP1Done: true,
      trailActive: false,
    });
    // 0.003 / 3 = 0.001 → 100 × 1.001 = 100.1
    assert.ok(Math.abs(result.runnerFloorStop - 100.1) < 1e-6,
      `leverage 3 expected 100.1, got ${result.runnerFloorStop}`);
  }

  console.log("RUNNER_FLOOR_AFTER_TP1_TEST_OK");
})();
