"use strict";

const crypto = require("crypto");
const { getFirestore } = require("./firestore");
const { buildUnifiedEventDoc } = require("./unifiedEventTimeline");

function nowIso() {
  return new Date().toISOString();
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function safeClone(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function buildFillEventId({
  fillId,
  mutationType,
  tsMs,
  deterministicKey = null,
} = {}) {
  if (deterministicKey) {
    return crypto.createHash("sha1").update(String(deterministicKey), "utf8").digest("hex");
  }
  const base = [
    String(fillId || "UNKNOWN"),
    upper(mutationType) || "MUTATION",
    Number.isFinite(Number(tsMs)) ? Number(tsMs) : Date.now(),
    crypto.randomBytes(6).toString("hex"),
  ].join("|");
  return crypto.createHash("sha1").update(base, "utf8").digest("hex");
}

function resolveUnifiedFillEventKind(mutationType) {
  const type = upper(mutationType) || "UPSERT";
  if (type === "EXTERNAL_INSERT" || type === "EXTERNAL_MERGE") return "EXCHANGE_ACK";
  if (type === "MARK_UNVERIFIED") return "FILL_AUDIT";
  return "FILL_MUTATION";
}

function buildFillEventDoc({
  fillId,
  mutationType,
  exchange = null,
  symbol = null,
  traceId = null,
  requestId = null,
  runId = null,
  createdAt = null,
  before = null,
  after = null,
  extra = null,
  deterministicKey = null,
} = {}) {
  const tsMs = Date.parse(String(createdAt || "")) || Date.now();
  return {
    fill_event_id: buildFillEventId({
      fillId,
      mutationType,
      tsMs,
      deterministicKey,
    }),
    fill_id: String(fillId || "").trim() || null,
    mutation_type: upper(mutationType),
    created_at: createdAt || nowIso(),
    ts_ms: tsMs,
    exchange: upper(exchange),
    symbol: upper(symbol),
    trace_id: String(traceId || "").trim() || null,
    request_id: String(requestId || "").trim() || null,
    run_id: String(runId || "").trim() || null,
    before: safeClone(before),
    after: safeClone(after),
    extra: safeClone(extra),
  };
}

function buildFillEventUnifiedDoc(doc = {}) {
  return buildUnifiedEventDoc({
    eventKind: resolveUnifiedFillEventKind(doc.mutation_type),
    eventSource: "FILL_EVENTS",
    sourceDocumentId: doc.fill_event_id,
    exchange: doc.exchange,
    symbol: doc.symbol,
    event: doc.mutation_type,
    traceId: doc.trace_id || null,
    requestId: doc.request_id || null,
    runId: doc.run_id || null,
    fillId: doc.fill_id || null,
    tsMs: doc.ts_ms,
    createdAt: doc.created_at,
    payload: {
      mutation_type: doc.mutation_type,
      extra: safeClone(doc.extra),
      classification_verified: doc.after && doc.after.classification_verified === false ? false : true,
    },
    raw: doc,
  });
}

async function recordFillEvent({
  fillId,
  mutationType,
  exchange = null,
  symbol = null,
  traceId = null,
  requestId = null,
  runId = null,
  createdAt = null,
  before = null,
  after = null,
  extra = null,
  deterministicKey = null,
} = {}) {
  const db = getFirestore();
  const doc = buildFillEventDoc({
    fillId,
    mutationType,
    exchange,
    symbol,
    traceId,
    requestId,
    runId,
    createdAt,
    before,
    after,
    extra,
    deterministicKey,
  });
  await db.collection("fill_events").doc(doc.fill_event_id).set(doc, { merge: false });
  try {
    const unifiedDoc = buildFillEventUnifiedDoc(doc);
    await db.collection("unified_event_timeline").doc(unifiedDoc.unified_event_id).set(unifiedDoc, { merge: false });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn("[UNIFIED_TIMELINE_FILL_EVENT_FAIL]", msg);
  }
  return doc;
}

module.exports = {
  recordFillEvent,
  __test: {
    buildFillEventId,
    buildFillEventDoc,
    buildFillEventUnifiedDoc,
    resolveUnifiedFillEventKind,
  },
};
