"use strict";

const { getFirestore } = require("../../src/storage/firestore");
const { isIntentCanceledLikeStatus } = require("../../src/utils/intentStatus");

const DEFAULT_WINDOW_MS = 24 * 60 * 60 * 1000;
const DEFAULT_FETCH_LIMIT = 1500;
const ACTIVE_WINDOW_DEFAULT_MS = 24 * 60 * 60 * 1000;
const ACTIVE_WINDOW_TRANSIENT_INFRA_MS = 6 * 60 * 60 * 1000;
const ACTIVE_WINDOW_POSITION_WRITE_TOKEN_MISMATCH_SINGLE_MS = Math.max(
  15 * 60 * 1000,
  Number(process.env.RUNTIME_ERROR_ACTIVE_WINDOW_POSITION_WRITE_TOKEN_MISMATCH_SINGLE_MS || (90 * 60 * 1000))
);
const ACTIVE_WINDOW_POSITION_WRITE_TOKEN_MISMATCH_REPEAT_MS = Math.max(
  ACTIVE_WINDOW_POSITION_WRITE_TOKEN_MISMATCH_SINGLE_MS,
  Number(process.env.RUNTIME_ERROR_ACTIVE_WINDOW_POSITION_WRITE_TOKEN_MISMATCH_REPEAT_MS || (6 * 60 * 60 * 1000))
);
const ACTIVE_WINDOW_POSITION_WRITE_LEASE_MS = Math.max(
  15 * 60 * 1000,
  Number(process.env.RUNTIME_ERROR_ACTIVE_WINDOW_POSITION_WRITE_LEASE_MS || (60 * 60 * 1000))
);

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

function isNonRuntimeLiveReject(row = {}) {
  const reason = String(row.cancel_reason || row.status_reason || row.reason || "").trim().toUpperCase();
  if (reason !== "LIVE_EXCEPTION" && reason !== "LIVE_FAILED") return false;
  const note = String(row.cancel_note || row.last_error || "").trim().toUpperCase();
  if (!note) return false;
  if (note.includes("MARGIN IS INSUFFICIENT")) return true;
  if (note.includes("INSUFFICIENT MARGIN")) return true;
  if (note.includes('"CODE":-2019')) return true;
  if (note.includes("CODE=-2019")) return true;
  if (note.includes("REDUCEONLY ORDER IS REJECTED")) return true;
  if (note.includes('"CODE":-2022')) return true;
  if (note.includes("CODE=-2022")) return true;
  if (note.includes("NO_POSITION")) return true;
  if (note.includes("POSITION DOES NOT EXIST")) return true;
  return false;
}

function resolveIntentCancelOperationalFamily(row = {}) {
  if (isNonRuntimeLiveReject(row)) return null;
  return normalizeOperationalReason(row && (row.cancel_reason || row.status_reason || row.reason));
}

function normalizeOperationalDetail(value) {
  const detail = String(value || "").trim().toUpperCase();
  return detail || null;
}

function isRetryableInfraOperationalDetail(value) {
  const detail = normalizeOperationalDetail(value);
  if (!detail) return false;
  return (
    detail.includes("EGRESS_PROXY_TIMEOUT")
    || detail.includes("EGRESS_PROXY_FETCH_FAIL")
    || detail.includes("FETCH FAILED")
    || detail.includes("TIMEOUT")
    || detail.includes("UNAVAILABLE")
    || detail.includes("ECONNRESET")
    || detail.includes("ETIMEDOUT")
    || detail.includes("ENOTFOUND")
    || detail.includes("EAI_AGAIN")
  );
}

function resolveOperationalActiveWindowMs(item = {}) {
  const family = String(item.family || "").trim().toUpperCase();
  const detail = normalizeOperationalDetail(item.latest_detail || item.sample_detail || item.detail || "");
  const count = Number(item.count || 0);
  if (family === "POSITION_WRITE_TOKEN_MISMATCH") {
    return count >= 2
      ? ACTIVE_WINDOW_POSITION_WRITE_TOKEN_MISMATCH_REPEAT_MS
      : ACTIVE_WINDOW_POSITION_WRITE_TOKEN_MISMATCH_SINGLE_MS;
  }
  if (family === "POSITION_WRITE_LEASE_HELD" || family === "POSITION_WRITE_LEASE_LOST") {
    return ACTIVE_WINDOW_POSITION_WRITE_LEASE_MS;
  }
  if (family === "LEVERAGE_SET_FAILED") return ACTIVE_WINDOW_TRANSIENT_INFRA_MS;
  if ((family === "LIVE_EXCEPTION" || family === "LIVE_FAILED") && isRetryableInfraOperationalDetail(detail)) {
    return ACTIVE_WINDOW_TRANSIENT_INFRA_MS;
  }
  return ACTIVE_WINDOW_DEFAULT_MS;
}

function isOperationalFamilyActive(item = {}, nowMs = Date.now()) {
  const latestMs = toMs(item.latest_at);
  if (!Number.isFinite(latestMs)) return false;
  const windowMs = resolveOperationalActiveWindowMs(item);
  return (latestMs + Math.max(60 * 1000, Number(windowMs) || ACTIVE_WINDOW_DEFAULT_MS)) > nowMs;
}

function upsertFamily(map, family, { source, at, symbol, reason, detail } = {}) {
  const key = String(family || "").trim().toUpperCase();
  if (!key) return;
  const item = map.get(key) || {
    family: key,
    count: 0,
    latest_at: null,
    sources: new Set(),
    symbols: new Set(),
    sample_reason: null,
    sample_detail: null,
    latest_detail: null,
  };
  item.count += 1;
  if (source) item.sources.add(String(source));
  if (symbol) item.symbols.add(String(symbol).toUpperCase());
  if (!item.sample_reason && reason) item.sample_reason = String(reason);
  if (!item.sample_detail && detail) item.sample_detail = String(detail);
  if (at) {
    const atMs = toMs(at);
    const prevMs = toMs(item.latest_at);
    if (Number.isFinite(atMs) && (!Number.isFinite(prevMs) || atMs >= prevMs)) {
      item.latest_at = at;
      item.latest_detail = detail ? String(detail) : item.latest_detail;
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
      sample_detail: item.sample_detail,
      latest_detail: item.latest_detail,
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
  positionWriterAuthorityEvents = [],
  nowMs = Date.now(),
} = {}) {
  const families = new Map();

  for (const row of intentCancels || []) {
    const family = resolveIntentCancelOperationalFamily(row);
    if (!family) continue;
    upsertFamily(families, family, {
      source: "order_intents_paper",
      at: row.updated_at || row.created_at || null,
      symbol: row.symbol_or_pair_id || row.symbol || null,
      reason: row.cancel_reason || row.status_reason || row.reason || null,
      detail: row.cancel_note || row.last_error || row.error_message || null,
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

  for (const row of positionWriterAuthorityEvents || []) {
    if (row && (row.runtime_family_suppressed === true || row.runtime_family_suppressed === "true")) continue;
    if (row && row.resolved_at) continue;
    const family = String(row && row.code || "").trim().toUpperCase();
    if (!family) continue;
    upsertFamily(families, family, {
      source: "position_writer_authority_events",
      at: row.created_at || row.updated_at || null,
      symbol: row.symbol || null,
      reason: row.code || null,
      detail: row.error || null,
    });
  }

  const finalized = finalizeFamilies(families);
  const activeFamilies = finalized.filter((item) => isOperationalFamilyActive(item, nowMs));
  return {
    error_count_24h: finalized.length,
    error_occurrence_count_24h: finalized.reduce((acc, item) => acc + Number(item.count || 0), 0),
    error_families_24h: finalized,
    active_error_count_24h: activeFamilies.length,
    active_error_occurrence_count_24h: activeFamilies.reduce((acc, item) => acc + Number(item.count || 0), 0),
    active_error_families_24h: activeFamilies,
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
  const [intentRows, dropRows, gateRows, aiRows, writerAuthorityRows] = await Promise.all([
    fetchRecentDocs({ collection: "order_intents_paper", orderByField: "updated_at", limit: fetchLimit, sinceMs }),
    fetchRecentDocs({ collection: "signals_dropped", orderByField: "created_at", limit: fetchLimit, sinceMs }),
    fetchRecentDocs({ collection: "gate_events", orderByField: "created_at", limit: fetchLimit, sinceMs }),
    fetchRecentDocs({ collection: "ai_allocation_runs", orderByField: "created_at", limit: Math.min(fetchLimit, 200), sinceMs }),
    fetchRecentDocs({ collection: "position_writer_authority_events", orderByField: "created_at", limit: Math.min(fetchLimit, 300), sinceMs }),
  ]);

  const intentCancels = intentRows.filter((row) => isIntentCanceledLikeStatus(row && row.status));
  const summary = summarizeRuntimeErrorFamilies({
    intentCancels,
    droppedSignals: dropRows,
    gateEvents: gateRows,
    aiRuns: aiRows,
    positionWriterAuthorityEvents: writerAuthorityRows,
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
  isNonRuntimeLiveReject,
  normalizeOperationalReason,
  normalizeOperationalDetail,
  resolveIntentCancelOperationalFamily,
  isRetryableInfraOperationalDetail,
  resolveOperationalActiveWindowMs,
  isOperationalFamilyActive,
  summarizeRuntimeErrorFamilies,
  fetchRuntimeErrorSummary24h,
};
