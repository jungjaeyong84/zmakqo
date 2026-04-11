"use strict";

const { getFirestore } = require("../storage/firestore");
const { buildUnifiedEventId } = require("../storage/unifiedEventTimeline").__test;
const { resolveUnifiedFillEventKind } = require("../storage/fillEvents").__test;

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

function buildUnifiedEventDoc(params = {}) {
  const {
    eventKind,
    eventSource,
    sourceDocumentId,
    exchange,
    symbol,
    event,
    traceId = null,
    requestId = null,
    runId = null,
    signalId = null,
    intentId = null,
    fillId = null,
    positionEventId = null,
    createdAt = null,
    tsMs = null,
    payload = null,
    raw = null,
  } = params;
  const resolvedTsMs = Number.isFinite(Number(tsMs)) ? Number(tsMs) : (toTimeMs(createdAt) || Date.now());
  const unifiedEventId = buildUnifiedEventId({
    exchange,
    symbol,
    eventKind,
    eventSource,
    tsMs: resolvedTsMs,
    traceId,
    entityId: intentId || fillId || positionEventId || signalId || null,
    sourceDocumentId,
  });
  return {
    unified_event_id: unifiedEventId,
    created_at: createdAt || new Date(resolvedTsMs).toISOString(),
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
    source_document_id: String(sourceDocumentId || "").trim() || null,
    payload: safeClone(payload),
    raw: safeClone(raw),
  };
}

function mapActionHookToUnifiedDoc(docId, row = {}) {
  return buildUnifiedEventDoc({
    eventKind: "DECISION",
    eventSource: "ACTION_HOOK_LEDGER",
    sourceDocumentId: docId,
    exchange: row.exchange,
    symbol: row.symbol,
    event: row.event,
    traceId: row.idempotency_key || row.trace_id || null,
    requestId: row.request_id || null,
    runId: row.run_id || null,
    signalId: row.signal_id || null,
    intentId: row.intent_id || null,
    createdAt: row.created_at || null,
    payload: {
      hook: row.hook || null,
      policy_stage: row.policy_stage || null,
      policy_reason: row.policy_reason || null,
      qty_pct_final: Number.isFinite(Number(row.qty_pct_final)) ? Number(row.qty_pct_final) : null,
      action: row.action || null,
      intent: row.intent || null,
    },
    raw: row,
  });
}

function mapIntentToUnifiedDoc(docId, row = {}) {
  const sourceDocumentId = row.intent_id || docId;
  return buildUnifiedEventDoc({
    eventKind: "INTENT",
    eventSource: "ORDER_INTENTS_PAPER",
    sourceDocumentId,
    exchange: row.exchange,
    symbol: row.symbol_or_pair_id || row.symbol,
    event: row.event,
    traceId: row.trace_id || null,
    requestId: row.request_id || null,
    runId: row.run_id || null,
    signalId: row.signal_id || null,
    intentId: row.intent_id || null,
    createdAt: row.created_at || row.updated_at || null,
    payload: {
      status: row.status || null,
      side: row.side || null,
      event_intent: row.event_intent || null,
      qty_pct: Number.isFinite(Number(row.qty_pct)) ? Number(row.qty_pct) : null,
      decision_reason: row.decision_reason || null,
    },
    raw: row,
  });
}

function mapFillToUnifiedDoc(docId, row = {}) {
  const sourceDocumentId = row.fill_id || docId;
  return buildUnifiedEventDoc({
    eventKind: "FILL",
    eventSource: "FILLS_PAPER_BACKFILL",
    sourceDocumentId,
    exchange: row.exchange,
    symbol: row.symbol || row.symbol_or_pair_id,
    event: row.event,
    traceId: row.trace_id || row.idempotency_key || null,
    requestId: row.request_id || null,
    runId: row.run_id || null,
    signalId: row.signal_id || null,
    intentId: row.intent_id || null,
    fillId: row.fill_id || null,
    createdAt: row.created_at || row.updated_at || null,
    payload: {
      side: row.side || null,
      qty_pct: Number.isFinite(Number(row.qty_pct)) ? Number(row.qty_pct) : null,
      qty_fraction: Number.isFinite(Number(row.qty_fraction)) ? Number(row.qty_fraction) : null,
      exec_price: Number.isFinite(Number(row.exec_price)) ? Number(row.exec_price) : null,
      decision_reason: row.decision_reason || null,
      classification_verified: row.classification_verified !== false,
    },
    raw: row,
  });
}

function mapPositionEventToUnifiedDoc(docId, row = {}) {
  const sourceDocumentId = row.event_id || docId;
  return buildUnifiedEventDoc({
    eventKind: "POSITION_MUTATION",
    eventSource: "POSITION_EVENTS",
    sourceDocumentId,
    exchange: row.exchange,
    symbol: row.symbol,
    event: row.mutation_kind,
    traceId: row.trace_id || null,
    requestId: row.request_id || null,
    runId: row.run_id || null,
    positionEventId: row.event_id || null,
    createdAt: row.created_at || null,
    tsMs: Number.isFinite(Number(row.sequence_ms)) ? Number(row.sequence_ms) : null,
    payload: {
      reason: row.reason || null,
      before_summary: safeClone(row.before_summary),
      after_summary: safeClone(row.after_summary),
      transition: safeClone(row.transition),
    },
    raw: row,
  });
}

function mapOrderIntentEventToUnifiedDoc(docId, row = {}) {
  const sourceDocumentId = row.intent_event_id || docId;
  return buildUnifiedEventDoc({
    eventKind: "INTENT_MUTATION",
    eventSource: "ORDER_INTENT_EVENTS",
    sourceDocumentId,
    exchange: row.exchange,
    symbol: row.symbol,
    event: row.mutation_type,
    traceId: row.trace_id || null,
    requestId: row.request_id || null,
    runId: row.run_id || null,
    intentId: row.intent_id || null,
    createdAt: row.created_at || null,
    tsMs: Number.isFinite(Number(row.ts_ms)) ? Number(row.ts_ms) : null,
    payload: {
      mutation_type: row.mutation_type || null,
      extra: safeClone(row.extra),
      after_status: row.after && row.after.status ? row.after.status : null,
    },
    raw: row,
  });
}

function mapFillEventToUnifiedDoc(docId, row = {}) {
  const sourceDocumentId = row.fill_event_id || docId;
  return buildUnifiedEventDoc({
    eventKind: resolveUnifiedFillEventKind(row.mutation_type),
    eventSource: "FILL_EVENTS",
    sourceDocumentId,
    exchange: row.exchange,
    symbol: row.symbol,
    event: row.mutation_type,
    traceId: row.trace_id || null,
    requestId: row.request_id || null,
    runId: row.run_id || null,
    fillId: row.fill_id || null,
    createdAt: row.created_at || null,
    tsMs: Number.isFinite(Number(row.ts_ms)) ? Number(row.ts_ms) : null,
    payload: {
      mutation_type: row.mutation_type || null,
      extra: safeClone(row.extra),
      classification_verified: row.after && row.after.classification_verified === false ? false : true,
    },
    raw: row,
  });
}

const BACKFILL_SPECS = Object.freeze([
  {
    name: "action_hook_ledger",
    orderField: "created_at",
    mapper: mapActionHookToUnifiedDoc,
  },
  {
    name: "order_intents_paper",
    orderField: "created_at",
    mapper: mapIntentToUnifiedDoc,
  },
  {
    name: "fills_paper",
    orderField: "created_at",
    mapper: mapFillToUnifiedDoc,
  },
  {
    name: "position_events",
    orderField: "sequence_ms",
    mapper: mapPositionEventToUnifiedDoc,
  },
  {
    name: "order_intent_events",
    orderField: "ts_ms",
    mapper: mapOrderIntentEventToUnifiedDoc,
  },
  {
    name: "fill_events",
    orderField: "ts_ms",
    mapper: mapFillEventToUnifiedDoc,
  },
]);

async function backfillCollection({
  collection,
  orderField,
  mapper,
  pageSize = 200,
  maxDocs = null,
  dryRun = false,
} = {}) {
  const db = getFirestore();
  let lastDoc = null;
  let scanned = 0;
  let written = 0;
  while (true) {
    let query = db.collection(collection)
      .orderBy(orderField, "asc")
      .limit(Math.max(1, Math.min(400, Math.trunc(Number(pageSize) || 200))));
    if (lastDoc) query = query.startAfter(lastDoc);
    const snap = await query.get();
    if (snap.empty) break;
    const batch = dryRun ? null : db.batch();
    for (const doc of snap.docs) {
      const row = doc.data() || {};
      const unifiedDoc = mapper(doc.id, row);
      scanned += 1;
      if (!dryRun) {
        const ref = db.collection("unified_event_timeline").doc(unifiedDoc.unified_event_id);
        batch.set(ref, unifiedDoc, { merge: false });
      }
      written += 1;
      if (Number.isFinite(Number(maxDocs)) && scanned >= Number(maxDocs)) break;
    }
    if (!dryRun) await batch.commit();
    lastDoc = snap.docs[snap.docs.length - 1];
    if (Number.isFinite(Number(maxDocs)) && scanned >= Number(maxDocs)) break;
  }
  return {
    ok: true,
    collection,
    scanned,
    written,
    dry_run: dryRun === true,
  };
}

async function runUnifiedEventTimelineBackfill({
  pageSize = null,
  maxDocsPerCollection = null,
  dryRun = false,
} = {}) {
  const pageSizeValue = Math.max(20, Math.min(400, Number(pageSize || process.env.UNIFIED_EVENT_BACKFILL_PAGE_SIZE || 200)));
  const maxDocsValue = Number.isFinite(Number(maxDocsPerCollection || process.env.UNIFIED_EVENT_BACKFILL_MAX_DOCS_PER_COLLECTION))
    ? Number(maxDocsPerCollection || process.env.UNIFIED_EVENT_BACKFILL_MAX_DOCS_PER_COLLECTION)
    : null;
  const results = [];
  for (const spec of BACKFILL_SPECS) {
    // eslint-disable-next-line no-await-in-loop
    const result = await backfillCollection({
      collection: spec.name,
      orderField: spec.orderField,
      mapper: spec.mapper,
      pageSize: pageSizeValue,
      maxDocs: maxDocsValue,
      dryRun,
    });
    results.push(result);
  }
  return {
    ok: results.every((row) => row.ok === true),
    dry_run: dryRun === true,
    page_size: pageSizeValue,
    max_docs_per_collection: maxDocsValue,
    results,
    total_scanned: results.reduce((sum, row) => sum + Number(row.scanned || 0), 0),
    total_written: results.reduce((sum, row) => sum + Number(row.written || 0), 0),
  };
}

module.exports = {
  runUnifiedEventTimelineBackfill,
  __test: {
    buildUnifiedEventDoc,
    mapActionHookToUnifiedDoc,
    mapIntentToUnifiedDoc,
    mapFillToUnifiedDoc,
    mapPositionEventToUnifiedDoc,
    mapOrderIntentEventToUnifiedDoc,
    mapFillEventToUnifiedDoc,
  },
};
