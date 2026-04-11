"use strict";

const { getFirestore } = require("../storage/firestore");
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

function normalizeDecisionRow(row = {}) {
  return {
    kind: "DECISION",
    ts_ms: toTimeMs(row.created_at) || 0,
    created_at: row.created_at || null,
    exchange: upper(row.exchange),
    symbol: upper(row.symbol),
    event: upper(row.event),
    trace_id: row.idempotency_key || row.trace_id || null,
    request_id: row.request_id || null,
    run_id: row.run_id || null,
    signal_id: row.signal_id || null,
    intent_id: row.intent_id || null,
    payload: {
      hook: row.hook || null,
      policy_stage: row.policy_stage || null,
      policy_reason: row.policy_reason || null,
      qty_pct_final: Number.isFinite(Number(row.qty_pct_final)) ? Number(row.qty_pct_final) : null,
      action: upper(row.action),
      intent: upper(row.intent),
    },
    raw: safeClone(row),
  };
}

function normalizeIntentRow(row = {}) {
  return {
    kind: "INTENT",
    ts_ms: toTimeMs(row.created_at) || toTimeMs(row.updated_at) || 0,
    created_at: row.created_at || row.updated_at || null,
    exchange: upper(row.exchange),
    symbol: upper(row.symbol_or_pair_id || row.symbol),
    event: upper(row.event),
    trace_id: row.trace_id || null,
    request_id: row.request_id || null,
    run_id: row.run_id || null,
    signal_id: row.signal_id || null,
    intent_id: row.intent_id || null,
    payload: {
      status: upper(row.status),
      side: upper(row.side),
      event_intent: upper(row.event_intent),
      qty_pct: Number.isFinite(Number(row.qty_pct)) ? Number(row.qty_pct) : null,
      decision_reason: row.decision_reason || null,
    },
    raw: safeClone(row),
  };
}

function normalizeIntentMutationRow(row = {}) {
  return {
    kind: "INTENT_MUTATION",
    ts_ms: Number.isFinite(Number(row.ts_ms)) ? Number(row.ts_ms) : (toTimeMs(row.created_at) || 0),
    created_at: row.created_at || null,
    exchange: upper(row.exchange),
    symbol: upper(row.symbol),
    event: upper(row.mutation_type),
    trace_id: row.trace_id || null,
    request_id: row.request_id || null,
    run_id: row.run_id || null,
    signal_id: null,
    intent_id: row.intent_id || null,
    payload: {
      mutation_type: upper(row.mutation_type),
      after_status: row.after && row.after.status ? upper(row.after.status) : null,
      extra: safeClone(row.extra),
    },
    raw: safeClone(row),
  };
}

function normalizeFillRow(row = {}) {
  return {
    kind: "FILL",
    ts_ms: toTimeMs(row.created_at) || toTimeMs(row.updated_at) || 0,
    created_at: row.created_at || row.updated_at || null,
    exchange: upper(row.exchange),
    symbol: upper(row.symbol || row.symbol_or_pair_id),
    event: upper(row.event),
    trace_id: row.trace_id || row.idempotency_key || null,
    request_id: row.request_id || null,
    run_id: row.run_id || null,
    signal_id: row.signal_id || null,
    intent_id: row.intent_id || null,
    fill_id: row.fill_id || null,
    payload: {
      side: upper(row.side),
      qty_pct: Number.isFinite(Number(row.qty_pct)) ? Number(row.qty_pct) : null,
      qty_fraction: Number.isFinite(Number(row.qty_fraction)) ? Number(row.qty_fraction) : null,
      exec_price: Number.isFinite(Number(row.exec_price)) ? Number(row.exec_price) : null,
      decision_reason: row.decision_reason || null,
    },
    raw: safeClone(row),
  };
}

function normalizeFillMutationRow(row = {}) {
  return {
    kind: "FILL_MUTATION",
    ts_ms: Number.isFinite(Number(row.ts_ms)) ? Number(row.ts_ms) : (toTimeMs(row.created_at) || 0),
    created_at: row.created_at || null,
    exchange: upper(row.exchange),
    symbol: upper(row.symbol),
    event: upper(row.mutation_type),
    trace_id: row.trace_id || null,
    request_id: row.request_id || null,
    run_id: row.run_id || null,
    signal_id: null,
    intent_id: null,
    fill_id: row.fill_id || null,
    payload: {
      mutation_type: upper(row.mutation_type),
      extra: safeClone(row.extra),
      classification_verified: row.after && row.after.classification_verified === false ? false : true,
    },
    raw: safeClone(row),
  };
}

function normalizeExchangeAckRow(row = {}) {
  return {
    ...normalizeFillMutationRow(row),
    kind: "EXCHANGE_ACK",
  };
}

function normalizePositionEventRow(row = {}) {
  return {
    kind: "POSITION_MUTATION",
    ts_ms: Number.isFinite(Number(row.sequence_ms)) ? Number(row.sequence_ms) : (toTimeMs(row.created_at) || 0),
    created_at: row.created_at || null,
    exchange: upper(row.exchange),
    symbol: upper(row.symbol),
    event: upper(row.mutation_kind),
    trace_id: row.trace_id || null,
    request_id: row.request_id || null,
    run_id: row.run_id || null,
    signal_id: null,
    intent_id: null,
    payload: {
      reason: row.reason || null,
      before_summary: safeClone(row.before_summary),
      after_summary: safeClone(row.after_summary),
      transition: safeClone(row.transition),
    },
    raw: safeClone(row),
  };
}

function normalizeUnifiedTimelineRow(row = {}) {
  return {
    kind: upper(row.event_kind || row.kind),
    ts_ms: Number.isFinite(Number(row.ts_ms)) ? Number(row.ts_ms) : (toTimeMs(row.created_at) || 0),
    created_at: row.created_at || null,
    exchange: upper(row.exchange),
    symbol: upper(row.symbol),
    event: upper(row.event),
    trace_id: row.trace_id || null,
    request_id: row.request_id || null,
    run_id: row.run_id || null,
    signal_id: row.signal_id || null,
    intent_id: row.intent_id || null,
    fill_id: row.fill_id || null,
    payload: safeClone(row.payload),
    raw: safeClone(row.raw || row),
  };
}

const TIMELINE_PRIORITY = Object.freeze({
  DECISION: 1,
  INTENT: 2,
  INTENT_MUTATION: 3,
  FILL: 4,
  FILL_MUTATION: 5,
  EXCHANGE_ACK: 6,
  FILL_AUDIT: 7,
  POSITION_MUTATION: 8,
});

function sortTimeline(rows = []) {
  return (Array.isArray(rows) ? rows : []).slice().sort((a, b) => {
    const timeDiff = Number(a.ts_ms || 0) - Number(b.ts_ms || 0);
    if (timeDiff !== 0) return timeDiff;
    const pa = TIMELINE_PRIORITY[a.kind] || 99;
    const pb = TIMELINE_PRIORITY[b.kind] || 99;
    if (pa !== pb) return pa - pb;
    return String(a.event || "").localeCompare(String(b.event || ""));
  });
}

function replayDecisionTimelineV2FromRows({
  decisions = [],
  intents = [],
  intentEvents = [],
  fills = [],
  fillEvents = [],
  exchangeAcks = [],
  positionEvents = [],
} = {}) {
  const timeline = sortTimeline([
    ...(Array.isArray(decisions) ? decisions.map(normalizeDecisionRow) : []),
    ...(Array.isArray(intents) ? intents.map(normalizeIntentRow) : []),
    ...(Array.isArray(intentEvents) ? intentEvents.map(normalizeIntentMutationRow) : []),
    ...(Array.isArray(fills) ? fills.map(normalizeFillRow) : []),
    ...(Array.isArray(fillEvents) ? fillEvents.map(normalizeFillMutationRow) : []),
    ...(Array.isArray(exchangeAcks) ? exchangeAcks.map(normalizeExchangeAckRow) : []),
    ...(Array.isArray(positionEvents) ? positionEvents.map(normalizePositionEventRow) : []),
  ]);
  const lastPositionMutation = timeline.filter((row) => row.kind === "POSITION_MUTATION").slice(-1)[0] || null;
  const lastExchangeAck = timeline.filter((row) => row.kind === "EXCHANGE_ACK").slice(-1)[0] || null;
  return {
    schema_version: "DECISION_REPLAY_V2",
    timeline_n: timeline.length,
    counts: {
      decisions_n: Array.isArray(decisions) ? decisions.length : 0,
      intents_n: Array.isArray(intents) ? intents.length : 0,
      intent_mutations_n: Array.isArray(intentEvents) ? intentEvents.length : 0,
      fills_n: Array.isArray(fills) ? fills.length : 0,
      fill_mutations_n: Array.isArray(fillEvents) ? fillEvents.length : 0,
      exchange_ack_n: Array.isArray(exchangeAcks) ? exchangeAcks.length : 0,
      position_mutations_n: Array.isArray(positionEvents) ? positionEvents.length : 0,
    },
    latest_exchange_ack: lastExchangeAck ? safeClone(lastExchangeAck.payload) : null,
    latest_position_summary: lastPositionMutation && lastPositionMutation.payload
      ? lastPositionMutation.payload.after_summary || null
      : null,
    timeline,
  };
}

async function fetchRecentRows({ collection, orderField, limit = 500 } = {}) {
  const db = getFirestore();
  const snap = await db.collection(collection)
    .orderBy(orderField, "desc")
    .limit(Math.max(1, Math.trunc(Number(limit) || 500)))
    .get();
  return snap.docs.map((doc) => ({ id: doc.id, ...(doc.data() || {}) }));
}

function filterRows(rows = [], {
  exchange = null,
  symbol = null,
  fromMs = null,
  toMs: toMsLimit = null,
  pickMs = null,
  pickSymbol = null,
} = {}) {
  const ex = upper(exchange);
  const sym = upper(symbol);
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (ex && upper(row.exchange) !== ex) return false;
    const rowSymbol = upper(pickSymbol ? pickSymbol(row) : (row.symbol || row.symbol_or_pair_id));
    if (sym && rowSymbol !== sym) return false;
    const ms = Number(pickMs ? pickMs(row) : (toTimeMs(row && row.created_at) || 0));
    if (Number.isFinite(Number(fromMs)) && ms < Number(fromMs)) return false;
    if (Number.isFinite(Number(toMsLimit)) && ms > Number(toMsLimit)) return false;
    return true;
  });
}

async function replayDecisionTimelineV2({
  exchange,
  symbol,
  fromMs = null,
  toMs = null,
  limitPerCollection = 500,
} = {}) {
  const useUnifiedTimeline = String(process.env.DECISION_REPLAY_V2_USE_UNIFIED_TIMELINE || "1").trim() !== "0";
  if (useUnifiedTimeline) {
    const unifiedRows = await fetchUnifiedEventTimeline({
      exchange,
      symbol,
      fromMs,
      toMs,
      limit: limitPerCollection * 4,
    }).catch(() => []);
    if (Array.isArray(unifiedRows) && unifiedRows.length) {
      const timeline = sortTimeline(unifiedRows.map(normalizeUnifiedTimelineRow));
      const lastPositionMutation = timeline.filter((row) => row.kind === "POSITION_MUTATION").slice(-1)[0] || null;
      const lastExchangeAck = timeline.filter((row) => row.kind === "EXCHANGE_ACK").slice(-1)[0] || null;
      return {
        exchange: upper(exchange),
        symbol: upper(symbol),
        from_ms: Number.isFinite(Number(fromMs)) ? Number(fromMs) : null,
        to_ms: Number.isFinite(Number(toMs)) ? Number(toMs) : null,
        schema_version: "DECISION_REPLAY_V2",
        source_collection: "UNIFIED_EVENT_TIMELINE",
        timeline_n: timeline.length,
        counts: {
          decisions_n: timeline.filter((row) => row.kind === "DECISION").length,
          intents_n: timeline.filter((row) => row.kind === "INTENT").length,
          intent_mutations_n: timeline.filter((row) => row.kind === "INTENT_MUTATION").length,
          fills_n: timeline.filter((row) => row.kind === "FILL").length,
          fill_mutations_n: timeline.filter((row) => row.kind === "FILL_MUTATION").length,
          exchange_ack_n: timeline.filter((row) => row.kind === "EXCHANGE_ACK").length,
          position_mutations_n: timeline.filter((row) => row.kind === "POSITION_MUTATION").length,
        },
        latest_exchange_ack: lastExchangeAck ? safeClone(lastExchangeAck.payload) : null,
        latest_position_summary: lastPositionMutation && lastPositionMutation.payload
          ? lastPositionMutation.payload.after_summary || null
          : null,
        timeline,
      };
    }
  }
  const [decisionsRaw, intentsRaw, intentEventsRaw, fillsRaw, fillEventsRaw, positionEventsRaw] = await Promise.all([
    fetchRecentRows({ collection: "action_hook_ledger", orderField: "created_at", limit: limitPerCollection }),
    fetchRecentRows({ collection: "order_intents_paper", orderField: "created_at", limit: limitPerCollection }),
    fetchRecentRows({ collection: "order_intent_events", orderField: "ts_ms", limit: limitPerCollection }),
    fetchRecentRows({ collection: "fills_paper", orderField: "created_at", limit: limitPerCollection }),
    fetchRecentRows({ collection: "fill_events", orderField: "ts_ms", limit: limitPerCollection }),
    fetchRecentRows({ collection: "position_events", orderField: "sequence_ms", limit: limitPerCollection }),
  ]);

  return {
    exchange: upper(exchange),
    symbol: upper(symbol),
    from_ms: Number.isFinite(Number(fromMs)) ? Number(fromMs) : null,
    to_ms: Number.isFinite(Number(toMs)) ? Number(toMs) : null,
    ...replayDecisionTimelineV2FromRows({
      decisions: filterRows(decisionsRaw, {
        exchange,
        symbol,
        fromMs,
        toMs,
        pickMs: (row) => toTimeMs(row.created_at) || 0,
        pickSymbol: (row) => row.symbol,
      }),
      intents: filterRows(intentsRaw, {
        exchange,
        symbol,
        fromMs,
        toMs,
        pickMs: (row) => toTimeMs(row.created_at) || toTimeMs(row.updated_at) || 0,
        pickSymbol: (row) => row.symbol_or_pair_id,
      }),
      intentEvents: filterRows(intentEventsRaw, {
        exchange,
        symbol,
        fromMs,
        toMs,
        pickMs: (row) => Number.isFinite(Number(row.ts_ms)) ? Number(row.ts_ms) : (toTimeMs(row.created_at) || 0),
        pickSymbol: (row) => row.symbol,
      }),
      fills: filterRows(fillsRaw, {
        exchange,
        symbol,
        fromMs,
        toMs,
        pickMs: (row) => toTimeMs(row.created_at) || toTimeMs(row.updated_at) || 0,
        pickSymbol: (row) => row.symbol,
      }),
      fillEvents: filterRows(fillEventsRaw, {
        exchange,
        symbol,
        fromMs,
        toMs,
        pickMs: (row) => Number.isFinite(Number(row.ts_ms)) ? Number(row.ts_ms) : (toTimeMs(row.created_at) || 0),
        pickSymbol: (row) => row.symbol,
      }).filter((row) => {
        const type = upper(row.mutation_type);
        return type !== "EXTERNAL_INSERT" && type !== "EXTERNAL_MERGE";
      }),
      exchangeAcks: filterRows(fillEventsRaw, {
        exchange,
        symbol,
        fromMs,
        toMs,
        pickMs: (row) => Number.isFinite(Number(row.ts_ms)) ? Number(row.ts_ms) : (toTimeMs(row.created_at) || 0),
        pickSymbol: (row) => row.symbol,
      }).filter((row) => {
        const type = upper(row.mutation_type);
        return type === "EXTERNAL_INSERT" || type === "EXTERNAL_MERGE";
      }),
      positionEvents: filterRows(positionEventsRaw, {
        exchange,
        symbol,
        fromMs,
        toMs,
        pickMs: (row) => Number(row.sequence_ms || 0),
        pickSymbol: (row) => row.symbol,
      }),
    }),
  };
}

module.exports = {
  replayDecisionTimelineV2,
  __test: {
    toTimeMs,
    normalizeDecisionRow,
    normalizeIntentRow,
    normalizeIntentMutationRow,
    normalizeFillRow,
    normalizeFillMutationRow,
    normalizeExchangeAckRow,
    normalizePositionEventRow,
    normalizeUnifiedTimelineRow,
    replayDecisionTimelineV2FromRows,
    sortTimeline,
  },
};
