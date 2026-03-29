"use strict";

function toMsSafe(v) {
  if (v == null) return null;
  const n = Number(v);
  if (Number.isFinite(n)) return n;
  const ms = Date.parse(String(v));
  return Number.isFinite(ms) ? ms : null;
}

function isPendingIntentExpired(intent, refMs = Date.now()) {
  const status = String(intent && intent.status || "").toUpperCase();
  if (status !== "PENDING") return false;
  const expMs = toMsSafe(intent && (intent.expires_at_ms ?? intent.expires_at));
  return Number.isFinite(expMs) && expMs <= refMs;
}

function resolveIntentStatusForView(intent, refMs = Date.now()) {
  const status = String(intent && intent.status || "").toUpperCase();
  if (!status) return null;
  if (isPendingIntentExpired(intent, refMs)) return "CANCELED";
  return status;
}

function isActivePendingIntent(intent, refMs = Date.now()) {
  return resolveIntentStatusForView(intent, refMs) === "PENDING";
}

module.exports = {
  toMsSafe,
  isPendingIntentExpired,
  resolveIntentStatusForView,
  isActivePendingIntent,
};
