const { getFirestore } = require("./firestore");
const { clearTpP1PendingIfUnchanged } = require("./positionsPaper");
const { tfToMs } = require("../utils/marketConfig");
const { enrichFeaturesWithRegime } = require("../utils/regime");
const { resolveEventMapping } = require("../services/signalMapping");
const { sendSignalDroppedAlert } = require("../services/signalLifecycleAlert");
const { deriveSignalDocId } = require("../utils/signalDocId");
const { isIntentCanceledLikeStatus, classifyIntentTerminalStatus } = require("../utils/intentStatus");
const { buildEventEnvelope } = require("../utils/eventEnvelope");
const { extractLiveExecutionPolicyTrace, toLiveExecutionPolicyTopLevel } = require("../utils/liveExecutionPolicyTrace");
const { recordUnifiedEvent, buildUnifiedEventDoc } = require("./unifiedEventTimeline");
const { recordOrderIntentEvent } = require("./orderIntentEvents");
const { __test: orderIntentEventsTest } = require("./orderIntentEvents");

const LINEAGE_STRICT_ENABLED = String(process.env.LINEAGE_STRICT_ENABLED || "1").trim() !== "0";

function nowIso(){ return new Date().toISOString(); }
function isTpP1Event(event) {
  const ev = String(event || "").toUpperCase();
  return ev === "EXIT_TP_P1" || ev.startsWith("EXIT_TP_P1_");
}
function intentId({exchange,symbol,tf,signalBarCloseMs,event}){
  return `INTENT__${exchange}__${symbol}__${tf}__${signalBarCloseMs}__${event}`;
}
function intentScopeKey({ exchange, symbol, tf }) {
  return `${exchange}__${symbol}__${tf}`;
}
function execKey({ exchange, symbol, tf, execBarCloseMs }) {
  if (!Number.isFinite(Number(execBarCloseMs))) return null;
  return `${exchange}__${symbol}__${tf}__${execBarCloseMs}`;
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

function shouldRequireLineageForEvent(event) {
  const ev = String(event || "").trim().toUpperCase();
  if (!ev) return false;
  if (ev.startsWith("EXIT_")) return false;
  if (ev.startsWith("FORCE_EXIT")) return false;
  if (ev.includes("EXTERNAL_SYNC")) return false;
  return true;
}

function buildTraceMeta({ signalId = null, intentId = null, runId = null, requestId = null, decisionReason = null } = {}) {
  return [
    signalId ? `signal:${signalId}` : null,
    intentId ? `intent:${intentId}` : null,
    runId ? `run:${runId}` : null,
    requestId ? `req:${requestId}` : null,
    decisionReason ? `reason:${decisionReason}` : null,
  ].filter(Boolean).join(" | ") || null;
}

async function recordIntentUnifiedEventSafe(doc = null, eventSource = "ORDER_INTENTS_PAPER") {
  if (!doc || typeof doc !== "object") return;
  try {
    await recordUnifiedEvent({
      eventKind: "INTENT",
      eventSource,
      sourceDocumentId: doc.intent_id || null,
      exchange: doc.exchange,
      symbol: doc.symbol_or_pair_id || doc.symbol,
      event: doc.event,
      traceId: doc.trace_id || null,
      requestId: doc.request_id || null,
      runId: doc.run_id || null,
      signalId: doc.signal_id || null,
      intentId: doc.intent_id || null,
      createdAt: doc.created_at || doc.updated_at || null,
      payload: {
        status: doc.status || null,
        side: doc.side || null,
        event_intent: doc.event_intent || null,
        qty_pct: Number.isFinite(Number(doc.qty_pct)) ? Number(doc.qty_pct) : null,
        decision_reason: doc.decision_reason || null,
      },
      raw: doc,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn("[UNIFIED_TIMELINE_INTENT_FAIL]", msg);
  }
}

function buildIntentSnapshotUnifiedEventDoc(doc = null, eventSource = "ORDER_INTENTS_PAPER") {
  if (!doc || typeof doc !== "object") return null;
  const sourceSuffix = String(doc.updated_at || doc.created_at || nowIso()).trim() || nowIso();
  return buildUnifiedEventDoc({
    eventKind: "INTENT",
    eventSource,
    sourceDocumentId: `${doc.intent_id || "UNKNOWN"}__${sourceSuffix}`,
    exchange: doc.exchange,
    symbol: doc.symbol_or_pair_id || doc.symbol,
    event: doc.event,
    traceId: doc.trace_id || null,
    requestId: doc.request_id || null,
    runId: doc.run_id || null,
    signalId: doc.signal_id || null,
    intentId: doc.intent_id || null,
    createdAt: doc.created_at || doc.updated_at || null,
    tsMs: doc.updated_at || doc.created_at || null,
    payload: {
      status: doc.status || null,
      side: doc.side || null,
      event_intent: doc.event_intent || null,
      qty_pct: Number.isFinite(Number(doc.qty_pct)) ? Number(doc.qty_pct) : null,
      decision_reason: doc.decision_reason || null,
    },
    raw: doc,
  });
}

async function recordIntentMutationEventSafe({
  before = null,
  after = null,
  mutationType = "UPSERT",
  extra = null,
} = {}) {
  const doc = after || before;
  if (!doc || typeof doc !== "object") return;
  try {
    await recordOrderIntentEvent({
      intentId: doc.intent_id || null,
      mutationType,
      exchange: doc.exchange || null,
      symbol: doc.symbol_or_pair_id || doc.symbol || null,
      traceId: doc.trace_id || null,
      requestId: doc.request_id || null,
      runId: doc.run_id || null,
      createdAt: doc.updated_at || doc.created_at || null,
      before,
      after,
      extra,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn("[ORDER_INTENT_EVENT_FAIL]", msg);
  }
}

function intentTtlMs(tf) {
  const envMs = Number(process.env.INTENT_TTL_MS);
  if (Number.isFinite(envMs) && envMs > 0) return envMs;
  const bars = Number(process.env.INTENT_TTL_BARS || 2);
  const tfMs = tfToMs(tf);
  if (Number.isFinite(tfMs) && Number.isFinite(bars) && bars > 0) return Math.round(tfMs * bars);
  return 2 * 60 * 60 * 1000;
}

function resolveIntentSignalRefs({
  exchange,
  symbol,
  tf,
  signalBarCloseTimeUtcMs,
  event,
  signalId = null,
  signalDocId = null,
  features = {},
} = {}) {
  let resolvedSignalId = String(signalId || features.signal_id || "").trim() || null;
  const resolvedSignalDocId = String(
    signalDocId
    || features.signal_doc_id
    || deriveSignalDocId({
      exchange,
      symbol,
      tf,
      barCloseMs: signalBarCloseTimeUtcMs,
      event,
      signalId: resolvedSignalId,
    })
    || ""
  ).trim() || null;
  if (!resolvedSignalId && String(resolvedSignalDocId || "").startsWith("SIG__")) {
    resolvedSignalId = resolvedSignalDocId;
  }
  if (resolvedSignalId && !features.signal_id) features.signal_id = resolvedSignalId;
  if (resolvedSignalDocId && !features.signal_doc_id) features.signal_doc_id = resolvedSignalDocId;
  return {
    signalId: resolvedSignalId,
    signalDocId: resolvedSignalDocId,
    features,
  };
}

async function enrichIntentFeaturesWithSignalRegime({
  features = {},
  signalId = null,
  signalDocId = null,
  signalLookupFn = null,
} = {}) {
  const baseMeta = enrichFeaturesWithRegime(features || {});
  if (baseMeta.regime) return baseMeta;
  const lookupId = String(signalDocId || signalId || "").trim();
  if (!lookupId) return baseMeta;
  let signalRow = null;
  try {
    if (typeof signalLookupFn === "function") {
      signalRow = await signalLookupFn(lookupId);
    } else {
      const snap = await getFirestore().collection("signals").doc(lookupId).get();
      signalRow = snap.exists ? (snap.data() || null) : null;
    }
  } catch (_) {
    signalRow = null;
  }
  if (!signalRow || typeof signalRow !== "object") return baseMeta;
  return enrichFeaturesWithRegime(baseMeta.features, signalRow);
}

async function upsertIntent({
  exchange, symbol, tf,
  signalBarCloseTimeUtc, signalBarCloseTimeUtcMs,
  scheduledExecBarCloseUtc, scheduledExecBarCloseUtcMs,
  event, side, qtyPct, reason, features = {}, runId,
  signalId = null,
  budgetMaxKrw, budgetUsedKrw, qtyFraction,
  signalPrice,
  signalDocId,
  pendingReason,
  pendingNote,
  ttlMs,
  execTf,
  executionMode,
  requestId = null,
  decisionReason = null,
} = {}) {
  const db = getFirestore();
  let regimeMeta = enrichFeaturesWithRegime(features || {});
  let normalizedFeatures = regimeMeta.features;
  const resolvedSignalRefs = resolveIntentSignalRefs({
    exchange,
    symbol,
    tf,
    signalBarCloseTimeUtcMs,
    event,
    signalId,
    signalDocId,
    features: normalizedFeatures,
  });
  let resolvedSignalId = resolvedSignalRefs.signalId;
  const resolvedSignalDocId = resolvedSignalRefs.signalDocId;
  if (!resolvedSignalId && resolvedSignalDocId) resolvedSignalId = resolvedSignalDocId;
  regimeMeta = await enrichIntentFeaturesWithSignalRegime({
    features: resolvedSignalRefs.features,
    signalId: resolvedSignalId,
    signalDocId: resolvedSignalDocId,
  });
  normalizedFeatures = regimeMeta.features;
  if (LINEAGE_STRICT_ENABLED && shouldRequireLineageForEvent(event)) {
    if (!resolvedSignalDocId) {
      throw new Error("LINEAGE_SIGNAL_DOC_ID_REQUIRED");
    }
    if (!resolvedSignalId) {
      throw new Error("LINEAGE_SIGNAL_ID_REQUIRED");
    }
  }
  const mapping = resolveEventMapping({ event, side });
  const liveExecPolicyTrace = extractLiveExecutionPolicyTrace(normalizedFeatures);
  const liveExecPolicyTopLevel = toLiveExecutionPolicyTopLevel(liveExecPolicyTrace);
  const hintedIntent = String(normalizedFeatures && normalizedFeatures._event_intent || "").trim().toUpperCase();
  const useHintedIntent = hintedIntent === "ENTRY" || hintedIntent === "ADD" || hintedIntent === "EXIT";
  const eventIntent = useHintedIntent ? hintedIntent : (mapping.intent || null);
  const id = intentId({ exchange, symbol, tf, signalBarCloseMs: signalBarCloseTimeUtcMs, event });
  const ref = db.collection("order_intents_paper").doc(id);
  const t = nowIso();
  const ttlNum = Number(ttlMs);
  const ttlBaseTf = execTf || tf;
  let ttl = (Number.isFinite(ttlNum) && ttlNum > 0) ? ttlNum : intentTtlMs(ttlBaseTf);
  const ev = String(event || "").toUpperCase();
  if (ev.startsWith("EXIT_")) {
    const exitTtlNum = Number(process.env.EXIT_INTENT_TTL_MS);
    const exitBarsRaw = process.env.EXIT_INTENT_TTL_BARS;
    const exitBars = Number.isFinite(Number(exitBarsRaw)) ? Number(exitBarsRaw) : 8;
    let exitTtl = null;
    if (Number.isFinite(exitTtlNum) && exitTtlNum > 0) {
      exitTtl = exitTtlNum;
    } else if (Number.isFinite(exitBars) && exitBars > 0) {
      const tfMs = tfToMs(ttlBaseTf);
      if (Number.isFinite(tfMs) && tfMs > 0) exitTtl = Math.round(tfMs * exitBars);
    }
    if (Number.isFinite(exitTtl) && exitTtl > ttl) ttl = exitTtl;
  } else {
    const entryTtlNum = Number(process.env.ENTRY_INTENT_TTL_MS);
    const entryBarsRaw = process.env.ENTRY_INTENT_TTL_BARS;
    const entryBars = Number.isFinite(Number(entryBarsRaw)) ? Number(entryBarsRaw) : 8;
    let entryTtl = null;
    if (Number.isFinite(entryTtlNum) && entryTtlNum > 0) {
      entryTtl = entryTtlNum;
    } else if (Number.isFinite(entryBars) && entryBars > 0) {
      const tfMs = tfToMs(ttlBaseTf);
      if (Number.isFinite(tfMs) && tfMs > 0) entryTtl = Math.round(tfMs * entryBars);
    }
    if (Number.isFinite(entryTtl) && entryTtl > ttl) ttl = entryTtl;
  }
  const execMs = Number(scheduledExecBarCloseUtcMs);
  const expiresMs = Number.isFinite(execMs) ? execMs + ttl : null;
  const expiresAt = Number.isFinite(expiresMs) ? new Date(expiresMs).toISOString() : null;
  const scopeKey = intentScopeKey({ exchange, symbol, tf });
  const execKeyValue = execKey({ exchange, symbol, tf, execBarCloseMs: execMs });

  const committedResult = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const featureEntryEventId = String(normalizedFeatures && normalizedFeatures.entry_event_id || "").trim() || null;
    const featureEntrySignalType = String(normalizedFeatures && normalizedFeatures.entry_signal_type || "").toUpperCase() || null;

    if (snap.exists) {
      const cur = snap.data() || {};
      const st = String(cur.status || "PENDING").toUpperCase();

      // ✅ FILLED/CANCELED는 절대 되돌리지 않는다
      if (st === "FILLED" || isIntentCanceledLikeStatus(st)) {
        return {
          doc: cur,
          before: cur,
          mutationType: "UPSERT_SKIPPED_TERMINAL",
        };
      }

      // ✅ status는 건드리지 않고 부가정보만 갱신
      const patch = {
        ...buildEventEnvelope({
          requestId: requestId || cur.request_id || null,
          runId: runId || cur.run_id || null,
          signalId: resolvedSignalId || cur.signal_id || null,
          intentId: id,
          event,
          exchange,
          symbol,
          tf,
          decisionReason: decisionReason || reason || cur.decision_reason || null,
          action: eventIntent || cur.event_intent || null,
          intent: eventIntent || cur.event_intent || null,
          executionMode: executionMode || cur.execution_mode || null,
          source: "INTENT",
          barCloseMs: signalBarCloseTimeUtcMs,
        }),
        run_id: runId || cur.run_id || null,
        request_id: requestId || cur.request_id || null,
        reason: reason || cur.reason || null,
        decision_reason: String(decisionReason || reason || cur.decision_reason || "").trim() || null,
        features_json: normalizedFeatures,
        execution_mode: executionMode || cur.execution_mode || null,
        budget_max_krw: (budgetMaxKrw == null ? cur.budget_max_krw : Number(budgetMaxKrw)),
        budget_used_krw: (budgetUsedKrw == null ? cur.budget_used_krw : Number(budgetUsedKrw)),
        qty_fraction: (qtyFraction == null ? cur.qty_fraction : Number(qtyFraction)),
        event_intent: eventIntent || cur.event_intent || null,
        signal_price: (signalPrice == null ? cur.signal_price : Number(signalPrice)),
        signal_price_source: signalPrice == null ? cur.signal_price_source : "BAR_CLOSE",
        signal_id: resolvedSignalId || cur.signal_id || null,
        signal_doc_id: resolvedSignalDocId || cur.signal_doc_id || null,
        canonical_event_id: cur.canonical_event_id || canonicalEventId({ exchange, symbol, tf, signalBarCloseMs: signalBarCloseTimeUtcMs, event, side }),
        entry_event_id: featureEntryEventId || cur.entry_event_id || null,
        entry_signal_type: featureEntrySignalType || cur.entry_signal_type || null,
        pending_reason: pendingReason || cur.pending_reason || "WAIT_NEXT_BAR",
        pending_note: pendingNote || cur.pending_note || null,
        intent_ttl_ms: Number.isFinite(ttl) ? ttl : (cur.intent_ttl_ms || null),
        expires_at: expiresAt || cur.expires_at || null,
        expires_at_ms: Number.isFinite(expiresMs) ? expiresMs : (cur.expires_at_ms || null),
        intent_scope: cur.intent_scope || scopeKey,
        exec_key: cur.exec_key || execKeyValue,
        regime: regimeMeta.regime || cur.regime || null,
        market_regime: regimeMeta.market_regime || cur.market_regime || null,
        regime_source: regimeMeta.regime_source || cur.regime_source || null,
        ...liveExecPolicyTopLevel,
        trace_meta: buildTraceMeta({
          signalId: resolvedSignalId || cur.signal_id || null,
          intentId: id,
          runId: runId || cur.run_id || null,
          requestId: requestId || cur.request_id || null,
          decisionReason: decisionReason || reason || cur.decision_reason || null,
        }),
        updated_at: t,
      };
      const nextDoc = { ...cur, ...patch };
      const unifiedDoc = buildIntentSnapshotUnifiedEventDoc(nextDoc, "ORDER_INTENTS_PAPER");
      const intentEventDoc = orderIntentEventsTest.buildOrderIntentEventDoc({
        intentId: id,
        mutationType: "UPSERT_PATCH",
        exchange: nextDoc.exchange,
        symbol: nextDoc.symbol_or_pair_id || nextDoc.symbol || null,
        traceId: nextDoc.trace_id || null,
        requestId: nextDoc.request_id || null,
        runId: nextDoc.run_id || null,
        createdAt: nextDoc.updated_at || nextDoc.created_at || null,
        before: cur,
        after: nextDoc,
        extra: {
          execution_mode: nextDoc.execution_mode || null,
          event_intent: nextDoc.event_intent || null,
        },
        deterministicKey: `${id}|UPSERT_PATCH|${nextDoc.updated_at || nextDoc.created_at || ""}`,
      });
      const intentEventUnifiedDoc = orderIntentEventsTest.buildOrderIntentEventUnifiedDoc(intentEventDoc);
      tx.set(ref, patch, { merge: true });
      if (unifiedDoc) tx.set(db.collection("unified_event_timeline").doc(unifiedDoc.unified_event_id), unifiedDoc, { merge: false });
      tx.set(db.collection("order_intent_events").doc(intentEventDoc.intent_event_id), intentEventDoc, { merge: false });
      tx.set(db.collection("unified_event_timeline").doc(intentEventUnifiedDoc.unified_event_id), intentEventUnifiedDoc, { merge: false });
      return {
        doc: nextDoc,
        before: cur,
        mutationType: "UPSERT_PATCH",
      };
    }

    const payload = {
      intent_id: id,
      ...buildEventEnvelope({
        requestId,
        runId,
        signalId: resolvedSignalId,
        intentId: id,
        event,
        exchange,
        symbol,
        tf,
        decisionReason: decisionReason || reason || null,
        action: eventIntent,
        intent: eventIntent,
        executionMode,
        source: "INTENT",
        barCloseMs: signalBarCloseTimeUtcMs,
        createdAt: t,
      }),
      run_id: runId || null,
      request_id: requestId || null,
      exchange,
      symbol_or_pair_id: symbol,
      tf,
      signal_bar_close_time_utc: signalBarCloseTimeUtc || null,
      signal_bar_close_time_utc_ms: Number(signalBarCloseTimeUtcMs),
      scheduled_exec_bar_close_time_utc: scheduledExecBarCloseUtc || null,
      scheduled_exec_bar_close_time_utc_ms: Number(scheduledExecBarCloseUtcMs),
      event,
      side,
      qty_pct: Number(qtyPct),
      qty_fraction: (qtyFraction == null ? null : Number(qtyFraction)),
      event_intent: eventIntent,
      reason: reason || null,
      decision_reason: String(decisionReason || reason || "").trim() || null,
      features_json: normalizedFeatures,
      execution_mode: executionMode || null,
      signal_price: (signalPrice == null ? null : Number(signalPrice)),
      signal_price_source: signalPrice == null ? null : "BAR_CLOSE",
      signal_id: resolvedSignalId,
      signal_doc_id: resolvedSignalDocId,
      canonical_event_id: canonicalEventId({ exchange, symbol, tf, signalBarCloseMs: signalBarCloseTimeUtcMs, event, side }),
      entry_event_id: featureEntryEventId,
      entry_signal_type: featureEntrySignalType,
      budget_max_krw: (budgetMaxKrw == null ? null : Number(budgetMaxKrw)),
      budget_used_krw: (budgetUsedKrw == null ? null : Number(budgetUsedKrw)),
      pending_reason: pendingReason || "WAIT_NEXT_BAR",
      pending_note: pendingNote || null,
      intent_ttl_ms: Number.isFinite(ttl) ? ttl : null,
      expires_at: expiresAt || null,
      expires_at_ms: Number.isFinite(expiresMs) ? expiresMs : null,
      intent_scope: scopeKey,
      exec_key: execKeyValue,
      regime: regimeMeta.regime,
      market_regime: regimeMeta.market_regime,
      regime_source: regimeMeta.regime_source,
      ...liveExecPolicyTopLevel,
      trace_meta: buildTraceMeta({
        signalId: resolvedSignalId,
        intentId: id,
        runId,
        requestId,
        decisionReason: decisionReason || reason || null,
      }),
      status: "PENDING",
      created_at: t,
      updated_at: t,
    };
    const unifiedDoc = buildIntentSnapshotUnifiedEventDoc(payload, "ORDER_INTENTS_PAPER");
    const intentEventDoc = orderIntentEventsTest.buildOrderIntentEventDoc({
      intentId: id,
      mutationType: "UPSERT_CREATE",
      exchange: payload.exchange,
      symbol: payload.symbol_or_pair_id || payload.symbol || null,
      traceId: payload.trace_id || null,
      requestId: payload.request_id || null,
      runId: payload.run_id || null,
      createdAt: payload.updated_at || payload.created_at || null,
      before: null,
      after: payload,
      extra: {
        execution_mode: payload.execution_mode || null,
        event_intent: payload.event_intent || null,
      },
      deterministicKey: `${id}|UPSERT_CREATE|${payload.updated_at || payload.created_at || ""}`,
    });
    const intentEventUnifiedDoc = orderIntentEventsTest.buildOrderIntentEventUnifiedDoc(intentEventDoc);
    tx.set(ref, payload, { merge: true });
    if (unifiedDoc) tx.set(db.collection("unified_event_timeline").doc(unifiedDoc.unified_event_id), unifiedDoc, { merge: false });
    tx.set(db.collection("order_intent_events").doc(intentEventDoc.intent_event_id), intentEventDoc, { merge: false });
    tx.set(db.collection("unified_event_timeline").doc(intentEventUnifiedDoc.unified_event_id), intentEventUnifiedDoc, { merge: false });
    return {
      doc: payload,
      before: null,
      mutationType: "UPSERT_CREATE",
    };
  });
  return committedResult && committedResult.doc ? committedResult.doc : null;
}

async function listPendingIntentsForExec({ exchange, symbol, tf, execBarCloseMs, limitN = 50 } = {}) {
  const db = getFirestore();
  const ms = Number(execBarCloseMs);
  let snap = null;
  const execKeyValue = execKey({ exchange, symbol, tf, execBarCloseMs: ms });
  try {
    if (execKeyValue) {
      snap = await db.collection("order_intents_paper")
        .where("exec_key", "==", execKeyValue)
        .limit(limitN)
        .get();
      if (!snap.empty) {
        return snap.docs.map(d => d.data()).filter((x) => String(x.status || "") === "PENDING");
      }
      const legacyFallback = String(process.env.INTENT_FALLBACK_SCAN || "1") !== "0";
      if (!legacyFallback) return [];
    }
  } catch (e) {
    // Missing index or legacy intent -> fallback scan
  }
  try {
    snap = await db.collection("order_intents_paper")
      .where("exchange", "==", exchange)
      .where("symbol_or_pair_id", "==", symbol)
      .where("tf", "==", tf)
      .where("scheduled_exec_bar_close_time_utc_ms", "==", ms)
      .where("status", "==", "PENDING")
      .limit(limitN)
      .get();
    if (snap.empty) return [];
    return snap.docs.map(d => d.data());
  } catch (e) {
    // Missing composite index -> fallback scan
    snap = await db.collection("order_intents_paper")
      .orderBy("updated_at", "desc")
      .limit(Math.max(80, Number(limitN) * 5))
      .get();
    const out = [];
    snap.forEach((d) => {
      const x = d.data() || {};
      if (String(x.exchange || "") !== String(exchange || "")) return;
      if (String(x.symbol_or_pair_id || "") !== String(symbol || "")) return;
      if (String(x.tf || "") !== String(tf || "")) return;
      if (String(x.status || "") !== "PENDING") return;
      if (Number(x.scheduled_exec_bar_close_time_utc_ms) !== ms) return;
      out.push(x);
    });
    return out.slice(0, Number(limitN) || 50);
  }
}

async function listPendingIntentsOverdue({ exchange, symbol, tf, execBarCloseMs, limitN = 50, lookbackLimit = 600 } = {}) {
  const db = getFirestore();
  const ms = Number(execBarCloseMs);
  if (!Number.isFinite(ms)) return [];
  const nowMs = Date.now();
  const scopeKey = intentScopeKey({ exchange, symbol, tf });

  let snap = null;
  try {
    snap = await db.collection("order_intents_paper")
      .where("intent_scope", "==", scopeKey)
      .limit(Math.max(80, Number(lookbackLimit) || 600))
      .get();
  } catch (_) {
    // fallback to scan
    snap = await db.collection("order_intents_paper")
      .orderBy("updated_at", "desc")
      .limit(Math.max(200, Number(lookbackLimit) || 600))
      .get();
  }

  const out = [];
  snap.forEach((d) => {
    const x = d.data() || {};
    if (String(x.exchange || "") !== String(exchange || "")) return;
    if (String(x.symbol_or_pair_id || "") !== String(symbol || "")) return;
    if (String(x.tf || "") !== String(tf || "")) return;
    if (String(x.status || "") !== "PENDING") return;
    const sched = Number(x.scheduled_exec_bar_close_time_utc_ms);
    if (!Number.isFinite(sched) || sched >= ms) return;
    const expMs = Number(x.expires_at_ms);
    if (Number.isFinite(expMs) && expMs <= nowMs) return;
    out.push(x);
  });

  return out.slice(0, Number(limitN) || 50);
}

async function cancelExpiredPendingIntents({ exchange, symbol, tf, lookbackLimit = 600 } = {}) {
  const db = getFirestore();
  const nowMs = Date.now();
  const scopeKey = intentScopeKey({ exchange, symbol, tf });

  let snap = null;
  try {
    snap = await db.collection("order_intents_paper")
      .where("intent_scope", "==", scopeKey)
      .limit(Math.max(80, Number(lookbackLimit) || 600))
      .get();
  } catch (_) {
    snap = await db.collection("order_intents_paper")
      .orderBy("updated_at", "desc")
      .limit(Math.max(200, Number(lookbackLimit) || 600))
      .get();
  }

  const tasks = [];
  let canceled = 0;
  snap.forEach((d) => {
    const x = d.data() || {};
    if (String(x.status || "") !== "PENDING") return;
    if (String(x.exchange || "") !== String(exchange || "")) return;
    if (String(x.symbol_or_pair_id || "") !== String(symbol || "")) return;
    if (String(x.tf || "") !== String(tf || "")) return;
    const expMs = Number(x.expires_at_ms);
    if (!Number.isFinite(expMs) || expMs > nowMs) return;
    tasks.push(
      markIntentStatus(d.id, "CANCELED", {
        canceled_at: nowIso(),
        cancel_reason: "INTENT_EXPIRED",
        status_reason: "INTENT_EXPIRED",
      })
        .then(() => { canceled += 1; })
    );
  });

  if (tasks.length) {
    const chunk = 50;
    for (let i = 0; i < tasks.length; i += chunk) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(tasks.slice(i, i + chunk));
    }
  }

  return { ok: true, canceled };
}

async function markIntentStatus(intentIdValue, status, patch = {}) {
  const db = getFirestore();
  const ref = db.collection("order_intents_paper").doc(intentIdValue);
  let current = null;
  let committed = null;
  const resolved = classifyIntentTerminalStatus(status, patch);
  const statusToWrite = resolved.status || String(status || "").toUpperCase() || null;
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    current = snap.exists ? (snap.data() || {}) : null;
    const runId = patch.run_id || (current && current.run_id) || null;
    const requestId = patch.request_id || (current && current.request_id) || null;
    const signalId = patch.signal_id || (current && current.signal_id) || null;
    const event = patch.event || (current && current.event) || null;
    const exchange = patch.exchange || (current && current.exchange) || null;
    const symbol = patch.symbol_or_pair_id || patch.symbol || (current && (current.symbol_or_pair_id || current.symbol)) || null;
    const tf = patch.tf || (current && current.tf) || null;
    const decisionReason = patch.decision_reason || patch.status_reason || patch.cancel_reason || (current && current.decision_reason) || null;
    const eventIntent = patch.event_intent || (current && current.event_intent) || null;
    const executionMode = patch.execution_mode || (current && current.execution_mode) || null;
    const payload = {
      ...buildEventEnvelope({
        requestId,
        runId,
        signalId,
        intentId: intentIdValue,
        event,
        exchange,
        symbol,
        tf,
        decisionReason,
        action: eventIntent,
        intent: eventIntent,
        executionMode,
        source: "INTENT_STATUS",
        barCloseMs: current && current.signal_bar_close_time_utc_ms ? current.signal_bar_close_time_utc_ms : null,
      }),
      status: statusToWrite,
      status_family: resolved.statusFamily || null,
      terminal_failure_status: resolved.terminalFailureStatus || null,
      request_id: requestId,
      run_id: runId,
      decision_reason: String(decisionReason || "").trim() || null,
      trace_meta: buildTraceMeta({
        signalId,
        intentId: intentIdValue,
        runId,
        requestId,
        decisionReason,
      }),
      updated_at: nowIso(),
      ...patch,
    };
    committed = { ...(current || {}), ...payload };
    const unifiedDoc = buildIntentSnapshotUnifiedEventDoc(committed, "INTENT_STATUS");
    const mutationType = `STATUS_${statusToWrite || "UNKNOWN"}`;
    const intentEventDoc = orderIntentEventsTest.buildOrderIntentEventDoc({
      intentId: intentIdValue,
      mutationType,
      exchange: committed.exchange,
      symbol: committed.symbol_or_pair_id || committed.symbol || null,
      traceId: committed.trace_id || null,
      requestId: committed.request_id || null,
      runId: committed.run_id || null,
      createdAt: committed.updated_at || committed.created_at || null,
      before: current,
      after: committed,
      extra: {
        status_family: resolved.statusFamily || null,
        terminal_failure_status: resolved.terminalFailureStatus || null,
      },
      deterministicKey: `${intentIdValue}|${mutationType}|${committed.updated_at || committed.created_at || ""}`,
    });
    const intentEventUnifiedDoc = orderIntentEventsTest.buildOrderIntentEventUnifiedDoc(intentEventDoc);
    tx.set(ref, payload, { merge: true });
    if (unifiedDoc) tx.set(db.collection("unified_event_timeline").doc(unifiedDoc.unified_event_id), unifiedDoc, { merge: false });
    tx.set(db.collection("order_intent_events").doc(intentEventDoc.intent_event_id), intentEventDoc, { merge: false });
    tx.set(db.collection("unified_event_timeline").doc(intentEventUnifiedDoc.unified_event_id), intentEventUnifiedDoc, { merge: false });
  });

  if (isIntentCanceledLikeStatus(statusToWrite)) {
    try {
      const doc = committed;
      if (doc && typeof doc === "object") {
        const reason = String(doc.cancel_reason || doc.status_reason || doc.decision_reason || "").trim() || null;
        if (reason) {
          sendSignalDroppedAlert({
            exchange: doc.exchange || null,
            symbol: doc.symbol_or_pair_id || doc.symbol || null,
            tf: doc.tf || null,
            event: doc.event || null,
            side: doc.side || null,
            qtyPct: doc.qty_pct != null ? doc.qty_pct : null,
            reason,
            dropReasonCode: reason,
            signalId: doc.signal_id || null,
            executionMode: doc.execution_mode || null,
            source: "SERVER",
            authoritative: true,
            dropGroup: doc.features_json && doc.features_json._event_group ? doc.features_json._event_group : null,
            dropSubtype: doc.features_json && doc.features_json._event_subtype ? doc.features_json._event_subtype : null,
          }).catch(() => {});
        }
      }
    } catch (_) {}
  } else {
    return;
  }

  // TP1 cancel should immediately release pending lock; otherwise TP1 can stay blocked for too long.
  try {
    const doc = committed;
    if (!doc || typeof doc !== "object") return;
    if (!isTpP1Event(doc.event)) return;
    const ex = String(doc.exchange || "").trim();
    const sym = String(doc.symbol_or_pair_id || "").trim();
    if (!ex || !sym) return;
    await clearTpP1PendingIfUnchanged({
      exchange: ex,
      symbol: sym,
      clearedAt: nowIso(),
      clearedReason: String(patch.cancel_reason || patch.status_reason || "INTENT_CANCELED"),
    });
  } catch (_) {}
}

async function patchIntent(intentIdValue, patch = {}) {
  const db = getFirestore();
  const ref = db.collection("order_intents_paper").doc(intentIdValue);
  await db.runTransaction(async (tx) => {
    const currentSnap = await tx.get(ref);
    const current = currentSnap && currentSnap.exists ? (currentSnap.data() || {}) : null;
    const runId = patch.run_id || (current && current.run_id) || null;
    const requestId = patch.request_id || (current && current.request_id) || null;
    const signalId = patch.signal_id || (current && current.signal_id) || null;
    const decisionReason = patch.decision_reason || patch.status_reason || patch.cancel_reason || patch.reason || (current && current.decision_reason) || null;
    const payload = {
      request_id: requestId,
      run_id: runId,
      decision_reason: String(decisionReason || "").trim() || null,
      trace_meta: buildTraceMeta({
        signalId,
        intentId: intentIdValue,
        runId,
        requestId,
        decisionReason,
      }),
      updated_at: nowIso(),
      ...patch,
    };
    const committed = { ...(current || {}), ...payload };
    const unifiedDoc = buildIntentSnapshotUnifiedEventDoc(committed, "INTENT_PATCH");
    const intentEventDoc = orderIntentEventsTest.buildOrderIntentEventDoc({
      intentId: intentIdValue,
      mutationType: "PATCH",
      exchange: committed.exchange,
      symbol: committed.symbol_or_pair_id || committed.symbol || null,
      traceId: committed.trace_id || null,
      requestId: committed.request_id || null,
      runId: committed.run_id || null,
      createdAt: committed.updated_at || committed.created_at || null,
      before: current,
      after: committed,
      extra: {
        patch_keys: Object.keys(patch || {}).sort(),
      },
      deterministicKey: `${intentIdValue}|PATCH|${committed.updated_at || committed.created_at || ""}`,
    });
    const intentEventUnifiedDoc = orderIntentEventsTest.buildOrderIntentEventUnifiedDoc(intentEventDoc);
    tx.set(ref, payload, { merge: true });
    if (unifiedDoc) tx.set(db.collection("unified_event_timeline").doc(unifiedDoc.unified_event_id), unifiedDoc, { merge: false });
    tx.set(db.collection("order_intent_events").doc(intentEventDoc.intent_event_id), intentEventDoc, { merge: false });
    tx.set(db.collection("unified_event_timeline").doc(intentEventUnifiedDoc.unified_event_id), intentEventUnifiedDoc, { merge: false });
  });
}

async function cancelPendingIntentsByMarket({
  exchange,
  symbol,
  limitN = 200,
  reason = "MANUAL_CANCEL_UI",
  note = null,
  filterFn = null,
} = {}) {
  const db = getFirestore();
  const ex = String(exchange || "").trim();
  const sym = String(symbol || "").trim();
  if (!ex || !sym) return { ok: false, canceled: 0, scanned: 0 };

  let docs = [];
  let snap = null;
  try {
    snap = await db.collection("order_intents_paper")
      .where("exchange", "==", ex)
      .where("symbol_or_pair_id", "==", sym)
      .where("status", "==", "PENDING")
      .limit(Number(limitN) || 200)
      .get();
    if (!snap.empty) {
      docs = snap.docs.map((d) => ({ id: d.id, data: d.data() || {} }));
    }
  } catch (_) {
    // Missing composite index -> fallback scan
  }

  if (!docs.length) {
    snap = await db.collection("order_intents_paper")
      .orderBy("updated_at", "desc")
      .limit(Math.max(200, Number(limitN) || 200 * 5))
      .get();
    snap.forEach((d) => {
      const x = d.data() || {};
      if (String(x.exchange || "") !== ex) return;
      if (String(x.symbol_or_pair_id || "") !== sym) return;
      if (String(x.status || "") !== "PENDING") return;
      docs.push({ id: d.id, data: x });
    });
  }

  let canceled = 0;
  let scanned = 0;
  const tasks = [];
  for (const doc of docs) {
    scanned += 1;
    if (typeof filterFn === "function" && !filterFn(doc.data)) continue;
    tasks.push(
      markIntentStatus(doc.id, "CANCELED", {
        canceled_at: nowIso(),
        cancel_reason: reason,
        status_reason: reason,
        cancel_note: note || null,
      })
        .then(() => { canceled += 1; })
    );
  }

  if (tasks.length) {
    const chunk = 50;
    for (let i = 0; i < tasks.length; i += chunk) {
      // eslint-disable-next-line no-await-in-loop
      await Promise.all(tasks.slice(i, i + chunk));
    }
  }

  return { ok: true, canceled, scanned };
}

module.exports = {
  upsertIntent,
  listPendingIntentsForExec,
  listPendingIntentsOverdue,
  cancelExpiredPendingIntents,
  markIntentStatus,
  patchIntent,
  cancelPendingIntentsByMarket,
  __test: {
    resolveIntentSignalRefs,
    enrichIntentFeaturesWithSignalRegime,
    buildTraceMeta,
    shouldRequireLineageForEvent,
    canonicalEventId,
  },
};
