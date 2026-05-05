"use strict";

const assert = require("assert");
const { buildV2EntryBootstrap } = require("../v2/entryBootstrap");
const { reduceCanonicalExit } = require("../v2/canonicalExitReducer");
const { evaluateTrailRefresh } = require("../v2/tickExitWorker");
const { evaluateActiveExitWatchdog } = require("../v2/watchdog");
const { buildRepairQueueBatch } = require("../v2/repairQueueService");
const repairQueueWorker = require("../v2/repairQueueWorker");

function buildPreTp1Base() {
  return buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    entryEventId: "ENTRY__BTC__RQS1",
    entryOrderId: "ORDER__BTC__RQS1",
    entryFillGroupId: "FILL_GROUP__BTC__RQS1",
    positionSide: "LONG",
    entryPrice: 100000,
    entryQtyAbs: 0.01,
  });
}

function buildTrailActiveBase() {
  const base = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__RQS2",
    entryOrderId: "ORDER__ETH__RQS2",
    entryFillGroupId: "FILL_GROUP__ETH__RQS2",
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
      sourceFillId: "FILL__TP1__RQS2",
      sourceOrderId: "ORDER__TP1__RQS2",
      fillQtyAbs: 0.5,
    },
  });
  const trail = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: tp1.nextProjection,
    evidence: {
      kind: "TRAIL_ACTIVATION_CONFIRMED",
      sourceFillId: "FILL__TP1__RQS2",
      sourceOrderId: "ORDER__STOP__RQS2",
      nextStopPrice: 2010,
      nativeRefreshStatus: "OK",
    },
  });
  const tick = evaluateTrailRefresh({
    positionCycle: base.positionCycle,
    projection: trail.nextProjection,
    marketPrice: 2050,
    riskReferenceStopPrice: 1967,
  });
  return {
    positionCycle: base.positionCycle,
    projection: tick.nextProjection,
  };
}

(function repairQueueSelectsOldestDistinctRequestsFirst() {
  const preTp1 = buildPreTp1Base();
  const trail = buildTrailActiveBase();
  const preTp1Watchdog = evaluateActiveExitWatchdog({
    positionCycle: preTp1.positionCycle,
    projection: preTp1.projection,
    protectionRuntime: {
      position_cycle_id: preTp1.positionCycle.position_cycle_id,
      sl_order_id: "STOP__1",
      sl_order_status: "PLACED",
      tp1_order_id: null,
      tp1_order_status: null,
      native_refresh_status: "OK",
      health_status: "HEALTHY",
    },
    exchangeState: {
      has_active_position: true,
    },
    createdAt: "2026-04-21T01:00:00.000Z",
  });
  const trailWatchdog = evaluateActiveExitWatchdog({
    positionCycle: trail.positionCycle,
    projection: {
      ...trail.projection,
      native_stop_price: null,
    },
    protectionRuntime: {
      position_cycle_id: trail.positionCycle.position_cycle_id,
      sl_order_id: "STOP__old",
      sl_order_status: "FAILED",
      tp1_order_id: "TP1__ok",
      tp1_order_status: "PLACED",
      native_stop_price: null,
      native_refresh_status: "ERROR",
      health_status: "DEGRADED_REPAIRABLE",
    },
    exchangeState: {
      has_active_position: true,
    },
    createdAt: "2026-04-21T01:00:05.000Z",
  });
  const duplicateTp1Request = { ...preTp1Watchdog.repairRequests[0] };
  const batch = buildRepairQueueBatch({
    repairRequests: [
      trailWatchdog.repairRequests.find((row) => row.issue_code === "TRAIL_STOP_MISSING"),
      duplicateTp1Request,
      preTp1Watchdog.repairRequests.find((row) => row.issue_code === "TP1_ORDER_MISSING"),
    ],
    projections: [
      preTp1.projection,
      { ...trail.projection, native_stop_price: null },
    ],
    protectionRuntimes: [
      {
        position_cycle_id: preTp1.positionCycle.position_cycle_id,
        tp1_order_id: null,
      },
      {
        position_cycle_id: trail.positionCycle.position_cycle_id,
        native_stop_price: null,
        tp1_order_id: "TP1__ok",
        tp1_order_status: "PLACED",
      },
    ],
    positionCycles: [
      preTp1.positionCycle,
      trail.positionCycle,
    ],
    maxBatchSize: 2,
    placementStartedAt: "2026-04-21T01:00:10.000Z",
  });
  assert.strictEqual(batch.selected_batch_n, 2);
  assert.strictEqual(batch.delegated_n, 2);
  assert.strictEqual(batch.skipped_n, 0);
  assert.strictEqual(batch.delegated_repairs[0].issue_code, "TP1_ORDER_MISSING");
  assert.strictEqual(batch.delegated_repairs[1].issue_code, "TRAIL_STOP_MISSING");
  assert.strictEqual(batch.delegated_repairs[0].envelope.position_cycle_snapshot.symbol, "BTCUSDT");
})();

(function repairQueueSkipsRequestsWhenProjectionIsMissing() {
  const preTp1 = buildPreTp1Base();
  const watchdog = evaluateActiveExitWatchdog({
    positionCycle: preTp1.positionCycle,
    projection: preTp1.projection,
    protectionRuntime: {
      position_cycle_id: preTp1.positionCycle.position_cycle_id,
      sl_order_id: "STOP__1",
      sl_order_status: "PLACED",
      tp1_order_id: null,
      tp1_order_status: null,
      native_refresh_status: "OK",
      health_status: "HEALTHY",
    },
    exchangeState: {
      has_active_position: true,
    },
  });
  const batch = buildRepairQueueBatch({
    repairRequests: watchdog.repairRequests,
    projections: [],
    protectionRuntimes: [],
  });
  assert.strictEqual(batch.delegated_n, 0);
  assert.strictEqual(batch.skipped_n, 2);
  assert.ok(batch.skipped_repairs.every((row) => row.skip_reason === "PROJECTION_REQUIRED"));
})();

(function repairQueueSkipsRequestsWhenPositionCycleIsMissing() {
  const preTp1 = buildPreTp1Base();
  const watchdog = evaluateActiveExitWatchdog({
    positionCycle: preTp1.positionCycle,
    projection: preTp1.projection,
    protectionRuntime: {
      position_cycle_id: preTp1.positionCycle.position_cycle_id,
      sl_order_id: "STOP__1",
      sl_order_status: "PLACED",
      tp1_order_id: null,
      tp1_order_status: null,
      native_refresh_status: "OK",
      health_status: "HEALTHY",
    },
    exchangeState: {
      has_active_position: true,
    },
  });
  const batch = buildRepairQueueBatch({
    repairRequests: watchdog.repairRequests,
    projections: [preTp1.projection],
    protectionRuntimes: [],
    positionCycles: [],
  });
  assert.strictEqual(batch.delegated_n, 0);
  assert.strictEqual(batch.skipped_n, 2);
  assert.ok(batch.skipped_repairs.every((row) => row.skip_reason === "POSITION_CYCLE_REQUIRED"));
})();

(function repairQueueSkipsTerminalStageRepairsInsteadOfDelegatingWrite() {
  const batch = buildRepairQueueBatch({
    repairRequests: [
      {
        exit_repair_request_id: "RQRV2__MANUAL__1",
        position_cycle_id: "PCY__MANUAL__1",
        stage: "PRE_TP1",
        issue_code: "UNPROTECTED_ACTIVE_POSITION",
        requested_action: "ENSURE_FULL_PROTECTION",
        created_at: "2026-04-21T01:01:00.000Z",
      },
    ],
    projections: [
      {
        position_cycle_id: "PCY__MANUAL__1",
        stage: "EXITED_SL",
      },
    ],
    protectionRuntimes: [
      {
        position_cycle_id: "PCY__MANUAL__1",
      },
    ],
    positionCycles: [
      {
        position_cycle_id: "PCY__MANUAL__1",
        exchange: "BINANCEFUT",
        symbol: "BTCUSDT",
        position_side: "LONG",
        entry_price: 100000,
      },
    ],
  });
  assert.strictEqual(batch.delegated_n, 0);
  assert.strictEqual(batch.skipped_n, 1);
  assert.strictEqual(batch.skipped_repairs[0].skip_reason, "TERMINAL_STAGE_REPAIR_FORBIDDEN");
})();

(function repairQueueSynthesizesContextFromLatestReadModelForActiveTp1QtyRepair() {
  const cycleId = "PCY__BINANCEFUT__AXSUSDT__LONG__fb5f089124db";
  const repairRequest = {
    exit_repair_request_id: "RQRV2__TP1_ORDER_QTY_MISMATCH__TEST",
    position_cycle_id: cycleId,
    stage: "PRE_TP1",
    issue_code: "TP1_ORDER_QTY_MISMATCH",
    requested_action: "ENSURE_TP1_ORDER",
    created_at: "2026-05-05T01:40:00.000Z",
    detail: {
      symbol: "AXSUSDT",
      position_side: "LONG",
      tp1_qty_abs: 90,
      expected_tp_qty_base: 90,
      actual_tp_qty_base: 9,
      tp1_order_id: "TP1__BAD_QTY",
      sl_order_id: "SL__OK",
    },
  };
  const latestReadModel = {
    exchange: "BINANCEFUT",
    symbol: "AXSUSDT",
    after_snapshot: {
      exchange: "BINANCEFUT",
      symbol_or_pair_id: "AXSUSDT",
      state: "ACTIVE",
      position_state: "COMMIT",
      qty_base: 90,
      avg_price: 1.33,
      position_side: "LONG",
      meta: {
        position_cycle_id: cycleId,
        entry_event_id: "ENTRYV2__AXSUSDT__LONG__14875942957",
        entry_order_id: "14875942957",
        entry_fill_group_id: "FILLGROUPV2__AXSUSDT__LONG__14875942957",
        signal_intent_id: "SIGINTV2__AXS",
        openclaw_decision_id: "OCDV2__AXS",
        entry_price: 1.33,
        entry_qty_abs: 90,
        initial_stop_price: 1.322685,
        entry_r_distance: 0.007315,
        final_effective_stop: 1.323,
        tp1_target_price: 1.341,
        tp1_target_qty_abs: 90,
        native_protection_stop_order_id: "SL__OK",
        native_protection_stop_price: 1.323,
        native_protection_tp_order_id: "TP1__BAD_QTY",
        native_protection_tp_price: 1.341,
        native_protection_tp_qty_base: 9,
        native_protection_refresh_status: "OK",
        native_protection_health_status: "HEALTHY",
      },
    },
  };
  const synthesized = repairQueueWorker.__test.synthesizeRepairContextsFromLatestReadModels({
    repairRequests: [repairRequest],
    latestReadModelsBySymbol: {
      AXSUSDT: latestReadModel,
    },
  });
  assert.strictEqual(synthesized.synthesized_position_cycle_n, 1);
  assert.strictEqual(synthesized.synthesized_projection_n, 1);
  assert.strictEqual(synthesized.synthesized_protection_runtime_n, 1);

  const batch = buildRepairQueueBatch({
    repairRequests: [repairRequest],
    projections: synthesized.projections,
    protectionRuntimes: synthesized.protection_runtimes,
    positionCycles: synthesized.position_cycles,
    placementStartedAt: "2026-05-05T01:41:00.000Z",
  });
  assert.strictEqual(batch.delegated_n, 1);
  assert.strictEqual(batch.skipped_n, 0);
  assert.strictEqual(batch.delegated_repairs[0].envelope.tp1_repair_request.requested_tp1_qty_abs, 90);
  assert.strictEqual(batch.delegated_repairs[0].envelope.tp1_repair_request.requested_tp1_price, 1.341);
  assert.strictEqual(batch.delegated_repairs[0].envelope.writer_delegation.command.symbol, "AXSUSDT");
  assert.strictEqual(batch.delegated_repairs[0].envelope.writer_delegation.command.quantity_abs, 90);
})();

console.log("V2_REPAIR_QUEUE_SERVICE_TEST_OK");
