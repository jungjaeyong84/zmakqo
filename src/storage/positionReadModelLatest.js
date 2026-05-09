"use strict";

const { getFirestore } = require("./firestore");

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

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildPositionReadModelLatestId(exchange, symbol) {
  return `POSITION_READ_MODEL_LATEST__${upper(exchange) || "UNKNOWN"}__${upper(symbol) || "UNKNOWN"}`;
}

function extractAfterSnapshot(doc = null) {
  return doc && typeof doc.after_snapshot === "object" && doc.after_snapshot
    ? doc.after_snapshot
    : {};
}

function extractAfterSummary(doc = null) {
  return doc && typeof doc.after_summary === "object" && doc.after_summary
    ? doc.after_summary
    : {};
}

function extractMeta(doc = null) {
  const snapshot = extractAfterSnapshot(doc);
  return snapshot && typeof snapshot.meta === "object" && snapshot.meta
    ? snapshot.meta
    : {};
}

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function extractState(doc = null) {
  const summary = extractAfterSummary(doc);
  const snapshot = extractAfterSnapshot(doc);
  return upper(
    summary.state
    || summary.position_state
    || snapshot.state
    || snapshot.position_state
  );
}

function hasProtectedEntryMarkers(doc = null) {
  const meta = extractMeta(doc);
  return meta.v2_protected_entry_read_model === true
    || trimOrNull(meta.protection_runtime_id) != null
    || trimOrNull(meta.position_cycle_id) != null
    || trimOrNull(meta.native_protection_stop_order_id) != null
    || trimOrNull(meta.native_protection_tp_order_id) != null;
}

function isProtectedActiveLatest(doc = null) {
  if (extractState(doc) !== "ACTIVE") return false;
  return upper(doc && doc.mutation_kind) === "V2_PROTECTED_ENTRY_ACTIVATED"
    || upper(doc && doc.source) === "V2_PRODUCTION_ENTRY"
    || hasProtectedEntryMarkers(doc);
}

function isWeakObservationalFlat(doc = null) {
  if (extractState(doc) !== "FLAT") return false;
  const source = upper(doc && doc.source);
  const mutationKind = upper(doc && doc.mutation_kind);
  if (source === "BAR_LOOP_OBSERVATION") return true;
  if (source === "INTENT_FILL" && mutationKind === "POSITION_META_UPSERT") return true;
  return false;
}

function isAuthoritativeFlatConfirmation(doc = null) {
  if (extractState(doc) !== "FLAT") return false;
  const source = upper(doc && doc.source);
  return source === "BINANCE_FUTURES_POSITION_SYNC"
    || source === "BINANCE_TICK_EXIT"
    || source === "ACTIVE_POSITION_EXIT_RUNTIME_REPAIR"
    || source === "BINANCE_ACTIVE_EXIT_WATCHDOG"
    || source === "FILL_SYNC_RECONCILE"
    || source === "BINANCE_NATIVE_PROTECTION_REFRESH";
}

function isProtectedActiveRegression(previous = null, next = null) {
  if (!isProtectedActiveLatest(previous)) return false;
  if (!isWeakObservationalFlat(next)) return false;
  if (isAuthoritativeFlatConfirmation(next)) return false;
  return true;
}

function shouldReplaceLatestPositionReadModel(previous = null, next = null) {
  const prevTs = Number(previous && previous.ts_ms);
  const nextTs = Number(next && next.ts_ms);
  if (!Number.isFinite(nextTs)) return false;
  if (!Number.isFinite(prevTs)) return true;
  if (isProtectedActiveRegression(previous, next)) return false;
  if (nextTs > prevTs) return true;
  if (nextTs < prevTs) return false;
  const prevCreatedAt = Date.parse(String(previous && previous.created_at || ""));
  const nextCreatedAt = Date.parse(String(next && next.created_at || ""));
  if (Number.isFinite(nextCreatedAt) && Number.isFinite(prevCreatedAt)) {
    return nextCreatedAt >= prevCreatedAt;
  }
  return true;
}

async function upsertLatestPositionReadModel({
  exchange,
  symbol,
  tsMs,
  createdAt = null,
  positionEventId = null,
  traceId = null,
  requestId = null,
  runId = null,
  mutationKind = null,
  source = null,
  afterSummary = null,
  afterSnapshot = null,
} = {}) {
  const db = getFirestore();
  const docId = buildPositionReadModelLatestId(exchange, symbol);
  const ref = db.collection("position_read_model_latest").doc(docId);
  const candidate = buildLatestPositionReadModelDoc({
    exchange,
    symbol,
    tsMs,
    createdAt,
    positionEventId,
    traceId,
    requestId,
    runId,
    mutationKind,
    source,
    afterSummary,
    afterSnapshot,
  });
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const previous = snap.exists ? (snap.data() || null) : null;
    if (!shouldReplaceLatestPositionReadModel(previous, candidate)) return;
    tx.set(ref, candidate, { merge: false });
  });
  return candidate;
}

function buildLatestPositionReadModelDoc({
  exchange,
  symbol,
  tsMs,
  createdAt = null,
  positionEventId = null,
  traceId = null,
  requestId = null,
  runId = null,
  mutationKind = null,
  source = null,
  afterSummary = null,
  afterSnapshot = null,
} = {}) {
  const docId = buildPositionReadModelLatestId(exchange, symbol);
  return {
    read_model_id: docId,
    exchange: upper(exchange),
    symbol: upper(symbol),
    ts_ms: toOptionalNumber(tsMs),
    created_at: createdAt || new Date().toISOString(),
    position_event_id: String(positionEventId || "").trim() || null,
    trace_id: String(traceId || "").trim() || null,
    request_id: String(requestId || "").trim() || null,
    run_id: String(runId || "").trim() || null,
    mutation_kind: upper(mutationKind),
    source: upper(source),
    after_summary: safeClone(afterSummary),
    after_snapshot: safeClone(afterSnapshot),
  };
}

async function getLatestPositionReadModel({ exchange, symbol } = {}) {
  const db = getFirestore();
  const snap = await db.collection("position_read_model_latest")
    .doc(buildPositionReadModelLatestId(exchange, symbol))
    .get();
  return snap.exists ? (snap.data() || null) : null;
}

async function listLatestPositionReadModelsByExchange({
  exchange,
  limit = 2000,
} = {}) {
  const db = getFirestore();
  const snap = await db.collection("position_read_model_latest")
    .where("exchange", "==", upper(exchange))
    .orderBy("ts_ms", "desc")
    .limit(Math.max(50, Math.trunc(Number(limit) || 2000)))
    .get();
  return snap.docs.map((doc) => doc.data() || {});
}

async function listLatestPositionReadModelsBySymbols({
  exchange,
  symbols = [],
} = {}) {
  const db = getFirestore();
  const out = [];
  const seen = new Set();
  const uniqueSymbols = (Array.isArray(symbols) ? symbols : [])
    .map((symbol) => upper(symbol))
    .filter((symbol) => symbol && !seen.has(symbol) && seen.add(symbol));
  const docs = await Promise.all(uniqueSymbols.map((symbol) =>
    db.collection("position_read_model_latest")
      .doc(buildPositionReadModelLatestId(exchange, symbol))
      .get()
      .catch(() => null)
  ));
  for (const snap of docs) {
    if (!snap || !snap.exists) continue;
    out.push(snap.data() || {});
  }
  return out;
}

module.exports = {
  buildLatestPositionReadModelDoc,
  upsertLatestPositionReadModel,
  getLatestPositionReadModel,
  listLatestPositionReadModelsByExchange,
  listLatestPositionReadModelsBySymbols,
  __test: {
    buildPositionReadModelLatestId,
    buildLatestPositionReadModelDoc,
    shouldReplaceLatestPositionReadModel,
    extractState,
    hasProtectedEntryMarkers,
    isProtectedActiveLatest,
    isWeakObservationalFlat,
    isAuthoritativeFlatConfirmation,
    isProtectedActiveRegression,
  },
};
