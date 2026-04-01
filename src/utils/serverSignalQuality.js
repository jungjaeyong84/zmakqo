"use strict";

const { sourceOf } = require("./serverSignalAuthority");

function pickDocs(input) {
  if (Array.isArray(input)) return input.slice();
  if (input && Array.isArray(input.docs)) return input.docs.slice();
  if (input && Array.isArray(input.rows)) return input.rows.slice();
  if (input && Array.isArray(input.data)) return input.data.slice();
  return [];
}

function toMs(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  if (Number.isFinite(n)) return n;
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function toKstString(value) {
  const ms = toMs(value);
  if (!Number.isFinite(ms)) return null;
  const kst = new Date(ms + (9 * 60 * 60 * 1000));
  const pad = (n) => String(n).padStart(2, "0");
  return `${kst.getUTCFullYear()}-${pad(kst.getUTCMonth() + 1)}-${pad(kst.getUTCDate())} ${pad(kst.getUTCHours())}:${pad(kst.getUTCMinutes())}:${pad(kst.getUTCSeconds())} KST`;
}

function bump(map, key) {
  map.set(key, Number(map.get(key) || 0) + 1);
}

function topRows(map, limit = 5) {
  return Array.from(map.entries())
    .sort((a, b) => b[1] - a[1] || String(a[0]).localeCompare(String(b[0])))
    .slice(0, Math.max(0, limit))
    .map(([key, count]) => ({ key, count }));
}

function topObjectRows(obj, limit = 5) {
  if (Array.isArray(obj)) {
    return obj
      .map((row) => ({ key: row && row.key, count: Number(row && row.count) || 0 }))
      .filter((row) => row.key)
      .sort((a, b) => b.count - a.count || String(a.key).localeCompare(String(b.key)))
      .slice(0, Math.max(0, limit));
  }
  return Object.entries(obj || {})
    .sort((a, b) => Number(b[1]) - Number(a[1]) || String(a[0]).localeCompare(String(b[0])))
    .slice(0, Math.max(0, limit))
    .map(([key, count]) => ({ key, count: Number(count) || 0 }));
}

function rate(part, whole) {
  const a = Number(part);
  const b = Number(whole);
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  return a / b;
}

function statusOf({ entrySignals, intents, fills, mismatchRate }) {
  if (entrySignals <= 0) return "NO_SERVER_ENTRY_SIGNAL";
  if (Number.isFinite(mismatchRate) && mismatchRate > 0.5) return "WATCH_PARITY_DRIFT";
  if (fills <= 0 && intents <= 0) return "SERVER_SIGNAL_NOT_REACHING_EXECUTION";
  if (fills <= 0) return "SERVER_SIGNAL_FILL_SHORT";
  return "OK";
}

function explainIntentFillRelation({ intents, fills, trades }) {
  const intentN = Number(intents) || 0;
  const fillN = Number(fills) || 0;
  const tradeN = Number(trades) || 0;
  if (fillN <= intentN) return null;
  return {
    status: "FILL_CAN_EXCEED_INTENT",
    message: "fill_24h_n can exceed order_intent_24h_n when older intents or existing positions generate fills inside the same 24h window.",
    detail: {
      order_intent_24h_n: intentN,
      fill_24h_n: fillN,
      trade_24h_n: tradeN,
    },
  };
}

function deriveServerSignalQuality({ signalsRecent = null, intentsRecent = null, fillsRecent = null, tradesRecent = null, parityReport = null, nowMs = Date.now() } = {}) {
  const signals = pickDocs(signalsRecent);
  const intents = pickDocs(intentsRecent);
  const fills = pickDocs(fillsRecent);
  const trades = pickDocs(tradesRecent);
  const dayAgoMs = Number(nowMs) - (24 * 60 * 60 * 1000);

  const recentServerEntrySignals = signals.filter((row) => {
    const source = sourceOf(row);
    const intent = String(row.event_intent || row.features_json && row.features_json._event_intent || "").toUpperCase();
    const reason = String(row.reason || "").toUpperCase();
    const createdMs = toMs(row.created_at || row.bar_close_time_utc_ms);
    if (source !== "SERVER") return false;
    if (!(Number.isFinite(createdMs) && createdMs >= dayAgoMs)) return false;
    if (intent === "ENTRY") return true;
    return reason.includes("ENTRY");
  });

  const signalIds = new Set(recentServerEntrySignals.map((row) => row.signal_id).filter(Boolean));
  const intentsFromSignals = intents.filter((row) => signalIds.has(row.signal_doc_id));
  const intentIds = new Set(intentsFromSignals.map((row) => row.intent_id).filter(Boolean));
  const fillsFromIntents = fills.filter((row) => intentIds.has(row.intent_id));
  const tradeIds = new Set(fillsFromIntents.map((row) => row.trade_id).filter(Boolean));
  const tradesFromFills = trades.filter((row) => tradeIds.has(row.trade_id));

  const reasonCounts = new Map();
  const marketCounts = new Map();
  let latestSignalMs = null;
  for (const row of recentServerEntrySignals) {
    bump(reasonCounts, String(row.reason || "UNKNOWN").trim() || "UNKNOWN");
    bump(marketCounts, String(row.symbol_or_pair_id || row.symbol || row.market || "UNKNOWN").trim() || "UNKNOWN");
    const createdMs = toMs(row.created_at || row.bar_close_time_utc_ms);
    if (!Number.isFinite(latestSignalMs) || createdMs > latestSignalMs) latestSignalMs = createdMs;
  }

  const paritySummary = (parityReport && parityReport.summary) || {};
  const parityRows = Array.isArray(parityReport && parityReport.rows) ? parityReport.rows : [];
  const mismatchExamples = parityRows
    .filter((row) => row && row.parity_match === false)
    .slice(0, 5)
    .map((row) => ({
      market: row.market || row.symbol || "-",
      tier: row.tier || "-",
      scope: row.mismatch_scope || "-",
      reason: row.actual_drop_reason_family || row.actual_drop_reason || row.shadow_reason || "-",
      observed_at_kst: toKstString(row.observation_ms),
    }));

  const summary = {
    authoritative_entry_signal_24h_n: recentServerEntrySignals.length,
    order_intent_24h_n: intentsFromSignals.length,
    fill_24h_n: fillsFromIntents.length,
    trade_24h_n: tradesFromFills.length,
    intent_conversion_rate: rate(intentsFromSignals.length, recentServerEntrySignals.length),
    fill_conversion_rate: rate(fillsFromIntents.length, recentServerEntrySignals.length),
    latest_authoritative_entry_signal_at_kst: toKstString(latestSignalMs),
    parity_mismatch_rate: Number.isFinite(Number(paritySummary.parity_mismatch_rate)) ? Number(paritySummary.parity_mismatch_rate) : null,
    parity_mismatch_n: Number(paritySummary.parity_mismatch_n) || 0,
    top_mismatch_scope: topObjectRows(paritySummary.by_mismatch_scope || {}, 1)[0] || null,
    top_drop_reason_family: topObjectRows(paritySummary.by_actual_drop_reason_family || {}, 1)[0] || null,
  };
  summary.quality_status = statusOf({
    entrySignals: summary.authoritative_entry_signal_24h_n,
    intents: summary.order_intent_24h_n,
    fills: summary.fill_24h_n,
    mismatchRate: summary.parity_mismatch_rate,
  });
  summary.intent_fill_relation_note = explainIntentFillRelation({
    intents: summary.order_intent_24h_n,
    fills: summary.fill_24h_n,
    trades: summary.trade_24h_n,
  });

  return {
    ok: true,
    summary,
    rows: {
      top_reason: topRows(reasonCounts, 5),
      top_market: topRows(marketCounts, 5),
      mismatch_examples: mismatchExamples,
    },
  };
}

module.exports = {
  deriveServerSignalQuality,
};
