const { getFirestore } = require("./firestore");
const { buildEventEnvelope } = require("../utils/eventEnvelope");
const { deriveSignalDocId } = require("../utils/signalDocId");
const { extractLiveExecutionPolicyTrace, toLiveExecutionPolicyTopLevel } = require("../utils/liveExecutionPolicyTrace");

const LINEAGE_STRICT_ENABLED = String(process.env.LINEAGE_STRICT_ENABLED || "1").trim() !== "0";

function nowIso() {
  return new Date().toISOString();
}

function normalizeOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function normalizeFeaturesJson(featuresJson) {
  if (!featuresJson || typeof featuresJson !== "object" || Array.isArray(featuresJson)) return null;
  try {
    return JSON.parse(JSON.stringify(featuresJson));
  } catch (_err) {
    return null;
  }
}

function shouldRequireLineageForFill(event) {
  const ev = String(event || "").trim().toUpperCase();
  if (!ev) return false;
  if (ev.startsWith("EXIT_")) return false;
  if (ev.includes("EXTERNAL_SYNC")) return false;
  if (ev.includes("RECONCILED")) return false;
  return true;
}

function resolveFillSignalRefs({
  exchange,
  symbol,
  tf,
  signalBarCloseTimeUtcMs = null,
  execBarCloseTimeUtcMs = null,
  event = null,
  signalId = null,
  signalDocId = null,
} = {}) {
  let resolvedSignalId = String(signalId || "").trim() || null;
  const resolvedSignalDocId = String(
    signalDocId
    || deriveSignalDocId({
      exchange,
      symbol,
      tf,
      barCloseMs: signalBarCloseTimeUtcMs || execBarCloseTimeUtcMs,
      event,
      signalId: resolvedSignalId,
    })
    || ""
  ).trim() || null;
  if (!resolvedSignalId && resolvedSignalDocId) resolvedSignalId = resolvedSignalDocId;
  return {
    signalId: resolvedSignalId,
    signalDocId: resolvedSignalDocId,
  };
}

function buildTraceMeta({ signalId = null, intentId = null, fillId = null, runId = null, requestId = null, decisionReason = null } = {}) {
  return [
    signalId ? `signal:${signalId}` : null,
    intentId ? `intent:${intentId}` : null,
    fillId ? `fill:${fillId}` : null,
    runId ? `run:${runId}` : null,
    requestId ? `req:${requestId}` : null,
    decisionReason ? `reason:${decisionReason}` : null,
  ].filter(Boolean).join(" | ") || null;
}

function canonicalEventId({ exchange, symbol, tf, signalBarCloseMs, event, side }) {
  return [
    "EVENT",
    String(exchange || "").trim().toUpperCase(),
    String(symbol || "").trim().toUpperCase(),
    String(tf || "").trim(),
    String(signalBarCloseMs || "").trim(),
    String(event || "").trim().toUpperCase(),
    String(side || "").trim().toUpperCase(),
  ].join("__");
}

function buildExternalFillUnverifiedPatch({
  current = null,
  event = null,
  issues = [],
  decisionReason = "PROJECTION_MISMATCH_UNVERIFIED",
} = {}) {
  const doc = current && typeof current === "object" ? current : {};
  const exchange = doc.exchange || null;
  const symbol = doc.symbol || doc.symbol_or_pair_id || null;
  const tf = doc.tf || null;
  const execBarCloseTimeUtcMs = Number(doc.exec_bar_close_time_utc_ms);
  const side = doc.side || null;
  const baseEvent = String(event || doc.event || "").trim().toUpperCase() || "UNKNOWN";
  const unverifiedEvent = baseEvent.endsWith("_UNVERIFIED") ? baseEvent : `${baseEvent}_UNVERIFIED`;
  return {
    event: unverifiedEvent,
    decision_reason: decisionReason || "PROJECTION_MISMATCH_UNVERIFIED",
    canonical_event_id: canonicalEventId({
      exchange,
      symbol,
      tf,
      signalBarCloseMs: Number(doc.signal_bar_close_time_utc_ms) || execBarCloseTimeUtcMs,
      event: unverifiedEvent,
      side,
    }),
    classification_verified: false,
    classification_issues: Array.isArray(issues) ? issues.slice() : [],
    updated_at: nowIso(),
  };
}

// fills_paper: intent 실행 결과(체결) 기록
async function upsertFill({
  intentId,
  tradeId = null,
  runId,
  exchange,
  symbol,
  tf,
  execBarCloseTimeUtc,
  execBarCloseTimeUtcMs,
  side,
  event,
  qtyPct,
  execPrice,
  feeBps,
  slippageBps,
  feeValue,
  notional,
  notionalKrw = null,
  budgetMaxKrw = null,
  budgetUsedKrw = null,
  qtyFraction = null,
  execPriceSource = "BAR_OPEN",
  executionMode = null,
  liveOrderId = null,
  execQtyBase = null,
  entryEventId = null,
  entrySignalType = null,
  signalDocId = null,

  // P1 증거 필드
  signalBarCloseTimeUtcMs = null,
  signalId = null,
  signalPrice = null,
  signalPriceDiff = null,
  signalPriceDiffPct = null,
  signalPriceSource = null,
  leverageApplied = null,
  leverageReason = null,
  featuresJson = null,
  requestId = null,
  decisionReason = null,
} = {}) {
  const db = getFirestore();

  if (!intentId) throw new Error("upsertFill: intentId required");
  const refs = resolveFillSignalRefs({
    exchange,
    symbol,
    tf,
    signalBarCloseTimeUtcMs,
    execBarCloseTimeUtcMs,
    event,
    signalId,
    signalDocId,
  });
  if (LINEAGE_STRICT_ENABLED && shouldRequireLineageForFill(event)) {
    if (!refs.signalDocId) throw new Error("FILL_LINEAGE_SIGNAL_DOC_ID_REQUIRED");
    if (!refs.signalId) throw new Error("FILL_LINEAGE_SIGNAL_ID_REQUIRED");
  }
  const ref = db.collection("fills_paper").doc(); // auto id

  const normalizedFeaturesJson = normalizeFeaturesJson(featuresJson);
  const liveExecPolicyTopLevel = toLiveExecutionPolicyTopLevel(extractLiveExecutionPolicyTrace(normalizedFeaturesJson));
  const payload = {
    fill_id: ref.id,
    ...buildEventEnvelope({
      requestId,
      runId,
      signalId: refs.signalId,
      intentId,
      event,
      exchange,
      symbol,
      tf,
      decisionReason: decisionReason || event,
      action: event,
      intent: event,
      executionMode,
      source: execPriceSource,
      barCloseMs: execBarCloseTimeUtcMs,
    }),
    intent_id: intentId,
    trade_id: tradeId || null,
    run_id: runId || null,

    exchange,
    symbol,
    tf,

    exec_bar_close_time_utc: execBarCloseTimeUtc || null,
    exec_bar_close_time_utc_ms: (typeof execBarCloseTimeUtcMs === "number") ? execBarCloseTimeUtcMs : Number(execBarCloseTimeUtcMs),

    side,
    event,
    qty_pct: (typeof qtyPct === "number") ? qtyPct : Number(qtyPct),
    qty_fraction: (qtyFraction == null ? null : Number(qtyFraction)),
    exec_price: Number(execPrice),

    fee_bps: Number(feeBps || 0),
    slippage_bps: normalizeOptionalNumber(slippageBps),
    fee_value: (feeValue === null || feeValue === undefined) ? null : Number(feeValue),
    notional: (notional === null || notional === undefined) ? null : Number(notional),
    notional_krw: (notionalKrw === null || notionalKrw === undefined) ? null : Number(notionalKrw),
    budget_max_krw: (budgetMaxKrw === null || budgetMaxKrw === undefined) ? null : Number(budgetMaxKrw),
    budget_used_krw: (budgetUsedKrw === null || budgetUsedKrw === undefined) ? null : Number(budgetUsedKrw),

    // P1 증거(재현/감사)
    exec_price_source: execPriceSource || "BAR_OPEN",
    execution_mode: executionMode || null,
    live_order_id: liveOrderId || null,
    exec_qty_base: (execQtyBase == null ? null : Number(execQtyBase)),
    signal_bar_close_time_utc_ms: (typeof signalBarCloseTimeUtcMs === "number") ? signalBarCloseTimeUtcMs : (signalBarCloseTimeUtcMs == null ? null : Number(signalBarCloseTimeUtcMs)),
    signal_id: refs.signalId || null,
    signal_doc_id: refs.signalDocId || null,
    canonical_event_id: canonicalEventId({ exchange, symbol, tf, signalBarCloseMs: signalBarCloseTimeUtcMs || execBarCloseTimeUtcMs, event, side }),
    signal_price: (signalPrice == null ? null : Number(signalPrice)),
    signal_price_diff: (signalPriceDiff == null ? null : Number(signalPriceDiff)),
    signal_price_diff_pct: (signalPriceDiffPct == null ? null : Number(signalPriceDiffPct)),
    signal_price_source: signalPriceSource || null,
    decision_reason: decisionReason || null,
    entry_event_id: entryEventId || null,
    entry_signal_type: entrySignalType || null,
    leverage_applied: (leverageApplied == null ? null : Number(leverageApplied)),
    applied_leverage: (leverageApplied == null ? null : Number(leverageApplied)),
    leverage_reason: leverageReason || null,
    ...liveExecPolicyTopLevel,
    trace_meta: buildTraceMeta({
      signalId: refs.signalId || null,
      intentId,
      fillId: ref.id,
      runId,
      requestId,
      decisionReason: decisionReason || event || null,
    }),

    created_at: nowIso(),
    updated_at: nowIso(),
  };

  if (normalizedFeaturesJson) payload.features_json = normalizedFeaturesJson;

  await ref.set(payload, { merge: false });
  return { ok: true, fill_id: ref.id };
}

async function upsertExternalFill({
  fillId,
  intentId,
  tradeId = null,
  runId,
  exchange,
  symbol,
  tf,
  execBarCloseTimeUtc,
  execBarCloseTimeUtcMs,
  side,
  event,
  qtyPct,
  execPrice,
  feeBps,
  slippageBps,
  feeValue,
  notional,
  notionalKrw = null,
  budgetMaxKrw = null,
  budgetUsedKrw = null,
  qtyFraction = null,
  execPriceSource = "BINANCE_USER_TRADES",
  executionMode = null,
  liveOrderId = null,
  execQtyBase = null,
  entryEventId = null,
  entrySignalType = null,
  signalDocId = null,
  signalBarCloseTimeUtcMs = null,
  signalId = null,
  signalPrice = null,
  signalPriceDiff = null,
  signalPriceDiffPct = null,
  signalPriceSource = null,
  leverageApplied = null,
  leverageReason = null,
  featuresJson = null,
  createdAt = null,
  extra = null,
  requestId = null,
  decisionReason = null,
} = {}) {
  const db = getFirestore();
  if (!fillId) throw new Error("upsertExternalFill: fillId required");
  const refs = resolveFillSignalRefs({
    exchange,
    symbol,
    tf,
    signalBarCloseTimeUtcMs,
    execBarCloseTimeUtcMs,
    event,
    signalId,
    signalDocId,
  });
  if (LINEAGE_STRICT_ENABLED && shouldRequireLineageForFill(event)) {
    if (!refs.signalDocId) throw new Error("FILL_LINEAGE_SIGNAL_DOC_ID_REQUIRED");
    if (!refs.signalId) throw new Error("FILL_LINEAGE_SIGNAL_ID_REQUIRED");
  }
  const ref = db.collection("fills_paper").doc(fillId);
  const snap = await ref.get();
  const createdNew = !snap.exists;
  const now = nowIso();
  const existing = snap.exists ? snap.data() : null;
  const created_at = existing && existing.created_at ? existing.created_at : (createdAt || now);

  const qtyPctVal = (qtyPct === null || qtyPct === undefined || qtyPct === "") ? null : Number(qtyPct);
  const qtyFractionVal = (qtyFraction === null || qtyFraction === undefined || qtyFraction === "") ? null : Number(qtyFraction);

  const normalizedFeaturesJson = normalizeFeaturesJson(featuresJson);
  const liveExecPolicyTopLevel = toLiveExecutionPolicyTopLevel(extractLiveExecutionPolicyTrace(normalizedFeaturesJson));
  const payload = {
    fill_id: fillId,
    ...buildEventEnvelope({
      requestId,
      runId,
      signalId: refs.signalId,
      intentId,
      event,
      exchange,
      symbol,
      tf,
      decisionReason: decisionReason || event,
      action: event,
      intent: event,
      executionMode,
      source: execPriceSource,
      barCloseMs: execBarCloseTimeUtcMs,
      createdAt,
    }),
    intent_id: intentId || null,
    trade_id: tradeId || null,
    run_id: runId || null,

    exchange,
    symbol,
    tf,

    exec_bar_close_time_utc: execBarCloseTimeUtc || null,
    exec_bar_close_time_utc_ms: (typeof execBarCloseTimeUtcMs === "number") ? execBarCloseTimeUtcMs : Number(execBarCloseTimeUtcMs),

    side,
    event,
    qty_pct: Number.isFinite(qtyPctVal) ? qtyPctVal : null,
    qty_fraction: Number.isFinite(qtyFractionVal) ? qtyFractionVal : null,
    exec_price: Number(execPrice),

    fee_bps: Number(feeBps || 0),
    slippage_bps: normalizeOptionalNumber(slippageBps),
    fee_value: (feeValue === null || feeValue === undefined) ? null : Number(feeValue),
    notional: (notional === null || notional === undefined) ? null : Number(notional),
    notional_krw: (notionalKrw === null || notionalKrw === undefined) ? null : Number(notionalKrw),
    budget_max_krw: (budgetMaxKrw === null || budgetMaxKrw === undefined) ? null : Number(budgetMaxKrw),
    budget_used_krw: (budgetUsedKrw === null || budgetUsedKrw === undefined) ? null : Number(budgetUsedKrw),

    exec_price_source: execPriceSource || "BINANCE_USER_TRADES",
    execution_mode: executionMode || null,
    live_order_id: liveOrderId || null,
    exec_qty_base: (execQtyBase == null ? null : Number(execQtyBase)),
    signal_bar_close_time_utc_ms: (typeof signalBarCloseTimeUtcMs === "number") ? signalBarCloseTimeUtcMs : (signalBarCloseTimeUtcMs == null ? null : Number(signalBarCloseTimeUtcMs)),
    signal_id: refs.signalId || null,
    signal_doc_id: refs.signalDocId || null,
    canonical_event_id: canonicalEventId({ exchange, symbol, tf, signalBarCloseMs: signalBarCloseTimeUtcMs || execBarCloseTimeUtcMs, event, side }),
    signal_price: (signalPrice == null ? null : Number(signalPrice)),
    signal_price_diff: (signalPriceDiff == null ? null : Number(signalPriceDiff)),
    signal_price_diff_pct: (signalPriceDiffPct == null ? null : Number(signalPriceDiffPct)),
    signal_price_source: signalPriceSource || null,
    decision_reason: decisionReason || null,
    entry_event_id: entryEventId || null,
    entry_signal_type: entrySignalType || null,
    leverage_applied: (leverageApplied == null ? null : Number(leverageApplied)),
    applied_leverage: (leverageApplied == null ? null : Number(leverageApplied)),
    leverage_reason: leverageReason || null,
    ...liveExecPolicyTopLevel,
    trace_meta: buildTraceMeta({
      signalId: refs.signalId || null,
      intentId: intentId || null,
      fillId,
      runId,
      requestId,
      decisionReason: decisionReason || event || null,
    }),

    created_at,
    updated_at: now,
    classification_verified: existing && existing.classification_verified === false ? false : true,
    classification_issues: existing && existing.classification_verified === false
      ? (Array.isArray(existing.classification_issues) ? existing.classification_issues.slice() : [])
      : [],
  };

  if (extra && typeof extra === "object") {
    Object.assign(payload, extra);
  }
  if (normalizedFeaturesJson) payload.features_json = normalizedFeaturesJson;

  await ref.set(payload, { merge: true });
  return { ok: true, fill_id: fillId, inserted: createdNew };
}

async function markExternalFillUnverified({
  fillId,
  event,
  issues = [],
  decisionReason = "PROJECTION_MISMATCH_UNVERIFIED",
} = {}) {
  if (!fillId) throw new Error("markExternalFillUnverified: fillId required");
  const db = getFirestore();
  const ref = db.collection("fills_paper").doc(fillId);
  let result = { ok: false, skipped: true, reason: "UNKNOWN", fill_id: fillId };
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) {
      result = { ok: false, skipped: true, reason: "FILL_NOT_FOUND", fill_id: fillId };
      return;
    }
    const current = snap.data() || {};
    const payload = buildExternalFillUnverifiedPatch({
      current,
      event,
      issues,
      decisionReason,
    });
    tx.set(ref, payload, { merge: true });
    result = { ok: true, fill_id: fillId, event: payload.event };
  });
  return result;
}

module.exports = {
  upsertFill,
  upsertExternalFill,
  markExternalFillUnverified,
  __test: {
    shouldRequireLineageForFill,
    resolveFillSignalRefs,
    canonicalEventId,
    buildExternalFillUnverifiedPatch,
  },
};
