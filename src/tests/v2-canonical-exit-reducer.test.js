"use strict";

const assert = require("assert");
const { buildV2EntryBootstrap } = require("../v2/entryBootstrap");
const { reduceCanonicalExit } = require("../v2/canonicalExitReducer");

function buildBaseLong() {
  return buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__R1",
    entryOrderId: "ORDER__ETH__R1",
    entryFillGroupId: "FILL_GROUP__ETH__R1",
    entryIntentId: "EINTV2__eth",
    signalIntentId: "SIGINTV2__eth",
    openclawDecisionId: "OCDV2__eth",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
  });
}

(function tp1ConfirmedPromotesToTp1Done() {
  const base = buildBaseLong();
  const reduced = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "TP1_CONFIRMED",
      positionCycleId: base.positionCycle.position_cycle_id,
      sourceFillId: "FILL__TP1__1",
      sourceOrderId: "ORDER__TP1__1",
      fillQtyAbs: 0.5,
      fillPrice: 2033.6,
    },
  });
  assert.strictEqual(reduced.transition.transition_event, "TP1_REACHED");
  assert.strictEqual(reduced.nextProjection.stage, "TP1_DONE");
  assert.strictEqual(reduced.nextProjection.tp1_done, true);
  assert.strictEqual(reduced.nextProjection.tp1_filled_qty_abs, 0.5);
  assert.strictEqual(reduced.nextProjection.runner_remaining_qty_abs, 0.5);
})();

(function duplicateTp1IsNoop() {
  const base = buildBaseLong();
  const once = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "TP1_CONFIRMED",
      sourceFillId: "FILL__TP1__1",
      sourceOrderId: "ORDER__TP1__1",
      fillQtyAbs: 0.5,
    },
  });
  const twice = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: once.nextProjection,
    evidence: {
      kind: "TP1_CONFIRMED",
      sourceFillId: "FILL__TP1__2",
      sourceOrderId: "ORDER__TP1__1",
      fillQtyAbs: 0.5,
    },
  });
  assert.strictEqual(twice.duplicate, true);
  assert.strictEqual(twice.reason, "TP1_ALREADY_REACHED");
})();

(function trailActivationOnlyAfterTp1() {
  const base = buildBaseLong();
  let err = null;
  try {
    reduceCanonicalExit({
      positionCycle: base.positionCycle,
      projection: base.projection,
      evidence: {
        kind: "TRAIL_ACTIVATION_CONFIRMED",
        sourceFillId: "FILL__TP1__1",
        sourceOrderId: "ORDER__STOP__1",
        nextStopPrice: 2010,
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "TRAIL_ACTIVATION_STAGE_INVALID");
})();

(function tp1ThenTrailActivationPromotesToTrailActive() {
  const base = buildBaseLong();
  const tp1 = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "TP1_CONFIRMED",
      sourceFillId: "FILL__TP1__1",
      sourceOrderId: "ORDER__TP1__1",
      fillQtyAbs: 0.5,
    },
  });
  const trail = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: tp1.nextProjection,
    evidence: {
      kind: "TRAIL_ACTIVATION_CONFIRMED",
      sourceFillId: "FILL__TP1__1",
      sourceOrderId: "ORDER__STOP_REFRESH__1",
      nextStopPrice: 2012,
    },
  });
  assert.strictEqual(trail.transition.transition_event, "TRAIL_ACTIVATED");
  assert.strictEqual(trail.nextProjection.stage, "TRAIL_ACTIVE");
  assert.strictEqual(trail.nextProjection.chosen_stop_source, "TRAIL");
  assert.strictEqual(trail.nextProjection.native_stop_price, 2012);
})();

(function stopExitMapsToSlOrTrailByCurrentStage() {
  const base = buildBaseLong();
  const sl = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "STOP_EXIT_CONFIRMED",
      sourceFillId: "FILL__SL__1",
      sourceOrderId: "ORDER__SL__1",
      fillPrice: 1967,
    },
  });
  assert.strictEqual(sl.transition.transition_event, "SL_HIT");
  assert.strictEqual(sl.nextProjection.stage, "EXITED_SL");
  assert.strictEqual(sl.transition.ledger_patch.final_exit_qty_abs, 1);

  const tp1 = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "TP1_CONFIRMED",
      sourceFillId: "FILL__TP1__1",
      sourceOrderId: "ORDER__TP1__1",
      fillQtyAbs: 0.5,
    },
  });
  const trail = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: tp1.nextProjection,
    evidence: {
      kind: "TRAIL_ACTIVATION_CONFIRMED",
      sourceFillId: "FILL__TP1__1",
      sourceOrderId: "ORDER__STOP_REFRESH__1",
      nextStopPrice: 2012,
    },
  });
  const trailExit = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: trail.nextProjection,
    evidence: {
      kind: "STOP_EXIT_CONFIRMED",
      sourceFillId: "FILL__TRAIL__1",
      sourceOrderId: "ORDER__TRAIL__1",
      fillPrice: 2012,
    },
  });
  assert.strictEqual(trailExit.transition.transition_event, "TRAIL_HIT");
  assert.strictEqual(trailExit.nextProjection.stage, "EXITED_TRAIL");
  assert.strictEqual(trailExit.transition.ledger_patch.final_exit_qty_abs, 0.5);
})();

(function externalAndManualCloseBecomeTerminal() {
  const base = buildBaseLong();
  const external = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "EXTERNAL_CLOSE_CONFIRMED",
      sourceFillId: "FILL__EXT__1",
      sourceOrderId: "ORDER__EXT__1",
    },
  });
  assert.strictEqual(external.transition.transition_event, "EXTERNAL_CLOSE_SYNC");
  assert.strictEqual(external.nextProjection.stage, "EXITED_EXTERNAL");
  assert.strictEqual(external.transition.ledger_patch.final_exit_qty_abs, 1);

  const manual = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "MANUAL_CLOSE_CONFIRMED",
      sourceFillId: "FILL__MANUAL__1",
      sourceOrderId: "ORDER__MANUAL__1",
    },
  });
  assert.strictEqual(manual.transition.transition_event, "MANUAL_CLOSE_SYNC");
  assert.strictEqual(manual.nextProjection.stage, "EXITED_MANUAL");
  assert.strictEqual(manual.transition.ledger_patch.final_exit_qty_abs, 1);
})();

(function manualCloseAfterTp1UsesOnlyOpenResidualQty() {
  const base = buildBaseLong();
  const tp1 = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "TP1_CONFIRMED",
      sourceFillId: "FILL__TP1__A1",
      sourceOrderId: "ORDER__TP1__A1",
      fillQtyAbs: 0.5,
    },
  });
  const manual = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: tp1.nextProjection,
    evidence: {
      kind: "MANUAL_CLOSE_CONFIRMED",
      sourceFillId: "FILL__MANUAL__A1",
      sourceOrderId: "ORDER__MANUAL__A1",
    },
  });
  assert.strictEqual(manual.transition.ledger_patch.final_exit_qty_abs, 0.5);
})();

(function legacyPartialExitInputHardFails() {
  const base = buildBaseLong();
  let err = null;
  try {
    reduceCanonicalExit({
      positionCycle: base.positionCycle,
      projection: base.projection,
      evidence: {
        kind: "LEGACY_EARLY_PARTIAL_EXIT",
        sourceFillId: "FILL__LEGACY__1",
        sourceOrderId: "ORDER__LEGACY__1",
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "LEGACY_PARTIAL_TAKE_PROFIT_UNSUPPORTED");
})();

(function lineageMismatchHardFails() {
  const base = buildBaseLong();
  let err = null;
  try {
    reduceCanonicalExit({
      positionCycle: base.positionCycle,
      projection: {
        ...base.projection,
        position_cycle_id: "PCY__OTHER",
      },
      evidence: {
        kind: "TP1_CONFIRMED",
        sourceFillId: "FILL__TP1__1",
        sourceOrderId: "ORDER__TP1__1",
        fillQtyAbs: 0.5,
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "POSITION_CYCLE_PROJECTION_MISMATCH");
})();

console.log("V2_CANONICAL_EXIT_REDUCER_TEST_OK");
