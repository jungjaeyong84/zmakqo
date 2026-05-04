"use strict";

const assert = require("assert");
const { buildRepairDelegationEnvelope } = require("../v2/watchdogRepairRuntime");
const {
  buildDelegatedRepairExecutor,
  buildFailedProtectionWriteResult,
  validateDelegatedRepair,
} = require("../v2/repairDelegatedExecutor");
const { buildProtectionRepairCommand } = require("../v2/repairExecutor");

function buildRefreshDelegatedRepair() {
  const envelope = buildRepairDelegationEnvelope({
    repairRequest: {
      exit_repair_request_id: "RQRV2__TRAIL__EXEC",
      position_cycle_id: "PCY__EXEC__TRAIL",
      stage: "TRAIL_ACTIVE",
      issue_code: "TRAIL_STOP_MISSING",
      requested_action: "REFRESH_NATIVE_STOP",
    },
    projection: {
      exit_runtime_projection_id: "ERPv2__PCY__EXEC__TRAIL",
      position_cycle_id: "PCY__EXEC__TRAIL",
      stage: "TRAIL_ACTIVE",
      final_effective_stop: 101.5,
      chosen_stop_source: "TRAIL",
    },
    protectionRuntime: {
      protection_runtime_id: "PRTV2__PCY__EXEC__TRAIL",
      position_cycle_id: "PCY__EXEC__TRAIL",
      tp1_order_id: "TP1__OK",
      tp1_order_status: "PLACED",
      native_stop_price: null,
      placement_issue_codes: ["TRAIL_STOP_MISSING", "UNPROTECTED_ACTIVE_POSITION"],
    },
    placementStartedAt: "2026-04-21T05:00:00.000Z",
    placementRetryId: "RDE1",
  });
  return {
    exit_repair_request_id: "RQRV2__TRAIL__EXEC",
    position_cycle_id: "PCY__EXEC__TRAIL",
    issue_code: "TRAIL_STOP_MISSING",
    requested_action: "REFRESH_NATIVE_STOP",
    envelope,
  };
}

function buildTp1DelegatedRepair() {
  const envelope = buildRepairDelegationEnvelope({
    repairRequest: {
      exit_repair_request_id: "RQRV2__TP1__EXEC",
      position_cycle_id: "PCY__EXEC__TP1",
      stage: "PRE_TP1",
      issue_code: "TP1_ORDER_MISSING",
      requested_action: "ENSURE_TP1_ORDER",
    },
    projection: {
      exit_runtime_projection_id: "ERPv2__PCY__EXEC__TP1",
      position_cycle_id: "PCY__EXEC__TP1",
      stage: "PRE_TP1",
      tp1_target_price: 101.68,
      tp1_target_qty_abs: 0.5,
    },
    protectionRuntime: {
      protection_runtime_id: "PRTV2__PCY__EXEC__TP1",
      position_cycle_id: "PCY__EXEC__TP1",
      sl_order_id: "STOP__OK",
      sl_order_status: "PLACED",
      tp1_order_id: null,
    },
    positionCycle: {
      position_cycle_id: "PCY__EXEC__TP1",
      symbol: "ETHUSDT",
      position_side: "LONG",
    },
  });
  return {
    exit_repair_request_id: "RQRV2__TP1__EXEC",
    position_cycle_id: "PCY__EXEC__TP1",
    issue_code: "TP1_ORDER_MISSING",
    requested_action: "ENSURE_TP1_ORDER",
    envelope,
  };
}

function buildTp1QtyMismatchDelegatedRepair() {
  const envelope = buildRepairDelegationEnvelope({
    repairRequest: {
      exit_repair_request_id: "RQRV2__TP1_QTY__EXEC",
      position_cycle_id: "PCY__EXEC__TP1_QTY",
      stage: "PRE_TP1",
      issue_code: "TP1_ORDER_QTY_MISMATCH",
      requested_action: "ENSURE_TP1_ORDER",
    },
    projection: {
      exit_runtime_projection_id: "ERPv2__PCY__EXEC__TP1_QTY",
      position_cycle_id: "PCY__EXEC__TP1_QTY",
      stage: "PRE_TP1",
      tp1_target_price: 0.11513825,
      tp1_target_qty_abs: 1070,
    },
    protectionRuntime: {
      protection_runtime_id: "PRTV2__PCY__EXEC__TP1_QTY",
      position_cycle_id: "PCY__EXEC__TP1_QTY",
      sl_order_id: "STOP__OK",
      sl_order_status: "PLACED",
      tp1_order_id: "TP1__BAD_QTY",
      tp1_order_status: "PLACED",
    },
    positionCycle: {
      position_cycle_id: "PCY__EXEC__TP1_QTY",
      symbol: "DOGEUSDT",
      position_side: "LONG",
    },
  });
  return {
    exit_repair_request_id: "RQRV2__TP1_QTY__EXEC",
    position_cycle_id: "PCY__EXEC__TP1_QTY",
    issue_code: "TP1_ORDER_QTY_MISMATCH",
    requested_action: "ENSURE_TP1_ORDER",
    envelope,
  };
}

function buildFullProtectionDelegatedRepair() {
  const envelope = buildRepairDelegationEnvelope({
    repairRequest: {
      exit_repair_request_id: "RQRV2__FULL__EXEC",
      position_cycle_id: "PCY__EXEC__FULL",
      stage: "PRE_TP1",
      issue_code: "UNPROTECTED_ACTIVE_POSITION",
      requested_action: "ENSURE_FULL_PROTECTION",
    },
    projection: {
      exit_runtime_projection_id: "ERPv2__PCY__EXEC__FULL",
      position_cycle_id: "PCY__EXEC__FULL",
      stage: "PRE_TP1",
      final_effective_stop: 98.35,
      chosen_stop_source: "SL",
      tp1_target_price: 101.68,
      tp1_target_qty_abs: 0.5,
    },
    protectionRuntime: {
      protection_runtime_id: "PRTV2__PCY__EXEC__FULL",
      position_cycle_id: "PCY__EXEC__FULL",
      sl_order_id: null,
      tp1_order_id: null,
      placement_issue_codes: ["UNPROTECTED_ACTIVE_POSITION", "TP1_ORDER_MISSING"],
    },
    positionCycle: {
      position_cycle_id: "PCY__EXEC__FULL",
      symbol: "BTCUSDT",
      position_side: "LONG",
    },
  });
  return {
    exit_repair_request_id: "RQRV2__FULL__EXEC",
    position_cycle_id: "PCY__EXEC__FULL",
    issue_code: "UNPROTECTED_ACTIVE_POSITION",
    requested_action: "ENSURE_FULL_PROTECTION",
    envelope,
  };
}

(function failedResultUsesStableReasonAndIssueCodes() {
  const result = buildFailedProtectionWriteResult({
    delegatedRepair: {
      issue_code: "TP1_ORDER_MISSING",
    },
    reason: "repair transport missing",
    issueCodes: ["UNPROTECTED_ACTIVE_POSITION"],
  });
  assert.strictEqual(result.writeDecision.ok, false);
  assert.strictEqual(result.writeDecision.runtime_write_reason, "REPAIR_TRANSPORT_MISSING");
  assert.deepStrictEqual(result.writeDecision.placement_issue_codes, [
    "TP1_ORDER_MISSING",
    "UNPROTECTED_ACTIVE_POSITION",
  ]);
})();

(function validationRejectsWrongDelegationTarget() {
  let err = null;
  try {
    validateDelegatedRepair({
      envelope: {
        writer_delegation: {
          delegated_to_service: "V2_REPAIR_EXECUTOR",
          requested_by_service: "V2_REPAIR_EXECUTOR",
        },
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "REPAIR_DELEGATION_TARGET_INVALID");
})();

(function validationRejectsDelegatedProtectionWriteWithoutWriterLease() {
  const delegatedRepair = buildRefreshDelegatedRepair();
  let err = null;
  try {
    validateDelegatedRepair({
      ...delegatedRepair,
      envelope: {
        ...delegatedRepair.envelope,
        writer_delegation: {
          ...delegatedRepair.envelope.writer_delegation,
          writer_lease: null,
        },
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "PROTECTION_WRITER_LEASE_REQUIRED");
})();

(function validationRejectsWriterLeasePositionCycleDrift() {
  const delegatedRepair = buildTp1DelegatedRepair();
  let err = null;
  try {
    validateDelegatedRepair({
      ...delegatedRepair,
      envelope: {
        ...delegatedRepair.envelope,
        writer_delegation: {
          ...delegatedRepair.envelope.writer_delegation,
          writer_lease: {
            ...delegatedRepair.envelope.writer_delegation.writer_lease,
            position_cycle_id: "PCY__OTHER",
          },
        },
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "PROTECTION_WRITER_LEASE_POSITION_CYCLE_MISMATCH");
})();

(function validationAcceptsProtectionWriterLeaseForDelegatedRepair() {
  const delegatedRepair = buildFullProtectionDelegatedRepair();
  const result = validateDelegatedRepair(delegatedRepair);
  assert.strictEqual(result.writerLease.lease_scope, "V2_PROTECTION_WRITER_EXCHANGE_WRITE");
  assert.strictEqual(result.writerLease.lease_service, "V2_PROTECTION_WRITER");
  assert.strictEqual(result.writerLease.acquired_by_service, "V2_REPAIR_EXECUTOR");
  assert.strictEqual(result.writerLease.position_cycle_id, "PCY__EXEC__FULL");
  assert.strictEqual(result.writerLease.command_type, "PLACE_OR_REPLACE_FULL_PROTECTION");
})();

(function validationRejectsWriterLeaseCommandTypeDrift() {
  const delegatedRepair = buildTp1DelegatedRepair();
  let err = null;
  try {
    validateDelegatedRepair({
      ...delegatedRepair,
      envelope: {
        ...delegatedRepair.envelope,
        writer_delegation: {
          ...delegatedRepair.envelope.writer_delegation,
          writer_lease: {
            ...delegatedRepair.envelope.writer_delegation.writer_lease,
            command_type: "REFRESH_NATIVE_STOP",
          },
        },
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "PROTECTION_WRITER_LEASE_COMMAND_TYPE_MISMATCH");
})();

(function tp1RepairRejectsMissingTargetPriceInsteadOfUsingQuantityAsPrice() {
  let err = null;
  try {
    buildProtectionRepairCommand({
      repairRequest: {
        exit_repair_request_id: "RQRV2__TP1__NO_PRICE",
        position_cycle_id: "PCY__EXEC__TP1",
        stage: "PRE_TP1",
        issue_code: "TP1_ORDER_MISSING",
        requested_action: "ENSURE_TP1_ORDER",
      },
      projection: {
        exit_runtime_projection_id: "ERPv2__PCY__EXEC__TP1",
        position_cycle_id: "PCY__EXEC__TP1",
        stage: "PRE_TP1",
        tp1_target_qty_abs: 0.5,
      },
      protectionRuntime: {
        position_cycle_id: "PCY__EXEC__TP1",
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "TP1_REPAIR_TARGET_PRICE_REQUIRED");
})();

(async function refreshNativeStopUsesInjectedTransportAndFinalizesRuntime() {
  const delegatedRepair = buildRefreshDelegatedRepair();
  const executor = buildDelegatedRepairExecutor({
    writerLeaseRegistry: new Set(),
    recordedAt: "2026-04-21T05:00:02.000Z",
    transports: {
      refreshNativeStop: async ({ command }) => {
        assert.strictEqual(command.command_type, "REFRESH_NATIVE_STOP");
        assert.strictEqual(command.trigger_price, 101.5);
        return {
          status: "PLACED",
          order_id: "STOP__REFRESHED",
          trigger_price: command.trigger_price,
          ack_at: "2026-04-21T05:00:01.000Z",
        };
      },
    },
  });
  const result = await executor({ delegatedRepair });
  assert.strictEqual(result.writeDecision.runtime_write_reason, "REFRESH_STOP_PROTECTED");
  assert.strictEqual(result.runtimeDoc.native_refresh_status, "OK");
  assert.strictEqual(result.runtimeDoc.sl_order_id, "STOP__REFRESHED");
})();

(async function missingRefreshTransportReturnsFailedWriteResult() {
  const delegatedRepair = buildRefreshDelegatedRepair();
  const executor = buildDelegatedRepairExecutor({
    writerLeaseRegistry: new Set(),
    transports: {},
  });
  const result = await executor({ delegatedRepair });
  assert.strictEqual(result.writeDecision.ok, false);
  assert.strictEqual(result.writeDecision.runtime_write_reason, "REPAIR_TRANSPORT_MISSING");
  assert.deepStrictEqual(result.writeDecision.placement_issue_codes, ["TRAIL_STOP_MISSING"]);
})();

(async function refreshTransportThrowIsPersistableFailureReason() {
  const delegatedRepair = buildRefreshDelegatedRepair();
  const executor = buildDelegatedRepairExecutor({
    writerLeaseRegistry: new Set(),
    transports: {
      refreshNativeStop: async () => {
        throw new Error("BINANCE_TRANSPORT_CONTEXT_REQUIRED");
      },
    },
  });
  const result = await executor({ delegatedRepair });
  assert.strictEqual(result.writeDecision.ok, false);
  assert.strictEqual(result.writeDecision.runtime_write_reason, "BINANCE_TRANSPORT_CONTEXT_REQUIRED");
})();

(async function tp1RepairUsesExplicitProtectionWriterTransportAndFinalizesRuntime() {
  const delegatedRepair = buildTp1DelegatedRepair();
  const executor = buildDelegatedRepairExecutor({
    writerLeaseRegistry: new Set(),
    recordedAt: "2026-04-21T05:20:02.000Z",
    transports: {
      placeOrReplaceTp1: async ({ command }) => {
        assert.strictEqual(command.command_type, "PLACE_OR_REPLACE_TP1");
        assert.strictEqual(command.trigger_price, 101.68);
        assert.strictEqual(command.quantity_abs, 0.5);
        return {
          status: "PLACED",
          order_id: "TP1__REPAIRED",
          trigger_price: command.trigger_price,
          ack_at: "2026-04-21T05:20:01.000Z",
        };
      },
    },
  });
  const result = await executor({ delegatedRepair });
  assert.strictEqual(result.writeDecision.ok, true);
  assert.strictEqual(result.writeDecision.runtime_write_reason, "TP1_REPAIRED");
  assert.strictEqual(result.runtimeDoc.tp1_order_id, "TP1__REPAIRED");
  assert.strictEqual(result.runtimeDoc.native_tp1_price, 101.68);
})();

(async function tp1QtyMismatchRepairUsesSameTp1ReplacementPath() {
  const delegatedRepair = buildTp1QtyMismatchDelegatedRepair();
  assert.strictEqual(delegatedRepair.envelope.repair_command.command_type, "PLACE_OR_REPLACE_TP1");
  assert.strictEqual(delegatedRepair.envelope.repair_command.quantity_abs, 1070);
  const executor = buildDelegatedRepairExecutor({
    writerLeaseRegistry: new Set(),
    recordedAt: "2026-04-21T05:25:02.000Z",
    transports: {
      placeOrReplaceTp1: async ({ command }) => {
        assert.strictEqual(command.command_type, "PLACE_OR_REPLACE_TP1");
        assert.strictEqual(command.trigger_price, 0.11513825);
        assert.strictEqual(command.quantity_abs, 1070);
        return {
          status: "PLACED",
          order_id: "TP1__REPAIRED_FULL_QTY",
          trigger_price: command.trigger_price,
          ack_at: "2026-04-21T05:25:01.000Z",
        };
      },
    },
  });
  const result = await executor({ delegatedRepair });
  assert.strictEqual(result.writeDecision.ok, true);
  assert.strictEqual(result.writeDecision.runtime_write_reason, "TP1_REPAIRED");
  assert.strictEqual(result.runtimeDoc.tp1_order_id, "TP1__REPAIRED_FULL_QTY");
  assert.strictEqual(result.runtimeDoc.native_tp1_price, 0.11513825);
  assert.deepStrictEqual(result.writeDecision.placement_issue_codes, []);
})();

(async function missingTp1TransportReturnsFailedWriteResult() {
  const delegatedRepair = buildTp1DelegatedRepair();
  const executor = buildDelegatedRepairExecutor({
    writerLeaseRegistry: new Set(),
    transports: {},
  });
  const result = await executor({ delegatedRepair });
  assert.strictEqual(result.writeDecision.ok, false);
  assert.strictEqual(result.writeDecision.runtime_write_reason, "REPAIR_TRANSPORT_MISSING");
  assert.deepStrictEqual(result.writeDecision.placement_issue_codes, ["TP1_ORDER_MISSING"]);
})();

(async function fullProtectionRepairUsesExplicitWriterTransportAndFinalizesRuntime() {
  const delegatedRepair = buildFullProtectionDelegatedRepair();
  const executor = buildDelegatedRepairExecutor({
    writerLeaseRegistry: new Set(),
    recordedAt: "2026-04-21T05:30:02.000Z",
    transports: {
      placeOrReplaceFullProtection: async ({ command }) => {
        assert.strictEqual(command.command_type, "PLACE_OR_REPLACE_FULL_PROTECTION");
        assert.strictEqual(command.include_sl_order, true);
        assert.strictEqual(command.include_tp1_order, true);
        assert.strictEqual(command.commands.sl.trigger_price, 98.35);
        assert.strictEqual(command.commands.tp1.trigger_price, 101.68);
        return {
          slAck: {
            status: "PLACED",
            order_id: "STOP__FULL_REPAIRED",
            trigger_price: command.commands.sl.trigger_price,
            ack_at: "2026-04-21T05:30:00.800Z",
          },
          tp1Ack: {
            status: "PLACED",
            order_id: "TP1__FULL_REPAIRED",
            trigger_price: command.commands.tp1.trigger_price,
            ack_at: "2026-04-21T05:30:01.000Z",
          },
        };
      },
    },
  });
  const result = await executor({ delegatedRepair });
  assert.strictEqual(result.writeDecision.ok, true);
  assert.strictEqual(result.writeDecision.runtime_write_reason, "FULL_PROTECTION_REPAIRED");
  assert.deepStrictEqual(result.writeDecision.placement_issue_codes, []);
  assert.strictEqual(result.runtimeDoc.sl_order_id, "STOP__FULL_REPAIRED");
  assert.strictEqual(result.runtimeDoc.tp1_order_id, "TP1__FULL_REPAIRED");
})();

(async function missingFullProtectionTransportReturnsFailedWriteResult() {
  const delegatedRepair = buildFullProtectionDelegatedRepair();
  const executor = buildDelegatedRepairExecutor({
    writerLeaseRegistry: new Set(),
    transports: {},
  });
  const result = await executor({ delegatedRepair });
  assert.strictEqual(result.writeDecision.ok, false);
  assert.strictEqual(result.writeDecision.runtime_write_reason, "REPAIR_TRANSPORT_MISSING");
  assert.deepStrictEqual(result.writeDecision.placement_issue_codes, ["UNPROTECTED_ACTIVE_POSITION"]);
})();

(async function concurrentSameLeaseRepairIsFailClosed() {
  const delegatedRepair = buildTp1DelegatedRepair();
  const registry = new Set();
  const executor = buildDelegatedRepairExecutor({
    writerLeaseRegistry: registry,
    recordedAt: "2026-04-21T05:40:02.000Z",
    transports: {
      placeOrReplaceTp1: async ({ command }) => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          status: "PLACED",
          order_id: `TP1__${command.placement_attempt_id}`,
          trigger_price: command.trigger_price,
          ack_at: "2026-04-21T05:40:01.000Z",
        };
      },
    },
  });
  const results = await Promise.all([
    executor({ delegatedRepair }),
    executor({ delegatedRepair }),
  ]);
  const reasons = results.map((row) => row.writeDecision.runtime_write_reason).sort();
  assert.deepStrictEqual(reasons, [
    "PROTECTION_WRITER_LEASE_CONCURRENT_WRITE",
    "TP1_REPAIRED",
  ]);
  assert.strictEqual(registry.size, 0);
})();

(async function concurrentSameCycleDifferentCommandRepairIsFailClosed() {
  const tp1DelegatedRepair = buildTp1DelegatedRepair();
  const fullDelegatedRepair = JSON.parse(JSON.stringify(buildFullProtectionDelegatedRepair()).replaceAll("PCY__EXEC__FULL", "PCY__EXEC__TP1"));
  const registry = new Set();
  const executor = buildDelegatedRepairExecutor({
    writerLeaseRegistry: registry,
    recordedAt: "2026-04-21T05:40:02.000Z",
    transports: {
      placeOrReplaceTp1: async ({ command }) => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          status: "PLACED",
          order_id: `TP1__${command.placement_attempt_id}`,
          trigger_price: command.trigger_price,
          ack_at: "2026-04-21T05:40:01.000Z",
        };
      },
      placeOrReplaceFullProtection: async ({ command }) => {
        await new Promise((resolve) => setTimeout(resolve, 25));
        return {
          slAck: {
            status: "PLACED",
            order_id: `STOP__${command.placement_attempt_id}`,
            stop_price: command.stop_price,
            ack_at: "2026-04-21T05:40:01.000Z",
          },
          tp1Ack: {
            status: "PLACED",
            order_id: `TP1__${command.placement_attempt_id}`,
            trigger_price: command.tp1_target_price,
            ack_at: "2026-04-21T05:40:01.000Z",
          },
        };
      },
    },
  });
  const results = await Promise.all([
    executor({ delegatedRepair: tp1DelegatedRepair }),
    executor({ delegatedRepair: fullDelegatedRepair }),
  ]);
  const reasons = results.map((row) => row.writeDecision.runtime_write_reason).sort();
  assert.deepStrictEqual(reasons, [
    "PROTECTION_WRITER_LEASE_CONCURRENT_WRITE",
    "TP1_REPAIRED",
  ]);
  assert.strictEqual(registry.size, 0);
})();

console.log("V2_REPAIR_DELEGATED_EXECUTOR_TEST_OK");
