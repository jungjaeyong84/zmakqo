"use strict";

const assert = require("assert");
const { buildV2EntryBootstrap } = require("../v2/entryBootstrap");
const { reduceCanonicalExit } = require("../v2/canonicalExitReducer");
const { evaluateTrailRefresh } = require("../v2/tickExitWorker");
const { evaluateActiveExitWatchdog } = require("../v2/watchdog");
const {
  buildProtectionRepairCommand,
  buildRefreshStopRequestFromRepair,
} = require("../v2/repairExecutor");
const {
  buildRefreshStopCommand,
  finalizeRefreshStopPlacement,
} = require("../v2/protectionWriter");
const { V2_SERVICE_BOUNDARIES } = require("../v2/boundaries");

function buildPreTp1Base() {
  return buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    entryEventId: "ENTRY__BTC__W1",
    entryOrderId: "ORDER__BTC__W1",
    entryFillGroupId: "FILL_GROUP__BTC__W1",
    positionSide: "LONG",
    entryPrice: 100000,
    entryQtyAbs: 0.01,
  });
}

function buildTrailActiveBase() {
  const base = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__W2",
    entryOrderId: "ORDER__ETH__W2",
    entryFillGroupId: "FILL_GROUP__ETH__W2",
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
      sourceFillId: "FILL__TP1__W2",
      sourceOrderId: "ORDER__TP1__W2",
      fillQtyAbs: 0.5,
    },
  });
  const trail = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: tp1.nextProjection,
    evidence: {
      kind: "TRAIL_ACTIVATION_CONFIRMED",
      sourceFillId: "FILL__TP1__W2",
      sourceOrderId: "ORDER__STOP__W2",
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

(function watchdogPreTp1FindsMissingTp1WithoutMutatingStage() {
  const base = buildPreTp1Base();
  const out = evaluateActiveExitWatchdog({
    positionCycle: base.positionCycle,
    projection: base.projection,
    protectionRuntime: {
      position_cycle_id: base.positionCycle.position_cycle_id,
      sl_order_id: "STOP__1",
      tp1_order_id: null,
      native_refresh_status: "OK",
      health_status: "HEALTHY",
    },
    exchangeState: {
      has_active_position: true,
    },
    createdAt: "2026-04-20T12:30:00.000Z",
  });
  assert.ok(out.issueCodes.includes("TP1_ORDER_MISSING"));
  assert.ok(out.issueCodes.includes("UNPROTECTED_ACTIVE_POSITION"));
  assert.strictEqual(out.repairRequests[0].stage, "PRE_TP1");
})();

(function watchdogTreatsFailedTp1StatusAsMissingEvenIfIdRemains() {
  const base = buildPreTp1Base();
  const out = evaluateActiveExitWatchdog({
    positionCycle: base.positionCycle,
    projection: base.projection,
    protectionRuntime: {
      position_cycle_id: base.positionCycle.position_cycle_id,
      sl_order_id: "STOP__1",
      sl_order_status: "PLACED",
      tp1_order_id: "TP1__stale",
      tp1_order_status: "FAILED",
      native_refresh_status: "OK",
      health_status: "HEALTHY",
    },
    exchangeState: {
      has_active_position: true,
    },
  });
  assert.ok(out.issueCodes.includes("TP1_ORDER_MISSING"));
})();

(function watchdogTrailActiveFindsMissingStopAndUnhealthyRefresh() {
  const base = buildTrailActiveBase();
  const out = evaluateActiveExitWatchdog({
    positionCycle: base.positionCycle,
    projection: {
      ...base.projection,
      native_stop_price: null,
    },
    protectionRuntime: {
      position_cycle_id: base.positionCycle.position_cycle_id,
      sl_order_id: "STOP__2",
      tp1_order_id: "TP1__2",
      native_stop_price: null,
      native_refresh_status: "ERROR",
      health_status: "DEGRADED_REPAIRABLE",
    },
    exchangeState: {
      has_active_position: true,
    },
  });
  assert.ok(out.issueCodes.includes("TRAIL_STOP_MISSING"));
  assert.ok(out.issueCodes.includes("NATIVE_REFRESH_UNHEALTHY"));
  assert.ok(out.issueCodes.includes("UNPROTECTED_ACTIVE_POSITION"));
})();

(function watchdogTreatsFailedStopStatusAsUnprotectedEvenIfIdRemains() {
  const base = buildTrailActiveBase();
  const out = evaluateActiveExitWatchdog({
    positionCycle: base.positionCycle,
    projection: {
      ...base.projection,
      native_stop_price: null,
    },
    protectionRuntime: {
      position_cycle_id: base.positionCycle.position_cycle_id,
      sl_order_id: "STOP__stale",
      sl_order_status: "FAILED",
      tp1_order_id: "TP1__2",
      tp1_order_status: "PLACED",
      native_stop_price: null,
      native_refresh_status: "ERROR",
      health_status: "DEGRADED_REPAIRABLE",
    },
    exchangeState: {
      has_active_position: true,
    },
  });
  assert.ok(out.issueCodes.includes("UNPROTECTED_ACTIVE_POSITION"));
})();

(function watchdogSkipsTerminalStages() {
  const base = buildTrailActiveBase();
  const out = evaluateActiveExitWatchdog({
    positionCycle: base.positionCycle,
    projection: {
      ...base.projection,
      stage: "EXITED_TRAIL",
      trail_active: false,
    },
    protectionRuntime: {},
    exchangeState: {
      has_active_position: false,
    },
  });
  assert.deepStrictEqual(out.issueCodes, []);
  assert.deepStrictEqual(out.repairRequests, []);
})();

(function watchdogFlatExchangeRequiresTerminalTransition() {
  const base = buildTrailActiveBase();
  const out = evaluateActiveExitWatchdog({
    positionCycle: base.positionCycle,
    projection: base.projection,
    protectionRuntime: {
      position_cycle_id: base.positionCycle.position_cycle_id,
      sl_order_id: "STOP__3",
      tp1_order_id: "TP1__3",
      native_stop_price: 2010,
      native_refresh_status: "OK",
      health_status: "HEALTHY",
    },
    exchangeState: {
      has_active_position: false,
    },
  });
  assert.ok(out.issueCodes.includes("TERMINAL_TRANSITION_MISSING"));
  assert.deepStrictEqual(out.repairRequests, []);
})();

(function watchdogTerminalTransitionRequiresTerminalProjection() {
  const base = buildTrailActiveBase();
  const out = evaluateActiveExitWatchdog({
    positionCycle: base.positionCycle,
    projection: base.projection,
    protectionRuntime: {
      position_cycle_id: base.positionCycle.position_cycle_id,
      sl_order_id: "STOP__4",
      tp1_order_id: "TP1__4",
      native_stop_price: 2010,
      native_refresh_status: "OK",
      health_status: "HEALTHY",
    },
    exchangeState: {
      has_active_position: false,
    },
    latestTransition: {
      next_stage: "EXITED_TRAIL",
      transition_event: "TRAIL_HIT",
    },
  });
  assert.ok(out.issueCodes.includes("TERMINAL_PROJECTION_MISMATCH"));
  assert.ok(!out.issueCodes.includes("TERMINAL_TRANSITION_MISSING"));
  assert.deepStrictEqual(out.repairRequests, []);
})();

(function watchdogTerminalProjectionRejectsActiveExchangePosition() {
  const base = buildTrailActiveBase();
  const out = evaluateActiveExitWatchdog({
    positionCycle: base.positionCycle,
    projection: {
      ...base.projection,
      stage: "EXITED_TRAIL",
      trail_active: false,
    },
    protectionRuntime: {},
    exchangeState: {
      has_active_position: true,
    },
  });
  assert.ok(out.issueCodes.includes("TERMINAL_STAGE_WITH_ACTIVE_POSITION"));
  assert.deepStrictEqual(out.repairRequests, []);
})();

(function repairExecutorBuildsProtectionCommandOnly() {
  const base = buildTrailActiveBase();
  const watchdog = evaluateActiveExitWatchdog({
    positionCycle: base.positionCycle,
    projection: {
      ...base.projection,
      native_stop_price: null,
    },
    protectionRuntime: {
      position_cycle_id: base.positionCycle.position_cycle_id,
      sl_order_id: "STOP__2",
      tp1_order_id: "TP1__2",
      native_stop_price: null,
      native_refresh_status: "ERROR",
      health_status: "DEGRADED_REPAIRABLE",
    },
    exchangeState: {
      has_active_position: true,
    },
  });
  const trailMissingRequest = watchdog.repairRequests.find((req) => req.issue_code === "TRAIL_STOP_MISSING");
  const command = buildProtectionRepairCommand({
    repairRequest: trailMissingRequest,
    projection: {
      ...base.projection,
      native_stop_price: null,
    },
    protectionRuntime: {
      native_stop_price: null,
    },
  });
  assert.strictEqual(command.command_type, "REFRESH_NATIVE_STOP");
  assert.strictEqual(command.stage_snapshot, "TRAIL_ACTIVE");
  assert.strictEqual(command.refresh_reason, "TRAIL_STOP_MISSING");
})();

(function watchdogRefreshPipelineClosesStopIssuesWithoutTouchingTp1() {
  const base = buildTrailActiveBase();
  const protectionRuntime = {
    position_cycle_id: base.positionCycle.position_cycle_id,
    sl_order_id: "STOP__stale",
    sl_order_status: "FAILED",
    tp1_order_id: null,
    tp1_order_status: null,
    native_stop_price: null,
    native_refresh_status: "ERROR",
    health_status: "DEGRADED_REPAIRABLE",
    placement_issue_codes: ["TRAIL_STOP_MISSING", "NATIVE_REFRESH_UNHEALTHY", "UNPROTECTED_ACTIVE_POSITION"],
  };
  const watchdog = evaluateActiveExitWatchdog({
    positionCycle: base.positionCycle,
    projection: {
      ...base.projection,
      native_stop_price: null,
    },
    protectionRuntime,
    exchangeState: {
      has_active_position: true,
    },
    createdAt: "2026-04-20T14:00:00.000Z",
  });
  const refreshRepair = watchdog.repairRequests.find((req) => req.issue_code === "TRAIL_STOP_MISSING");
  const repairCommand = buildProtectionRepairCommand({
    repairRequest: refreshRepair,
    projection: {
      ...base.projection,
      native_stop_price: null,
    },
    protectionRuntime,
  });
  const refreshRequest = buildRefreshStopRequestFromRepair({
    repairCommand,
    protectionRuntime,
  });
  const built = buildRefreshStopCommand({
    refreshRequest,
    protectionRuntime,
    placementStartedAt: "2026-04-20T14:00:01.000Z",
    placementRetryId: "R7",
  });
  const placement = finalizeRefreshStopPlacement({
    refreshRequest,
    protectionRuntime,
    attemptMeta: built.attemptMeta,
    slAck: {
      status: "PLACED",
      order_id: "STOP__fresh",
      trigger_price: repairCommand.target_price,
      ack_at: "2026-04-20T14:00:01.900Z",
    },
    placementFinishedAt: "2026-04-20T14:00:02.000Z",
  });
  const healed = evaluateActiveExitWatchdog({
    positionCycle: base.positionCycle,
    projection: {
      ...base.projection,
      native_stop_price: placement.runtimeDoc.native_stop_price,
    },
    protectionRuntime: placement.runtimeDoc,
    exchangeState: {
      has_active_position: true,
    },
    createdAt: "2026-04-20T14:00:03.000Z",
  });
  assert.ok(!healed.issueCodes.includes("TRAIL_STOP_MISSING"));
  assert.ok(!healed.issueCodes.includes("NATIVE_REFRESH_UNHEALTHY"));
  assert.ok(!healed.issueCodes.includes("UNPROTECTED_ACTIVE_POSITION"));
})();

(function repairExecutorForbidsTerminalRepairMutation() {
  let err = null;
  try {
    buildProtectionRepairCommand({
      repairRequest: {
        position_cycle_id: "PCY__1",
        issue_code: "UNPROTECTED_ACTIVE_POSITION",
        requested_action: "ENSURE_FULL_PROTECTION",
      },
      projection: {
        position_cycle_id: "PCY__1",
        stage: "EXITED_SL",
      },
      protectionRuntime: {},
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "TERMINAL_STAGE_REPAIR_FORBIDDEN");
})();

(function watchdogAndRepairRemainNonWriters() {
  assert.strictEqual(V2_SERVICE_BOUNDARIES.V2_WATCHDOG.mayWriteExchange, false);
  assert.strictEqual(V2_SERVICE_BOUNDARIES.V2_REPAIR_EXECUTOR.mayWriteExchange, false);
})();

console.log("V2_WATCHDOG_REPAIR_TEST_OK");
