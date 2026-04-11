"use strict";

const { getFirestore } = require("../storage/firestore");
const { getPosition } = require("../storage/positionsPaper");
const {
  getLatestPositionReadModel,
  listLatestPositionReadModelsByExchange,
  listLatestPositionReadModelsBySymbols,
} = require("../storage/positionReadModelLatest");
const { fetchUnifiedEventTimeline } = require("../storage/unifiedEventTimeline");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toTimeMs(value) {
  if (value === null || value === undefined || value === "") return null;
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

function boolEnv(name, fallback = false) {
  const raw = String(process.env[name] == null ? "" : process.env[name]).trim().toLowerCase();
  if (!raw) return fallback;
  if (["1", "true", "yes", "on"].includes(raw)) return true;
  if (["0", "false", "no", "off"].includes(raw)) return false;
  return fallback;
}

const POSITION_READ_MODEL_RAW_FALLBACK_ENABLED = boolEnv("POSITION_READ_MODEL_RAW_FALLBACK_ENABLED", false);
const POSITION_READ_MODEL_STRICT_LATEST_INDEX_ONLY = boolEnv("POSITION_READ_MODEL_STRICT_LATEST_INDEX_ONLY", false);

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
    ts_ms: toTimeMs(doc.ts_ms),
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
  const enabled = String(process.env.POSITION_READ_MODEL_USE_UNIFIED_TIMELINE || "1").trim() !== "0";
  const normalizedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.trunc(Number(limit))
    : 2000;
  if (enabled) {
    const latestDocs = await listLatestPositionReadModelsByExchange({
      exchange,
      limit: normalizedLimit,
    }).catch(() => []);
    if (latestDocs.length || POSITION_READ_MODEL_RAW_FALLBACK_ENABLED !== true || POSITION_READ_MODEL_STRICT_LATEST_INDEX_ONLY === true) {
      return latestDocs.map((doc) => buildPositionReadView({
        storedPosition: null,
        latestTimelineRow: buildLatestTimelineRowFromIndex(doc),
      }));
    }
  }

  const db = getFirestore();
  let query = db.collection("positions_paper").where("exchange", "==", upper(exchange));
  if (normalizedLimit > 0) query = query.limit(normalizedLimit);
  const snap = await query.get();
  const rawPositions = [];
  snap.forEach((doc) => {
    rawPositions.push({ id: doc.id, ...(doc.data() || {}) });
  });
  return listPositionReadViews({ exchange, positions: rawPositions });
}

async function getPositionReadViewsBySymbols({
  exchange,
  symbols = [],
} = {}) {
  const enabled = String(process.env.POSITION_READ_MODEL_USE_UNIFIED_TIMELINE || "1").trim() !== "0";
  const uniqueSymbols = [];
  const seen = new Set();
  for (const rawSymbol of (Array.isArray(symbols) ? symbols : [])) {
    const symbol = upper(rawSymbol);
    if (!symbol || seen.has(symbol)) continue;
    seen.add(symbol);
    uniqueSymbols.push(symbol);
  }
  if (!uniqueSymbols.length) return {};
  if (!enabled) {
    const rawPositions = await Promise.all(uniqueSymbols.map((symbol) => getPosition({ exchange, symbol }).catch(() => null)));
    return uniqueSymbols.reduce((acc, symbol, index) => {
      acc[symbol] = rawPositions[index] || null;
      return acc;
    }, {});
  }

  const latestDocs = await listLatestPositionReadModelsBySymbols({
    exchange,
    symbols: uniqueSymbols,
  }).catch(() => []);
  const latestBySymbol = new Map();
  for (const doc of latestDocs) {
    const symbol = upper(doc && doc.symbol);
    if (!symbol || latestBySymbol.has(symbol)) continue;
    latestBySymbol.set(symbol, doc);
  }

  const missingSymbols = uniqueSymbols.filter((symbol) => !latestBySymbol.has(symbol));
  const fallbackBySymbol = new Map();
  if (missingSymbols.length && POSITION_READ_MODEL_RAW_FALLBACK_ENABLED === true && POSITION_READ_MODEL_STRICT_LATEST_INDEX_ONLY !== true) {
    const rawPositions = await Promise.all(missingSymbols.map((symbol) => getPosition({ exchange, symbol }).catch(() => null)));
    missingSymbols.forEach((symbol, index) => {
      fallbackBySymbol.set(symbol, rawPositions[index] || null);
    });
  }

  return uniqueSymbols.reduce((acc, symbol) => {
    const latestDoc = latestBySymbol.get(symbol) || null;
    const fallback = fallbackBySymbol.get(symbol) || null;
    acc[symbol] = latestDoc
      ? buildPositionReadView({
        storedPosition: null,
        latestTimelineRow: buildLatestTimelineRowFromIndex(latestDoc),
      })
      : fallback;
    return acc;
  }, {});
}

async function getPositionReadView({
  exchange,
  symbol,
  fallbackPosition = null,
  timelineLimit = 30,
} = {}) {
  const enabled = String(process.env.POSITION_READ_MODEL_USE_UNIFIED_TIMELINE || "1").trim() !== "0";
  const storedPosition = fallbackPosition || null;
  if (!enabled) return storedPosition;
  const latestDoc = await getLatestPositionReadModel({ exchange, symbol }).catch(() => null);
  if (latestDoc) {
    return buildPositionReadView({
      storedPosition,
      latestTimelineRow: buildLatestTimelineRowFromIndex(latestDoc),
    });
  }
  if (POSITION_READ_MODEL_STRICT_LATEST_INDEX_ONLY === true) {
    return storedPosition || null;
  }
  const rawPosition = (storedPosition || POSITION_READ_MODEL_RAW_FALLBACK_ENABLED === true)
    ? (storedPosition || await getPosition({ exchange, symbol }))
    : null;
  const rows = await fetchUnifiedEventTimeline({
    exchange,
    symbol,
    limit: Math.max(5, Math.trunc(Number(timelineLimit) || 30)),
  }).catch(() => []);
  return buildPositionReadView({
    storedPosition: rawPosition,
    latestTimelineRow: pickLatestPositionMutationRow(rows),
  });
}

module.exports = {
  getPositionReadView,
  getPositionReadViewsBySymbols,
  listPositionReadViews,
  listExchangePositionReadViews,
  __test: {
    pickLatestPositionMutationRow,
    buildPositionReadView,
    buildPositionReadViews,
    buildLatestTimelineRowFromIndex,
    POSITION_READ_MODEL_STRICT_LATEST_INDEX_ONLY,
  },
};
