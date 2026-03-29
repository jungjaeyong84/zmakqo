"use strict";

function buildRouteErrorRef(prefix = "ROUTE") {
  return `${String(prefix || "ROUTE").toUpperCase()}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
}

function sanitizeRouteError(err, {
  defaultCode = "ROUTE_ERROR",
  defaultMessage = "잠시 후 다시 시도해 주세요.",
  defaultStatus = 500,
} = {}) {
  const rawStatus = Number(err && err.status);
  const rawCode = String((err && (err.publicCode || err.code)) || "").trim().toUpperCase();
  const rawMessage = String((err && err.publicMessage) || "").trim();
  return {
    status: Number.isFinite(rawStatus) && rawStatus >= 400 && rawStatus < 600 ? rawStatus : defaultStatus,
    code: rawCode || String(defaultCode || "ROUTE_ERROR").trim().toUpperCase(),
    userMessage: rawMessage || defaultMessage,
  };
}

function logRouteError(label, errorRef, err, extra = {}) {
  console.error(`[${String(label || "ROUTE_ERROR").toUpperCase()}]`, {
    error_ref: errorRef || null,
    ...((extra && typeof extra === "object") ? extra : {}),
    error: err && err.stack ? err.stack : (err && err.message ? err.message : String(err)),
  });
}

module.exports = {
  buildRouteErrorRef,
  sanitizeRouteError,
  logRouteError,
};
