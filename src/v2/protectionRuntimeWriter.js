"use strict";

const { buildProtectionRuntimeDoc } = require("./contracts");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function validateRequiredObject(name, value) {
  if (!value || typeof value !== "object") throw new Error(`${name}_REQUIRED`);
  return value;
}

function normalizeOrderAck(name, ack) {
  const row = validateRequiredObject(name, ack);
  const status = upper(row.status);
  if (!["PLACED", "FAILED"].includes(status)) throw new Error(`${name}_STATUS_INVALID`);
  return Object.freeze({
    status,
    order_id: trimOrNull(row.order_id),
    trigger_price: toNumberOrNull(row.trigger_price),
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

function resolveWriteState({ slAck, tp1Ack }) {
  const issueCodes = [];
  let nativeRefreshStatus = "OK";
  let healthStatus = "HEALTHY";
  let runtimeWriteReason = "FULLY_PROTECTED";

  if (slAck.status === "PLACED" && tp1Ack.status === "PLACED") {
    return Object.freeze({
      native_refresh_status: nativeRefreshStatus,
      health_status: healthStatus,
      runtime_write_reason: runtimeWriteReason,
      placement_issue_codes: issueCodes,
      requires_repair: false,
    });
  }

  if (slAck.status === "PLACED" && tp1Ack.status === "FAILED") {
    issueCodes.push("TP1_ORDER_MISSING");
    nativeRefreshStatus = "PARTIAL";
    healthStatus = "DEGRADED_REPAIRABLE";
    runtimeWriteReason = "SL_ONLY_PROTECTED";
    return Object.freeze({
      native_refresh_status: nativeRefreshStatus,
      health_status: healthStatus,
      runtime_write_reason: runtimeWriteReason,
      placement_issue_codes: issueCodes,
      requires_repair: true,
    });
  }

  if (slAck.status === "FAILED" && tp1Ack.status === "PLACED") {
    issueCodes.push("UNPROTECTED_ACTIVE_POSITION");
    nativeRefreshStatus = "PARTIAL";
    healthStatus = "DEGRADED_UNPROTECTED";
    runtimeWriteReason = "TP1_ONLY_PROTECTED";
    return Object.freeze({
      native_refresh_status: nativeRefreshStatus,
      health_status: healthStatus,
      runtime_write_reason: runtimeWriteReason,
      placement_issue_codes: issueCodes,
      requires_repair: true,
    });
  }

  issueCodes.push("UNPROTECTED_ACTIVE_POSITION");
  issueCodes.push("TP1_ORDER_MISSING");
  nativeRefreshStatus = "ERROR";
  healthStatus = "DEGRADED_UNPROTECTED";
  runtimeWriteReason = "PROTECTION_PLACEMENT_FAILED";
  return Object.freeze({
    native_refresh_status: nativeRefreshStatus,
    health_status: healthStatus,
    runtime_write_reason: runtimeWriteReason,
    placement_issue_codes: issueCodes,
    requires_repair: true,
  });
}

function buildProtectionRuntimeWriteResult({
  placementRequest,
  slAck,
  tp1Ack,
  observedAt = null,
  lastGapMs = null,
  placementAttemptId = null,
  placementRetryId = null,
  placementStartedAt = null,
  placementFinishedAt = null,
} = {}) {
  const request = validateRequiredObject("PLACEMENT_REQUEST", placementRequest);
  const normalizedSlAck = normalizeOrderAck("SL_ACK", slAck);
  const normalizedTp1Ack = normalizeOrderAck("TP1_ACK", tp1Ack);
  const writeState = resolveWriteState({
    slAck: normalizedSlAck,
    tp1Ack: normalizedTp1Ack,
  });
  const runtimeDoc = buildProtectionRuntimeDoc({
    positionCycleId: request.position_cycle_id,
    slOrderId: normalizedSlAck.order_id,
    tp1OrderId: normalizedTp1Ack.order_id,
    nativeStopPrice: normalizedSlAck.status === "PLACED"
      ? (normalizedSlAck.trigger_price != null ? normalizedSlAck.trigger_price : request.sl_trigger_price)
      : null,
    nativeTp1Price: normalizedTp1Ack.status === "PLACED"
      ? (normalizedTp1Ack.trigger_price != null ? normalizedTp1Ack.trigger_price : request.tp1_trigger_price)
      : null,
    nativeRefreshStatus: writeState.native_refresh_status,
    lastRefreshAt: trimOrNull(observedAt),
    lastGapMs,
    healthStatus: writeState.health_status,
    slOrderStatus: normalizedSlAck.status,
    tp1OrderStatus: normalizedTp1Ack.status,
    runtimeWriteReason: writeState.runtime_write_reason,
    placementIssueCodes: writeState.placement_issue_codes,
    placementAttemptId,
    placementRetryId,
    placementStartedAt,
    placementFinishedAt,
    slAckAt: normalizedSlAck.ack_at,
    tp1AckAt: normalizedTp1Ack.ack_at,
    lastExchangeEvidence: {
      initial_protection: {
        sl_ack: normalizedSlAck,
        tp1_ack: normalizedTp1Ack,
        late_placed_after_abort: normalizedSlAck.late_placed_after_abort === true ||
          normalizedTp1Ack.late_placed_after_abort === true,
        late_placed_legs: [
          normalizedSlAck.late_placed_after_abort === true ? "SL" : null,
          normalizedTp1Ack.late_placed_after_abort === true ? "TP1" : null,
        ].filter(Boolean),
      },
    },
    lastEvidenceObservedAt: trimOrNull(observedAt),
  });
  return Object.freeze({
    runtimeDoc,
    writeDecision: Object.freeze({
      ok: writeState.requires_repair !== true,
      requires_repair: writeState.requires_repair,
      placement_issue_codes: writeState.placement_issue_codes,
      runtime_write_reason: writeState.runtime_write_reason,
      native_refresh_status: writeState.native_refresh_status,
      health_status: writeState.health_status,
    }),
  });
}

module.exports = {
  buildProtectionRuntimeWriteResult,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
    normalizeOrderAck,
    resolveWriteState,
  },
};
