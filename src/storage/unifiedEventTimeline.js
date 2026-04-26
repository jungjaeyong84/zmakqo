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
  if (value === null || value === undefined || value === "") return null;
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function boundedPositiveInt(value, fallback, { min = 1, max = 5000 } = {}) {
  const n = Math.trunc(Number(value));
  const base = Number.isFinite(n) && n > 0 ? n : fallback;
  return Math.max(min, Math.min(max, Math.trunc(Number(base) || fallback || min)));
}

function resolveTimelineFetchLimit(limit) {
  const hardMax = boundedPositiveInt(process.env.UNIFIED_EVENT_TIMELINE_FETCH_MAX_LIMIT, 5000, {
    min: 100,
    max: 20000,
  });
  return boundedPositiveInt(limit, 500, {
    min: 1,
    max: hardMax,
  });
}

function resolveTimelineFallbackScanLimit(limit) {
  const hardMax = boundedPositiveInt(process.env.UNIFIED_EVENT_TIMELINE_FALLBACK_SCAN_LIMIT, 1500, {
    min: 100,
    max: 10000,
  });
  return boundedPositiveInt((Number(limit) || 500) * 3, hardMax, {
    min: 1,
    max: hardMax,
  });
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
    toTimeMs(tsMs) != null ? toTimeMs(tsMs) : Date.now(),
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
  const doc = buildUnifiedEventDoc({
    eventKind,
    eventSource,
    exchange,
    symbol,
    event,
    traceId,
    requestId,
    runId,
    signalId,
    intentId,
    fillId,
    positionEventId,
    sourceDocumentId,
    tsMs,
    createdAt,
    payload,
    raw,
    unifiedEventId,
  });
  await db.collection("unified_event_timeline").doc(doc.unified_event_id).set(doc, { merge: false });
  return doc;
}

function buildUnifiedEventDoc({
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
  const normalizedTsMs = toTimeMs(tsMs);
  const resolvedTsMs = normalizedTsMs != null
    ? normalizedTsMs
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
  return doc;
}

async function fetchUnifiedEventTimeline({
  exchange,
  symbol,
  fromMs = null,
  toMs = null,
  limit = 500,
  db = null,
} = {}) {
  const store = db || getFirestore();
  const resolvedExchange = upper(exchange);
  const resolvedSymbol = upper(symbol);
  const resolvedLimit = resolveTimelineFetchLimit(limit);
  const resolvedFromMs = toTimeMs(fromMs);
  const resolvedToMs = toTimeMs(toMs);
  try {
    let query = store.collection("unified_event_timeline")
      .where("exchange", "==", resolvedExchange)
      .where("symbol", "==", resolvedSymbol)
      .orderBy("ts_ms", "asc")
      .limit(resolvedLimit);
    if (resolvedFromMs != null) query = query.where("ts_ms", ">=", resolvedFromMs);
    if (resolvedToMs != null) query = query.where("ts_ms", "<", resolvedToMs);
    const snap = await query.get();
    const rows = snap.docs.map((doc) => doc.data() || {});
    return rows;
  } catch (_) {}

  // Fail bounded: never full-scan this collection from Cloud Run. A missing
  // composite index should degrade to a small recent scan, not heap exhaustion.
  const fallbackLimit = resolveTimelineFallbackScanLimit(resolvedLimit);
  let fallbackSnap = null;
  try {
    fallbackSnap = await store.collection("unified_event_timeline")
      .orderBy("ts_ms", "desc")
      .limit(fallbackLimit)
      .get();
  } catch (_) {
    return [];
  }
  return fallbackSnap.docs
    .map((doc) => doc.data() || {})
    .filter((row) => row.exchange === resolvedExchange && row.symbol === resolvedSymbol)
    .filter((row) => {
      const ts = toTimeMs(row.ts_ms);
      if (resolvedFromMs != null && (ts == null || ts < resolvedFromMs)) return false;
      if (resolvedToMs != null && (ts == null || ts >= resolvedToMs)) return false;
      return true;
    })
    .sort((a, b) => Number(toTimeMs(a.ts_ms) || 0) - Number(toTimeMs(b.ts_ms) || 0))
    .slice(0, resolvedLimit);
}

module.exports = {
  buildUnifiedEventDoc,
  recordUnifiedEvent,
  fetchUnifiedEventTimeline,
  __test: {
    buildUnifiedEventId,
    buildUnifiedEventDoc,
    toTimeMs,
    resolveTimelineFetchLimit,
    resolveTimelineFallbackScanLimit,
  },
};
