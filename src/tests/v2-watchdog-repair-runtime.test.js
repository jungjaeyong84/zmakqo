"use strict";

const assert = require("assert");
const { buildV2EntryBootstrap } = require("../v2/entryBootstrap");
const { reduceCanonicalExit } = require("../v2/canonicalExitReducer");
const { evaluateTrailRefresh } = require("../v2/tickExitWorker");
const {
  assertWatchdogRepairRuntimeBoundaries,
  buildWatchdogRepairSnapshot,
  buildRepairDelegationEnvelope,
} = require("../v2/watchdogRepairRuntime");

function buildPreTp1Base() {
  return buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    entryEventId: "ENTRY__BTC__WRT1",
    entryOrderId: "ORDER__BTC__WRT1",
    entryFillGroupId: "FILL_GROUP__BTC__WRT1",
    positionSide: "LONG",
    entryPrice: 100000,
    entryQtyAbs: 0.01,
  });
}

function buildTrailActiveBase() {
  const base = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__WRT2",
    entryOrderId: "ORDER__ETH__WRT2",
    entryFillGroupId: "FILL_GROUP__ETH__WRT2",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
  });
  const tp1 = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "TP1_CONFIRMED",
      sourceFillId: "FILL__TP1__WRT2",
      sourceOrderId: "ORDER__TP1__WRT2",
      fillQtyAbs: 0.5,
    },
  });
  const trail = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: tp1.nextProjection,
    evidence: {
      kind: "TRAIL_ACTIVATION_CONFIRMED",
      sourceFillId: "FILL__TP1__WRT2",
      sourceOrderId: "ORDER__STOP__WRT2",
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

(function watchdogRepairBoundaryKeepsSingleWriterAtProtectionWriter() {
  const audit = assertWatchdogRepairRuntimeBoundaries();
  assert.strictEqual(audit.ok, true);
  assert.strictEqual(audit.single_writer_service, "V2_PROTECTION_WRITER");
  assert.strictEqual(audit.watchdog_may_write_exchange, false);
  assert.strictEqual(audit.repair_executor_may_write_exchange, false);
})();

(function watchdogSnapshotEmitsRepairRequestsButNoWriterDelegation() {
  const base = buildPreTp1Base();
  const snapshot = buildWatchdogRepairSnapshot({
    positionCycle: base.positionCycle,
    projection: base.projection,
    protectionRuntime: {
      position_cycle_id: base.positionCycle.position_cycle_id,
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
  assert.ok(snapshot.issue_codes.includes("TP1_ORDER_MISSING"));
  assert.strictEqual(snapshot.repair_requests.length > 0, true);
  assert.deepStrictEqual(snapshot.writer_delegations, []);
})();

(function refreshStopRepairDelegatesToProtectionWriter() {
  const base = buildTrailActiveBase();
  const snapshot = buildWatchdogRepairSnapshot({
    positionCycle: base.positionCycle,
    projection: {
      ...base.projection,
      native_stop_price: null,
    },
    positionCycle: base.positionCycle,
    protectionRuntime: {
      position_cycle_id: base.positionCycle.position_cycle_id,
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
  });
  const request = snapshot.repair_requests.find((row) => row.issue_code === "TRAIL_STOP_MISSING");
  const envelope = buildRepairDelegationEnvelope({
    repairRequest: request,
    projection: {
      ...base.projection,
      native_stop_price: null,
    },
    positionCycle: base.positionCycle,
    protectionRuntime: {
      position_cycle_id: base.positionCycle.position_cycle_id,
      native_stop_price: null,
      tp1_order_id: "TP1__ok",
      tp1_order_status: "PLACED",
    },
    placementStartedAt: "2026-04-21T01:00:00.000Z",
    placementRetryId: "R9",
  });
  assert.strictEqual(envelope.direct_exchange_write_forbidden, true);
  assert.strictEqual(envelope.writer_delegation.delegated_to_service, "V2_PROTECTION_WRITER");
  assert.strictEqual(envelope.writer_delegation.requested_by_service, "V2_REPAIR_EXECUTOR");
  assert.strictEqual(envelope.writer_delegation.command.command_type, "REFRESH_NATIVE_STOP");
  assert.strictEqual(envelope.writer_delegation.attempt_meta.requested_by_service, "V2_PROTECTION_WRITER");
  assert.strictEqual(envelope.writer_delegation.writer_lease.lease_scope, "V2_PROTECTION_WRITER_EXCHANGE_WRITE");
  assert.strictEqual(envelope.writer_delegation.writer_lease.lease_service, "V2_PROTECTION_WRITER");
  assert.strictEqual(envelope.writer_delegation.writer_lease.acquired_by_service, "V2_REPAIR_EXECUTOR");
  assert.strictEqual(envelope.writer_delegation.writer_lease.position_cycle_id, base.positionCycle.position_cycle_id);
  assert.strictEqual(envelope.writer_delegation.writer_lease.placement_attempt_id, envelope.writer_delegation.attempt_meta.placement_attempt_id);
  assert.strictEqual(envelope.writer_delegation.writer_lease.command_type, "REFRESH_NATIVE_STOP");
  assert.strictEqual(envelope.position_cycle_snapshot.symbol, "ETHUSDT");
})();

(function tp1RepairStaysAsDelegatedActionNotDirectExchangeWrite() {
  const base = buildPreTp1Base();
  const snapshot = buildWatchdogRepairSnapshot({
    positionCycle: base.positionCycle,
    projection: base.projection,
    protectionRuntime: {
      position_cycle_id: base.positionCycle.position_cycle_id,
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
  const request = snapshot.repair_requests.find((row) => row.issue_code === "TP1_ORDER_MISSING");
  const envelope = buildRepairDelegationEnvelope({
    repairRequest: request,
    projection: base.projection,
    positionCycle: base.positionCycle,
    protectionRuntime: {
      position_cycle_id: base.positionCycle.position_cycle_id,
      tp1_order_id: null,
    },
  });
  assert.strictEqual(envelope.direct_exchange_write_forbidden, true);
  assert.strictEqual(envelope.writer_delegation.delegated_to_service, "V2_PROTECTION_WRITER");
  assert.strictEqual(envelope.writer_delegation.requested_by_service, "V2_REPAIR_EXECUTOR");
  assert.strictEqual(envelope.writer_delegation.command.command_type, "PLACE_OR_REPLACE_TP1");
  assert.strictEqual(envelope.writer_delegation.command.trigger_price, base.projection.tp1_target_price);
  assert.strictEqual(envelope.writer_delegation.command.quantity_abs, base.projection.tp1_target_qty_abs);
  assert.strictEqual(envelope.writer_delegation.attempt_meta.requested_by_service, "V2_PROTECTION_WRITER");
  assert.strictEqual(envelope.writer_delegation.writer_lease.lease_scope, "V2_PROTECTION_WRITER_EXCHANGE_WRITE");
  assert.strictEqual(envelope.writer_delegation.writer_lease.command_type, "PLACE_OR_REPLACE_TP1");
  assert.strictEqual(envelope.writer_delegation.writer_lease.position_cycle_id, base.positionCycle.position_cycle_id);
  assert.strictEqual(envelope.tp1_repair_request.requested_tp1_price, base.projection.tp1_target_price);
})();

(function fullProtectionRepairDelegatesOnlyMissingProtectionLegs() {
  const base = buildPreTp1Base();
  const snapshot = buildWatchdogRepairSnapshot({
    positionCycle: base.positionCycle,
    projection: base.projection,
    protectionRuntime: {
      position_cycle_id: base.positionCycle.position_cycle_id,
      sl_order_id: "STOP__OK",
      sl_order_status: "PLACED",
      native_stop_price: base.projection.final_effective_stop,
      tp1_order_id: null,
      tp1_order_status: "FAILED",
      native_refresh_status: "OK",
      health_status: "DEGRADED_UNPROTECTED",
    },
    exchangeState: {
      has_active_position: true,
    },
  });
  const request = snapshot.repair_requests.find((row) => row.issue_code === "UNPROTECTED_ACTIVE_POSITION");
  const envelope = buildRepairDelegationEnvelope({
    repairRequest: request,
    projection: base.projection,
    positionCycle: base.positionCycle,
    protectionRuntime: {
      position_cycle_id: base.positionCycle.position_cycle_id,
      sl_order_id: "STOP__OK",
      sl_order_status: "PLACED",
      native_stop_price: base.projection.final_effective_stop,
      tp1_order_id: null,
      tp1_order_status: "FAILED",
    },
    placementStartedAt: "2026-04-21T01:10:00.000Z",
    placementRetryId: "R10",
  });
  assert.strictEqual(envelope.direct_exchange_write_forbidden, true);
  assert.strictEqual(envelope.writer_delegation.delegated_to_service, "V2_PROTECTION_WRITER");
  assert.strictEqual(envelope.writer_delegation.command.command_type, "PLACE_OR_REPLACE_FULL_PROTECTION");
  assert.strictEqual(envelope.writer_delegation.command.include_sl_order, false);
  assert.strictEqual(envelope.writer_delegation.command.include_tp1_order, true);
  assert.strictEqual(envelope.writer_delegation.command.commands.sl, null);
  assert.strictEqual(envelope.writer_delegation.command.commands.tp1.trigger_price, base.projection.tp1_target_price);
  assert.strictEqual(envelope.writer_delegation.writer_lease.lease_service, "V2_PROTECTION_WRITER");
  assert.strictEqual(envelope.writer_delegation.writer_lease.command_type, "PLACE_OR_REPLACE_FULL_PROTECTION");
  assert.strictEqual(envelope.full_protection_repair_request.include_tp1_order, true);
})();

(function repairDelegationRejectsMismatchedPositionCycleSnapshot() {
  const base = buildPreTp1Base();
  const snapshot = buildWatchdogRepairSnapshot({
    positionCycle: base.positionCycle,
    projection: base.projection,
    protectionRuntime: {
      position_cycle_id: base.positionCycle.position_cycle_id,
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
  const request = snapshot.repair_requests.find((row) => row.issue_code === "TP1_ORDER_MISSING");
  let err = null;
  try {
    buildRepairDelegationEnvelope({
      repairRequest: request,
      projection: base.projection,
      positionCycle: {
        ...base.positionCycle,
        position_cycle_id: "PCY__OTHER",
      },
      protectionRuntime: {
        position_cycle_id: base.positionCycle.position_cycle_id,
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "REPAIR_REQUEST_POSITION_CYCLE_MISMATCH");
})();

console.log("V2_WATCHDOG_REPAIR_RUNTIME_TEST_OK");
