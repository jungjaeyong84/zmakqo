"use strict";

const { getFirestore } = require("../../src/storage/firestore");

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FETCH_LIMIT = 1500;

function toMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const ms = Date.parse(raw);
  return Number.isFinite(ms) ? ms : null;
}

function normalizeOperationalReason(raw) {
  const reason = String(raw || "").trim().toUpperCase();
  if (!reason) return null;
  if (reason.includes("KEYS_MISSING")) return reason;
  if (reason.includes("TIMEOUT")) return reason;
  if (reason.includes("EXCEPTION")) return reason;
  if (reason.includes("FAILED")) return reason;
  if (reason.includes("ERROR")) return reason;
  if (reason.includes("UNAVAILABLE")) return reason;
  return null;
}

function upsertFamily(map, family, { source, at, symbol, reason } = {}) {
  const key = String(family || "").trim().toUpperCase();
  if (!key) return;
  const item = map.get(key) || {
    family: key,
    count: 0,
    latest_at: null,
    sources: new Set(),
    symbols: new Set(),
    sample_reason: null,
  };
  item.count += 1;
  if (source) item.sources.add(String(source));
  if (symbol) item.symbols.add(String(symbol).toUpperCase());
  if (!item.sample_reason && reason) item.sample_reason = String(reason);
  if (at) {
    const atMs = toMs(at);
    const prevMs = toMs(item.latest_at);
    if (Number.isFinite(atMs) && (!Number.isFinite(prevMs) || atMs >= prevMs)) {
      item.latest_at = at;
    }
  }
  map.set(key, item);
}

function finalizeFamilies(map) {
  return Array.from(map.values())
    .map((item) => ({
      family: item.family,
      count: item.count,
      latest_at: item.latest_at,
      sources: Array.from(item.sources).sort(),
      symbols: Array.from(item.symbols).sort(),
      sample_reason: item.sample_reason,
    }))
    .sort((a, b) => {
      if (b.count !== a.count) return b.count - a.count;
      return String(a.family).localeCompare(String(b.family));
    });
}

function summarizeRuntimeErrorFamilies({
  intentCancels = [],
  droppedSignals = [],
  gateEvents = [],
  aiRuns = [],
} = {}) {
  const families = new Map();

  for (const row of intentCancels || []) {
    const family = normalizeOperationalReason(row && (row.cancel_reason || row.status_reason || row.reason));
    if (!family) continue;
    upsertFamily(families, family, {
      source: "order_intents_paper",
      at: row.updated_at || row.created_at || null,
      symbol: row.symbol_or_pair_id || row.symbol || null,
      reason: row.cancel_reason || row.status_reason || row.reason || null,
    });
  }

  for (const row of droppedSignals || []) {
    const family = normalizeOperationalReason(row && (row.reason || row.drop_reason_code));
    if (!family) continue;
    upsertFamily(families, family, {
      source: "signals_dropped",
      at: row.created_at || null,
      symbol: row.symbol_or_pair_id || row.symbol || null,
      reason: row.reason || row.drop_reason_code || null,
    });
  }

  for (const row of gateEvents || []) {
    const reasonCodes = Array.isArray(row && row.reason_codes) ? row.reason_codes : [];
    const operationalCodes = reasonCodes.map(normalizeOperationalReason).filter(Boolean);
    if (operationalCodes.length) {
      for (const family of operationalCodes) {
        upsertFamily(families, family, {
          source: "gate_events",
          at: row.created_at || null,
          symbol: row.market || row.symbol || null,
          reason: family,
        });
      }
      continue;
    }
    const status = String(row && row.status || "").toUpperCase();
    const severity = String(row && row.severity || "").toUpperCase();
    if (status === "FAIL" && (severity === "HARD" || severity === "HIGH")) {
      upsertFamily(families, "GATE_HARD_FAIL", {
        source: "gate_events",
        at: row.created_at || null,
        symbol: row.market || row.symbol || null,
        reason: `${status}/${severity}`,
      });
    }
  }

  for (const row of aiRuns || []) {
    const createdAt = row && row.created_at ? row.created_at : null;
    if (row && row.news_ok === false) {
      upsertFamily(families, "AI_NEWS_FETCH_FAILED", {
        source: "ai_allocation_runs",
        at: createdAt,
        reason: row.news_reason || null,
      });
    }
    if (row && row.gpt_attempted === true && row.gpt_ok === false) {
      upsertFamily(families, "AI_GPT_FAILED", {
        source: "ai_allocation_runs",
        at: createdAt,
        reason: row.gpt_error || null,
      });
    }
    if (row && row.claude_attempted === true && row.claude_ok === false) {
      upsertFamily(families, "AI_CLAUDE_FAILED", {
        source: "ai_allocation_runs",
        at: createdAt,
        reason: row.claude_error || null,
      });
    }
    if (row && row.applied === true && row.live_ok === false) {
      upsertFamily(families, "AI_LIVE_APPLY_FAILED", {
        source: "ai_allocation_runs",
        at: createdAt,
        reason: row.live_reason || null,
      });
    }
  }

  const finalized = finalizeFamilies(families);
  return {
    error_count_24h: finalized.length,
    error_occurrence_count_24h: finalized.reduce((acc, item) => acc + Number(item.count || 0), 0),
    error_families_24h: finalized,
  };
}

async function fetchRecentDocs({ collection, orderByField, limit = DEFAULT_FETCH_LIMIT, sinceMs }) {
  const db = getFirestore();
  const snap = await db.collection(collection).orderBy(orderByField, "desc").limit(limit).get();
  const out = [];
  snap.forEach((doc) => {
    const row = doc.data() || {};
    const ms = toMs(row.updated_at || row.created_at || row.started_at || row.ended_at || "");
    if (Number.isFinite(sinceMs) && Number.isFinite(ms) && ms < sinceMs) return;
    out.push({ ...row, __id: doc.id });
  });
  return out;
}

async function fetchRuntimeErrorSummary24h({
  windowMs = DEFAULT_WINDOW_MS,
  fetchLimit = DEFAULT_FETCH_LIMIT,
} = {}) {
  const sinceMs = Date.now() - Math.max(60 * 60 * 1000, Number(windowMs) || DEFAULT_WINDOW_MS);
  const [intentRows, dropRows, gateRows, aiRows] = await Promise.all([
    fetchRecentDocs({ collection: "order_intents_paper", orderByField: "updated_at", limit: fetchLimit, sinceMs }),
    fetchRecentDocs({ collection: "signals_dropped", orderByField: "created_at", limit: fetchLimit, sinceMs }),
    fetchRecentDocs({ collection: "gate_events", orderByField: "created_at", limit: fetchLimit, sinceMs }),
    fetchRecentDocs({ collection: "ai_allocation_runs", orderByField: "created_at", limit: Math.min(fetchLimit, 200), sinceMs }),
  ]);

  const intentCancels = intentRows.filter((row) => String(row.status || "").toUpperCase() === "CANCELED");
  const summary = summarizeRuntimeErrorFamilies({
    intentCancels,
    droppedSignals: dropRows,
    gateEvents: gateRows,
    aiRuns: aiRows,
  });

  return {
    ok: true,
    source: "FIRESTORE_RUNTIME_24H",
    window_ms: windowMs,
    since_iso: new Date(sinceMs).toISOString(),
    ...summary,
  };
}

module.exports = {
  normalizeOperationalReason,
  summarizeRuntimeErrorFamilies,
  fetchRuntimeErrorSummary24h,
};
