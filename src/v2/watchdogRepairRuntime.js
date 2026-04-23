"use strict";

const { V2_SERVICES } = require("./constants");
const { V2_SERVICE_BOUNDARIES, assertSingleExchangeWriter } = require("./boundaries");
const { evaluateActiveExitWatchdog } = require("./watchdog");
const {
  buildProtectionRepairCommand,
  buildRefreshStopRequestFromRepair,
} = require("./repairExecutor");
const {
  buildRefreshStopCommand,
  buildTp1RepairCommand,
  buildFullProtectionRepairCommand,
} = require("./protectionWriter");

function assertWatchdogRepairRuntimeBoundaries() {
  const writerCheck = assertSingleExchangeWriter(V2_SERVICES.PROTECTION_WRITER);
  if (writerCheck.ok !== true) {
    throw new Error("WATCHDOG_REPAIR_SINGLE_WRITER_VIOLATION");
  }
  if (V2_SERVICE_BOUNDARIES.V2_WATCHDOG.mayWriteExchange === true) {
    throw new Error("WATCHDOG_EXCHANGE_WRITE_FORBIDDEN");
  }
  if (V2_SERVICE_BOUNDARIES.V2_REPAIR_EXECUTOR.mayWriteExchange === true) {
    throw new Error("REPAIR_EXECUTOR_EXCHANGE_WRITE_FORBIDDEN");
  }
  return Object.freeze({
    ok: true,
    single_writer_service: V2_SERVICES.PROTECTION_WRITER,
    watchdog_may_write_exchange: false,
    repair_executor_may_write_exchange: false,
  });
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function buildProtectionWriterLease({ repairCommand, delegated }) {
  const command = delegated && delegated.command && typeof delegated.command === "object"
    ? delegated.command
    : {};
  const attemptMeta = delegated && delegated.attemptMeta && typeof delegated.attemptMeta === "object"
    ? delegated.attemptMeta
    : {};
  const positionCycleId = trimOrNull(repairCommand && repairCommand.position_cycle_id);
  const placementAttemptId = trimOrNull(attemptMeta.placement_attempt_id)
    || trimOrNull(command.placement_attempt_id);
  if (!positionCycleId) throw new Error("PROTECTION_WRITER_LEASE_POSITION_CYCLE_REQUIRED");
  if (!placementAttemptId) throw new Error("PROTECTION_WRITER_LEASE_PLACEMENT_ATTEMPT_REQUIRED");
  return Object.freeze({
    lease_scope: "V2_PROTECTION_WRITER_EXCHANGE_WRITE",
    lease_service: V2_SERVICES.PROTECTION_WRITER,
    acquired_by_service: V2_SERVICES.REPAIR_EXECUTOR,
    position_cycle_id: positionCycleId,
    placement_attempt_id: placementAttemptId,
    command_type: upper(command.command_type) || upper(repairCommand && repairCommand.command_type),
  });
}

function buildWatchdogRepairSnapshot(input = {}) {
  const boundaryAudit = assertWatchdogRepairRuntimeBoundaries();
  const watchdog = evaluateActiveExitWatchdog(input);
  return Object.freeze({
    ok: true,
    boundary_audit: boundaryAudit,
    issue_codes: Array.isArray(watchdog.issueCodes) ? Object.freeze(watchdog.issueCodes.slice()) : Object.freeze([]),
    repair_requests: Array.isArray(watchdog.repairRequests) ? Object.freeze(watchdog.repairRequests.slice()) : Object.freeze([]),
    writer_delegations: Object.freeze([]),
  });
}

function buildRepairDelegationEnvelope({
  repairRequest,
  projection,
  protectionRuntime,
  positionCycle = null,
  placementStartedAt = null,
  placementRetryId = "R0",
} = {}) {
  const boundaryAudit = assertWatchdogRepairRuntimeBoundaries();
  const cycle = positionCycle && typeof positionCycle === "object" ? positionCycle : null;
  if (cycle) {
    const requestCycleId = repairRequest && repairRequest.position_cycle_id;
    if (String(requestCycleId || "").trim() !== String(cycle.position_cycle_id || "").trim()) {
      throw new Error("REPAIR_REQUEST_POSITION_CYCLE_MISMATCH");
    }
  }
  const repairCommand = buildProtectionRepairCommand({
    repairRequest,
    projection,
    protectionRuntime,
  });

  if (repairCommand.command_type === "REFRESH_NATIVE_STOP") {
    const refreshRequest = buildRefreshStopRequestFromRepair({
      repairCommand,
      protectionRuntime,
    });
    const delegated = buildRefreshStopCommand({
      refreshRequest,
      protectionRuntime,
      placementStartedAt,
      placementRetryId,
    });
    return Object.freeze({
      ok: true,
      boundary_audit: boundaryAudit,
      repair_command: repairCommand,
      refresh_request: refreshRequest,
      projection_snapshot: Object.freeze({ ...projection }),
      protection_runtime_snapshot: Object.freeze({ ...(protectionRuntime || {}) }),
      position_cycle_snapshot: cycle ? Object.freeze({ ...cycle }) : null,
      writer_delegation: Object.freeze({
        delegated_to_service: V2_SERVICES.PROTECTION_WRITER,
        requested_by_service: V2_SERVICES.REPAIR_EXECUTOR,
        command: delegated.command,
        attempt_meta: delegated.attemptMeta,
        writer_lease: buildProtectionWriterLease({ repairCommand, delegated }),
      }),
      direct_exchange_write_forbidden: true,
    });
  }

  if (repairCommand.command_type === "PLACE_OR_REPLACE_TP1") {
    const tp1RepairRequest = Object.freeze({
      position_cycle_id: repairCommand.position_cycle_id,
      requested_tp1_price: repairCommand.target_price,
      requested_tp1_qty_abs: repairCommand.quantity_abs,
      reason: upper(repairCommand.command_type) || upper(repairCommand.refresh_reason) || "TP1_ORDER_MISSING",
    });
    const delegated = buildTp1RepairCommand({
      tp1RepairRequest,
      protectionRuntime,
      positionCycle: cycle,
      placementStartedAt,
      placementRetryId,
    });
    return Object.freeze({
      ok: true,
      boundary_audit: boundaryAudit,
      repair_command: repairCommand,
      refresh_request: null,
      tp1_repair_request: tp1RepairRequest,
      projection_snapshot: Object.freeze({ ...projection }),
      protection_runtime_snapshot: Object.freeze({ ...(protectionRuntime || {}) }),
      position_cycle_snapshot: cycle ? Object.freeze({ ...cycle }) : null,
      writer_delegation: Object.freeze({
        delegated_to_service: V2_SERVICES.PROTECTION_WRITER,
        requested_by_service: V2_SERVICES.REPAIR_EXECUTOR,
        command: delegated.command,
        attempt_meta: delegated.attemptMeta,
        writer_lease: buildProtectionWriterLease({ repairCommand, delegated }),
      }),
      direct_exchange_write_forbidden: true,
    });
  }

  if (repairCommand.command_type === "PLACE_OR_REPLACE_FULL_PROTECTION") {
    const detail = repairCommand.detail && typeof repairCommand.detail === "object" ? repairCommand.detail : {};
    const fullProtectionRepairRequest = Object.freeze({
      position_cycle_id: repairCommand.position_cycle_id,
      include_sl_order: detail.include_sl_order === true,
      include_tp1_order: detail.include_tp1_order === true,
      requested_stop_price: repairCommand.target_price,
      requested_stop_source: detail.chosen_stop_source,
      requested_tp1_price: detail.tp1_target_price,
      requested_tp1_qty_abs: repairCommand.quantity_abs,
      reason: upper(repairCommand.command_type) || "UNPROTECTED_ACTIVE_POSITION",
    });
    const delegated = buildFullProtectionRepairCommand({
      fullProtectionRepairRequest,
      protectionRuntime,
      positionCycle: cycle,
      placementStartedAt,
      placementRetryId,
    });
    return Object.freeze({
      ok: true,
      boundary_audit: boundaryAudit,
      repair_command: repairCommand,
      refresh_request: null,
      tp1_repair_request: null,
      full_protection_repair_request: fullProtectionRepairRequest,
      projection_snapshot: Object.freeze({ ...projection }),
      protection_runtime_snapshot: Object.freeze({ ...(protectionRuntime || {}) }),
      position_cycle_snapshot: cycle ? Object.freeze({ ...cycle }) : null,
      writer_delegation: Object.freeze({
        delegated_to_service: V2_SERVICES.PROTECTION_WRITER,
        requested_by_service: V2_SERVICES.REPAIR_EXECUTOR,
        command: delegated.command,
        attempt_meta: delegated.attemptMeta,
        writer_lease: buildProtectionWriterLease({ repairCommand, delegated }),
      }),
      direct_exchange_write_forbidden: true,
    });
  }

  return Object.freeze({
    ok: true,
    boundary_audit: boundaryAudit,
    repair_command: repairCommand,
    refresh_request: null,
    projection_snapshot: Object.freeze({ ...projection }),
    protection_runtime_snapshot: Object.freeze({ ...(protectionRuntime || {}) }),
    position_cycle_snapshot: cycle ? Object.freeze({ ...cycle }) : null,
    writer_delegation: Object.freeze({
      delegated_to_service: V2_SERVICES.PROTECTION_WRITER,
      requested_by_service: V2_SERVICES.REPAIR_EXECUTOR,
      action_required: repairCommand.command_type,
      command: null,
      attempt_meta: null,
    }),
    direct_exchange_write_forbidden: true,
  });
}

module.exports = {
  assertWatchdogRepairRuntimeBoundaries,
  buildWatchdogRepairSnapshot,
  buildRepairDelegationEnvelope,
};
