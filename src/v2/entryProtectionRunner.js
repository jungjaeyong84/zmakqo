"use strict";

const { buildEntryProtectionPlacementRequest } = require("./entryProtectionHandoff");
const {
  buildInitialProtectionCommands,
  finalizeInitialProtectionPlacement,
  finalizeAuditedInitialProtectionPlacement,
} = require("./protectionWriter");
const {
  commitEntryProtectionPendingBootstrap,
  commitProtectedEntryActivation,
  commitEntryProtectionRepairQueue,
} = require("./entryProtectionStorage");
const { reconcileInitialProtectionLatePlaced } = require("./initialProtectionLatePlacedReconciler");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function stableCode(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return code || null;
}

function validateRequiredObject(name, value) {
  if (!value || typeof value !== "object") throw new Error(`${name}_REQUIRED`);
  return value;
}

function validateTransportFn(name, value) {
  if (typeof value !== "function") throw new Error(`${name}_REQUIRED`);
  return value;
}

function normalizeProtectionAck(name, ack) {
  const row = ack && typeof ack === "object" ? ack : null;
  if (!row) throw new Error(`${name}_ACK_REQUIRED`);
  const status = String(row.status || "").trim().toUpperCase();
  if (!["PLACED", "FAILED"].includes(status)) throw new Error(`${name}_ACK_STATUS_INVALID`);
  return Object.freeze({
    status,
    order_id: trimOrNull(row.order_id),
    trigger_price: row.trigger_price == null ? null : Number(row.trigger_price),
    error_code: trimOrNull(row.error_code),
    ack_at: trimOrNull(row.ack_at),
    late_placed_after_abort: row.late_placed_after_abort === true,
    original_error_code: trimOrNull(row.original_error_code),
    late_placed_observed_at: trimOrNull(row.late_placed_observed_at),
    late_placed_client_order_key: trimOrNull(row.late_placed_client_order_key),
    late_placed_reconcile_status: trimOrNull(row.late_placed_reconcile_status),
    late_placed_reconcile_reason: trimOrNull(row.late_placed_reconcile_reason),
  });
}

function buildFailedProtectionAck({ name, command, error, rawAck = null } = {}) {
  const message = trimOrNull(error && error.message) || trimOrNull(error) || `${name}_TRANSPORT_FAILED`;
  const row = rawAck && typeof rawAck === "object" ? rawAck : {};
  return Object.freeze({
    status: "FAILED",
    order_id: trimOrNull(row.order_id || row.orderId),
    trigger_price: row.trigger_price == null && row.triggerPrice == null
      ? (command && command.trigger_price == null ? null : Number(command.trigger_price))
      : Number(row.trigger_price ?? row.triggerPrice),
    error_code: stableCode(message) || `${name}_TRANSPORT_FAILED`,
    ack_at: null,
    late_placed_after_abort: row.late_placed_after_abort === true,
    original_error_code: trimOrNull(row.original_error_code),
    late_placed_observed_at: trimOrNull(row.late_placed_observed_at),
    late_placed_client_order_key: trimOrNull(row.late_placed_client_order_key),
    late_placed_reconcile_status: trimOrNull(row.late_placed_reconcile_status),
    late_placed_reconcile_reason: trimOrNull(row.late_placed_reconcile_reason),
  });
}

async function invokeProtectionTransport({ name, fn, command, args }) {
  try {
    const rawAck = await fn(args);
    try {
      return normalizeProtectionAck(name, rawAck);
    } catch (error) {
      return buildFailedProtectionAck({
        name,
        command,
        error,
        rawAck,
      });
    }
  } catch (error) {
    return buildFailedProtectionAck({
      name,
      command,
      error,
    });
  }
}

async function runV2EntryProtectionActivation({
  db = null,
  env = process.env,
  executedEntry,
  transports,
  now = () => new Date().toISOString(),
  placementRetryId = "R0",
} = {}) {
  const executed = validateRequiredObject("EXECUTED_ENTRY", executedEntry);
  const transportBag = validateRequiredObject("PROTECTION_TRANSPORTS", transports);
  const placeInitialSl = validateTransportFn("PLACE_INITIAL_SL_TRANSPORT", transportBag.placeInitialSl);
  const placeInitialTp1 = validateTransportFn("PLACE_INITIAL_TP1_TRANSPORT", transportBag.placeInitialTp1);
  const placementStartedAt = trimOrNull(now()) || new Date().toISOString();

  const pendingCommit = await commitEntryProtectionPendingBootstrap({
    db,
    env,
    executedEntry: executed,
    committedAt: placementStartedAt,
  });
  const placementRequest = buildEntryProtectionPlacementRequest(executed);
  const protectionCommands = buildInitialProtectionCommands({
    placementRequest,
    placementStartedAt,
    placementRetryId,
  });

  let slAck = await invokeProtectionTransport({
    name: "SL",
    fn: placeInitialSl,
    command: protectionCommands.commands.sl,
    args: {
      command: protectionCommands.commands.sl,
      placementRequest,
      executedEntry: executed,
      env,
      db,
    },
  });
  let tp1Ack = await invokeProtectionTransport({
    name: "TP1",
    fn: placeInitialTp1,
    command: protectionCommands.commands.tp1,
    args: {
      command: protectionCommands.commands.tp1,
      placementRequest,
      executedEntry: executed,
      env,
      db,
    },
  });
  const latePlacedReconcile = await reconcileInitialProtectionLatePlaced({
    slAck,
    tp1Ack,
    commands: protectionCommands.commands,
    fetchOrderByClientOrderId: transportBag.fetchOrderByClientOrderId,
    env,
    now,
  });
  slAck = normalizeProtectionAck("SL", latePlacedReconcile.slAck || slAck);
  tp1Ack = normalizeProtectionAck("TP1", latePlacedReconcile.tp1Ack || tp1Ack);
  const placementFinishedAt = trimOrNull(now()) || new Date().toISOString();

  let auditedProtection = null;
  let protectionWriteResult = null;
  try {
    auditedProtection = finalizeAuditedInitialProtectionPlacement({
      executedEntry: executed,
      placementRequest,
      attemptMeta: protectionCommands.attemptMeta,
      slAck,
      tp1Ack,
      placementFinishedAt,
    });
    protectionWriteResult = auditedProtection;
  } catch (error) {
    protectionWriteResult = finalizeInitialProtectionPlacement({
      placementRequest,
      attemptMeta: protectionCommands.attemptMeta,
      slAck,
      tp1Ack,
      placementFinishedAt,
    });
    let repairQueueCommit = null;
    try {
      repairQueueCommit = await commitEntryProtectionRepairQueue({
        db,
        env,
        executedEntry: executed,
        placementRequest,
        protectionWriteResult,
        slAck,
        tp1Ack,
        committedAt: placementFinishedAt,
      });
    } catch (repairError) {
      repairQueueCommit = Object.freeze({
        ok: false,
        reason: trimOrNull(repairError && repairError.message) || "ENTRY_PROTECTION_REPAIR_ENQUEUE_FAILED",
      });
    }
    return Object.freeze({
      ok: false,
      reason: trimOrNull(error && error.message) || "ENTRY_PROTECTION_ACTIVATION_BLOCKED",
      pendingCommit,
      placementRequest,
      protectionCommands,
      slAck,
      tp1Ack,
      latePlacedReconcile,
      protectionWriteResult,
      repairQueueCommit,
      activationCommit: null,
    });
  }

  const activationCommit = await commitProtectedEntryActivation({
    db,
    env,
    executedEntry: executed,
    placementRequest,
    protectionWriteResult: auditedProtection,
    activatedAt: auditedProtection.activatedPositionCycle.protection_activated_at,
  });

  return Object.freeze({
    ok: true,
    reason: "ENTRY_PROTECTION_ACTIVE",
    pendingCommit,
    placementRequest,
    protectionCommands,
    slAck,
    tp1Ack,
    latePlacedReconcile,
    protectionWriteResult,
    repairQueueCommit: null,
    activationCommit,
  });
}

module.exports = {
  runV2EntryProtectionActivation,
  __test: {
    trimOrNull,
    validateRequiredObject,
    validateTransportFn,
    normalizeProtectionAck,
    buildFailedProtectionAck,
    invokeProtectionTransport,
  },
};
