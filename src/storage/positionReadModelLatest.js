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

function buildPositionReadModelLatestId(exchange, symbol) {
  return `POSITION_READ_MODEL_LATEST__${upper(exchange) || "UNKNOWN"}__${upper(symbol) || "UNKNOWN"}`;
}

function shouldReplaceLatestPositionReadModel(previous = null, next = null) {
  const prevTs = Number(previous && previous.ts_ms);
  const nextTs = Number(next && next.ts_ms);
  if (!Number.isFinite(nextTs)) return false;
  if (!Number.isFinite(prevTs)) return true;
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
  const candidate = {
    read_model_id: docId,
    exchange: upper(exchange),
    symbol: upper(symbol),
    ts_ms: Number.isFinite(Number(tsMs)) ? Number(tsMs) : null,
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
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const previous = snap.exists ? (snap.data() || null) : null;
    if (!shouldReplaceLatestPositionReadModel(previous, candidate)) return;
    tx.set(ref, candidate, { merge: false });
  });
  return candidate;
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
  upsertLatestPositionReadModel,
  getLatestPositionReadModel,
  listLatestPositionReadModelsByExchange,
  listLatestPositionReadModelsBySymbols,
  __test: {
    buildPositionReadModelLatestId,
    shouldReplaceLatestPositionReadModel,
  },
};
