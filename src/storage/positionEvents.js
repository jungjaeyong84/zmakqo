"use strict";

const crypto = require("crypto");
const { getFirestore } = require("./firestore");
const { normalizeTraceContext } = require("../utils/traceContext");
const { buildUnifiedEventDoc } = require("./unifiedEventTimeline");
const { upsertLatestPositionReadModel, buildLatestPositionReadModelDoc } = require("./positionReadModelLatest");

function nowIso() {
  return new Date().toISOString();
}

function toOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeClone(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function summarizeSnapshot(snapshot = null) {
  if (!snapshot || typeof snapshot !== "object") return null;
  const meta = (snapshot.meta && typeof snapshot.meta === "object") ? snapshot.meta : {};
  return {
    state: snapshot.state || snapshot.position_state || null,
    position_state: snapshot.position_state || snapshot.state || null,
    position_side: snapshot.position_side || null,
    size_pct: Number.isFinite(Number(snapshot.size_pct)) ? Number(snapshot.size_pct) : null,
    qty_base: Number.isFinite(Number(snapshot.qty_base)) ? Number(snapshot.qty_base) : null,
    avg_price: Number.isFinite(Number(snapshot.avg_price)) ? Number(snapshot.avg_price) : null,
    tp_p0_done: meta.tp_p0_done === true,
    tp_p1_done: meta.tp_p1_done === true,
    trail_active: meta.trail_active === true,
    native_refresh_status: meta.native_protection_refresh_status || null,
  };
}

function buildPositionEventId({
  exchange,
  symbol,
  traceId,
  mutationKind,
  sequence,
  nonce = null,
} = {}) {
  const base = [
    String(exchange || "").toUpperCase(),
    String(symbol || "").toUpperCase(),
    String(traceId || ""),
    String(mutationKind || "").toUpperCase(),
    String(sequence || ""),
    String(nonce || ""),
  ].join("|");
  return crypto.createHash("sha1").update(base, "utf8").digest("hex");
}

async function recordPositionEvent({
  exchange,
  symbol,
  mutationKind,
  requestId = null,
  runId = null,
  traceId = null,
  source = null,
  reason = null,
  before = null,
  after = null,
  transition = null,
  extra = null,
} = {}) {
  const db = getFirestore();
  const bundle = buildPositionEventBundle({
    exchange,
    symbol,
    mutationKind,
    requestId,
    runId,
    traceId,
    source,
    reason,
    before,
    after,
    transition,
    extra,
  });
  const doc = bundle.eventDoc;
  await db.collection("position_events").doc(bundle.eventId).set(doc, { merge: false });
  try {
    await db.collection("unified_event_timeline")
      .doc(bundle.unifiedEventDoc.unified_event_id)
      .set(bundle.unifiedEventDoc, { merge: false });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn("[UNIFIED_TIMELINE_POSITION_FAIL]", msg);
  }
  try {
    await upsertLatestPositionReadModel({
      exchange: bundle.latestReadModelDoc.exchange,
      symbol: bundle.latestReadModelDoc.symbol,
      tsMs: bundle.latestReadModelDoc.ts_ms,
      createdAt: bundle.latestReadModelDoc.created_at,
      positionEventId: bundle.latestReadModelDoc.position_event_id,
      traceId: bundle.latestReadModelDoc.trace_id,
      requestId: bundle.latestReadModelDoc.request_id,
      runId: bundle.latestReadModelDoc.run_id,
      mutationKind: bundle.latestReadModelDoc.mutation_kind,
      source: bundle.latestReadModelDoc.source,
      afterSummary: bundle.latestReadModelDoc.after_summary,
      afterSnapshot: bundle.latestReadModelDoc.after_snapshot,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn("[POSITION_READ_MODEL_LATEST_FAIL]", msg);
  }
  return doc;
}

function buildPositionEventBundle({
  exchange,
  symbol,
  mutationKind,
  requestId = null,
  runId = null,
  traceId = null,
  source = null,
  reason = null,
  before = null,
  after = null,
  transition = null,
  extra = null,
  sequence = null,
  createdAt = null,
  nonce = null,
} = {}) {
  const trace = normalizeTraceContext({
    traceId,
    requestId,
    runId,
    exchange,
    symbol,
    mutationKind,
    source,
  });
  const sequenceMs = toOptionalNumber(sequence);
  const resolvedSequence = sequenceMs != null ? sequenceMs : Date.now();
  const resolvedNonce = String(nonce || "").trim() || crypto.randomBytes(6).toString("hex");
  const id = buildPositionEventId({
    exchange,
    symbol,
    traceId: trace.trace_id,
    mutationKind,
    sequence: resolvedSequence,
    nonce: resolvedNonce,
  });
  const eventDoc = {
    event_id: id,
    created_at: createdAt || nowIso(),
    sequence_ms: resolvedSequence,
    exchange: trace.exchange,
    symbol: trace.symbol,
    mutation_kind: trace.mutation_kind,
    trace_id: trace.trace_id,
    request_id: trace.request_id,
    run_id: trace.run_id,
    source: trace.source,
    reason: reason ? String(reason).trim().toUpperCase() : null,
    before_summary: summarizeSnapshot(before),
    after_summary: summarizeSnapshot(after),
    before_snapshot: safeClone(before),
    after_snapshot: safeClone(after),
    transition: safeClone(transition),
    extra: safeClone(extra),
  };
  const unifiedEventDoc = buildUnifiedEventDoc({
    eventKind: "POSITION_MUTATION",
    eventSource: "POSITION_EVENTS",
    sourceDocumentId: id,
    exchange: trace.exchange,
    symbol: trace.symbol,
    event: trace.mutation_kind,
    traceId: trace.trace_id,
    requestId: trace.request_id,
    runId: trace.run_id,
    positionEventId: id,
    tsMs: resolvedSequence,
    createdAt: eventDoc.created_at,
    payload: {
      reason: eventDoc.reason || null,
      before_summary: safeClone(eventDoc.before_summary),
      after_summary: safeClone(eventDoc.after_summary),
      transition: safeClone(eventDoc.transition),
    },
    raw: eventDoc,
  });
  const latestReadModelDoc = buildLatestPositionReadModelDoc({
    exchange: trace.exchange,
    symbol: trace.symbol,
    tsMs: resolvedSequence,
    createdAt: eventDoc.created_at,
    positionEventId: id,
    traceId: trace.trace_id,
    requestId: trace.request_id,
    runId: trace.run_id,
    mutationKind: trace.mutation_kind,
    source: trace.source,
    afterSummary: eventDoc.after_summary,
    afterSnapshot: eventDoc.after_snapshot,
  });
  return {
    trace,
    sequence: resolvedSequence,
    nonce: resolvedNonce,
    eventId: id,
    eventDoc,
    unifiedEventDoc,
    latestReadModelDoc,
  };
}

async function fetchPositionEvents({
  exchange,
  symbol,
  fromMs = null,
  toMs = null,
  limit = 500,
} = {}) {
  const db = getFirestore();
  const resolvedExchange = String(exchange || "").toUpperCase();
  const resolvedSymbol = String(symbol || "").toUpperCase();
  const resolvedLimit = Math.max(1, Math.trunc(Number(limit) || 500));
  const resolvedFromMs = toOptionalNumber(fromMs);
  const resolvedToMs = toOptionalNumber(toMs);
  try {
    let query = db.collection("position_events")
      .where("exchange", "==", resolvedExchange)
      .where("symbol", "==", resolvedSymbol)
      .orderBy("sequence_ms", "asc")
      .limit(resolvedLimit);
    if (resolvedFromMs != null) query = query.where("sequence_ms", ">=", resolvedFromMs);
    if (resolvedToMs != null) query = query.where("sequence_ms", "<", resolvedToMs);
    const snap = await query.get();
    const rows = snap.docs.map((doc) => doc.data() || {});
    if (rows.length > 0) return rows;
  } catch (_) {}
  const fallbackSnap = await db.collection("position_events").get();
  return fallbackSnap.docs
    .map((doc) => doc.data() || {})
    .filter((row) => row.exchange === resolvedExchange && row.symbol === resolvedSymbol)
    .filter((row) => {
      const seq = toOptionalNumber(row.sequence_ms);
      if (resolvedFromMs != null && (seq == null || seq < resolvedFromMs)) return false;
      if (resolvedToMs != null && (seq == null || seq >= resolvedToMs)) return false;
      return true;
    })
    .sort((a, b) => Number(toOptionalNumber(a.sequence_ms) || 0) - Number(toOptionalNumber(b.sequence_ms) || 0))
    .slice(0, resolvedLimit);
}

module.exports = {
  recordPositionEvent,
  fetchPositionEvents,
  __test: {
    summarizeSnapshot,
    buildPositionEventId,
    buildPositionEventBundle,
  },
};
