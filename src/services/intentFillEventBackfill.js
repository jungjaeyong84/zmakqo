"use strict";

const { getFirestore } = require("../storage/firestore");
const { __test: orderIntentEventsTest } = require("../storage/orderIntentEvents");
const { __test: fillEventsTest } = require("../storage/fillEvents");

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

function normalizeTsMs(value, fallbackIso = null) {
  const ms = Date.parse(String(value || fallbackIso || ""));
  return Number.isFinite(ms) ? ms : Date.now();
}

function mapIntentDocToEvent(doc = {}) {
  const intentId = String(doc.intent_id || "").trim() || null;
  const createdAt = doc.updated_at || doc.created_at || nowIso();
  const tsMs = normalizeTsMs(createdAt, nowIso());
  return {
    intent_event_id: orderIntentEventsTest.buildOrderIntentEventId({
      intentId,
      mutationType: "BOOTSTRAP_SNAPSHOT",
      deterministicKey: `BOOTSTRAP_SNAPSHOT|${intentId || "UNKNOWN"}`,
      tsMs,
    }),
    intent_id: intentId,
    mutation_type: "BOOTSTRAP_SNAPSHOT",
    created_at: createdAt,
    ts_ms: tsMs,
    exchange: upper(doc.exchange),
    symbol: upper(doc.symbol_or_pair_id || doc.symbol),
    trace_id: String(doc.trace_id || "").trim() || null,
    request_id: String(doc.request_id || "").trim() || null,
    run_id: String(doc.run_id || "").trim() || null,
    before: null,
    after: safeClone(doc),
    extra: {
      backfill: true,
      source_collection: "order_intents_paper",
    },
  };
}

function mapFillDocToEvent(doc = {}) {
  const fillId = String(doc.fill_id || "").trim() || null;
  const createdAt = doc.updated_at || doc.created_at || nowIso();
  const tsMs = normalizeTsMs(createdAt, nowIso());
  return {
    fill_event_id: fillEventsTest.buildFillEventId({
      fillId,
      mutationType: "BOOTSTRAP_SNAPSHOT",
      deterministicKey: `BOOTSTRAP_SNAPSHOT|${fillId || "UNKNOWN"}`,
      tsMs,
    }),
    fill_id: fillId,
    mutation_type: "BOOTSTRAP_SNAPSHOT",
    created_at: createdAt,
    ts_ms: tsMs,
    exchange: upper(doc.exchange),
    symbol: upper(doc.symbol || doc.symbol_or_pair_id),
    trace_id: String(doc.trace_id || doc.idempotency_key || "").trim() || null,
    request_id: String(doc.request_id || "").trim() || null,
    run_id: String(doc.run_id || "").trim() || null,
    before: null,
    after: safeClone(doc),
    extra: {
      backfill: true,
      source_collection: "fills_paper",
    },
  };
}

async function backfillCollection({
  sourceCollection,
  targetCollection,
  mapDoc,
  idField,
  pageSize = 200,
  maxDocs = Infinity,
  dryRun = false,
} = {}) {
  const db = getFirestore();
  let lastDoc = null;
  let scanned = 0;
  let written = 0;

  while (scanned < maxDocs) {
    let query = db.collection(sourceCollection).orderBy("__name__").limit(Math.max(1, Number(pageSize) || 200));
    if (lastDoc) query = query.startAfter(lastDoc);
    const snap = await query.get();
    if (snap.empty) break;

    for (const docSnap of snap.docs) {
      lastDoc = docSnap;
      scanned += 1;
      const mapped = mapDoc(docSnap.data() || {});
      if (!mapped || !mapped[idField]) continue;
      if (dryRun !== true) {
        await db.collection(targetCollection).doc(mapped[idField]).set(mapped, { merge: false });
      }
      written += 1;
      if (scanned >= maxDocs) break;
    }
  }

  return { sourceCollection, targetCollection, scanned, written, dry_run: dryRun === true };
}

async function runIntentFillEventBackfill({
  pageSize = 200,
  maxDocsPerCollection = Infinity,
  dryRun = false,
} = {}) {
  const limit = Number.isFinite(Number(maxDocsPerCollection))
    ? Math.max(0, Number(maxDocsPerCollection))
    : Infinity;
  const results = [];
  results.push(await backfillCollection({
    sourceCollection: "order_intents_paper",
    targetCollection: "order_intent_events",
    mapDoc: mapIntentDocToEvent,
    idField: "intent_event_id",
    pageSize,
    maxDocs: limit,
    dryRun,
  }));
  results.push(await backfillCollection({
    sourceCollection: "fills_paper",
    targetCollection: "fill_events",
    mapDoc: mapFillDocToEvent,
    idField: "fill_event_id",
    pageSize,
    maxDocs: limit,
    dryRun,
  }));
  return {
    ok: true,
    dry_run: dryRun === true,
    results,
    scanned_total: results.reduce((sum, row) => sum + Number(row.scanned || 0), 0),
    written_total: results.reduce((sum, row) => sum + Number(row.written || 0), 0),
  };
}

module.exports = {
  runIntentFillEventBackfill,
  __test: {
    mapIntentDocToEvent,
    mapFillDocToEvent,
  },
};
