"use strict";

const crypto = require("crypto");
const { getFirestore } = require("./firestore");

function nowIso() {
  return new Date().toISOString();
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toTimeMs(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function safeClone(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function buildUnifiedEventId({
  exchange,
  symbol,
  eventKind,
  eventSource,
  tsMs,
  traceId = null,
  entityId = null,
  sourceDocumentId = null,
} = {}) {
  const sourceDoc = String(sourceDocumentId || "").trim() || null;
  if (sourceDoc) {
    const base = [
      "SOURCE_DOC",
      upper(eventSource) || "SOURCE",
      sourceDoc,
    ].join("|");
    return crypto.createHash("sha1").update(base, "utf8").digest("hex");
  }
  const base = [
    upper(exchange) || "UNKNOWN",
    upper(symbol) || "UNKNOWN",
    upper(eventKind) || "EVENT",
    upper(eventSource) || "SOURCE",
    Number.isFinite(Number(tsMs)) ? Number(tsMs) : Date.now(),
    String(traceId || "").trim() || "TRACE",
    String(entityId || "").trim() || "ENTITY",
    crypto.randomBytes(6).toString("hex"),
  ].join("|");
  return crypto.createHash("sha1").update(base, "utf8").digest("hex");
}

async function recordUnifiedEvent({
  eventKind,
  eventSource,
  exchange,
  symbol,
  event = null,
  traceId = null,
  requestId = null,
  runId = null,
  signalId = null,
  intentId = null,
  fillId = null,
  positionEventId = null,
  sourceDocumentId = null,
  tsMs = null,
  createdAt = null,
  payload = null,
  raw = null,
  unifiedEventId = null,
} = {}) {
  const db = getFirestore();
  const resolvedTsMs = Number.isFinite(Number(tsMs))
    ? Number(tsMs)
    : (toTimeMs(createdAt) || Date.now());
  const resolvedCreatedAt = createdAt || nowIso();
  const entityId = intentId || fillId || positionEventId || signalId || null;
  const doc = {
    unified_event_id: buildUnifiedEventId({
      exchange,
      symbol,
      eventKind,
      eventSource,
      tsMs: resolvedTsMs,
      traceId,
      entityId,
      sourceDocumentId,
    }),
    created_at: resolvedCreatedAt,
    ts_ms: resolvedTsMs,
    exchange: upper(exchange),
    symbol: upper(symbol),
    event_kind: upper(eventKind),
    event_source: upper(eventSource),
    event: upper(event),
    trace_id: String(traceId || "").trim() || null,
    request_id: String(requestId || "").trim() || null,
    run_id: String(runId || "").trim() || null,
    signal_id: String(signalId || "").trim() || null,
    intent_id: String(intentId || "").trim() || null,
    fill_id: String(fillId || "").trim() || null,
    position_event_id: String(positionEventId || "").trim() || null,
    source_document_id: sourceDocumentId ? String(sourceDocumentId).trim() : null,
    payload: safeClone(payload),
    raw: safeClone(raw),
  };
  if (String(unifiedEventId || "").trim()) doc.unified_event_id = String(unifiedEventId).trim();
  await db.collection("unified_event_timeline").doc(doc.unified_event_id).set(doc, { merge: false });
  return doc;
}

async function fetchUnifiedEventTimeline({
  exchange,
  symbol,
  fromMs = null,
  toMs = null,
  limit = 500,
} = {}) {
  const db = getFirestore();
  let query = db.collection("unified_event_timeline")
    .where("exchange", "==", upper(exchange))
    .where("symbol", "==", upper(symbol))
    .orderBy("ts_ms", "asc")
    .limit(Math.max(1, Math.trunc(Number(limit) || 500)));
  if (Number.isFinite(Number(fromMs))) query = query.where("ts_ms", ">=", Number(fromMs));
  if (Number.isFinite(Number(toMs))) query = query.where("ts_ms", "<", Number(toMs));
  const snap = await query.get();
  return snap.docs.map((doc) => doc.data() || {});
}

module.exports = {
  recordUnifiedEvent,
  fetchUnifiedEventTimeline,
  __test: {
    buildUnifiedEventId,
    toTimeMs,
  },
};
