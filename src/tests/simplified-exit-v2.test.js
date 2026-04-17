"use strict";

const assert = require("assert");
const {
  ECONOMIC_STATE,
  EVENT,
  buildSimplifiedExitPlan,
  accumulateAbsoluteFillQty,
  resolveTp1Completion,
  classifySimplifiedExitEvent,
  computeSimplifiedTrailingStop,
  buildSimplifiedExitShadowView,
} = require("../services/simplifiedExitV2");

function run() {
  const longPlan = buildSimplifiedExitPlan({
    side: "LONG",
    entryPrice: 100,
    entryQtyAbs: 10,
    qtyStep: 0.001,
    minQty: 0.001,
    minNotional: 5,
    tp1QtyRatio: 0.5,
    tp1TargetPct: 0.0168,
    stopLossPct: 0.0165,
    floorLockPct: 0.0025,
    trailPct: 0.009,
  });
  assert.strictEqual(longPlan.ok, true);
  assert.strictEqual(longPlan.tp1_target_qty_abs, 5);
  assert.strictEqual(longPlan.runner_qty_abs, 5);
  assert.ok(Math.abs(longPlan.tp1_target_price - 101.68) < 1e-9);
  assert.ok(Math.abs(longPlan.initial_stop_price - 98.35) < 1e-9);
  assert.ok(Math.abs(longPlan.runner_floor_stop - 100.25) < 1e-9);

  const shortPlan = buildSimplifiedExitPlan({
    side: "SHORT",
    entryPrice: 100,
    entryQtyAbs: 8,
    qtyStep: 0.001,
    minQty: 0.001,
    minNotional: 5,
    tp1QtyRatio: 0.5,
    tp1TargetPct: 0.0168,
    stopLossPct: 0.0165,
    floorLockPct: 0.0025,
    trailPct: 0.009,
  });
  assert.strictEqual(shortPlan.ok, true);
  assert.ok(Math.abs(shortPlan.tp1_target_price - 98.32) < 1e-9);
  assert.ok(Math.abs(shortPlan.initial_stop_price - 101.65) < 1e-9);
  assert.ok(Math.abs(shortPlan.runner_floor_stop - 99.75) < 1e-9);

  const blockedPlan = buildSimplifiedExitPlan({
    side: "LONG",
    entryPrice: 100,
    entryQtyAbs: 0.02,
    qtyStep: 0.001,
    minQty: 0.02,
    minNotional: 5,
    tp1QtyRatio: 0.5,
    tp1TargetPct: 0.0168,
    stopLossPct: 0.0165,
    floorLockPct: 0.0025,
    trailPct: 0.009,
  });
  assert.strictEqual(blockedPlan.ok, false);
  assert.ok(blockedPlan.blocking_issues.some((issue) => issue.code === "TP1_TARGET_QTY_BELOW_MIN_QTY"));
  assert.ok(blockedPlan.blocking_issues.some((issue) => issue.code === "RUNNER_NOTIONAL_BELOW_MIN_NOTIONAL"));

  const partialFillQty = accumulateAbsoluteFillQty(0, 2.25);
  const partialState = resolveTp1Completion({
    tp1FilledQtyAbs: partialFillQty,
    tp1TargetQtyAbs: 5,
  });
  assert.strictEqual(partialState.tp1_complete, false);
  assert.strictEqual(partialState.next_economic_state, ECONOMIC_STATE.FULL);
  assert.ok(Math.abs(partialState.remaining_qty_abs - 2.75) < 1e-9);

  const fullFillQty = accumulateAbsoluteFillQty(partialFillQty, 2.75);
  const fullState = resolveTp1Completion({
    tp1FilledQtyAbs: fullFillQty,
    tp1TargetQtyAbs: 5,
  });
  assert.strictEqual(fullState.tp1_complete, true);
  assert.strictEqual(fullState.next_economic_state, ECONOMIC_STATE.RUNNER);
  assert.ok(Math.abs(fullState.remaining_qty_abs) < 1e-9);

  assert.strictEqual(
    classifySimplifiedExitEvent({
      fillOrderId: "tp1-1",
      tp1OrderId: "tp1-1",
      activeStopOrderId: "stop-1",
      economicState: ECONOMIC_STATE.FULL,
    }),
    EVENT.TP1_REACHED,
  );
  assert.strictEqual(
    classifySimplifiedExitEvent({
      fillOrderId: "stop-1",
      tp1OrderId: "tp1-1",
      activeStopOrderId: "stop-1",
      economicState: ECONOMIC_STATE.FULL,
    }),
    EVENT.SL_HIT,
  );
  assert.strictEqual(
    classifySimplifiedExitEvent({
      fillOrderId: "stop-1",
      tp1OrderId: "tp1-1",
      activeStopOrderId: "stop-1",
      economicState: ECONOMIC_STATE.RUNNER,
    }),
    EVENT.TRAIL_FINAL_EXIT,
  );

  const longTrail = computeSimplifiedTrailingStop({
    side: "LONG",
    entryPrice: 100,
    currentPrice: 103,
    trailPct: 0.01,
    floorLockPct: 0.0025,
    trailHighPrice: 102.5,
    currentStopPrice: 101.2,
  });
  assert.ok(Math.abs(longTrail.trail_high_price - 103) < 1e-9);
  assert.ok(Math.abs(longTrail.runner_floor_stop - 100.25) < 1e-9);
  assert.ok(Math.abs(longTrail.trail_stop - 101.97) < 1e-9);
  assert.ok(Math.abs(longTrail.final_effective_stop - 101.97) < 1e-9);
  assert.strictEqual(longTrail.chosen_stop_source, "TRAIL");
  assert.strictEqual(longTrail.should_replace_stop, true);

  const longTrailNoDowngrade = computeSimplifiedTrailingStop({
    side: "LONG",
    entryPrice: 100,
    currentPrice: 102.8,
    trailPct: 0.01,
    floorLockPct: 0.0025,
    trailHighPrice: 102.7,
    currentStopPrice: 102.1,
  });
  assert.strictEqual(longTrailNoDowngrade.should_replace_stop, false);

  const shortTrail = computeSimplifiedTrailingStop({
    side: "SHORT",
    entryPrice: 100,
    currentPrice: 96,
    trailPct: 0.01,
    floorLockPct: 0.0025,
    trailLowPrice: 96.5,
    currentStopPrice: 97.5,
  });
  assert.ok(Math.abs(shortTrail.trail_low_price - 96) < 1e-9);
  assert.ok(Math.abs(shortTrail.runner_floor_stop - 99.75) < 1e-9);
  assert.ok(Math.abs(shortTrail.trail_stop - 96.96) < 1e-9);
  assert.ok(Math.abs(shortTrail.final_effective_stop - 96.96) < 1e-9);
  assert.strictEqual(shortTrail.chosen_stop_source, "TRAIL");
  assert.strictEqual(shortTrail.should_replace_stop, true);

  const shadowFull = buildSimplifiedExitShadowView({
    side: "LONG",
    entryPrice: 100,
    entryQtyAbs: 1,
    currentQtyAbs: 1,
    closePrice: 100.8,
    stopLossPct: 0.00825,
    floorLockPct: 0.00125,
    trailPct: 0.01,
    legacyCanonicalStage: null,
    legacyTp0Done: false,
  });
  assert.strictEqual(shadowFull.available, true);
  assert.strictEqual(shadowFull.economic_state, ECONOMIC_STATE.FULL);
  assert.strictEqual(shadowFull.canonical_stage, "FULL");
  assert.deepStrictEqual(shadowFull.divergence_codes, []);

  const shadowRunner = buildSimplifiedExitShadowView({
    side: "LONG",
    entryPrice: 100,
    entryQtyAbs: 1,
    currentQtyAbs: 0.5,
    closePrice: 103,
    tp1FilledQtyAbs: 0.5,
    tp1Done: true,
    trailHighPrice: 103,
    currentStopPrice: 101.2,
    stopLossPct: 0.00825,
    floorLockPct: 0.00125,
    trailPct: 0.01,
    legacyCanonicalStage: "TRAIL",
    legacyTp0Done: false,
  });
  assert.strictEqual(shadowRunner.economic_state, ECONOMIC_STATE.RUNNER);
  assert.strictEqual(shadowRunner.canonical_stage, "TRAIL");
  assert.ok(Math.abs(shadowRunner.final_effective_stop - 101.97) < 1e-9);
  assert.deepStrictEqual(shadowRunner.divergence_codes, []);

  const shadowLegacyTp0 = buildSimplifiedExitShadowView({
    side: "LONG",
    entryPrice: 100,
    entryQtyAbs: 1,
    currentQtyAbs: 0.75,
    closePrice: 101,
    stopLossPct: 0.00825,
    floorLockPct: 0.00125,
    trailPct: 0.01,
    legacyCanonicalStage: null,
    legacyTp0Done: true,
  });
  assert.ok(shadowLegacyTp0.divergence_codes.includes("LEGACY_TP0_PRESENT"));
  assert.ok(shadowLegacyTp0.divergence_codes.includes("PRE_TP1_QTY_REDUCED"));
}

try {
  run();
  console.log("SIMPLIFIED_EXIT_V2_TEST_OK");
} catch (err) {
  console.error("SIMPLIFIED_EXIT_V2_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
