"use strict";

const assert = require("assert");
const { buildV2EntryBootstrap } = require("../v2/entryBootstrap");
const { reduceCanonicalExit } = require("../v2/canonicalExitReducer");
const { evaluateTrailRefresh } = require("../v2/tickExitWorker");

function buildTrailActiveProjection() {
  const base = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__T1",
    entryOrderId: "ORDER__ETH__T1",
    entryFillGroupId: "FILL_GROUP__ETH__T1",
    entryIntentId: "EINTV2__eth_t1",
    signalIntentId: "SIGINTV2__eth_t1",
    openclawDecisionId: "OCDV2__eth_t1",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
  });
  const legacyPartialProjection = Object.freeze({
    ...base.projection,
    tp1_target_qty_abs: 0.5,
    runner_remaining_qty_abs: 1,
  });
  const tp1 = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: legacyPartialProjection,
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
      nextStopPrice: 2010,
      nativeRefreshStatus: "OK",
    },
  });
  return {
    positionCycle: base.positionCycle,
    projection: trail.nextProjection,
  };
}

(function tp1BeforeTrailStageIsRejected() {
  const base = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    entryEventId: "ENTRY__BTC__TW1",
    entryOrderId: "ORDER__BTC__TW1",
    entryFillGroupId: "FILL_GROUP__BTC__TW1",
    positionSide: "LONG",
    entryPrice: 100000,
    entryQtyAbs: 0.01,
  });
  let err = null;
  try {
    evaluateTrailRefresh({
      positionCycle: base.positionCycle,
      projection: base.projection,
      marketPrice: 101000,
      riskReferenceStopPrice: 98350,
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "TRAIL_WORKER_STAGE_INVALID");
})();

(function watermarkBootstrapAndRefreshRequestAreDeterministic() {
  const active = buildTrailActiveProjection();
  const out = evaluateTrailRefresh({
    positionCycle: active.positionCycle,
    projection: active.projection,
    marketPrice: 2050,
    riskReferenceStopPrice: 1967,
    trailRMultiple: 0.6,
    observedAt: "2026-04-20T10:00:00.000Z",
  });
  assert.strictEqual(out.ok, true);
  assert.strictEqual(out.observation.watermark_price, 2050);
  assert.strictEqual(out.nextProjection.runner_floor_stop, 2000);
  assert.strictEqual(out.nextProjection.trail_stop_by_r, 2030.2);
  assert.strictEqual(out.nextProjection.chosen_stop_source, "TRAIL");
  assert.strictEqual(out.nextProjection.final_effective_stop, 2030.2);
  assert.ok(out.refreshRequest);
  assert.strictEqual(out.refreshRequest.requested_stop_price, 2030.2);
})();

(function floorWinsWhenTrailIsBelowBreakEven() {
  const active = buildTrailActiveProjection();
  const out = evaluateTrailRefresh({
    positionCycle: active.positionCycle,
    projection: {
      ...active.projection,
      native_stop_price: 2000,
      chosen_stop_price: 2000,
      final_effective_stop: 2000,
    },
    marketPrice: 2010,
    riskReferenceStopPrice: 1967,
    trailRMultiple: 0.6,
  });
  assert.strictEqual(out.nextProjection.trail_stop_by_r, 1990.2);
  assert.strictEqual(out.nextProjection.chosen_stop_source, "FLOOR");
  assert.strictEqual(out.nextProjection.chosen_stop_price, 2000);
})();

(function tightenOnlyPreventsStopRollback() {
  const active = buildTrailActiveProjection();
  const out = evaluateTrailRefresh({
    positionCycle: active.positionCycle,
    projection: {
      ...active.projection,
      chosen_stop_source: "TRAIL",
      chosen_stop_price: 2040,
      final_effective_stop: 2040,
      native_stop_price: 2040,
    },
    marketPrice: 2041,
    riskReferenceStopPrice: 1967,
    trailRMultiple: 0.6,
  });
  assert.strictEqual(out.nextProjection.trail_stop_by_r, 2021.2);
  assert.strictEqual(out.nextProjection.chosen_stop_price, 2040);
  assert.strictEqual(out.refreshRequest, null);
})();

(function missingNativeStopRaisesIssue() {
  const active = buildTrailActiveProjection();
  const out = evaluateTrailRefresh({
    positionCycle: active.positionCycle,
    projection: {
      ...active.projection,
      native_stop_price: null,
    },
    marketPrice: 2050,
    riskReferenceStopPrice: 1967,
  });
  assert.ok(out.issueCodes.includes("TRAIL_STOP_MISSING"));
  assert.ok(out.refreshRequest);
  assert.strictEqual(out.refreshRequest.reason, "TRAIL_STOP_MISSING");
})();

(function missingRunnerFloorBecomesExplicitIssue() {
  const active = buildTrailActiveProjection();
  const out = evaluateTrailRefresh({
    positionCycle: {
      ...active.positionCycle,
      entry_price: null,
    },
    projection: {
      ...active.projection,
      runner_floor_stop: null,
    },
    marketPrice: 2050,
    riskReferenceStopPrice: 1967,
  });
  assert.strictEqual(out.ok, false);
  assert.ok(out.issueCodes.includes("RUNNER_FLOOR_STOP_UNRESOLVABLE"));
})();

(function watermarkDependencyBecomesExplicitIssue() {
  const active = buildTrailActiveProjection();
  const out = evaluateTrailRefresh({
    positionCycle: {
      ...active.positionCycle,
      entry_price: null,
    },
    projection: {
      ...active.projection,
      runner_floor_stop: 2005,
    },
    marketPrice: 2050,
    riskReferenceStopPrice: 1967,
  });
  assert.strictEqual(out.ok, false);
  assert.ok(out.issueCodes.includes("TRAIL_WATERMARK_UNRESOLVABLE"));
})();

console.log("V2_TICK_EXIT_WORKER_TEST_OK");
