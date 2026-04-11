"use strict";

const crypto = require("crypto");
const { getFirestore } = require("./firestore");
const { recordUnifiedEvent } = require("./unifiedEventTimeline");

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

function buildOrderIntentEventId({
  intentId,
  mutationType,
  tsMs,
  deterministicKey = null,
} = {}) {
  if (deterministicKey) {
    return crypto.createHash("sha1").update(String(deterministicKey), "utf8").digest("hex");
  }
  const base = [
    String(intentId || "UNKNOWN"),
    upper(mutationType) || "MUTATION",
    Number.isFinite(Number(tsMs)) ? Number(tsMs) : Date.now(),
    crypto.randomBytes(6).toString("hex"),
  ].join("|");
  return crypto.createHash("sha1").update(base, "utf8").digest("hex");
}

async function recordOrderIntentEvent({
  intentId,
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
  const tsMs = Date.parse(String(createdAt || "")) || Date.now();
  const doc = {
    intent_event_id: buildOrderIntentEventId({
      intentId,
      mutationType,
      tsMs,
      deterministicKey,
    }),
    intent_id: String(intentId || "").trim() || null,
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
  await db.collection("order_intent_events").doc(doc.intent_event_id).set(doc, { merge: false });
  try {
    await recordUnifiedEvent({
      eventKind: "INTENT_MUTATION",
      eventSource: "ORDER_INTENT_EVENTS",
      sourceDocumentId: doc.intent_event_id,
      exchange: doc.exchange,
      symbol: doc.symbol,
      event: doc.mutation_type,
      traceId: doc.trace_id || null,
      requestId: doc.request_id || null,
      runId: doc.run_id || null,
      intentId: doc.intent_id || null,
      tsMs: doc.ts_ms,
      createdAt: doc.created_at,
      payload: {
        mutation_type: doc.mutation_type,
        extra: safeClone(doc.extra),
        after_status: doc.after && doc.after.status ? String(doc.after.status).trim().toUpperCase() : null,
      },
      raw: doc,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn("[UNIFIED_TIMELINE_INTENT_EVENT_FAIL]", msg);
  }
  return doc;
}

module.exports = {
  recordOrderIntentEvent,
  __test: {
    buildOrderIntentEventId,
  },
};
