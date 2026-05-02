#!/usr/bin/env node
"use strict";

require("dotenv").config();

const { getFirestore } = require("../src/storage/firestore");
const {
  classifyExitEventStage,
  buildCanonicalExitEvent,
} = require("../src/services/positionStateMachine");
const {
  buildCanonicalExitTransitionId,
  recordCanonicalExitTransitions,
} = require("../src/storage/canonicalExitTransitions");

const LOOKBACK_DAYS = Math.max(1, Number(process.env.CANONICAL_EXIT_TRANSITION_BACKFILL_LOOKBACK_DAYS || 30));
const PAGE_SIZE = Math.max(100, Number(process.env.CANONICAL_EXIT_TRANSITION_BACKFILL_PAGE_SIZE || 1000));
const FILL_SELECT_FIELDS = Object.freeze([
  "fill_id",
  "exchange",
  "symbol",
  "symbol_or_pair_id",
  "event",
  "created_at",
  "updated_at",
  "trade_id",
  "trade_ms",
  "external_trade_id",
  "exec_bar_close_time_utc_ms",
  "qty_fraction",
  "qty_pct",
  "contract_entry_qty_abs",
  "contract_tp0_allowed_abs",
  "contract_tp0_consumed_abs",
  "contract_tp1_allowed_abs",
  "contract_tp1_consumed_abs",
  "contract_runner_allowed_abs",
  "contract_runner_remaining_abs",
  "contract_trail_consumed_abs",
  "contract_observed_qty_abs",
  "canonical_exit_event",
  "canonical_exit_stage",
  "canonical_transition_events",
  "canonical_primary_transition_event",
  "canonical_exit_chain_key",
  "canonical_exit_reason",
  "canonical_exit_blocked_invariant",
  "canonical_exit_ledger_blocked_invariant",
  "entry_event_id",
  "signal_doc_id",
  "external_order_id",
  "external_client_order_id",
  "external_order_close_position",
  "simplified_exit_v2_enabled",
  "simplifiedExitV2Enabled",
  "extra",
  "meta",
]);

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function isSyntheticEntryEventId(value) {
  return String(value || "").trim().toUpperCase().startsWith("SYN|");
}

function isAuthoritativeEntryEventId(value) {
  const text = String(value || "").trim();
  return !!(text && !isSyntheticEntryEventId(text));
}

function isSimplifiedExitV2Row(row = {}) {
  const extra = row && row.extra && typeof row.extra === "object" ? row.extra : {};
  const meta = row && row.meta && typeof row.meta === "object" ? row.meta : {};
  return row.simplified_exit_v2_enabled === true
    || row.simplifiedExitV2Enabled === true
    || extra.simplified_exit_v2_enabled === true
    || extra.simplifiedExitV2Enabled === true
    || meta.simplified_exit_v2_enabled === true
    || meta.simplifiedExitV2Enabled === true;
}

function buildTransitionEvents(stage, row) {
  const extra = row && row.extra && typeof row.extra === "object" ? row.extra : {};
  const qty = Number(row.qty_fraction ?? row.qty_pct ?? extra.qty_fraction);
  const simplifiedExitV2 = isSimplifiedExitV2Row(row);
  if (stage === "TP0") return ["TP1_REACHED"];
  if (stage === "TP1") return simplifiedExitV2 ? ["TP1_REACHED", "TRAIL_ACTIVATED"] : ["TP1_REACHED", "TRAIL_ACTIVE"];
  if (stage === "TRAIL") return simplifiedExitV2 ? ["TRAIL_FINAL_EXIT"] : [qty >= 0.999 ? "TRAIL_FINAL_EXIT" : "TRAIL_PARTIAL"];
  if ((stage === "OTHER_EXIT" || stage === "OTHER") && (
    row.external_order_close_position === true
    || (row.extra && row.extra.external_order_close_position === true)
  )) return ["EXTERNAL_CLOSE_SYNC"];
  return [];
}

function buildLedger(row = {}) {
  const extra = row.extra && typeof row.extra === "object" ? row.extra : {};
  const out = {
    entry_qty_abs: toNum(extra.contract_entry_qty_abs ?? row.contract_entry_qty_abs),
    tp0_allowed_abs: toNum(extra.contract_tp0_allowed_abs ?? row.contract_tp0_allowed_abs),
    tp0_consumed_abs: toNum(extra.contract_tp0_consumed_abs ?? row.contract_tp0_consumed_abs),
    tp1_allowed_abs: toNum(extra.contract_tp1_allowed_abs ?? row.contract_tp1_allowed_abs),
    tp1_consumed_abs: toNum(extra.contract_tp1_consumed_abs ?? row.contract_tp1_consumed_abs),
    runner_allowed_abs: toNum(extra.contract_runner_allowed_abs ?? row.contract_runner_allowed_abs),
    runner_remaining_abs: toNum(extra.contract_runner_remaining_abs ?? row.contract_runner_remaining_abs ?? extra.canonical_runner_remaining_abs ?? row.canonical_runner_remaining_abs),
    trail_consumed_abs: toNum(extra.contract_trail_consumed_abs ?? row.contract_trail_consumed_abs),
    observed_qty_abs: toNum(extra.contract_observed_qty_abs ?? row.contract_observed_qty_abs ?? row.exec_qty_base),
  };
  return Object.values(out).some((value) => value != null) ? out : null;
}

function buildCanonicalTransitionPayload(row = {}) {
  const extra = row.extra && typeof row.extra === "object" ? row.extra : {};
  const fallbackEvent = upper(row.canonical_exit_event || extra.canonical_exit_event || row.event);
  const stage = upper(row.canonical_exit_stage || extra.canonical_exit_stage) || classifyExitEventStage(fallbackEvent);
  if (!stage) return null;
  if (
    row.canonical_exit_blocked_invariant === true
    || extra.canonical_exit_blocked_invariant === true
    || row.canonical_exit_ledger_blocked_invariant === true
    || extra.canonical_exit_ledger_blocked_invariant === true
  ) {
    return null;
  }
  const rowTransitionEvents = Array.isArray(row.canonical_transition_events) ? row.canonical_transition_events : null;
  const extraTransitionEvents = Array.isArray(extra.canonical_transition_events) ? extra.canonical_transition_events : null;
  const transitionEventsRaw = rowTransitionEvents && rowTransitionEvents.length
    ? rowTransitionEvents
    : (extraTransitionEvents && extraTransitionEvents.length ? extraTransitionEvents : buildTransitionEvents(stage, row));
  const transitionEvents = transitionEventsRaw.map((item) => upper(item)).filter(Boolean);
  if (!transitionEvents.length) return null;
  return {
    exchange: upper(row.exchange),
    symbol: upper(row.symbol || row.symbol_or_pair_id),
    fillId: String(row.fill_id || row.id || "").trim() || null,
    tradeId: toNum(row.trade_id ?? row.external_trade_id ?? extra.external_trade_id),
    tradeMs: toNum(row.trade_ms ?? row.exec_bar_close_time_utc_ms ?? row.updated_at ?? row.created_at),
    createdAt: row.created_at || row.updated_at || null,
    canonicalEvent: buildCanonicalExitEvent({
      stage,
      fallbackEvent,
      simplifiedExitV2Enabled: isSimplifiedExitV2Row(row),
    }) || fallbackEvent,
    transitionEvents,
    chainKey: String(row.canonical_exit_chain_key || extra.canonical_exit_chain_key || row.authoritative_exit_chain_key || extra.authoritative_exit_chain_key || "").trim() || null,
    reason: String(row.canonical_exit_reason || extra.canonical_exit_reason || "").trim() || null,
    entryEventId: String(row.entry_event_id || extra.entry_event_id || "").trim() || null,
    signalDocId: String(row.signal_doc_id || extra.signal_doc_id || row.signal_id || "").trim() || null,
    orderMeta: {
      orderId: toNum(row.external_order_id ?? extra.external_order_id),
      clientOrderId: String(row.external_client_order_id || extra.external_client_order_id || "").trim() || null,
    },
    ledger: buildLedger(row),
    source: "CANONICAL_EXIT_TRANSITION_BACKFILL",
  };
}

function applyRecoveredEntryLineageToPayload(payload = null, recovered = null) {
  if (!payload || typeof payload !== "object") return payload;
  const entryEventId = String(recovered && (recovered.entry_event_id || recovered.entryEventId) || "").trim();
  if (!isAuthoritativeEntryEventId(entryEventId)) return payload;
  const exchange = upper(payload.exchange);
  const symbol = upper(payload.symbol);
  return {
    ...payload,
    entryEventId,
    signalDocId: String(payload.signalDocId || recovered.signal_doc_id || recovered.signalDocId || "").trim() || null,
    chainKey: exchange && symbol
      ? `${exchange}__${symbol}__ENTRY__${entryEventId}`
      : payload.chainKey,
  };
}

async function recoverAuthoritativeEntryLineageForPayload(db, payload) {
  if (!payload || !db) return payload;
  if (!isSyntheticEntryEventId(payload.entryEventId)) return payload;
  const symbol = upper(payload.symbol);
  if (!symbol) return payload;
  try {
    const snap = await db.collection("canonical_exit_transitions")
      .where("symbol", "==", symbol)
      .limit(50)
      .get();
    const maxTradeMs = Number.isFinite(Number(payload.tradeMs)) ? Number(payload.tradeMs) : Infinity;
    const candidates = [];
    snap.forEach((doc) => {
      const row = doc.data() || {};
      const transition = upper(row.canonical_transition_event || row.transition_event);
      if (!["TP1_REACHED", "TRAIL_ACTIVATED", "TRAIL_ACTIVE", "TRAIL_FINAL_EXIT", "TRAIL_HIT"].includes(transition)) return;
      const entryEventId = String(row.entry_event_id || "").trim();
      if (!isAuthoritativeEntryEventId(entryEventId)) return;
      const ts = toNum(row.ts_ms || row.trade_ms || row.created_at_ms) || Date.parse(row.created_at || "");
      if (Number.isFinite(ts) && ts > maxTradeMs + 60 * 1000) return;
      candidates.push({ ...row, entry_event_id: entryEventId, _ts: Number.isFinite(ts) ? ts : 0 });
    });
    candidates.sort((a, b) => Number(b._ts || 0) - Number(a._ts || 0));
    return candidates[0] ? applyRecoveredEntryLineageToPayload(payload, candidates[0]) : payload;
  } catch (_) {
    return payload;
  }
}

async function filterMissingTransitionEvents(db, payload) {
  const missing = [];
  for (const transitionEvent of payload.transitionEvents || []) {
    const id = buildCanonicalExitTransitionId({
      fillId: payload.fillId,
      transitionEvent,
    });
    const snap = await db.collection("canonical_exit_transitions").doc(id).get();
    if (!snap.exists) missing.push(transitionEvent);
  }
  return missing;
}

async function main() {
  const db = getFirestore();
  const sinceIso = new Date(Date.now() - (LOOKBACK_DAYS * 24 * 60 * 60 * 1000)).toISOString();
  let last = null;
  let scanned = 0;
  let candidateFillN = 0;
  let createdFillN = 0;
  let createdTransitionN = 0;
  let skippedExistingFillN = 0;
  const rows = [];
  for (;;) {
    let q = db.collection("fills_paper")
      .where("created_at", ">=", sinceIso)
      .orderBy("created_at", "desc")
      .select(...FILL_SELECT_FIELDS)
      .limit(PAGE_SIZE);
    if (last) q = q.startAfter(last);
    const snap = await q.get();
    if (snap.empty) break;
    for (const doc of snap.docs) {
      const row = { id: doc.id, ...(doc.data() || {}) };
      if (upper(row.exchange) !== "BINANCEFUT") continue;
      scanned += 1;
      let payload = buildCanonicalTransitionPayload(row);
      payload = await recoverAuthoritativeEntryLineageForPayload(db, payload);
      if (!payload || !payload.fillId) continue;
      candidateFillN += 1;
      const missingTransitions = await filterMissingTransitionEvents(db, payload);
      if (!missingTransitions.length) {
        skippedExistingFillN += 1;
        continue;
      }
      const docs = await recordCanonicalExitTransitions({
        ...payload,
        transitionEvents: missingTransitions,
      });
      if (docs.length) createdFillN += 1;
      createdTransitionN += docs.length;
      rows.push({
        fill_id: payload.fillId,
        symbol: payload.symbol,
        canonical_event: payload.canonicalEvent,
        transition_events: missingTransitions,
      });
    }
    if (snap.size < PAGE_SIZE) break;
    last = snap.docs[snap.docs.length - 1];
  }
  console.log(JSON.stringify({
    ok: true,
    lookback_days: LOOKBACK_DAYS,
    scanned_fill_n: scanned,
    candidate_fill_n: candidateFillN,
    created_fill_n: createdFillN,
    created_transition_n: createdTransitionN,
    skipped_existing_fill_n: skippedExistingFillN,
    rows: rows.slice(0, 100),
  }, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BACKFILL_CANONICAL_EXIT_TRANSITIONS_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  __test: {
    upper,
    isSimplifiedExitV2Row,
    buildTransitionEvents,
    buildLedger,
    buildCanonicalTransitionPayload,
    applyRecoveredEntryLineageToPayload,
    FILL_SELECT_FIELDS,
  },
};
