"use strict";

const crypto = require("crypto");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function nowIso() {
  return new Date().toISOString();
}

function pickNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickText(value) {
  const s = String(value || "").trim();
  return s || null;
}

function buildIdempotencyKey({
  requestId = null,
  runId = null,
  signalId = null,
  intentId = null,
  event = null,
  exchange = null,
  symbol = null,
  tf = null,
  barCloseMs = null,
} = {}) {
  const base = [
    pickText(requestId),
    pickText(runId),
    pickText(signalId),
    pickText(intentId),
    upper(event),
    upper(exchange),
    upper(symbol),
    pickText(tf),
    pickNumber(barCloseMs),
  ].map((v) => (v == null ? "-" : String(v))).join("|");
  return crypto.createHash("sha1").update(base, "utf8").digest("hex");
}

function buildEventEnvelope({
  requestId = null,
  runId = null,
  signalId = null,
  intentId = null,
  event = null,
  exchange = null,
  symbol = null,
  tf = null,
  decisionReason = null,
  action = null,
  intent = null,
  executionMode = null,
  source = null,
  barCloseMs = null,
  createdAt = null,
  schemaVersion = "EVENT_ENVELOPE_V2",
  reasonFamily = null,
  authority = null,
  idempotencyKey = null,
} = {}) {
  const resolvedIdempotencyKey = pickText(idempotencyKey) || buildIdempotencyKey({
    requestId,
    runId,
    signalId,
    intentId,
    event,
    exchange,
    symbol,
    tf,
    barCloseMs,
  });
  return {
    schema_version: pickText(schemaVersion) || "EVENT_ENVELOPE_V2",
    request_id: requestId || null,
    run_id: runId || null,
    signal_id: signalId || null,
    intent_id: intentId || null,
    event: upper(event),
    ts: createdAt || nowIso(),
    exchange: upper(exchange),
    symbol: upper(symbol),
    tf: tf || null,
    decision_reason: upper(decisionReason),
    action: upper(action),
    intent: upper(intent),
    execution_mode: upper(executionMode),
    source: upper(source),
    reason_family: upper(reasonFamily),
    authority: upper(authority),
    idempotency_key: resolvedIdempotencyKey,
    bar_close_time_utc_ms: pickNumber(barCloseMs),
  };
}

module.exports = {
  buildEventEnvelope,
};
