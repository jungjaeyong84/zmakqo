"use strict";

const { V2_SERVICES } = require("./constants");
const {
  finalizeRefreshStopPlacement,
  finalizeTp1RepairPlacement,
  finalizeFullProtectionRepairPlacement,
} = require("./protectionWriter");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function stableCode(value) {
  const code = String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return code || null;
}

function buildFailedProtectionWriteResult({
  delegatedRepair,
  reason,
  issueCodes = [],
} = {}) {
  const row = delegatedRepair && typeof delegatedRepair === "object" ? delegatedRepair : {};
  const normalizedReason = stableCode(reason) || "REPAIR_EXECUTION_FAILED";
  const codes = Array.from(new Set([
    upper(row.issue_code),
    ...((Array.isArray(issueCodes) ? issueCodes : []).map(upper)),
  ].filter(Boolean)));
  return Object.freeze({
    runtimeDoc: null,
    writeDecision: Object.freeze({
      ok: false,
      requires_repair: true,
      runtime_write_reason: normalizedReason,
      native_refresh_status: "ERROR",
      health_status: "DEGRADED_REPAIRABLE",
      placement_issue_codes: Object.freeze(codes),
    }),
  });
}

function validateDelegatedRepair(delegatedRepair) {
  if (!delegatedRepair || typeof delegatedRepair !== "object") {
    throw new Error("DELEGATED_REPAIR_REQUIRED");
  }
  const envelope = delegatedRepair.envelope && typeof delegatedRepair.envelope === "object"
    ? delegatedRepair.envelope
    : null;
  if (!envelope) throw new Error("REPAIR_DELEGATION_ENVELOPE_REQUIRED");
  const delegation = envelope.writer_delegation && typeof envelope.writer_delegation === "object"
    ? envelope.writer_delegation
    : null;
  if (!delegation) throw new Error("WRITER_DELEGATION_REQUIRED");
  if (delegation.delegated_to_service !== V2_SERVICES.PROTECTION_WRITER) {
    throw new Error("REPAIR_DELEGATION_TARGET_INVALID");
  }
  if (delegation.requested_by_service !== V2_SERVICES.REPAIR_EXECUTOR) {
    throw new Error("REPAIR_DELEGATION_REQUESTER_INVALID");
  }
  return Object.freeze({
    envelope,
    delegation,
    repairCommand: envelope.repair_command && typeof envelope.repair_command === "object"
      ? envelope.repair_command
      : null,
  });
}

async function executeRefreshNativeStopRepair({
  delegatedRepair,
  envelope,
  delegation,
  transports,
  env,
  db,
  recordedAt,
} = {}) {
  const refreshNativeStop = transports && typeof transports.refreshNativeStop === "function"
    ? transports.refreshNativeStop
    : null;
  if (!refreshNativeStop) {
    return buildFailedProtectionWriteResult({
      delegatedRepair,
      reason: "REPAIR_TRANSPORT_MISSING",
    });
  }
  let slAck;
  try {
    slAck = await refreshNativeStop({
      command: delegation.command,
      delegatedRepair,
      env,
      db,
    });
  } catch (error) {
    return buildFailedProtectionWriteResult({
      delegatedRepair,
      reason: error && error.message ? error.message : "REPAIR_TRANSPORT_THROWN",
    });
  }
  return finalizeRefreshStopPlacement({
    refreshRequest: envelope.refresh_request,
    protectionRuntime: envelope.protection_runtime_snapshot || {},
    attemptMeta: delegation.attempt_meta,
    slAck,
    placementFinishedAt: trimOrNull(recordedAt) || new Date().toISOString(),
  });
}

async function executePlaceOrReplaceTp1Repair({
  delegatedRepair,
  envelope,
  delegation,
  transports,
  env,
  db,
  recordedAt,
} = {}) {
  const placeOrReplaceTp1 = transports && typeof transports.placeOrReplaceTp1 === "function"
    ? transports.placeOrReplaceTp1
    : null;
  if (!placeOrReplaceTp1) {
    return buildFailedProtectionWriteResult({
      delegatedRepair,
      reason: "REPAIR_TRANSPORT_MISSING",
    });
  }
  let tp1Ack;
  try {
    tp1Ack = await placeOrReplaceTp1({
      command: delegation.command,
      delegatedRepair,
      env,
      db,
    });
  } catch (error) {
    return buildFailedProtectionWriteResult({
      delegatedRepair,
      reason: error && error.message ? error.message : "REPAIR_TRANSPORT_THROWN",
    });
  }
  return finalizeTp1RepairPlacement({
    tp1RepairRequest: envelope.tp1_repair_request,
    protectionRuntime: envelope.protection_runtime_snapshot || {},
    attemptMeta: delegation.attempt_meta,
    tp1Ack,
    placementFinishedAt: trimOrNull(recordedAt) || new Date().toISOString(),
  });
}

async function executePlaceOrReplaceFullProtectionRepair({
  delegatedRepair,
  envelope,
  delegation,
  transports,
  env,
  db,
  recordedAt,
} = {}) {
  const placeOrReplaceFullProtection = transports && typeof transports.placeOrReplaceFullProtection === "function"
    ? transports.placeOrReplaceFullProtection
    : null;
  if (!placeOrReplaceFullProtection) {
    return buildFailedProtectionWriteResult({
      delegatedRepair,
      reason: "REPAIR_TRANSPORT_MISSING",
    });
  }
  let placementResult;
  try {
    placementResult = await placeOrReplaceFullProtection({
      command: delegation.command,
      delegatedRepair,
      env,
      db,
    });
  } catch (error) {
    return buildFailedProtectionWriteResult({
      delegatedRepair,
      reason: error && error.message ? error.message : "REPAIR_TRANSPORT_THROWN",
    });
  }
  const result = placementResult && typeof placementResult === "object" ? placementResult : {};
  return finalizeFullProtectionRepairPlacement({
    fullProtectionRepairRequest: envelope.full_protection_repair_request,
    protectionRuntime: envelope.protection_runtime_snapshot || {},
    attemptMeta: delegation.attempt_meta,
    slAck: result.slAck,
    tp1Ack: result.tp1Ack,
    placementFinishedAt: trimOrNull(recordedAt) || new Date().toISOString(),
  });
}

async function executeGenericProtectionRepair({
  delegatedRepair,
  envelope,
  delegation,
  transports,
  env,
  db,
  recordedAt,
} = {}) {
  const executeProtectionRepairCommand = transports && typeof transports.executeProtectionRepairCommand === "function"
    ? transports.executeProtectionRepairCommand
    : null;
  if (!executeProtectionRepairCommand) {
    return buildFailedProtectionWriteResult({
      delegatedRepair,
      reason: "REPAIR_TRANSPORT_MISSING",
    });
  }
  let result;
  try {
    result = await executeProtectionRepairCommand({
      repairCommand: envelope.repair_command,
      writerDelegation: delegation,
      delegatedRepair,
      env,
      db,
      recordedAt,
    });
  } catch (error) {
    return buildFailedProtectionWriteResult({
      delegatedRepair,
      reason: error && error.message ? error.message : "REPAIR_TRANSPORT_THROWN",
    });
  }
  if (!result || typeof result !== "object" || !result.writeDecision) {
    return buildFailedProtectionWriteResult({
      delegatedRepair,
      reason: "REPAIR_TRANSPORT_RESULT_INVALID",
    });
  }
  return result;
}

function buildDelegatedRepairExecutor({
  transports = {},
  env = process.env,
  db = null,
  recordedAt = null,
} = {}) {
  return async function executeDelegatedRepair({ delegatedRepair } = {}) {
    const validated = validateDelegatedRepair(delegatedRepair);
    const commandType = upper(validated.delegation.command && validated.delegation.command.command_type)
      || upper(validated.repairCommand && validated.repairCommand.command_type)
      || upper(validated.delegation.action_required);
    if (commandType === "REFRESH_NATIVE_STOP") {
      return executeRefreshNativeStopRepair({
        delegatedRepair,
        envelope: validated.envelope,
        delegation: validated.delegation,
        transports,
        env,
        db,
        recordedAt,
      });
    }
    if (commandType === "PLACE_OR_REPLACE_TP1") {
      return executePlaceOrReplaceTp1Repair({
        delegatedRepair,
        envelope: validated.envelope,
        delegation: validated.delegation,
        transports,
        env,
        db,
        recordedAt,
      });
    }
    if (commandType === "PLACE_OR_REPLACE_FULL_PROTECTION") {
      return executePlaceOrReplaceFullProtectionRepair({
        delegatedRepair,
        envelope: validated.envelope,
        delegation: validated.delegation,
        transports,
        env,
        db,
        recordedAt,
      });
    }
    return executeGenericProtectionRepair({
      delegatedRepair,
      envelope: validated.envelope,
      delegation: validated.delegation,
      transports,
      env,
      db,
      recordedAt,
    });
  };
}

module.exports = {
  buildDelegatedRepairExecutor,
  buildFailedProtectionWriteResult,
  validateDelegatedRepair,
  __test: {
    trimOrNull,
    upper,
    stableCode,
    executeRefreshNativeStopRepair,
    executePlaceOrReplaceTp1Repair,
    executePlaceOrReplaceFullProtectionRepair,
    executeGenericProtectionRepair,
  },
};
