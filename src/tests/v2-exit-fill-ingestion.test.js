"use strict";

const assert = require("assert");
const { buildV2EntryBootstrap } = require("../v2/entryBootstrap");
const { reduceCanonicalExit } = require("../v2/canonicalExitReducer");
const { buildProtectionRuntimeDoc } = require("../v2/contracts");
const {
  normalizeV2ExitFillEvidence,
  reduceV2ExitFill,
} = require("../v2/exitFillIngestion");

function buildBaseLong() {
  const bootstrap = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__FILL_INGESTION",
    entryOrderId: "ORDER__ETH__FILL_INGESTION",
    entryFillGroupId: "FILL_GROUP__ETH__FILL_INGESTION",
    entryIntentId: "EINTV2__eth_fill_ingestion",
    signalIntentId: "SIGINTV2__eth_fill_ingestion",
    openclawDecisionId: "OCDV2__eth_fill_ingestion",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
  });
  const protectionRuntime = buildProtectionRuntimeDoc({
    positionCycleId: bootstrap.positionCycle.position_cycle_id,
    slOrderId: "STOP__ETH__FILL_INGESTION",
    tp1OrderId: "TP1__ETH__FILL_INGESTION",
    nativeStopPrice: bootstrap.protectionPlan.sl_trigger_price,
    nativeTp1Price: bootstrap.protectionPlan.tp1_trigger_price,
    nativeRefreshStatus: "OK",
    healthStatus: "HEALTHY",
    slOrderStatus: "PLACED",
    tp1OrderStatus: "PLACED",
  });
  return Object.freeze({
    ...bootstrap,
    positionCycle: Object.freeze({
      ...bootstrap.positionCycle,
      status: "ACTIVE_PROTECTED",
      protection_runtime_id: protectionRuntime.protection_runtime_id,
    }),
    protectionRuntime,
  });
}

(function legacyPartialExitIsNotARecognizedV2FillKind() {
  let err = null;
  try {
    normalizeV2ExitFillEvidence({
      exitFill: {
        exit_kind: "LEGACY_EARLY_PARTIAL_EXIT",
        source_fill_id: "FILL__LEGACY_PARTIAL",
        source_order_id: "ORDER__LEGACY_PARTIAL",
        fill_qty_abs: 0.25,
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_EXIT_FILL_UNSUPPORTED_LEGACY_PARTIAL");
})();

(function tp1FillReducesOnlyThroughCanonicalReducerAndBuildsAlert() {
  const base = buildBaseLong();
  const result = reduceV2ExitFill({
    positionCycle: base.positionCycle,
    projection: base.projection,
    protectionRuntime: base.protectionRuntime,
    exitFill: {
      exit_kind: "TP1",
      source_fill_id: "FILL__TP1__INGESTION",
      source_order_id: "ORDER__TP1__INGESTION",
      fill_qty_abs: 0.5,
      fill_price: 2033.6,
      observed_at: "2026-04-21T06:00:00.000Z",
      raw_exchange_event: "fixture",
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_EXIT_FILL_REDUCED");
  assert.strictEqual(result.transition.transition_event, "TP1_REACHED");
  assert.strictEqual(result.nextProjection.stage, "TP1_DONE");
  assert.strictEqual(result.nextProjection.tp1_filled_qty_abs, 0.5);
  assert.strictEqual(result.transition.source_exchange_evidence.evidence_kind, "TP1_FILL");
  assert.strictEqual(result.transition.source_exchange_evidence.source_fill_id, "FILL__TP1__INGESTION");
  assert.strictEqual(result.alert.ok, true);
  assert.strictEqual(result.alert.outbox.canonical_transition_id, result.transition.canonical_transition_id);
})();

(function splitTp1FillsAccumulateBeforeAlertingCanonicalTp1() {
  const base = buildBaseLong();
  const first = reduceV2ExitFill({
    positionCycle: base.positionCycle,
    projection: base.projection,
    protectionRuntime: base.protectionRuntime,
    exitFill: {
      exit_kind: "TP1",
      source_fill_id: "FILL__TP1__SPLIT_A",
      source_order_id: "ORDER__TP1__SPLIT",
      fill_qty_abs: 0.2,
      fill_price: 2033.6,
      observed_at: "2026-04-21T06:00:00.000Z",
    },
  });
  assert.strictEqual(first.ok, true);
  assert.strictEqual(first.partial, true);
  assert.strictEqual(first.duplicate, false);
  assert.strictEqual(first.reason, "TP1_PARTIAL_FILL_ACCUMULATED");
  assert.strictEqual(first.transition, null);
  assert.strictEqual(first.alert, null);
  assert.strictEqual(first.nextProjection.stage, "PRE_TP1");
  assert.strictEqual(first.nextProjection.tp1_filled_qty_abs, 0.2);

  const second = reduceV2ExitFill({
    positionCycle: base.positionCycle,
    projection: first.nextProjection,
    protectionRuntime: base.protectionRuntime,
    exitFill: {
      exit_kind: "TP1",
      source_fill_id: "FILL__TP1__SPLIT_B",
      source_order_id: "ORDER__TP1__SPLIT",
      fill_qty_abs: 0.3,
      fill_price: 2033.6,
      observed_at: "2026-04-21T06:00:02.000Z",
    },
  });
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.partial, undefined);
  assert.strictEqual(second.transition.transition_event, "TP1_REACHED");
  assert.strictEqual(second.nextProjection.stage, "TP1_DONE");
  assert.strictEqual(second.nextProjection.tp1_filled_qty_abs, 0.5);
  assert.strictEqual(second.alert.ok, true);
})();

(function tp1SplitOverfillIsRejected() {
  const base = buildBaseLong();
  const first = reduceV2ExitFill({
    positionCycle: base.positionCycle,
    projection: base.projection,
    protectionRuntime: base.protectionRuntime,
    exitFill: {
      exit_kind: "TP1",
      source_fill_id: "FILL__TP1__OVER_A",
      source_order_id: "ORDER__TP1__OVER",
      fill_qty_abs: 0.2,
      fill_price: 2033.6,
    },
  });
  let err = null;
  try {
    reduceV2ExitFill({
      positionCycle: base.positionCycle,
      projection: first.nextProjection,
      protectionRuntime: base.protectionRuntime,
      exitFill: {
        exit_kind: "TP1",
        source_fill_id: "FILL__TP1__OVER_B",
        source_order_id: "ORDER__TP1__OVER",
        fill_qty_abs: 0.4,
        fill_price: 2033.6,
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "TP1_FILL_QTY_OVER_TARGET");
})();

(function tp1FillRequiresHealthyNativeProtectionRuntime() {
  const base = buildBaseLong();
  let err = null;
  try {
    reduceV2ExitFill({
      positionCycle: base.positionCycle,
      projection: base.projection,
      exitFill: {
        exit_kind: "TP1",
        source_fill_id: "FILL__TP1__NO_PROTECTION",
        source_order_id: "ORDER__TP1__NO_PROTECTION",
        fill_qty_abs: 0.5,
        fill_price: 2033.6,
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "TP1_PROTECTION_RUNTIME_REQUIRED");
})();

(function tp1FillRejectsMissingTp1NativeOrderEvidence() {
  const base = buildBaseLong();
  let err = null;
  try {
    reduceV2ExitFill({
      positionCycle: base.positionCycle,
      projection: base.projection,
      protectionRuntime: {
        ...base.protectionRuntime,
        tp1_order_id: null,
        tp1_order_status: "FAILED",
      },
      exitFill: {
        exit_kind: "TP1",
        source_fill_id: "FILL__TP1__MISSING_NATIVE",
        source_order_id: "ORDER__TP1__MISSING_NATIVE",
        fill_qty_abs: 0.5,
        fill_price: 2033.6,
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "TP1_ORDER_MISSING");
})();

(function stopFillMapsToSlBeforeTp1AndRequiresFillPrice() {
  const base = buildBaseLong();
  let err = null;
  try {
    reduceV2ExitFill({
      positionCycle: base.positionCycle,
      projection: base.projection,
      exitFill: {
        exit_kind: "STOP",
        source_fill_id: "FILL__SL__NO_PRICE",
        source_order_id: "ORDER__SL__NO_PRICE",
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "EXIT_FILL_STOP_PRICE_REQUIRED");

  const result = reduceV2ExitFill({
    positionCycle: base.positionCycle,
    projection: base.projection,
    exitFill: {
      exit_kind: "STOP",
      source_fill_id: "FILL__SL__INGESTION",
      source_order_id: "ORDER__SL__INGESTION",
      fill_price: 1967,
    },
  });
  assert.strictEqual(result.transition.transition_event, "SL_HIT");
  assert.strictEqual(result.nextProjection.stage, "EXITED_SL");
  assert.strictEqual(result.transition.ledger_patch.final_exit_qty_abs, 1);
  assert.strictEqual(result.transition.source_exchange_evidence.evidence_kind, "STOP_EXIT");
})();

(function stopFillAfterTrailMapsToTrailHitByProjectionStage() {
  const base = buildBaseLong();
  const tp1 = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    protectionRuntime: base.protectionRuntime,
    requireProtectionRuntimeGate: true,
    evidence: {
      kind: "TP1_CONFIRMED",
      sourceFillId: "FILL__TP1__TRAIL_INGESTION",
      sourceOrderId: "ORDER__TP1__TRAIL_INGESTION",
      fillQtyAbs: 0.5,
    },
  });
  const trail = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: tp1.nextProjection,
    evidence: {
      kind: "TRAIL_ACTIVATION_CONFIRMED",
      sourceFillId: "FILL__TP1__TRAIL_INGESTION",
      sourceOrderId: "ORDER__STOP_REFRESH__TRAIL_INGESTION",
      nextStopPrice: 2012,
      nativeRefreshStatus: "OK",
    },
  });
  const result = reduceV2ExitFill({
    positionCycle: base.positionCycle,
    projection: trail.nextProjection,
    protectionRuntime: base.protectionRuntime,
    exitFill: {
      exit_kind: "TRAIL_HIT",
      source_fill_id: "FILL__TRAIL__INGESTION",
      source_order_id: "ORDER__TRAIL__INGESTION",
      fill_price: 2012,
    },
  });
  assert.strictEqual(result.transition.transition_event, "TRAIL_HIT");
  assert.strictEqual(result.nextProjection.stage, "EXITED_TRAIL");
  assert.strictEqual(result.transition.ledger_patch.final_exit_qty_abs, 0.5);
})();

(function externalAndManualCloseUseDedicatedReducerEvidence() {
  const base = buildBaseLong();
  const external = reduceV2ExitFill({
    positionCycle: base.positionCycle,
    projection: base.projection,
    exitFill: {
      exit_kind: "EXTERNAL_CLOSE_SYNC",
      source_fill_id: "FILL__EXTERNAL__INGESTION",
      source_order_id: "ORDER__EXTERNAL__INGESTION",
    },
  });
  assert.strictEqual(external.transition.transition_event, "EXTERNAL_CLOSE_SYNC");
  assert.strictEqual(external.nextProjection.stage, "EXITED_EXTERNAL");
  assert.strictEqual(external.transition.source_exchange_evidence.evidence_kind, "EXTERNAL_CLOSE");

  const manual = reduceV2ExitFill({
    positionCycle: base.positionCycle,
    projection: base.projection,
    exitFill: {
      exit_kind: "MANUAL_CLOSE_SYNC",
      source_fill_id: "FILL__MANUAL__INGESTION",
      source_order_id: "ORDER__MANUAL__INGESTION",
    },
  });
  assert.strictEqual(manual.transition.transition_event, "MANUAL_CLOSE_SYNC");
  assert.strictEqual(manual.nextProjection.stage, "EXITED_MANUAL");
  assert.strictEqual(manual.transition.source_exchange_evidence.evidence_kind, "MANUAL_CLOSE");
})();

(function missingLineageFailsBeforeReducer() {
  const base = buildBaseLong();
  let err = null;
  try {
    reduceV2ExitFill({
      positionCycle: base.positionCycle,
      projection: base.projection,
      exitFill: {
        exit_kind: "TP1",
        source_order_id: "ORDER__TP1__NO_FILL",
        fill_qty_abs: 0.5,
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "EXIT_FILL_SOURCE_FILL_ID_REQUIRED");
})();

console.log("V2_EXIT_FILL_INGESTION_TEST_OK");
