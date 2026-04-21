"use strict";

const { V2_SERVICES } = require("./constants");
const { buildRepairRequestDoc } = require("./contracts");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function normalizeIssueCodes(codes = []) {
  const seen = new Set();
  const rows = [];
  for (const code of Array.isArray(codes) ? codes : []) {
    const normalized = upper(code);
    if (!normalized || seen.has(normalized)) continue;
    seen.add(normalized);
    rows.push(normalized);
  }
  return Object.freeze(rows);
}

function isDryRunAck(ack) {
  const row = ack && typeof ack === "object" ? ack : {};
  const code = upper(row.error_code);
  return !!code && code.includes("DRY_RUN");
}

function isDryRunProtectionFailure({ slAck, tp1Ack, protectionWriteResult } = {}) {
  if (isDryRunAck(slAck) || isDryRunAck(tp1Ack)) return true;
  const runtime = protectionWriteResult && protectionWriteResult.runtimeDoc && typeof protectionWriteResult.runtimeDoc === "object"
    ? protectionWriteResult.runtimeDoc
    : {};
  return normalizeIssueCodes(runtime.placement_issue_codes).some((code) => code.includes("DRY_RUN"));
}

function resolveRepairAction(issueCode) {
  const code = upper(issueCode);
  if (code === "TP1_ORDER_MISSING") return "ENSURE_TP1_ORDER";
  if (code === "UNPROTECTED_ACTIVE_POSITION") return "ENSURE_FULL_PROTECTION";
  if (code === "NATIVE_REFRESH_UNHEALTHY" || code === "TRAIL_STOP_MISSING") return "REFRESH_NATIVE_STOP";
  return null;
}

function resolveRepairHealth(issueCode, fallbackHealth = null) {
  const code = upper(issueCode);
  if (code === "UNPROTECTED_ACTIVE_POSITION") return "DEGRADED_UNPROTECTED";
  if (code === "TRAIL_STOP_MISSING") return "DEGRADED_UNPROTECTED";
  return upper(fallbackHealth) || "DEGRADED_REPAIRABLE";
}

function buildEntryProtectionRepairRequests({
  executedEntry,
  placementRequest,
  protectionWriteResult,
  slAck = null,
  tp1Ack = null,
  createdAt = null,
} = {}) {
  const executed = executedEntry && typeof executedEntry === "object" ? executedEntry : null;
  const projection = executed && executed.projection && typeof executed.projection === "object" ? executed.projection : null;
  const request = placementRequest && typeof placementRequest === "object" ? placementRequest : null;
  const result = protectionWriteResult && typeof protectionWriteResult === "object" ? protectionWriteResult : null;
  const runtime = result && result.runtimeDoc && typeof result.runtimeDoc === "object" ? result.runtimeDoc : null;
  const decision = result && result.writeDecision && typeof result.writeDecision === "object" ? result.writeDecision : null;
  if (!executed) throw new Error("EXECUTED_ENTRY_REQUIRED");
  if (!projection) throw new Error("EXIT_RUNTIME_PROJECTION_REQUIRED");
  if (!request) throw new Error("PLACEMENT_REQUEST_REQUIRED");
  if (!runtime) throw new Error("PROTECTION_RUNTIME_DOC_REQUIRED");
  if (!decision) throw new Error("PROTECTION_WRITE_DECISION_REQUIRED");

  const positionCycleId = trimOrNull(runtime.position_cycle_id) || trimOrNull(request.position_cycle_id);
  if (!positionCycleId) throw new Error("position_cycle_id_REQUIRED");
  if (trimOrNull(projection.position_cycle_id) !== positionCycleId) {
    throw new Error("ENTRY_REPAIR_PROJECTION_CYCLE_MISMATCH");
  }

  if (decision.requires_repair !== true) {
    return Object.freeze({
      ok: true,
      enqueue_required: false,
      skip_reason: "PROTECTION_WRITE_HEALTHY",
      repair_requests: Object.freeze([]),
    });
  }

  if (isDryRunProtectionFailure({ slAck, tp1Ack, protectionWriteResult: result })) {
    return Object.freeze({
      ok: true,
      enqueue_required: false,
      skip_reason: "DRY_RUN_PROTECTION_ACK",
      repair_requests: Object.freeze([]),
    });
  }

  const issueCodes = normalizeIssueCodes(decision.placement_issue_codes && decision.placement_issue_codes.length
    ? decision.placement_issue_codes
    : runtime.placement_issue_codes);
  const repairRequests = [];
  for (const issueCode of issueCodes) {
    const requestedAction = resolveRepairAction(issueCode);
    if (!requestedAction) continue;
    repairRequests.push(buildRepairRequestDoc({
      positionCycleId,
      stage: projection.stage,
      issueCode,
      healthStatus: resolveRepairHealth(issueCode, decision.health_status || runtime.health_status),
      requestedAction,
      createdAt,
      detail: {
        requested_by_service: V2_SERVICES.ENTRY_EXECUTOR,
        source: "ENTRY_PROTECTION_ACTIVATION",
        runtime_write_reason: trimOrNull(decision.runtime_write_reason) || trimOrNull(runtime.runtime_write_reason),
        native_refresh_status: trimOrNull(decision.native_refresh_status) || trimOrNull(runtime.native_refresh_status),
        sl_order_id: trimOrNull(runtime.sl_order_id),
        sl_order_status: upper(runtime.sl_order_status),
        tp1_order_id: trimOrNull(runtime.tp1_order_id),
        tp1_order_status: upper(runtime.tp1_order_status),
        sl_error_code: trimOrNull(slAck && slAck.error_code),
        tp1_error_code: trimOrNull(tp1Ack && tp1Ack.error_code),
        sl_trigger_price: request.sl_trigger_price || null,
        tp1_trigger_price: request.tp1_trigger_price || null,
        tp1_qty_abs: request.tp1_qty_abs || projection.tp1_target_qty_abs || null,
        protection_runtime_id: trimOrNull(runtime.protection_runtime_id),
        placement_attempt_id: trimOrNull(runtime.placement_attempt_id),
        placement_retry_id: trimOrNull(runtime.placement_retry_id),
      },
    }));
  }

  return Object.freeze({
    ok: true,
    enqueue_required: repairRequests.length > 0,
    skip_reason: repairRequests.length > 0 ? null : "NO_REPAIRABLE_ISSUE_CODE",
    repair_requests: Object.freeze(repairRequests),
  });
}

module.exports = {
  buildEntryProtectionRepairRequests,
  __test: {
    trimOrNull,
    upper,
    normalizeIssueCodes,
    isDryRunAck,
    isDryRunProtectionFailure,
    resolveRepairAction,
    resolveRepairHealth,
  },
};
