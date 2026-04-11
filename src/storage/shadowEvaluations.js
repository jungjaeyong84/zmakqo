"use strict";

const crypto = require("crypto");
const { getFirestore } = require("./firestore");
const { normalizeTraceContext } = require("../utils/traceContext");

function nowIso() {
  return new Date().toISOString();
}

function safeClone(value) {
  if (value == null) return null;
  try {
    return JSON.parse(JSON.stringify(value));
  } catch (_) {
    return null;
  }
}

function buildShadowEvaluationId({ traceId, exchange, symbol, modelKey, event } = {}) {
  const base = [
    String(traceId || ""),
    String(exchange || "").toUpperCase(),
    String(symbol || "").toUpperCase(),
    String(modelKey || "").toUpperCase(),
    String(event || "").toUpperCase(),
    String(Date.now()),
    crypto.randomBytes(6).toString("hex"),
  ].join("|");
  return crypto.createHash("sha1").update(base, "utf8").digest("hex");
}

async function recordShadowEvaluation({
  exchange,
  symbol,
  event = null,
  traceId = null,
  requestId = null,
  runId = null,
  source = null,
  modelKey = "POLICY_SHADOW_V1",
  baselineDecision = null,
  shadowDecision = null,
  features = null,
  extra = null,
} = {}) {
  const db = getFirestore();
  const trace = normalizeTraceContext({
    traceId,
    requestId,
    runId,
    exchange,
    symbol,
    mutationKind: "SHADOW_EVALUATION",
    source,
  });
  const id = buildShadowEvaluationId({
    traceId: trace.trace_id,
    exchange,
    symbol,
    modelKey,
    event,
  });
  const doc = {
    evaluation_id: id,
    created_at: nowIso(),
    trace_id: trace.trace_id,
    request_id: trace.request_id,
    run_id: trace.run_id,
    exchange: trace.exchange,
    symbol: trace.symbol,
    source: trace.source,
    event: String(event || "").trim().toUpperCase() || null,
    model_key: String(modelKey || "POLICY_SHADOW_V1").trim().toUpperCase(),
    baseline_decision: safeClone(baselineDecision),
    shadow_decision: safeClone(shadowDecision),
    features: safeClone(features),
    extra: safeClone(extra),
  };
  await db.collection("shadow_evaluations").doc(id).set(doc, { merge: false });
  return doc;
}

module.exports = {
  recordShadowEvaluation,
};
