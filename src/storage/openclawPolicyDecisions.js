"use strict";

const crypto = require("crypto");
const { getFirestore } = require("./firestore");
const { recordUnifiedEvent } = require("./unifiedEventTimeline");
const { recordShadowEvaluation } = require("./shadowEvaluations");
const { normalizeTraceContext } = require("../utils/traceContext");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function norm(value) {
  const text = String(value || "").trim();
  return text || null;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function safeClone(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function nowIso() {
  return new Date().toISOString();
}

function buildOpenClawPolicyDecisionId({
  traceId = null,
  exchange = null,
  symbol = null,
  event = null,
  stage = null,
  intentId = null,
  signalId = null,
  runId = null,
} = {}) {
  const base = [
    norm(traceId) || "TRACE",
    upper(exchange) || "UNKNOWN",
    upper(symbol) || "UNKNOWN",
    upper(event) || "UNKNOWN_EVENT",
    upper(stage) || "UNKNOWN_STAGE",
    norm(intentId) || "INTENT",
    norm(signalId) || "SIGNAL",
    norm(runId) || "RUN",
    Date.now(),
    crypto.randomBytes(6).toString("hex"),
  ].join("|");
  return crypto.createHash("sha1").update(base, "utf8").digest("hex");
}

function resolvePolicyAction({ blocked = false, requestedQtyPct = null, finalQtyPct = null, exitProfileMode = null } = {}) {
  if (blocked) return "BLOCK";
  const requested = toNum(requestedQtyPct);
  const finalQty = toNum(finalQtyPct);
  if (Number.isFinite(requested) && Number.isFinite(finalQty) && finalQty < requested) return "REDUCE";
  if (upper(exitProfileMode) === "AGGRESSIVE") return "AGGRESSIVE";
  return "ALLOW";
}

function buildOpenClawPolicyDecisionDoc({
  exchange,
  symbol,
  event = null,
  intent = null,
  side = null,
  stage = null,
  signalTf = null,
  traceId = null,
  requestId = null,
  runId = null,
  signalId = null,
  intentId = null,
  source = null,
  requestedQtyPct = null,
  finalQtyPct = null,
  scaleApplied = null,
  reason = null,
  blocked = false,
  exitProfileMode = null,
  cohort = null,
  decision = null,
  featuresPatch = null,
  createdAt = null,
} = {}) {
  const trace = normalizeTraceContext({
    traceId,
    requestId,
    runId,
    exchange,
    symbol,
    mutationKind: "OPENCLAW_POLICY_DECISION",
    source: source || stage || "OPENCLAW_POLICY_AUTHORITY",
    spanName: "OPENCLAW_POLICY_DECISION",
  });
  const action = resolvePolicyAction({
    blocked,
    requestedQtyPct,
    finalQtyPct,
    exitProfileMode,
  });
  const ts = createdAt || nowIso();
  return {
    decision_id: buildOpenClawPolicyDecisionId({
      traceId: trace.trace_id,
      exchange: trace.exchange,
      symbol: trace.symbol,
      event,
      stage,
      intentId,
      signalId,
      runId: trace.run_id,
    }),
    created_at: ts,
    trace_id: trace.trace_id,
    traceparent: trace.traceparent,
    otel_trace_id: trace.otel_trace_id,
    otel_span_id: trace.otel_span_id,
    request_id: trace.request_id,
    run_id: trace.run_id,
    exchange: trace.exchange,
    symbol: trace.symbol,
    source: upper(source || stage || "OPENCLAW_POLICY_AUTHORITY"),
    event: upper(event),
    intent: upper(intent),
    side: upper(side),
    stage: upper(stage),
    signal_tf: norm(signalTf),
    signal_id: norm(signalId),
    intent_id: norm(intentId),
    requested_qty_pct: toNum(requestedQtyPct),
    final_qty_pct: toNum(finalQtyPct),
    scale_applied: toNum(scaleApplied),
    blocked: blocked === true,
    action,
    reason: upper(reason),
    exit_profile_mode: upper(exitProfileMode),
    cohort: upper(cohort),
    decision: safeClone(decision),
    features_patch: safeClone(featuresPatch),
  };
}

async function recordOpenClawPolicyDecision(input = {}) {
  const db = getFirestore();
  const doc = buildOpenClawPolicyDecisionDoc(input);
  await db.collection("openclaw_policy_decisions").doc(doc.decision_id).set(doc, { merge: false });
  try {
    await recordUnifiedEvent({
      eventKind: "DECISION",
      eventSource: "OPENCLAW_POLICY_AUTHORITY",
      sourceDocumentId: doc.decision_id,
      exchange: doc.exchange,
      symbol: doc.symbol,
      event: doc.event,
      traceId: doc.trace_id,
      requestId: doc.request_id,
      runId: doc.run_id,
      signalId: doc.signal_id,
      intentId: doc.intent_id,
      createdAt: doc.created_at,
      payload: {
        policy_stage: doc.stage,
        policy_reason: doc.reason,
        qty_pct_requested: doc.requested_qty_pct,
        qty_pct_final: doc.final_qty_pct,
        action: doc.action,
        intent: doc.intent,
        exit_profile_mode: doc.exit_profile_mode,
        blocked: doc.blocked === true,
        model_key: "OPENCLAW_POLICY_AUTHORITY_V1",
      },
      raw: doc,
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn("[UNIFIED_TIMELINE_OPENCLAW_DECISION_FAIL]", msg);
  }
  try {
    await recordShadowEvaluation({
      exchange: doc.exchange,
      symbol: doc.symbol,
      event: doc.event,
      traceId: doc.trace_id,
      requestId: doc.request_id,
      runId: doc.run_id,
      source: "OPENCLAW_POLICY_AUTHORITY",
      modelKey: "OPENCLAW_POLICY_AUTHORITY_V1",
      baselineDecision: {
        ok: doc.blocked !== true,
        reason: "BASELINE_REQUESTED",
        qty_pct_final: doc.requested_qty_pct,
        intent: doc.intent,
        qty_pct_requested: doc.requested_qty_pct,
      },
      shadowDecision: {
        inference: {
          ok: doc.blocked !== true,
          reason: doc.reason,
          qty_pct_final: doc.final_qty_pct,
          action: doc.action,
          exit_profile_mode: doc.exit_profile_mode,
        },
        policy: {
          stage: doc.stage,
          blocked: doc.blocked === true,
          cohort: doc.cohort,
          scale_applied: doc.scale_applied,
          exit_profile_mode: doc.exit_profile_mode,
        },
      },
      features: doc.features_patch,
      extra: {
        decision_id: doc.decision_id,
        policy_stage: doc.stage,
        model_key: "OPENCLAW_POLICY_AUTHORITY_V1",
      },
    });
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    console.warn("[SHADOW_EVAL_OPENCLAW_DECISION_FAIL]", msg);
  }
  return doc;
}

async function listRecentOpenClawPolicyDecisions({
  exchange = null,
  fromMs = null,
  limit = 2000,
} = {}) {
  const db = getFirestore();
  const ex = upper(exchange);
  const resolvedLimit = Math.max(1, Math.trunc(Number(limit) || 2000));
  const snap = await db.collection("openclaw_policy_decisions")
    .orderBy("created_at", "desc")
    .limit(resolvedLimit)
    .get();
  return snap.docs
    .map((doc) => ({ id: doc.id, ...(doc.data() || {}) }))
    .filter((row) => {
      if (ex && upper(row.exchange) !== ex) return false;
      const ms = Date.parse(String(row.created_at || ""));
      if (Number.isFinite(Number(fromMs)) && Number.isFinite(ms) && ms < Number(fromMs)) return false;
      return true;
    });
}

module.exports = {
  recordOpenClawPolicyDecision,
  listRecentOpenClawPolicyDecisions,
  __test: {
    buildOpenClawPolicyDecisionId,
    resolvePolicyAction,
    buildOpenClawPolicyDecisionDoc,
  },
};
