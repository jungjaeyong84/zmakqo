const { getFirestore } = require("./firestore");
const { buildEventEnvelope } = require("../utils/eventEnvelope");
const { deriveSignalDocId } = require("../utils/signalDocId");
const { extractLiveExecutionPolicyTrace, toLiveExecutionPolicyTopLevel } = require("../utils/liveExecutionPolicyTrace");
const { enrichFeaturesWithRegime } = require("../utils/regime");
const { recordUnifiedEvent, buildUnifiedEventDoc } = require("./unifiedEventTimeline");
const { recordFillEvent } = require("./fillEvents");
const { __test: fillEventsTest } = require("./fillEvents");

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
    const cloned = JSON.parse(JSON.stringify(featuresJson));
    return enrichFeaturesWithRegime(cloned).features;
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

function buildExternalFillEventReclassificationPatch({
  current = null,
  event = null,
  intentId = null,
  signalId = null,
  signalDocId = null,
  decisionReason = "INTENT_EVENT_RECLASSIFIED",
  reclassifyReason = "MATCHED_INTENT_EVENT",
  reclassifyScript = null,
} = {}) {
  const doc = current && typeof current === "object" ? current : {};
  const exchange = doc.exchange || null;
  const symbol = doc.symbol || doc.symbol_or_pair_id || null;
  const tf = doc.tf || null;
  const execBarCloseTimeUtcMs = Number(doc.exec_bar_close_time_utc_ms);
  const side = doc.side || null;
  const nextEvent = String(event || "").trim().toUpperCase();
  if (!nextEvent) {
    throw new Error("buildExternalFillEventReclassificationPatch: event required");
  }
  const resolvedIntentId = String(intentId || doc.intent_id || "").trim() || null;
  const nextClassificationVerified = !nextEvent.endsWith("_UNVERIFIED");
  const refs = resolveFillSignalRefs({
    exchange,
    symbol,
    tf,
    signalBarCloseTimeUtcMs: Number(doc.signal_bar_close_time_utc_ms) || null,
    execBarCloseTimeUtcMs,
    event: nextEvent,
    signalId: signalId || doc.signal_id || null,
    signalDocId: signalDocId || doc.signal_doc_id || null,
  });
  const ts = nowIso();
  return {
    event: nextEvent,
    action: nextEvent,
    intent: nextEvent,
    intent_id: resolvedIntentId,
    signal_id: refs.signalId || null,
    signal_doc_id: refs.signalDocId || null,
    decision_reason: decisionReason || "INTENT_EVENT_RECLASSIFIED",
    canonical_event_id: canonicalEventId({
      exchange,
      symbol,
      tf,
      signalBarCloseMs: Number(doc.signal_bar_close_time_utc_ms) || execBarCloseTimeUtcMs,
      event: nextEvent,
      side,
    }),
    trace_meta: buildTraceMeta({
      signalId: refs.signalId || null,
      intentId: resolvedIntentId,
      fillId: doc.fill_id || null,
      runId: doc.run_id || null,
      requestId: doc.request_id || null,
      decisionReason: decisionReason || nextEvent,
    }),
    updated_at: ts,
    reclassified_at: ts,
    reclassify_reason: reclassifyReason || "MATCHED_INTENT_EVENT",
    reclassify_script: reclassifyScript || null,
    classification_verified: nextClassificationVerified,
    classification_issues: nextClassificationVerified
      ? []
      : (Array.isArray(doc.classification_issues) ? doc.classification_issues.slice() : []),
  };
}

function resolveExternalFillPreservedRefs({
  existing = null,
  refs = null,
  intentId = null,
  entryEventId = null,
  entrySignalType = null,
} = {}) {
  const current = existing && typeof existing === "object" ? existing : {};
  const resolvedRefs = refs && typeof refs === "object" ? refs : {};
  return {
    intentId: intentId || current.intent_id || null,
    signalId: resolvedRefs.signalId || current.signal_id || null,
    signalDocId: resolvedRefs.signalDocId || current.signal_doc_id || null,
    entryEventId: entryEventId || current.entry_event_id || null,
    entrySignalType: entrySignalType || current.entry_signal_type || null,
  };
}

async function recordFillUnifiedEventSafe(doc = null, eventSource = "FILLS_PAPER") {
  if (!doc || typeof doc !== "object") return;
  try {
    await recordUnifiedEvent({
      eventKind: "FILL",
      eventSource,
      sourceDocumentId: doc.fill_id || null,
      exchange: doc.exchange,
      symbol: doc.symbol || doc.symbol_or_pair_id,
      event: doc.event,
      traceId: doc.trace_id || doc.idempotency_key || null,
      requestId: doc.request_id || null,
      runId: doc.run_id || null,
      signalId: doc.signal_id || null,
      intentId: doc.intent_id || null,
      fillId: doc.fill_id || null,
      createdAt: doc.created_at || doc.updated_at || null,
      payload: {
        side: doc.side || null,
        qty_pct: Number.isFinite(Number(doc.qty_pct)) ? Number(doc.qty_pct) : null,
        qty_fraction: Number.isFinite(Number(doc.qty_fraction)) ? Number(doc.qty_fraction) : null,
        exec_price: Number.isFinite(Number(doc.exec_price)) ? Number(doc.exec_price) : null,
        decision_reason: doc.decision_reason || null,
        classification_verified: doc.classification_verified !== false,
      },
      raw: doc,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn("[UNIFIED_TIMELINE_FILL_FAIL]", msg);
  }
}

function buildFillSnapshotUnifiedEventDoc(doc = null, eventSource = "FILLS_PAPER") {
  if (!doc || typeof doc !== "object") return null;
  const sourceSuffix = String(doc.updated_at || doc.created_at || nowIso()).trim() || nowIso();
  return buildUnifiedEventDoc({
    eventKind: "FILL",
    eventSource,
    sourceDocumentId: `${doc.fill_id || "UNKNOWN"}__${sourceSuffix}`,
    exchange: doc.exchange,
    symbol: doc.symbol || doc.symbol_or_pair_id,
    event: doc.event,
    traceId: doc.trace_id || doc.idempotency_key || null,
    requestId: doc.request_id || null,
    runId: doc.run_id || null,
    signalId: doc.signal_id || null,
    intentId: doc.intent_id || null,
    fillId: doc.fill_id || null,
    createdAt: doc.created_at || doc.updated_at || null,
    tsMs: doc.updated_at || doc.created_at || null,
    payload: {
      side: doc.side || null,
      qty_pct: Number.isFinite(Number(doc.qty_pct)) ? Number(doc.qty_pct) : null,
      qty_fraction: Number.isFinite(Number(doc.qty_fraction)) ? Number(doc.qty_fraction) : null,
      exec_price: Number.isFinite(Number(doc.exec_price)) ? Number(doc.exec_price) : null,
      decision_reason: doc.decision_reason || null,
      classification_verified: doc.classification_verified !== false,
    },
    raw: doc,
  });
}

async function recordFillMutationEventSafe({
  before = null,
  after = null,
  mutationType = "UPSERT",
  extra = null,
} = {}) {
  const doc = after || before;
  if (!doc || typeof doc !== "object") return;
  try {
    await recordFillEvent({
      fillId: doc.fill_id || null,
      mutationType,
      exchange: doc.exchange || null,
      symbol: doc.symbol || doc.symbol_or_pair_id || null,
      traceId: doc.trace_id || doc.idempotency_key || null,
      requestId: doc.request_id || null,
      runId: doc.run_id || null,
      createdAt: doc.updated_at || doc.created_at || null,
      before,
      after,
      extra,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn("[FILL_EVENT_FAIL]", msg);
  }
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
  extra = null,
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

  if (extra && typeof extra === "object") Object.assign(payload, extra);
  if (normalizedFeaturesJson) payload.features_json = normalizedFeaturesJson;

  const unifiedDoc = buildFillSnapshotUnifiedEventDoc(payload, "FILLS_PAPER_INTERNAL");
  const fillEventDoc = fillEventsTest.buildFillEventDoc({
    fillId: payload.fill_id,
    mutationType: "INTERNAL_INSERT",
    exchange: payload.exchange,
    symbol: payload.symbol || payload.symbol_or_pair_id || null,
    traceId: payload.trace_id || payload.idempotency_key || null,
    requestId: payload.request_id || null,
    runId: payload.run_id || null,
    createdAt: payload.updated_at || payload.created_at || null,
    before: null,
    after: payload,
    extra: {
      intent_id: intentId || null,
      execution_mode: executionMode || null,
    },
    deterministicKey: `${payload.fill_id}|INTERNAL_INSERT|${payload.updated_at || payload.created_at || ""}`,
  });
  const fillEventUnifiedDoc = fillEventsTest.buildFillEventUnifiedDoc(fillEventDoc);
  await db.runTransaction(async (tx) => {
    tx.set(ref, payload, { merge: false });
    if (unifiedDoc) tx.set(db.collection("unified_event_timeline").doc(unifiedDoc.unified_event_id), unifiedDoc, { merge: false });
    tx.set(db.collection("fill_events").doc(fillEventDoc.fill_event_id), fillEventDoc, { merge: false });
    tx.set(db.collection("unified_event_timeline").doc(fillEventUnifiedDoc.unified_event_id), fillEventUnifiedDoc, { merge: false });
  });
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
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const createdNew = !snap.exists;
    const now = nowIso();
    const existing = snap.exists ? (snap.data() || null) : null;
    const created_at = existing && existing.created_at ? existing.created_at : (createdAt || now);
    const previousEvent = String(existing && existing.event || "").trim().toUpperCase() || null;
    const preservedRefs = resolveExternalFillPreservedRefs({
      existing,
      refs,
      intentId,
      entryEventId,
      entrySignalType,
    });
    const preservedIntentId = preservedRefs.intentId;
    const preservedSignalId = preservedRefs.signalId;
    const preservedSignalDocId = preservedRefs.signalDocId;
    const preservedEntryEventId = preservedRefs.entryEventId;
    const preservedEntrySignalType = preservedRefs.entrySignalType;

    const qtyPctVal = (qtyPct === null || qtyPct === undefined || qtyPct === "") ? null : Number(qtyPct);
    const qtyFractionVal = (qtyFraction === null || qtyFraction === undefined || qtyFraction === "") ? null : Number(qtyFraction);

    const normalizedFeaturesJson = normalizeFeaturesJson(featuresJson);
    const liveExecPolicyTopLevel = toLiveExecutionPolicyTopLevel(extractLiveExecutionPolicyTrace(normalizedFeaturesJson));
    const payload = {
      fill_id: fillId,
      ...buildEventEnvelope({
        requestId,
        runId,
        signalId: preservedSignalId,
        intentId: preservedIntentId,
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
      intent_id: preservedIntentId,
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
      signal_id: preservedSignalId,
      signal_doc_id: preservedSignalDocId,
      canonical_event_id: canonicalEventId({ exchange, symbol, tf, signalBarCloseMs: signalBarCloseTimeUtcMs || execBarCloseTimeUtcMs, event, side }),
      signal_price: (signalPrice == null ? null : Number(signalPrice)),
      signal_price_diff: (signalPriceDiff == null ? null : Number(signalPriceDiff)),
      signal_price_diff_pct: (signalPriceDiffPct == null ? null : Number(signalPriceDiffPct)),
      signal_price_source: signalPriceSource || null,
      decision_reason: decisionReason || null,
      entry_event_id: preservedEntryEventId,
      entry_signal_type: preservedEntrySignalType,
      leverage_applied: (leverageApplied == null ? null : Number(leverageApplied)),
      applied_leverage: (leverageApplied == null ? null : Number(leverageApplied)),
      leverage_reason: leverageReason || null,
      ...liveExecPolicyTopLevel,
      trace_meta: buildTraceMeta({
        signalId: preservedSignalId,
        intentId: preservedIntentId,
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

    if (extra && typeof extra === "object") Object.assign(payload, extra);
    if (normalizedFeaturesJson) payload.features_json = normalizedFeaturesJson;

    const unifiedDoc = buildFillSnapshotUnifiedEventDoc(payload, "FILLS_PAPER_EXTERNAL");
    const mutationType = createdNew ? "EXTERNAL_INSERT" : "EXTERNAL_MERGE";
    const fillEventDoc = fillEventsTest.buildFillEventDoc({
      fillId,
      mutationType,
      exchange: payload.exchange,
      symbol: payload.symbol || payload.symbol_or_pair_id || null,
      traceId: payload.trace_id || payload.idempotency_key || null,
      requestId: payload.request_id || null,
      runId: payload.run_id || null,
      createdAt: payload.updated_at || payload.created_at || null,
      before: existing,
      after: payload,
      extra: {
        inserted: createdNew,
        classification_verified: payload.classification_verified !== false,
      },
      deterministicKey: `${fillId}|${mutationType}|${payload.updated_at || payload.created_at || ""}`,
    });
    const fillEventUnifiedDoc = fillEventsTest.buildFillEventUnifiedDoc(fillEventDoc);

    tx.set(ref, payload, { merge: true });
    if (unifiedDoc) tx.set(db.collection("unified_event_timeline").doc(unifiedDoc.unified_event_id), unifiedDoc, { merge: false });
    tx.set(db.collection("fill_events").doc(fillEventDoc.fill_event_id), fillEventDoc, { merge: false });
    tx.set(db.collection("unified_event_timeline").doc(fillEventUnifiedDoc.unified_event_id), fillEventUnifiedDoc, { merge: false });
    const nextEvent = String(payload.event || "").trim().toUpperCase() || null;
    return {
      ok: true,
      fill_id: fillId,
      inserted: createdNew,
      previous_event: previousEvent,
      event: nextEvent,
      event_changed: previousEvent !== nextEvent,
    };
  });
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
    const nextDoc = { ...current, ...payload };
    const unifiedDoc = buildFillSnapshotUnifiedEventDoc(nextDoc, "FILLS_PAPER_UNVERIFIED");
    const fillEventDoc = fillEventsTest.buildFillEventDoc({
      fillId,
      mutationType: "MARK_UNVERIFIED",
      exchange: nextDoc.exchange,
      symbol: nextDoc.symbol || nextDoc.symbol_or_pair_id || null,
      traceId: nextDoc.trace_id || nextDoc.idempotency_key || null,
      requestId: nextDoc.request_id || null,
      runId: nextDoc.run_id || null,
      createdAt: nextDoc.updated_at || nextDoc.created_at || null,
      before: current,
      after: nextDoc,
      extra: {
        classification_issues: Array.isArray(nextDoc.classification_issues) ? nextDoc.classification_issues.slice() : [],
      },
      deterministicKey: `${fillId}|MARK_UNVERIFIED|${nextDoc.updated_at || nextDoc.created_at || ""}`,
    });
    const fillEventUnifiedDoc = fillEventsTest.buildFillEventUnifiedDoc(fillEventDoc);
    tx.set(ref, payload, { merge: true });
    if (unifiedDoc) tx.set(db.collection("unified_event_timeline").doc(unifiedDoc.unified_event_id), unifiedDoc, { merge: false });
    tx.set(db.collection("fill_events").doc(fillEventDoc.fill_event_id), fillEventDoc, { merge: false });
    tx.set(db.collection("unified_event_timeline").doc(fillEventUnifiedDoc.unified_event_id), fillEventUnifiedDoc, { merge: false });
    result = {
      ok: true,
      fill_id: fillId,
      event: payload.event,
      before: current,
      doc: nextDoc,
    };
  });
  if (result.ok === true && result.doc) {
    delete result.before;
    delete result.doc;
  }
  return result;
}

async function reclassifyExternalFillEvent({
  fillId,
  event,
  intentId = null,
  signalId = null,
  signalDocId = null,
  decisionReason = "INTENT_EVENT_RECLASSIFIED",
  reclassifyReason = "MATCHED_INTENT_EVENT",
  reclassifyScript = null,
} = {}) {
  if (!fillId) throw new Error("reclassifyExternalFillEvent: fillId required");
  if (!event) throw new Error("reclassifyExternalFillEvent: event required");
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
    const currentEvent = String(current.event || "").trim().toUpperCase();
    const nextEvent = String(event || "").trim().toUpperCase();
    const currentIntentId = String(current.intent_id || "").trim() || null;
    const currentSignalId = String(current.signal_id || "").trim() || null;
    const currentSignalDocId = String(current.signal_doc_id || "").trim() || null;
    const nextIntentId = String(intentId || current.intent_id || "").trim() || null;
    const nextSignalId = String(signalId || current.signal_id || current.signal_doc_id || "").trim() || null;
    const nextSignalDocId = String(signalDocId || current.signal_doc_id || current.signal_id || "").trim() || null;
    const nextClassificationVerified = !nextEvent.endsWith("_UNVERIFIED");
    const currentClassificationVerified = current.classification_verified !== false;
    if (
      currentEvent === nextEvent
      && currentIntentId === nextIntentId
      && currentSignalId === nextSignalId
      && currentSignalDocId === nextSignalDocId
      && currentClassificationVerified === nextClassificationVerified
    ) {
      result = { ok: true, skipped: true, reason: "EVENT_AND_REFS_UNCHANGED", fill_id: fillId, event: currentEvent };
      return;
    }
    const payload = buildExternalFillEventReclassificationPatch({
      current,
      event: nextEvent,
      intentId,
      signalId,
      signalDocId,
      decisionReason,
      reclassifyReason,
      reclassifyScript,
    });
    const nextDoc = { ...current, ...payload };
    const unifiedDoc = buildFillSnapshotUnifiedEventDoc(nextDoc, "FILLS_PAPER_RECLASSIFIED");
    const fillEventDoc = fillEventsTest.buildFillEventDoc({
      fillId,
      mutationType: "RECLASSIFY_EVENT",
      exchange: nextDoc.exchange,
      symbol: nextDoc.symbol || nextDoc.symbol_or_pair_id || null,
      traceId: nextDoc.trace_id || nextDoc.idempotency_key || null,
      requestId: nextDoc.request_id || null,
      runId: nextDoc.run_id || null,
      createdAt: nextDoc.updated_at || nextDoc.created_at || null,
      before: current,
      after: nextDoc,
      extra: {
        from_event: current && current.event ? current.event : null,
        to_event: nextDoc.event || null,
        intent_id: nextDoc.intent_id || null,
        signal_id: nextDoc.signal_id || null,
        reclassify_reason: nextDoc.reclassify_reason || null,
      },
      deterministicKey: `${fillId}|RECLASSIFY_EVENT|${nextDoc.updated_at || nextDoc.created_at || ""}`,
    });
    const fillEventUnifiedDoc = fillEventsTest.buildFillEventUnifiedDoc(fillEventDoc);
    tx.set(ref, payload, { merge: true });
    if (unifiedDoc) tx.set(db.collection("unified_event_timeline").doc(unifiedDoc.unified_event_id), unifiedDoc, { merge: false });
    tx.set(db.collection("fill_events").doc(fillEventDoc.fill_event_id), fillEventDoc, { merge: false });
    tx.set(db.collection("unified_event_timeline").doc(fillEventUnifiedDoc.unified_event_id), fillEventUnifiedDoc, { merge: false });
    result = {
      ok: true,
      fill_id: fillId,
      event: nextEvent,
      before: current,
      doc: nextDoc,
    };
  });
  if (result.ok === true && result.doc) {
    delete result.before;
    delete result.doc;
  }
  return result;
}

module.exports = {
  upsertFill,
  upsertExternalFill,
  markExternalFillUnverified,
  reclassifyExternalFillEvent,
  __test: {
    shouldRequireLineageForFill,
    resolveFillSignalRefs,
    canonicalEventId,
    normalizeFeaturesJson,
    buildExternalFillUnverifiedPatch,
    buildExternalFillEventReclassificationPatch,
    resolveExternalFillPreservedRefs,
  },
};
