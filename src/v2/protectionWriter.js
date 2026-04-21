"use strict";

const crypto = require("crypto");
const { V2_SERVICES } = require("./constants");
const { assertSingleExchangeWriter } = require("./boundaries");
const { buildProtectionRuntimeDoc } = require("./contracts");
const { buildProtectionRuntimeWriteResult } = require("./protectionRuntimeWriter");
const { assertRuntimeExecutionChain } = require("./runtimeChainAudit");
const { buildProtectedActivePositionCycleDoc } = require("./entryBootstrap");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function parseIsoMs(value) {
  const time = Date.parse(String(value || "").trim());
  return Number.isFinite(time) ? time : null;
}

function hash10(payload) {
  return crypto.createHash("sha1").update(String(payload || "")).digest("hex").slice(0, 10);
}

function validatePlacementRequest(request) {
  if (!request || typeof request !== "object") throw new Error("PLACEMENT_REQUEST_REQUIRED");
  if (!trimOrNull(request.position_cycle_id)) throw new Error("position_cycle_id_REQUIRED");
  if (!trimOrNull(request.entry_event_id)) throw new Error("entry_event_id_REQUIRED");
  if (!trimOrNull(request.signal_intent_id)) throw new Error("signal_intent_id_REQUIRED");
  if (!trimOrNull(request.openclaw_decision_id)) throw new Error("openclaw_decision_id_REQUIRED");
  if (!trimOrNull(request.sl_trigger_price)) throw new Error("sl_trigger_price_REQUIRED");
  if (!trimOrNull(request.tp1_trigger_price)) throw new Error("tp1_trigger_price_REQUIRED");
  if (!trimOrNull(request.tp1_qty_abs)) throw new Error("tp1_qty_abs_REQUIRED");
  return request;
}

function validateRefreshRequest(request) {
  if (!request || typeof request !== "object") throw new Error("REFRESH_REQUEST_REQUIRED");
  if (!trimOrNull(request.position_cycle_id)) throw new Error("position_cycle_id_REQUIRED");
  if (!trimOrNull(request.requested_stop_price)) throw new Error("requested_stop_price_REQUIRED");
  if (!trimOrNull(request.requested_stop_source)) throw new Error("requested_stop_source_REQUIRED");
  if (!trimOrNull(request.reason)) throw new Error("reason_REQUIRED");
  return request;
}

function validateTp1RepairRequest(request) {
  if (!request || typeof request !== "object") throw new Error("TP1_REPAIR_REQUEST_REQUIRED");
  if (!trimOrNull(request.position_cycle_id)) throw new Error("position_cycle_id_REQUIRED");
  if (!(Number(request.requested_tp1_price) > 0)) throw new Error("requested_tp1_price_REQUIRED");
  if (!(Number(request.requested_tp1_qty_abs) > 0)) throw new Error("requested_tp1_qty_abs_REQUIRED");
  if (!trimOrNull(request.reason)) throw new Error("reason_REQUIRED");
  return request;
}

function validateFullProtectionRepairRequest(request) {
  if (!request || typeof request !== "object") throw new Error("FULL_PROTECTION_REPAIR_REQUEST_REQUIRED");
  if (!trimOrNull(request.position_cycle_id)) throw new Error("position_cycle_id_REQUIRED");
  if (request.include_sl_order !== true && request.include_tp1_order !== true) {
    throw new Error("full_protection_repair_target_REQUIRED");
  }
  if (request.include_sl_order === true) {
    if (!(Number(request.requested_stop_price) > 0)) throw new Error("requested_stop_price_REQUIRED");
    if (!trimOrNull(request.requested_stop_source)) throw new Error("requested_stop_source_REQUIRED");
  }
  if (request.include_tp1_order === true) {
    if (!(Number(request.requested_tp1_price) > 0)) throw new Error("requested_tp1_price_REQUIRED");
    if (!(Number(request.requested_tp1_qty_abs) > 0)) throw new Error("requested_tp1_qty_abs_REQUIRED");
  }
  if (!trimOrNull(request.reason)) throw new Error("reason_REQUIRED");
  return request;
}

function normalizeStopAck(name, ack) {
  if (!ack || typeof ack !== "object") throw new Error(`${name}_REQUIRED`);
  const status = upper(ack.status);
  if (!["PLACED", "FAILED"].includes(status)) throw new Error(`${name}_STATUS_INVALID`);
  return Object.freeze({
    status,
    order_id: trimOrNull(ack.order_id),
    trigger_price: ack.trigger_price == null ? null : Number(ack.trigger_price),
    error_code: trimOrNull(ack.error_code),
    ack_at: trimOrNull(ack.ack_at),
  });
}

function normalizePlacementIssueCodes(issueCodes) {
  return Array.from(new Set(
    (Array.isArray(issueCodes) ? issueCodes : [])
      .map((code) => upper(code))
      .filter(Boolean)
  ));
}

function filterRefreshResolvedIssueCodes(issueCodes) {
  return normalizePlacementIssueCodes(issueCodes).filter((code) => (
    code !== "UNPROTECTED_ACTIVE_POSITION" &&
    code !== "NATIVE_REFRESH_UNHEALTHY" &&
    code !== "TRAIL_STOP_MISSING"
  ));
}

function filterTp1ResolvedIssueCodes(issueCodes) {
  return normalizePlacementIssueCodes(issueCodes).filter((code) => code !== "TP1_ORDER_MISSING");
}

function filterFullProtectionBaseResolvedIssueCodes(issueCodes) {
  return normalizePlacementIssueCodes(issueCodes).filter((code) => (
    code !== "UNPROTECTED_ACTIVE_POSITION" &&
    code !== "NATIVE_REFRESH_UNHEALTHY" &&
    code !== "TRAIL_STOP_MISSING"
  ));
}

function hasPlacedRuntimeOrder(runtime, orderKey, statusKey) {
  const row = runtime && typeof runtime === "object" ? runtime : {};
  const orderId = trimOrNull(row[orderKey]);
  const status = upper(row[statusKey]);
  if (!orderId) return false;
  if (!status) return true;
  return status === "PLACED";
}

function buildProtectionPlacementAttemptId({
  positionCycleId,
  placementRetryId,
  placementStartedAt,
} = {}) {
  const cycleId = trimOrNull(positionCycleId);
  const retryId = trimOrNull(placementRetryId) || "R0";
  const startedAt = trimOrNull(placementStartedAt);
  if (!cycleId) throw new Error("position_cycle_id_REQUIRED");
  if (!startedAt) throw new Error("placement_started_at_REQUIRED");
  return `PRATTV2__${hash10(`${cycleId}__${retryId}__${startedAt}`)}`;
}

function resolveRepairPositionIdentity({ request, protectionRuntime = {}, positionCycle = {} } = {}) {
  const runtime = protectionRuntime && typeof protectionRuntime === "object" ? protectionRuntime : {};
  if (trimOrNull(runtime.position_cycle_id) && trimOrNull(runtime.position_cycle_id) !== request.position_cycle_id) {
    throw new Error("REPAIR_REQUEST_PROTECTION_RUNTIME_MISMATCH");
  }
  const cycle = positionCycle && typeof positionCycle === "object" ? positionCycle : {};
  if (trimOrNull(cycle.position_cycle_id) && trimOrNull(cycle.position_cycle_id) !== request.position_cycle_id) {
    throw new Error("REPAIR_REQUEST_POSITION_CYCLE_MISMATCH");
  }
  const positionSide = upper(cycle.position_side || runtime.position_side);
  if (positionSide !== "LONG" && positionSide !== "SHORT") throw new Error("position_side_REQUIRED");
  const symbol = upper(cycle.symbol || runtime.symbol);
  if (!symbol) throw new Error("symbol_REQUIRED");
  return Object.freeze({
    runtime,
    cycle,
    symbol,
    positionSide,
    closeSide: positionSide === "LONG" ? "SELL" : "BUY",
  });
}

function buildInitialProtectionCommands({
  placementRequest,
  placementStartedAt = null,
  placementRetryId = "R0",
} = {}) {
  const singleWriter = assertSingleExchangeWriter(V2_SERVICES.PROTECTION_WRITER);
  if (!singleWriter.ok) {
    throw new Error("PROTECTION_WRITER_SINGLE_WRITER_VIOLATION");
  }
  const request = validatePlacementRequest(placementRequest);
  const startedAt = trimOrNull(placementStartedAt) || new Date().toISOString();
  const retryId = trimOrNull(placementRetryId) || "R0";
  const placementAttemptId = buildProtectionPlacementAttemptId({
    positionCycleId: request.position_cycle_id,
    placementRetryId: retryId,
    placementStartedAt: startedAt,
  });
  const attemptMeta = Object.freeze({
    requested_by_service: V2_SERVICES.PROTECTION_WRITER,
    position_cycle_id: request.position_cycle_id,
    placement_attempt_id: placementAttemptId,
    placement_retry_id: retryId,
    placement_started_at: startedAt,
  });
  return Object.freeze({
    attemptMeta,
    commands: Object.freeze({
      sl: Object.freeze({
        command_type: "PLACE_INITIAL_SL",
        placement_attempt_id: placementAttemptId,
        position_cycle_id: request.position_cycle_id,
        symbol: upper(request.symbol),
        position_side: upper(request.position_side),
        close_side: upper(request.close_side),
        trigger_price: Number(request.sl_trigger_price),
        client_order_key: `SL__${placementAttemptId}`,
      }),
      tp1: Object.freeze({
        command_type: "PLACE_INITIAL_TP1",
        placement_attempt_id: placementAttemptId,
        position_cycle_id: request.position_cycle_id,
        symbol: upper(request.symbol),
        position_side: upper(request.position_side),
        close_side: upper(request.close_side),
        trigger_price: Number(request.tp1_trigger_price),
        quantity_abs: Number(request.tp1_qty_abs),
        client_order_key: `TP1__${placementAttemptId}`,
      }),
    }),
  });
}

function buildRefreshStopCommand({
  refreshRequest,
  protectionRuntime = {},
  placementStartedAt = null,
  placementRetryId = "R0",
} = {}) {
  const singleWriter = assertSingleExchangeWriter(V2_SERVICES.PROTECTION_WRITER);
  if (!singleWriter.ok) {
    throw new Error("PROTECTION_WRITER_SINGLE_WRITER_VIOLATION");
  }
  const request = validateRefreshRequest(refreshRequest);
  const runtime = protectionRuntime && typeof protectionRuntime === "object" ? protectionRuntime : {};
  if (trimOrNull(runtime.position_cycle_id) && trimOrNull(runtime.position_cycle_id) !== request.position_cycle_id) {
    throw new Error("REFRESH_REQUEST_PROTECTION_RUNTIME_MISMATCH");
  }
  const startedAt = trimOrNull(placementStartedAt) || new Date().toISOString();
  const retryId = trimOrNull(placementRetryId) || "R0";
  const placementAttemptId = buildProtectionPlacementAttemptId({
    positionCycleId: request.position_cycle_id,
    placementRetryId: retryId,
    placementStartedAt: startedAt,
  });
  const attemptMeta = Object.freeze({
    requested_by_service: V2_SERVICES.PROTECTION_WRITER,
    position_cycle_id: request.position_cycle_id,
    placement_attempt_id: placementAttemptId,
    placement_retry_id: retryId,
    placement_started_at: startedAt,
    refresh_reason: upper(request.reason),
  });
  return Object.freeze({
    attemptMeta,
    command: Object.freeze({
      command_type: "REFRESH_NATIVE_STOP",
      placement_attempt_id: placementAttemptId,
      position_cycle_id: request.position_cycle_id,
      trigger_price: Number(request.requested_stop_price),
      requested_stop_source: upper(request.requested_stop_source),
      previous_native_stop_price: runtime.native_stop_price == null ? null : Number(runtime.native_stop_price),
      client_order_key: `RSTP__${placementAttemptId}`,
    }),
  });
}

function buildTp1RepairCommand({
  tp1RepairRequest,
  protectionRuntime = {},
  positionCycle = {},
  placementStartedAt = null,
  placementRetryId = "R0",
} = {}) {
  const singleWriter = assertSingleExchangeWriter(V2_SERVICES.PROTECTION_WRITER);
  if (!singleWriter.ok) {
    throw new Error("PROTECTION_WRITER_SINGLE_WRITER_VIOLATION");
  }
  const request = validateTp1RepairRequest(tp1RepairRequest);
  const identity = resolveRepairPositionIdentity({
    request,
    protectionRuntime,
    positionCycle,
  });
  const startedAt = trimOrNull(placementStartedAt) || new Date().toISOString();
  const retryId = trimOrNull(placementRetryId) || "R0";
  const placementAttemptId = buildProtectionPlacementAttemptId({
    positionCycleId: request.position_cycle_id,
    placementRetryId: retryId,
    placementStartedAt: startedAt,
  });
  const attemptMeta = Object.freeze({
    requested_by_service: V2_SERVICES.PROTECTION_WRITER,
    position_cycle_id: request.position_cycle_id,
    placement_attempt_id: placementAttemptId,
    placement_retry_id: retryId,
    placement_started_at: startedAt,
    repair_reason: upper(request.reason),
  });
  return Object.freeze({
    attemptMeta,
    command: Object.freeze({
      command_type: "PLACE_OR_REPLACE_TP1",
      placement_attempt_id: placementAttemptId,
      position_cycle_id: request.position_cycle_id,
      symbol: identity.symbol,
      position_side: identity.positionSide,
      close_side: identity.closeSide,
      trigger_price: Number(request.requested_tp1_price),
      quantity_abs: Number(request.requested_tp1_qty_abs),
      previous_tp1_order_id: trimOrNull(identity.runtime.tp1_order_id),
      client_order_key: `RTP1__${placementAttemptId}`,
    }),
  });
}

function buildFullProtectionRepairCommand({
  fullProtectionRepairRequest,
  protectionRuntime = {},
  positionCycle = {},
  placementStartedAt = null,
  placementRetryId = "R0",
} = {}) {
  const singleWriter = assertSingleExchangeWriter(V2_SERVICES.PROTECTION_WRITER);
  if (!singleWriter.ok) {
    throw new Error("PROTECTION_WRITER_SINGLE_WRITER_VIOLATION");
  }
  const request = validateFullProtectionRepairRequest(fullProtectionRepairRequest);
  const identity = resolveRepairPositionIdentity({
    request,
    protectionRuntime,
    positionCycle,
  });
  const startedAt = trimOrNull(placementStartedAt) || new Date().toISOString();
  const retryId = trimOrNull(placementRetryId) || "R0";
  const placementAttemptId = buildProtectionPlacementAttemptId({
    positionCycleId: request.position_cycle_id,
    placementRetryId: retryId,
    placementStartedAt: startedAt,
  });
  const attemptMeta = Object.freeze({
    requested_by_service: V2_SERVICES.PROTECTION_WRITER,
    position_cycle_id: request.position_cycle_id,
    placement_attempt_id: placementAttemptId,
    placement_retry_id: retryId,
    placement_started_at: startedAt,
    repair_reason: upper(request.reason),
  });
  const slCommand = request.include_sl_order === true
    ? Object.freeze({
        command_type: "PLACE_OR_REPLACE_SL",
        placement_attempt_id: placementAttemptId,
        position_cycle_id: request.position_cycle_id,
        symbol: identity.symbol,
        position_side: identity.positionSide,
        close_side: identity.closeSide,
        trigger_price: Number(request.requested_stop_price),
        requested_stop_source: upper(request.requested_stop_source),
        previous_sl_order_id: trimOrNull(identity.runtime.sl_order_id),
        previous_native_stop_price: identity.runtime.native_stop_price == null ? null : Number(identity.runtime.native_stop_price),
        client_order_key: `RSL__${placementAttemptId}`,
      })
    : null;
  const tp1Command = request.include_tp1_order === true
    ? Object.freeze({
        command_type: "PLACE_OR_REPLACE_TP1",
        placement_attempt_id: placementAttemptId,
        position_cycle_id: request.position_cycle_id,
        symbol: identity.symbol,
        position_side: identity.positionSide,
        close_side: identity.closeSide,
        trigger_price: Number(request.requested_tp1_price),
        quantity_abs: Number(request.requested_tp1_qty_abs),
        previous_tp1_order_id: trimOrNull(identity.runtime.tp1_order_id),
        client_order_key: `RTP1__${placementAttemptId}`,
      })
    : null;
  return Object.freeze({
    attemptMeta,
    command: Object.freeze({
      command_type: "PLACE_OR_REPLACE_FULL_PROTECTION",
      placement_attempt_id: placementAttemptId,
      position_cycle_id: request.position_cycle_id,
      symbol: identity.symbol,
      position_side: identity.positionSide,
      close_side: identity.closeSide,
      include_sl_order: request.include_sl_order === true,
      include_tp1_order: request.include_tp1_order === true,
      commands: Object.freeze({
        sl: slCommand,
        tp1: tp1Command,
      }),
    }),
  });
}

function measureInitialProtectionGapMs({
  placementStartedAt,
  slAckAt,
  placementFinishedAt,
} = {}) {
  const startedMs = parseIsoMs(placementStartedAt);
  if (!Number.isFinite(startedMs)) throw new Error("placement_started_at_REQUIRED");
  const stopProtectedAtMs = parseIsoMs(slAckAt);
  const finishedMs = parseIsoMs(placementFinishedAt);
  const endMs = Number.isFinite(stopProtectedAtMs)
    ? stopProtectedAtMs
    : finishedMs;
  if (!Number.isFinite(endMs)) return null;
  return Math.max(0, endMs - startedMs);
}

function finalizeInitialProtectionPlacement({
  placementRequest,
  attemptMeta,
  slAck,
  tp1Ack,
  placementFinishedAt = null,
} = {}) {
  const request = validatePlacementRequest(placementRequest);
  const meta = attemptMeta && typeof attemptMeta === "object" ? attemptMeta : null;
  if (!meta) throw new Error("ATTEMPT_META_REQUIRED");
  const finishedAt = trimOrNull(placementFinishedAt) || new Date().toISOString();
  const gapMs = measureInitialProtectionGapMs({
    placementStartedAt: meta.placement_started_at,
    slAckAt: slAck && slAck.ack_at,
    placementFinishedAt: finishedAt,
  });
  return buildProtectionRuntimeWriteResult({
    placementRequest: request,
    slAck,
    tp1Ack,
    observedAt: finishedAt,
    lastGapMs: gapMs,
    placementAttemptId: meta.placement_attempt_id,
    placementRetryId: meta.placement_retry_id,
    placementStartedAt: meta.placement_started_at,
    placementFinishedAt: finishedAt,
  });
}

function finalizeAuditedInitialProtectionPlacement({
  executedEntry,
  placementRequest,
  attemptMeta,
  slAck,
  tp1Ack,
  placementFinishedAt = null,
} = {}) {
  const result = finalizeInitialProtectionPlacement({
    placementRequest,
    attemptMeta,
    slAck,
    tp1Ack,
    placementFinishedAt,
  });
  if (result.writeDecision.ok !== true) {
    throw new Error("RUNTIME_CHAIN_PROTECTION_NOT_READY");
  }
  if (upper(result.runtimeDoc.health_status) !== "HEALTHY") {
    throw new Error("RUNTIME_CHAIN_PROTECTION_HEALTHY");
  }
  const activatedPositionCycle = buildProtectedActivePositionCycleDoc({
    positionCycle: executedEntry && executedEntry.positionCycle,
    protectionWriteResult: result,
    activatedAt: result.runtimeDoc.last_refresh_at,
  });
  const chainAudit = assertRuntimeExecutionChain({
    executedEntry: {
      ...executedEntry,
      positionCycle: activatedPositionCycle,
    },
    placementRequest,
    protectionWriteResult: result,
  });
  return Object.freeze({
    ...result,
    activatedPositionCycle,
    chainAudit,
  });
}

function finalizeRefreshStopPlacement({
  refreshRequest,
  protectionRuntime = {},
  attemptMeta,
  slAck,
  placementFinishedAt = null,
} = {}) {
  const request = validateRefreshRequest(refreshRequest);
  const runtime = protectionRuntime && typeof protectionRuntime === "object" ? protectionRuntime : {};
  if (trimOrNull(runtime.position_cycle_id) && trimOrNull(runtime.position_cycle_id) !== request.position_cycle_id) {
    throw new Error("REFRESH_REQUEST_PROTECTION_RUNTIME_MISMATCH");
  }
  const meta = attemptMeta && typeof attemptMeta === "object" ? attemptMeta : null;
  if (!meta) throw new Error("ATTEMPT_META_REQUIRED");
  const normalizedSlAck = normalizeStopAck("SL_ACK", slAck);
  const finishedAt = trimOrNull(placementFinishedAt) || new Date().toISOString();
  const gapMs = measureInitialProtectionGapMs({
    placementStartedAt: meta.placement_started_at,
    slAckAt: normalizedSlAck.ack_at,
    placementFinishedAt: finishedAt,
  });
  const preservedIssueCodes = filterRefreshResolvedIssueCodes(runtime.placement_issue_codes);
  const stopPlaced = normalizedSlAck.status === "PLACED";
  const issueCodes = stopPlaced
    ? preservedIssueCodes
    : Array.from(new Set([...preservedIssueCodes, "UNPROTECTED_ACTIVE_POSITION"]));
  const healthStatus = stopPlaced
    ? (issueCodes.includes("TP1_ORDER_MISSING") ? "DEGRADED_REPAIRABLE" : "HEALTHY")
    : "DEGRADED_UNPROTECTED";
  const runtimeDoc = buildProtectionRuntimeDoc({
    positionCycleId: request.position_cycle_id,
    slOrderId: stopPlaced ? normalizedSlAck.order_id : null,
    tp1OrderId: trimOrNull(runtime.tp1_order_id),
    nativeStopPrice: stopPlaced
      ? (normalizedSlAck.trigger_price != null ? normalizedSlAck.trigger_price : Number(request.requested_stop_price))
      : null,
    nativeTp1Price: runtime.native_tp1_price,
    nativeRefreshStatus: stopPlaced ? "OK" : "ERROR",
    lastRefreshAt: finishedAt,
    lastGapMs: gapMs,
    healthStatus,
    slOrderStatus: normalizedSlAck.status,
    tp1OrderStatus: trimOrNull(runtime.tp1_order_status),
    runtimeWriteReason: stopPlaced ? "REFRESH_STOP_PROTECTED" : "REFRESH_STOP_FAILED",
    placementIssueCodes: issueCodes,
    placementAttemptId: meta.placement_attempt_id,
    placementRetryId: meta.placement_retry_id,
    placementStartedAt: meta.placement_started_at,
    placementFinishedAt: finishedAt,
    slAckAt: normalizedSlAck.ack_at,
    tp1AckAt: trimOrNull(runtime.tp1_ack_at),
  });
  return Object.freeze({
    runtimeDoc,
    writeDecision: Object.freeze({
      ok: stopPlaced && issueCodes.length === 0,
      requires_repair: !stopPlaced || issueCodes.length > 0,
      placement_issue_codes: issueCodes,
      runtime_write_reason: runtimeDoc.runtime_write_reason,
      native_refresh_status: runtimeDoc.native_refresh_status,
      health_status: runtimeDoc.health_status,
    }),
  });
}

function finalizeTp1RepairPlacement({
  tp1RepairRequest,
  protectionRuntime = {},
  attemptMeta,
  tp1Ack,
  placementFinishedAt = null,
} = {}) {
  const request = validateTp1RepairRequest(tp1RepairRequest);
  const runtime = protectionRuntime && typeof protectionRuntime === "object" ? protectionRuntime : {};
  if (trimOrNull(runtime.position_cycle_id) && trimOrNull(runtime.position_cycle_id) !== request.position_cycle_id) {
    throw new Error("TP1_REPAIR_REQUEST_PROTECTION_RUNTIME_MISMATCH");
  }
  const meta = attemptMeta && typeof attemptMeta === "object" ? attemptMeta : null;
  if (!meta) throw new Error("ATTEMPT_META_REQUIRED");
  const normalizedTp1Ack = normalizeStopAck("TP1_ACK", tp1Ack);
  const finishedAt = trimOrNull(placementFinishedAt) || new Date().toISOString();
  const preservedIssueCodes = filterTp1ResolvedIssueCodes(runtime.placement_issue_codes);
  const tp1Placed = normalizedTp1Ack.status === "PLACED";
  const issueCodes = tp1Placed
    ? preservedIssueCodes
    : Array.from(new Set([...preservedIssueCodes, "TP1_ORDER_MISSING"]));
  const hasUnprotectedIssue = issueCodes.includes("UNPROTECTED_ACTIVE_POSITION");
  const healthStatus = hasUnprotectedIssue
    ? "DEGRADED_UNPROTECTED"
    : (issueCodes.length > 0 ? "DEGRADED_REPAIRABLE" : "HEALTHY");
  const nativeRefreshStatus = trimOrNull(runtime.native_refresh_status) || (hasUnprotectedIssue ? "ERROR" : "OK");
  const runtimeDoc = buildProtectionRuntimeDoc({
    positionCycleId: request.position_cycle_id,
    slOrderId: trimOrNull(runtime.sl_order_id),
    tp1OrderId: tp1Placed ? normalizedTp1Ack.order_id : null,
    nativeStopPrice: runtime.native_stop_price,
    nativeTp1Price: tp1Placed
      ? (normalizedTp1Ack.trigger_price != null ? normalizedTp1Ack.trigger_price : Number(request.requested_tp1_price))
      : null,
    nativeRefreshStatus,
    lastRefreshAt: finishedAt,
    lastGapMs: runtime.last_gap_ms,
    healthStatus,
    slOrderStatus: trimOrNull(runtime.sl_order_status),
    tp1OrderStatus: normalizedTp1Ack.status,
    runtimeWriteReason: tp1Placed ? "TP1_REPAIRED" : "TP1_REPAIR_FAILED",
    placementIssueCodes: issueCodes,
    placementAttemptId: meta.placement_attempt_id,
    placementRetryId: meta.placement_retry_id,
    placementStartedAt: meta.placement_started_at,
    placementFinishedAt: finishedAt,
    slAckAt: trimOrNull(runtime.sl_ack_at),
    tp1AckAt: normalizedTp1Ack.ack_at,
  });
  return Object.freeze({
    runtimeDoc,
    writeDecision: Object.freeze({
      ok: tp1Placed && issueCodes.length === 0,
      requires_repair: !tp1Placed || issueCodes.length > 0,
      placement_issue_codes: issueCodes,
      runtime_write_reason: runtimeDoc.runtime_write_reason,
      native_refresh_status: runtimeDoc.native_refresh_status,
      health_status: runtimeDoc.health_status,
    }),
  });
}

function buildPreservedOrderAck({ runtime, orderKey, statusKey, priceKey, ackKey }) {
  const row = runtime && typeof runtime === "object" ? runtime : {};
  return Object.freeze({
    status: hasPlacedRuntimeOrder(row, orderKey, statusKey) ? "PLACED" : "FAILED",
    order_id: trimOrNull(row[orderKey]),
    trigger_price: row[priceKey] == null ? null : Number(row[priceKey]),
    error_code: null,
    ack_at: trimOrNull(row[ackKey]),
  });
}

function finalizeFullProtectionRepairPlacement({
  fullProtectionRepairRequest,
  protectionRuntime = {},
  attemptMeta,
  slAck = null,
  tp1Ack = null,
  placementFinishedAt = null,
} = {}) {
  const request = validateFullProtectionRepairRequest(fullProtectionRepairRequest);
  const runtime = protectionRuntime && typeof protectionRuntime === "object" ? protectionRuntime : {};
  if (trimOrNull(runtime.position_cycle_id) && trimOrNull(runtime.position_cycle_id) !== request.position_cycle_id) {
    throw new Error("FULL_PROTECTION_REPAIR_REQUEST_PROTECTION_RUNTIME_MISMATCH");
  }
  const meta = attemptMeta && typeof attemptMeta === "object" ? attemptMeta : null;
  if (!meta) throw new Error("ATTEMPT_META_REQUIRED");
  const normalizedSlAck = request.include_sl_order === true
    ? normalizeStopAck("SL_ACK", slAck)
    : buildPreservedOrderAck({
        runtime,
        orderKey: "sl_order_id",
        statusKey: "sl_order_status",
        priceKey: "native_stop_price",
        ackKey: "sl_ack_at",
      });
  const normalizedTp1Ack = request.include_tp1_order === true
    ? normalizeStopAck("TP1_ACK", tp1Ack)
    : buildPreservedOrderAck({
        runtime,
        orderKey: "tp1_order_id",
        statusKey: "tp1_order_status",
        priceKey: "native_tp1_price",
        ackKey: "tp1_ack_at",
      });
  const finishedAt = trimOrNull(placementFinishedAt) || new Date().toISOString();
  const gapMs = request.include_sl_order === true
    ? measureInitialProtectionGapMs({
        placementStartedAt: meta.placement_started_at,
        slAckAt: normalizedSlAck.ack_at,
        placementFinishedAt: finishedAt,
      })
    : runtime.last_gap_ms;
  const slPlaced = normalizedSlAck.status === "PLACED";
  const tp1Placed = normalizedTp1Ack.status === "PLACED";
  let issueCodes = filterFullProtectionBaseResolvedIssueCodes(runtime.placement_issue_codes);
  if (request.include_tp1_order === true) {
    issueCodes = filterTp1ResolvedIssueCodes(issueCodes);
    if (!tp1Placed) issueCodes.push("TP1_ORDER_MISSING");
  }
  if (!slPlaced) issueCodes.push("UNPROTECTED_ACTIVE_POSITION");
  issueCodes = Array.from(new Set(issueCodes));
  const healthStatus = issueCodes.includes("UNPROTECTED_ACTIVE_POSITION")
    ? "DEGRADED_UNPROTECTED"
    : (issueCodes.length > 0 ? "DEGRADED_REPAIRABLE" : "HEALTHY");
  const fullyRepaired = slPlaced && (request.include_tp1_order !== true || tp1Placed) && issueCodes.length === 0;
  const runtimeWriteReason = fullyRepaired
    ? "FULL_PROTECTION_REPAIRED"
    : (slPlaced ? "FULL_PROTECTION_PARTIAL" : "FULL_PROTECTION_REPAIR_FAILED");
  const runtimeDoc = buildProtectionRuntimeDoc({
    positionCycleId: request.position_cycle_id,
    slOrderId: slPlaced ? normalizedSlAck.order_id : null,
    tp1OrderId: tp1Placed ? normalizedTp1Ack.order_id : null,
    nativeStopPrice: slPlaced
      ? (normalizedSlAck.trigger_price != null ? normalizedSlAck.trigger_price : Number(request.requested_stop_price || runtime.native_stop_price))
      : null,
    nativeTp1Price: tp1Placed
      ? (normalizedTp1Ack.trigger_price != null ? normalizedTp1Ack.trigger_price : Number(request.requested_tp1_price || runtime.native_tp1_price))
      : null,
    nativeRefreshStatus: slPlaced ? "OK" : "ERROR",
    lastRefreshAt: finishedAt,
    lastGapMs: gapMs,
    healthStatus,
    slOrderStatus: normalizedSlAck.status,
    tp1OrderStatus: normalizedTp1Ack.status,
    runtimeWriteReason,
    placementIssueCodes: issueCodes,
    placementAttemptId: meta.placement_attempt_id,
    placementRetryId: meta.placement_retry_id,
    placementStartedAt: meta.placement_started_at,
    placementFinishedAt: finishedAt,
    slAckAt: normalizedSlAck.ack_at,
    tp1AckAt: normalizedTp1Ack.ack_at,
  });
  return Object.freeze({
    runtimeDoc,
    writeDecision: Object.freeze({
      ok: fullyRepaired,
      requires_repair: !fullyRepaired,
      placement_issue_codes: issueCodes,
      runtime_write_reason: runtimeDoc.runtime_write_reason,
      native_refresh_status: runtimeDoc.native_refresh_status,
      health_status: runtimeDoc.health_status,
    }),
  });
}

module.exports = {
  buildInitialProtectionCommands,
  buildRefreshStopCommand,
  buildTp1RepairCommand,
  buildFullProtectionRepairCommand,
  finalizeInitialProtectionPlacement,
  finalizeAuditedInitialProtectionPlacement,
  finalizeRefreshStopPlacement,
  finalizeTp1RepairPlacement,
  finalizeFullProtectionRepairPlacement,
  __test: {
    trimOrNull,
    upper,
    parseIsoMs,
    hash10,
    validatePlacementRequest,
    validateRefreshRequest,
    validateTp1RepairRequest,
    validateFullProtectionRepairRequest,
    normalizeStopAck,
    normalizePlacementIssueCodes,
    filterRefreshResolvedIssueCodes,
    filterTp1ResolvedIssueCodes,
    filterFullProtectionBaseResolvedIssueCodes,
    hasPlacedRuntimeOrder,
    buildProtectionPlacementAttemptId,
    buildPreservedOrderAck,
    measureInitialProtectionGapMs,
  },
};
