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

function upper(value) {
  return String(value || "").trim().toUpperCase();
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

function normalizeKey(value) {
  const text = String(value || "").trim();
  return text || null;
}

function finalDownstreamFamilyAction(family) {
  const key = upper(family);
  if (key === "EV_POLICY") return "RELAX_EV_POLICY_REVIEW";
  if (key === "COOLDOWN_POLICY") return "RELAX_OPPOSITE_COOLDOWN_REVIEW";
  if (key === "OTHER_SERVER_POLICY") return "WATCH_ONLY_REVIEW";
  if (key === "ENTRY_QUALITY") return "KEEP_DROP_RULE";
  if (key === "RISK_POLICY") return "KEEP_DROP_RULE";
  return "MONITOR_ONLY";
}

function otherServerPolicyReasonAction(reason) {
  const key = upper(reason);
  if (key === "LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED") return "WATCH_ONLY_REVIEW";
  if (key === "LIVE_RESCUE_ADD_POST_TP1_BLOCKED") return "MONITOR_POST_TP1_GUARD";
  return "MONITOR_ONLY";
}

function collectSignalRefs(row) {
  const refs = new Set();
  const features = row && row.features_json && typeof row.features_json === "object"
    ? row.features_json
    : null;
  const candidates = [
    row && row.id,
    row && row.signal_id,
    row && row.signal_doc_id,
    features && features.signal_id,
    features && features.signal_doc_id,
  ];
  for (const candidate of candidates) {
    const key = normalizeKey(candidate);
    if (key) refs.add(key);
  }
  return refs;
}

function intersectsRefs(refSet, row) {
  if (!(refSet instanceof Set) || refSet.size <= 0) return false;
  const rowRefs = collectSignalRefs(row);
  for (const key of rowRefs) {
    if (refSet.has(key)) return true;
  }
  return false;
}

function dedupeRows(rows, keys = []) {
  const seen = new Set();
  const out = [];
  for (const row of Array.isArray(rows) ? rows : []) {
    const parts = keys
      .map((key) => normalizeKey(row && row[key]))
      .filter(Boolean);
    const signature = parts.join("||") || JSON.stringify(row);
    if (seen.has(signature)) continue;
    seen.add(signature);
    out.push(row);
  }
  return out;
}

function deriveServerSignalQuality({
  signalsRecent = null,
  intentsRecent = null,
  fillsRecent = null,
  tradesRecent = null,
  parityReport = null,
  runtimeTickWindow = null,
  nowMs = Date.now(),
} = {}) {
  const signals = pickDocs(signalsRecent);
  const intents = pickDocs(intentsRecent);
  const fills = pickDocs(fillsRecent);
  const trades = pickDocs(tradesRecent);
  const runtimeSummary = runtimeTickWindow && typeof runtimeTickWindow === "object"
    ? (runtimeTickWindow.summary && typeof runtimeTickWindow.summary === "object" ? runtimeTickWindow.summary : runtimeTickWindow)
    : {};
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

  const signalRefs = new Set();
  for (const row of recentServerEntrySignals) {
    for (const key of collectSignalRefs(row)) signalRefs.add(key);
  }

  const intentsFromSignals = intents.filter((row) => intersectsRefs(signalRefs, row));
  const fillsDirectFromSignals = fills.filter((row) => intersectsRefs(signalRefs, row));
  const fillLinkedIntentIds = new Set(
    fillsDirectFromSignals.map((row) => normalizeKey(row.intent_id)).filter(Boolean)
  );
  const inferredIntentsFromFills = intents.filter((row) => fillLinkedIntentIds.has(normalizeKey(row.intent_id || row.id)));
  const intentsLinked = dedupeRows([...intentsFromSignals, ...inferredIntentsFromFills], ["intent_id", "id"]);
  const intentIds = new Set(intentsLinked.map((row) => normalizeKey(row.intent_id || row.id)).filter(Boolean));
  for (const row of fillsDirectFromSignals) {
    const intentId = normalizeKey(row.intent_id);
    if (intentId) intentIds.add(intentId);
  }
  const fillsFromIntents = fills.filter((row) => intentIds.has(normalizeKey(row.intent_id)));
  const fillsLinked = dedupeRows([...fillsDirectFromSignals, ...fillsFromIntents], ["fill_id", "id", "intent_id", "trade_id"]);
  const tradeIds = new Set(fillsLinked.map((row) => normalizeKey(row.trade_id)).filter(Boolean));
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
  const finalDownstreamRows = parityRows.filter((row) =>
    row
    && row.parity_match === false
    && upper(row.mismatch_scope) === "FINAL_DOWNSTREAM_MISMATCH"
  );
  const otherServerPolicyRows = finalDownstreamRows.filter((row) =>
    upper(row.actual_drop_reason_family || row.actual_drop_reason) === "OTHER_SERVER_POLICY"
  );
  const finalDownstreamByFamily = new Map();
  for (const row of finalDownstreamRows) {
    const family = upper(row.actual_drop_reason_family || row.actual_drop_reason || "UNKNOWN");
    bump(finalDownstreamByFamily, family);
  }
  const finalDownstreamFamilyActions = topRows(finalDownstreamByFamily, 16)
    .map((row) => ({
      family: row.key,
      mismatch_n: Number(row.count) || 0,
      recommended_action: finalDownstreamFamilyAction(row.key),
    }));
  const otherServerPolicyByReason = new Map();
  const otherServerPolicyReasonMarkets = new Map();
  for (const row of otherServerPolicyRows) {
    const reason = upper(row.actual_drop_reason || row.server_drop_reason || "UNKNOWN");
    const market = upper(row.market || row.symbol || "UNKNOWN");
    bump(otherServerPolicyByReason, reason);
    if (!otherServerPolicyReasonMarkets.has(reason)) otherServerPolicyReasonMarkets.set(reason, new Map());
    bump(otherServerPolicyReasonMarkets.get(reason), market);
  }
  const otherServerPolicyReasonActions = topRows(otherServerPolicyByReason, 16)
    .map((row) => ({
      reason: row.key,
      mismatch_n: Number(row.count) || 0,
      recommended_action: otherServerPolicyReasonAction(row.key),
      top_markets: topRows(otherServerPolicyReasonMarkets.get(row.key) || new Map(), 4)
        .map((marketRow) => ({
          market: marketRow.key,
          mismatch_n: Number(marketRow.count) || 0,
        })),
    }));
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

  const authoritativeEntrySignal24hN = Math.max(
    recentServerEntrySignals.length,
    Number(runtimeSummary.server_signal_created_24h_n || runtimeSummary.server_signal_created_n || 0),
    Number(runtimeSummary.direct_handoff_generated_24h_n || runtimeSummary.direct_handoff_generated_n || 0)
  );
  const orderIntent24hN = Math.max(
    intentsLinked.length,
    Number(runtimeSummary.intents_created_24h_n || runtimeSummary.intents_created_n || 0),
    Number(runtimeSummary.direct_handoff_executed_24h_n || runtimeSummary.direct_handoff_executed_n || 0)
  );

  const summary = {
    authoritative_entry_signal_24h_n: authoritativeEntrySignal24hN,
    order_intent_24h_n: orderIntent24hN,
    fill_24h_n: fillsLinked.length,
    trade_24h_n: tradesFromFills.length,
    runtime_server_signal_created_24h_n: Number(runtimeSummary.server_signal_created_24h_n || runtimeSummary.server_signal_created_n || 0),
    runtime_direct_handoff_generated_24h_n: Number(runtimeSummary.direct_handoff_generated_24h_n || runtimeSummary.direct_handoff_generated_n || 0),
    runtime_direct_handoff_executed_24h_n: Number(runtimeSummary.direct_handoff_executed_24h_n || runtimeSummary.direct_handoff_executed_n || 0),
    runtime_direct_handoff_blocked_24h_n: Number(runtimeSummary.direct_handoff_blocked_24h_n || runtimeSummary.direct_handoff_blocked_n || 0),
    top_runtime_direct_handoff_block_reason: topObjectRows(runtimeSummary.direct_handoff_reason_counts || {}, 1)[0] || null,
    intent_conversion_rate: rate(orderIntent24hN, authoritativeEntrySignal24hN),
    fill_conversion_rate: rate(fillsLinked.length, authoritativeEntrySignal24hN),
    latest_authoritative_entry_signal_at_kst: toKstString(latestSignalMs),
    parity_mismatch_rate: Number.isFinite(Number(paritySummary.parity_mismatch_rate)) ? Number(paritySummary.parity_mismatch_rate) : null,
    parity_mismatch_n: Number(paritySummary.parity_mismatch_n) || 0,
    final_downstream_mismatch_n: Number(paritySummary.final_downstream_mismatch_n)
      || Number((paritySummary.by_mismatch_scope && paritySummary.by_mismatch_scope.FINAL_DOWNSTREAM_MISMATCH) || 0)
      || finalDownstreamRows.length,
    top_mismatch_scope: topObjectRows(paritySummary.by_mismatch_scope || {}, 1)[0] || null,
    top_drop_reason_family: topObjectRows(paritySummary.by_actual_drop_reason_family || {}, 1)[0] || null,
    top_final_downstream_drop_reason_family: finalDownstreamFamilyActions[0]
      ? { key: finalDownstreamFamilyActions[0].family, count: finalDownstreamFamilyActions[0].mismatch_n }
      : null,
    other_server_policy_mismatch_n: otherServerPolicyRows.length,
    top_other_server_policy_reason_action: otherServerPolicyReasonActions[0]
      ? {
        reason: otherServerPolicyReasonActions[0].reason,
        mismatch_n: otherServerPolicyReasonActions[0].mismatch_n,
        recommended_action: otherServerPolicyReasonActions[0].recommended_action,
      }
      : null,
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
      final_downstream_family_actions: finalDownstreamFamilyActions,
      other_server_policy_reason_actions: otherServerPolicyReasonActions,
    },
  };
}

module.exports = {
  deriveServerSignalQuality,
};
