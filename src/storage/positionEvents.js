"use strict";

const crypto = require("crypto");
const { getFirestore } = require("./firestore");
const { normalizeTraceContext } = require("../utils/traceContext");
const { recordUnifiedEvent } = require("./unifiedEventTimeline");
const { upsertLatestPositionReadModel } = require("./positionReadModelLatest");

function nowIso() {
  return new Date().toISOString();
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
  const trace = normalizeTraceContext({
    traceId,
    requestId,
    runId,
    exchange,
    symbol,
    mutationKind,
    source,
  });
  const sequence = Date.now();
  const nonce = crypto.randomBytes(6).toString("hex");
  const id = buildPositionEventId({
    exchange,
    symbol,
    traceId: trace.trace_id,
    mutationKind,
    sequence,
    nonce,
  });
  const doc = {
    event_id: id,
    created_at: nowIso(),
    sequence_ms: sequence,
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
  await db.collection("position_events").doc(id).set(doc, { merge: false });
  try {
    await recordUnifiedEvent({
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
      tsMs: sequence,
      createdAt: doc.created_at,
      payload: {
        reason: doc.reason || null,
        before_summary: safeClone(doc.before_summary),
        after_summary: safeClone(doc.after_summary),
        transition: safeClone(doc.transition),
      },
      raw: doc,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn("[UNIFIED_TIMELINE_POSITION_FAIL]", msg);
  }
  try {
    await upsertLatestPositionReadModel({
      exchange: trace.exchange,
      symbol: trace.symbol,
      tsMs: sequence,
      createdAt: doc.created_at,
      positionEventId: id,
      traceId: trace.trace_id,
      requestId: trace.request_id,
      runId: trace.run_id,
      mutationKind: trace.mutation_kind,
      source: trace.source,
      afterSummary: doc.after_summary,
      afterSnapshot: doc.after_snapshot,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn("[POSITION_READ_MODEL_LATEST_FAIL]", msg);
  }
  return doc;
}

async function fetchPositionEvents({
  exchange,
  symbol,
  fromMs = null,
  toMs = null,
  limit = 500,
} = {}) {
  const db = getFirestore();
  let query = db.collection("position_events")
    .where("exchange", "==", String(exchange || "").toUpperCase())
    .where("symbol", "==", String(symbol || "").toUpperCase())
    .orderBy("sequence_ms", "asc")
    .limit(Math.max(1, Math.trunc(Number(limit) || 500)));
  if (Number.isFinite(Number(fromMs))) query = query.where("sequence_ms", ">=", Number(fromMs));
  if (Number.isFinite(Number(toMs))) query = query.where("sequence_ms", "<", Number(toMs));
  const snap = await query.get();
  return snap.docs.map((doc) => doc.data() || {});
}

module.exports = {
  recordPositionEvent,
  fetchPositionEvents,
  __test: {
    summarizeSnapshot,
    buildPositionEventId,
  },
};
