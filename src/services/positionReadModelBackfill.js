"use strict";

const { getFirestore } = require("../storage/firestore");
const { upsertLatestPositionReadModel } = require("../storage/positionReadModelLatest");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function reduceLatestPositionEvents(rows = []) {
  const latestByKey = {};
  mergeLatestPositionEvents(latestByKey, rows);
  return Object.values(latestByKey);
}

function mergeLatestPositionEvents(latestByKey = {}, rows = []) {
  const target = latestByKey && typeof latestByKey === "object" ? latestByKey : {};
  for (const row of Array.isArray(rows) ? rows : []) {
    const exchange = upper(row.exchange);
    const symbol = upper(row.symbol);
    if (!exchange || !symbol) continue;
    const key = `${exchange}::${symbol}`;
    const prev = target[key];
    const nextTs = Number(row.sequence_ms ?? row.ts_ms);
    const prevTs = Number(prev && (prev.sequence_ms ?? prev.ts_ms));
    if (!Number.isFinite(nextTs)) continue;
    if (!prev || !Number.isFinite(prevTs) || nextTs > prevTs) {
      target[key] = row;
    }
  }
  return target;
}

function safeClone(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function toTimeMs(value) {
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(String(value || ""));
  return Number.isFinite(parsed) ? parsed : null;
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

function buildBootstrapLatestRow(position = null) {
  if (!position || typeof position !== "object") return null;
  const exchange = upper(position.exchange);
  const symbol = upper(position.symbol || position.symbol_or_pair_id);
  if (!exchange || !symbol) return null;
  const updatedAt = String(position.updated_at || position.created_at || "").trim() || null;
  const sequenceMs = toTimeMs(updatedAt) || 0;
  const posId = String(position.pos_id || position.id || "").trim() || `${exchange}__${symbol}`;
  return {
    event_id: `BOOTSTRAP__${posId}`,
    exchange,
    symbol,
    sequence_ms: sequenceMs,
    created_at: updatedAt || new Date(sequenceMs || Date.now()).toISOString(),
    mutation_kind: "POSITION_SNAPSHOT_BOOTSTRAP",
    source: "POSITIONS_PAPER_BOOTSTRAP",
    after_summary: summarizeSnapshot(position),
    after_snapshot: safeClone(position),
  };
}

async function mergeBootstrapPositionSnapshots({
  db,
  exchange = null,
  latestByKey = {},
} = {}) {
  const target = latestByKey && typeof latestByKey === "object" ? latestByKey : {};
  let query = db.collection("positions_paper");
  if (upper(exchange)) query = query.where("exchange", "==", upper(exchange));
  const snap = await query.get();
  let bootstrapped = 0;
  snap.forEach((doc) => {
    const row = buildBootstrapLatestRow({ id: doc.id, ...(doc.data() || {}) });
    if (!row) return;
    const key = `${row.exchange}::${row.symbol}`;
    if (target[key]) return;
    target[key] = row;
    bootstrapped += 1;
  });
  return bootstrapped;
}

async function backfillLatestPositionReadModel({
  exchange = null,
  pageSize = 1000,
  maxDocs = 0,
  dryRun = false,
} = {}) {
  const db = getFirestore();
  const latestByKey = {};
  const normalizedExchange = upper(exchange);
  const normalizedPageSize = Math.max(1, Math.trunc(Number(pageSize) || 1000));
  const normalizedMaxDocs = Math.max(0, Math.trunc(Number(maxDocs) || 0));
  let scanned = 0;
  let pages = 0;
  let cursor = null;

  while (true) {
    const remaining = normalizedMaxDocs > 0 ? Math.max(0, normalizedMaxDocs - scanned) : normalizedPageSize;
    if (normalizedMaxDocs > 0 && remaining <= 0) break;

    let query = db.collection("position_events");
    if (normalizedExchange) query = query.where("exchange", "==", normalizedExchange);
    query = query.orderBy("sequence_ms", "desc")
      .limit(Math.max(1, Math.min(normalizedPageSize, remaining || normalizedPageSize)));
    if (cursor) query = query.startAfter(cursor);

    const snap = await query.get();
    if (snap.empty) break;

    const rows = snap.docs.map((doc) => doc.data() || {});
    mergeLatestPositionEvents(latestByKey, rows);
    scanned += rows.length;
    pages += 1;
    cursor = snap.docs[snap.docs.length - 1];
    if (snap.docs.length < normalizedPageSize) break;
  }

  const latestRows = Object.values(latestByKey);
  const bootstrapped = await mergeBootstrapPositionSnapshots({
    db,
    exchange: normalizedExchange,
    latestByKey,
  });
  const resolvedLatestRows = Object.values(latestByKey);
  let written = 0;
  if (dryRun !== true) {
    for (const row of resolvedLatestRows) {
      await upsertLatestPositionReadModel({
        exchange: row.exchange,
        symbol: row.symbol,
        tsMs: row.sequence_ms,
        createdAt: row.created_at,
        positionEventId: row.event_id,
        traceId: row.trace_id,
        requestId: row.request_id,
        runId: row.run_id,
        mutationKind: row.mutation_kind,
        source: row.source,
        afterSummary: row.after_summary,
        afterSnapshot: row.after_snapshot,
      });
      written += 1;
    }
  }
  return {
    ok: true,
    exchange: normalizedExchange,
    scanned,
    pages,
    latest_rows: resolvedLatestRows.length,
    bootstrap_rows: bootstrapped,
    written,
    dry_run: dryRun === true,
  };
}

module.exports = {
  backfillLatestPositionReadModel,
  __test: {
    reduceLatestPositionEvents,
    mergeLatestPositionEvents,
    summarizeSnapshot,
    buildBootstrapLatestRow,
  },
};
