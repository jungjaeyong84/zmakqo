"use strict";

const CANCELED_LIKE_INTENT_STATUSES = new Set([
  "CANCELED",
  "REJECTED_PROVIDER",
  "TIMEOUT_PROVIDER",
  "FAILED_INTERNAL",
]);

function normalizeIntentStatus(value) {
  const normalized = String(value || "").trim().toUpperCase();
  return normalized || null;
}

function isIntentCanceledLikeStatus(value) {
  const status = normalizeIntentStatus(value);
  return !!(status && CANCELED_LIKE_INTENT_STATUSES.has(status));
}

function resolveIntentStatusFamily(value) {
  const status = normalizeIntentStatus(value);
  if (!status) return null;
  if (isIntentCanceledLikeStatus(status)) return "CANCELED";
  return status;
}

function isProviderTimeoutReason(value) {
  const reason = normalizeIntentStatus(value);
  if (!reason) return false;
  return reason.includes("TIMEOUT") || reason.includes("TIMED_OUT");
}

function isProviderRejectedReason(value) {
  const reason = normalizeIntentStatus(value);
  if (!reason || isProviderTimeoutReason(reason)) return false;
  if (reason.endsWith("_SET_FAILED")) return true;
  if (reason.endsWith("_REJECTED")) return true;
  if (reason.includes("REJECT")) return true;
  if (reason === "HEDGE_MODE_ON") return true;
  if (reason === "MARKET_CLOSED") return true;
  if (reason === "LIQUIDATION_RISK") return true;
  if (reason === "TP_PARTIAL_PLACE_FAIL") return true;
  if (reason === "POSITION_CONTEXT_FETCH_FAIL") return true;
  if (reason === "CANCEL_OPEN_ORDERS_FAIL") return true;
  if (reason === "NATIVE_CANCEL_FAIL") return true;
  if (reason === "NATIVE_PLACE_FAIL") return true;
  // 2026-04-18 P1-2: cancel-succeeded + place-failed leaves the position
  // naked on the exchange. Treat as provider-rejected so the alert/retry
  // paths fire — this is strictly more urgent than NATIVE_PLACE_FAIL.
  if (reason === "UNPROTECTED_ACTIVE_POSITION") return true;
  return false;
}

function isInternalFailureReason(value) {
  const reason = normalizeIntentStatus(value);
  if (!reason) return false;
  if (reason.startsWith("LIVE_")) return true;
  if (reason.endsWith("_KEYS_MISSING")) return true;
  if (reason === "RISK_BUDGET_DISABLED") return true;
  if (reason === "BAD_PRICE") return true;
  if (reason === "BAD_QTY") return true;
  if (reason === "BAD_FILL_PRICE") return true;
  if (reason === "ORDER_TOO_SMALL") return true;
  if (reason === "POSITION_TOO_SMALL") return true;
  if (reason === "MIN_ORDER_EXCEEDS_BUDGET") return true;
  if (reason === "NO_POSITION") return true;
  if (reason === "POSITION_FULL") return true;
  if (reason === "TOTAL_BUDGET_EXCEEDED") return true;
  if (reason === "UNKNOWN_DIRECTION") return true;
  if (reason === "POSITION_SIDE_CONFLICT") return true;
  if (reason === "POSITION_SIDE_MISMATCH") return true;
  if (reason === "UNKNOWN_INTENT") return true;
  if (reason === "NATIVE_PROTECTION_RUNTIME_FAIL") return true;
  if (reason.startsWith("EXIT_WORKER_")) return true;
  return false;
}

function classifyIntentTerminalStatus(status, patch = {}) {
  const requestedStatus = normalizeIntentStatus(status);
  if (!requestedStatus) {
    return {
      status: null,
      statusFamily: null,
      terminalFailureStatus: null,
    };
  }
  if (requestedStatus !== "CANCELED") {
    return {
      status: requestedStatus,
      statusFamily: resolveIntentStatusFamily(requestedStatus),
      terminalFailureStatus: null,
    };
  }

  const reason = normalizeIntentStatus(
    patch.cancel_reason || patch.status_reason || patch.reason || null
  );

  let nextStatus = "CANCELED";
  if (isProviderTimeoutReason(reason)) nextStatus = "TIMEOUT_PROVIDER";
  else if (isProviderRejectedReason(reason)) nextStatus = "REJECTED_PROVIDER";
  else if (isInternalFailureReason(reason)) nextStatus = "FAILED_INTERNAL";

  return {
    status: nextStatus,
    statusFamily: "CANCELED",
    terminalFailureStatus: nextStatus !== "CANCELED" ? nextStatus : null,
  };
}

module.exports = {
  CANCELED_LIKE_INTENT_STATUSES,
  normalizeIntentStatus,
  isIntentCanceledLikeStatus,
  resolveIntentStatusFamily,
  isProviderTimeoutReason,
  isProviderRejectedReason,
  isInternalFailureReason,
  classifyIntentTerminalStatus,
};
