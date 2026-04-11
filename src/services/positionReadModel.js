"use strict";

const { getFirestore } = require("../storage/firestore");
const { getPosition } = require("../storage/positionsPaper");
const { getLatestPositionReadModel, listLatestPositionReadModelsByExchange } = require("../storage/positionReadModelLatest");
const { fetchUnifiedEventTimeline } = require("../storage/unifiedEventTimeline");

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

function pickLatestPositionMutationRow(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => upper(row.event_kind || row.kind) === "POSITION_MUTATION")
    .slice()
    .sort((a, b) => Number(b.ts_ms || 0) - Number(a.ts_ms || 0))[0] || null;
}

function buildPositionReadView({ storedPosition = null, latestTimelineRow = null } = {}) {
  const base = storedPosition && typeof storedPosition === "object" ? safeClone(storedPosition) : null;
  const latest = latestTimelineRow && typeof latestTimelineRow === "object" ? latestTimelineRow : null;
  if (!latest) return base;
  const timelineSnapshot = latest.raw && latest.raw.after_snapshot && typeof latest.raw.after_snapshot === "object"
    ? safeClone(latest.raw.after_snapshot)
    : null;
  const timelineSummary = latest.payload && latest.payload.after_summary && typeof latest.payload.after_summary === "object"
    ? safeClone(latest.payload.after_summary)
    : null;
  if (!timelineSnapshot && !timelineSummary) return base;
  const baseUpdatedMs = toTimeMs(base && base.updated_at);
  const timelineUpdatedMs = Number.isFinite(Number(latest.ts_ms)) ? Number(latest.ts_ms) : toTimeMs(latest.created_at);
  if (Number.isFinite(baseUpdatedMs) && Number.isFinite(timelineUpdatedMs) && timelineUpdatedMs < baseUpdatedMs) {
    return base;
  }
  if (timelineSnapshot) {
    return {
      ...(base || {}),
      ...timelineSnapshot,
      read_model_source: "UNIFIED_EVENT_TIMELINE",
      read_model_event_ts_ms: timelineUpdatedMs,
    };
  }
  return {
    ...(base || {}),
    ...(timelineSummary || {}),
    read_model_source: "UNIFIED_EVENT_TIMELINE_SUMMARY",
    read_model_event_ts_ms: timelineUpdatedMs,
  };
}

function buildLatestTimelineRowFromIndex(doc = null) {
  if (!doc || typeof doc !== "object") return null;
  return {
    event_kind: "POSITION_MUTATION",
    ts_ms: Number.isFinite(Number(doc.ts_ms)) ? Number(doc.ts_ms) : null,
    created_at: doc.created_at || null,
    event: doc.mutation_kind || null,
    trace_id: doc.trace_id || null,
    request_id: doc.request_id || null,
    run_id: doc.run_id || null,
    source_document_id: doc.position_event_id || null,
    payload: {
      after_summary: safeClone(doc.after_summary),
    },
    raw: {
      after_snapshot: safeClone(doc.after_snapshot),
    },
  };
}

async function fetchLatestPositionMutationRowsByExchange({
  exchange,
  limit = 2000,
} = {}) {
  const rowsBySymbol = {};
  const latestDocs = await listLatestPositionReadModelsByExchange({
    exchange,
    limit,
  }).catch(() => []);
  for (const doc of latestDocs) {
    const symbol = upper(doc && doc.symbol);
    if (!symbol || rowsBySymbol[symbol]) continue;
    rowsBySymbol[symbol] = buildLatestTimelineRowFromIndex(doc);
  }
  return rowsBySymbol;
}

function buildPositionReadViews({
  positions = [],
  latestTimelineRowsBySymbol = {},
} = {}) {
  const rowsBySymbol = latestTimelineRowsBySymbol && typeof latestTimelineRowsBySymbol === "object"
    ? latestTimelineRowsBySymbol
    : {};
  return (Array.isArray(positions) ? positions : []).map((position) => {
    const storedPosition = position && typeof position === "object" ? safeClone(position) : null;
    const symbol = upper(storedPosition && (storedPosition.symbol || storedPosition.symbol_or_pair_id));
    return buildPositionReadView({
      storedPosition,
      latestTimelineRow: symbol ? rowsBySymbol[symbol] || null : null,
    });
  });
}

async function listPositionReadViews({
  exchange,
  positions = [],
  timelineLimit = 2000,
} = {}) {
  const enabled = String(process.env.POSITION_READ_MODEL_USE_UNIFIED_TIMELINE || "1").trim() !== "0";
  if (!enabled) return Array.isArray(positions) ? positions : [];
  const rowsBySymbol = await fetchLatestPositionMutationRowsByExchange({
    exchange,
    limit: timelineLimit,
  }).catch(() => ({}));
  return buildPositionReadViews({
    positions,
    latestTimelineRowsBySymbol: rowsBySymbol,
  });
}

async function listExchangePositionReadViews({
  exchange,
  limit = null,
} = {}) {
  const db = getFirestore();
  let query = db.collection("positions_paper")
    .where("exchange", "==", upper(exchange));
  if (Number.isFinite(Number(limit)) && Number(limit) > 0) {
    query = query.limit(Math.trunc(Number(limit)));
  }
  const snap = await query.get();
  const rawPositions = [];
  snap.forEach((doc) => {
    rawPositions.push({ id: doc.id, ...(doc.data() || {}) });
  });
  return listPositionReadViews({
    exchange,
    positions: rawPositions,
  });
}

async function getPositionReadView({
  exchange,
  symbol,
  fallbackPosition = null,
  timelineLimit = 30,
} = {}) {
  const storedPosition = fallbackPosition || await getPosition({ exchange, symbol });
  const enabled = String(process.env.POSITION_READ_MODEL_USE_UNIFIED_TIMELINE || "1").trim() !== "0";
  if (!enabled) return storedPosition;
  const latestDoc = await getLatestPositionReadModel({ exchange, symbol }).catch(() => null);
  if (latestDoc) {
    return buildPositionReadView({
      storedPosition,
      latestTimelineRow: buildLatestTimelineRowFromIndex(latestDoc),
    });
  }
  const rows = await fetchUnifiedEventTimeline({
    exchange,
    symbol,
    limit: Math.max(5, Math.trunc(Number(timelineLimit) || 30)),
  }).catch(() => []);
  return buildPositionReadView({
    storedPosition,
    latestTimelineRow: pickLatestPositionMutationRow(rows),
  });
}

module.exports = {
  getPositionReadView,
  listPositionReadViews,
  listExchangePositionReadViews,
  __test: {
    pickLatestPositionMutationRow,
    buildPositionReadView,
    buildPositionReadViews,
    buildLatestTimelineRowFromIndex,
  },
};
