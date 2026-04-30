"use strict";

const { getFirestore } = require("./firestore");
const { recordUnifiedEvent } = require("./unifiedEventTimeline");

function nowIso() {
  return new Date().toISOString();
}

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

function buildCanonicalExitTransitionId({
  fillId,
  transitionEvent,
} = {}) {
  const fill = String(fillId || "").trim();
  const event = upper(transitionEvent);
  if (!fill || !event) throw new Error("CANONICAL_EXIT_TRANSITION_ID_REQUIRES_FILL_AND_EVENT");
  return `CET__${fill}__${event}`;
}

function buildCanonicalExitTransitionDoc({
  exchange,
  symbol,
  fillId,
  tradeId = null,
  tradeMs = null,
  createdAt = null,
  canonicalEvent = null,
  transitionEvent,
  chainKey = null,
  reason = null,
  entryEventId = null,
  signalDocId = null,
  orderMeta = null,
  ledger = null,
  source = "UNKNOWN",
} = {}) {
  const transition = upper(transitionEvent);
  if (!transition) throw new Error("CANONICAL_EXIT_TRANSITION_EVENT_REQUIRED");
  const tsMs = toTimeMs(tradeMs);
  const resolvedCreatedAt = createdAt || (tsMs != null ? new Date(tsMs).toISOString() : nowIso());
  return {
    canonical_exit_transition_id: buildCanonicalExitTransitionId({ fillId, transitionEvent: transition }),
    created_at: resolvedCreatedAt,
    ts_ms: tsMs,
    exchange: upper(exchange),
    symbol: upper(symbol),
    fill_id: String(fillId || "").trim() || null,
    source_fill_id: String(fillId || "").trim() || null,
    trade_id: Number.isFinite(Number(tradeId)) ? Number(tradeId) : null,
    canonical_event: upper(canonicalEvent),
    canonical_transition_event: transition,
    canonical_exit_chain_key: String(chainKey || "").trim() || null,
    canonical_exit_reason: String(reason || "").trim() || null,
    entry_event_id: String(entryEventId || "").trim() || null,
    signal_doc_id: String(signalDocId || "").trim() || null,
    external_order_id: Number.isFinite(Number(orderMeta && orderMeta.orderId)) ? Number(orderMeta.orderId) : null,
    external_client_order_id: String(orderMeta && orderMeta.clientOrderId || "").trim() || null,
    source: upper(source),
    quantity_contract_ledger: safeClone(ledger),
  };
}

async function recordCanonicalExitTransitions({
  exchange,
  symbol,
  fillId,
  tradeId = null,
  tradeMs = null,
  createdAt = null,
  canonicalEvent = null,
  transitionEvents = null,
  chainKey = null,
  reason = null,
  entryEventId = null,
  signalDocId = null,
  orderMeta = null,
  ledger = null,
  source = "UNKNOWN",
} = {}) {
  const transitions = Array.isArray(transitionEvents)
    ? transitionEvents.map((item) => upper(item)).filter(Boolean)
    : [];
  if (!transitions.length) return [];
  const db = getFirestore();
  const docs = [];
  for (const transitionEvent of transitions) {
    const doc = buildCanonicalExitTransitionDoc({
      exchange,
      symbol,
      fillId,
      tradeId,
      tradeMs,
      createdAt,
      canonicalEvent,
      transitionEvent,
      chainKey,
      reason,
      entryEventId,
      signalDocId,
      orderMeta,
      ledger,
      source,
    });
    await db.collection("canonical_exit_transitions").doc(doc.canonical_exit_transition_id).set(doc, { merge: true });
    await recordUnifiedEvent({
      eventKind: "CANONICAL_EXIT_TRANSITION",
      eventSource: source,
      exchange,
      symbol,
      event: transitionEvent,
      fillId,
      sourceDocumentId: doc.canonical_exit_transition_id,
      tsMs: doc.ts_ms != null ? doc.ts_ms : null,
      createdAt: doc.created_at || nowIso(),
      payload: doc,
    });
    docs.push(doc);
  }
  return docs;
}

module.exports = {
  buildCanonicalExitTransitionDoc,
  buildCanonicalExitTransitionId,
  recordCanonicalExitTransitions,
  __test: {
    buildCanonicalExitTransitionDoc,
    buildCanonicalExitTransitionId,
    toTimeMs,
  },
};
