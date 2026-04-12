"use strict";

const { evaluateOpenClawExecutionAuthority } = require("../services/openclawExecutionAuthority");
const { recordActionHookEvent } = require("../storage/actionHookLedger");
const { recordShadowEvaluation } = require("../storage/shadowEvaluations");
const { buildEventEnvelope } = require("./eventEnvelope");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function nowIso() {
  return new Date().toISOString();
}

function buildActionEnvelope({
  action = null,
  runId = null,
  signalId = null,
  intentId = null,
  signalEvent = null,
  exchange = null,
  symbol = null,
  tf = null,
  decisionReason = null,
  source = null,
  executionMode = null,
} = {}) {
  return {
    ...buildEventEnvelope({
      runId,
      signalId,
      intentId,
      event: signalEvent,
      exchange,
      symbol,
      tf,
      decisionReason,
      source,
      executionMode,
      action,
      intent: action,
      createdAt: nowIso(),
      reasonFamily: "ACTION_HOOK",
      authority: "SERVER",
    }),
    signal_event: upper(signalEvent),
    action: upper(action),
  };
}

function emitActionEvent({
  event,
  envelope,
  extra = {},
  level = "log",
  writer = null,
  persist = false,
} = {}) {
  const payload = {
    ...envelope,
    ...extra,
  };
  if (persist) {
    Promise.resolve(recordActionHookEvent(event, payload)).catch((err) => {
      const msg = err && err.message ? err.message : String(err);
      console.warn("[ACTION_HOOK_LEDGER_FAIL]", msg);
    });
  }
  if (typeof writer === "function") {
    writer(event, payload, level);
    return payload;
  }
  const record = {
    event,
    ...payload,
  };
  const fn = level === "warn" ? "warn" : "log";
  try {
    console[fn](JSON.stringify(record));
  } catch (_) {
    console[fn](`[${event}] ${JSON.stringify(payload)}`);
  }
  return payload;
}

function isEntryLikeIntent(intent) {
  const normalized = upper(intent);
  return normalized === "ENTRY" || normalized === "ADD";
}

function recordActionShadowEvaluationSafe({
  envelope,
  authorityEval,
  features = null,
  intent = null,
  qtyPct = null,
} = {}) {
  if (!envelope || !authorityEval) return;
  const policyEval = authorityEval.policy || null;
  const normalizedShadowInference = {
    ok: authorityEval.ok === true,
    reason: upper(authorityEval.reason),
    qty_pct_final: Number.isFinite(Number(authorityEval.qtyPctFinal)) ? Number(authorityEval.qtyPctFinal) : null,
    policy_blocked: !!(policyEval && policyEval.policy && policyEval.policy.blocked),
    action: upper(policyEval && policyEval.policy && policyEval.policy.action),
  };
  Promise.resolve(recordShadowEvaluation({
    exchange: envelope.exchange,
    symbol: envelope.symbol,
    event: envelope.event,
    traceId: envelope.trace_id || envelope.idempotency_key,
    requestId: envelope.request_id,
    runId: envelope.run_id,
    source: envelope.source || "ACTION_PRE_HOOK",
    modelKey: "OPENCLAW_EXECUTION_AUTHORITY_SHADOW_V1",
    baselineDecision: {
      ok: authorityEval.ok === true,
      reason: upper(authorityEval.reason),
      qty_pct_final: Number.isFinite(Number(authorityEval.qtyPctFinal)) ? Number(authorityEval.qtyPctFinal) : null,
      intent: upper(intent),
      qty_pct_requested: Number.isFinite(Number(qtyPct)) ? Number(qtyPct) : null,
    },
    shadowDecision: {
      authority: authorityEval.authority || null,
      openclaw_decision: authorityEval.decision || null,
      policy: policyEval && policyEval.policy ? policyEval.policy : null,
      features_patch: authorityEval.featuresPatch || null,
      inference: normalizedShadowInference,
    },
    features: features && typeof features === "object" ? { ...features } : null,
    extra: {
      policy_stage: "ACTION_PRE_HOOK",
    },
  })).catch((err) => {
    const msg = err && err.message ? err.message : String(err);
    console.warn("[SHADOW_EVALUATION_FAIL]", msg);
  });
}

async function runActionPreHooks({
  action = null,
  runId = null,
  signalId = null,
  intentId = null,
  signalEvent = null,
  exchange = null,
  symbol = null,
  tf = null,
  decisionReason = null,
  source = null,
  executionMode = null,
  intent = null,
  qtyPct = null,
  features = null,
  writer = null,
  persist = false,
  snapshotOverride = null,
  policyStage = "ACTION_PRE_HOOK",
} = {}) {
  const envelope = buildActionEnvelope({
    action,
    runId,
    signalId,
    intentId,
    signalEvent,
    exchange,
    symbol,
    tf,
    decisionReason,
    source,
    executionMode,
  });
  const baseFeatures = features && typeof features === "object" ? { ...features } : {};

  if (!isEntryLikeIntent(intent)) {
    emitActionEvent({
      event: "action_pre_ok",
      envelope,
      extra: {
        hook: "pre",
        policy_stage: upper(policyStage),
        policy_reason: "ACTION_PRE_HOOK_SKIPPED",
        intent: upper(intent),
      },
      writer,
      persist,
    });
    return {
      ok: true,
      blocked: false,
      reason: "ACTION_PRE_HOOK_SKIPPED",
      envelope,
      featuresPatch: baseFeatures,
      policy: null,
    };
  }

  const authorityEval = await evaluateOpenClawExecutionAuthority({
    exchange,
    symbol,
    intent,
    qtyPct,
    features: baseFeatures,
    stage: policyStage,
    applyScale: false,
    snapshotOverride,
  });
  const featuresPatch = authorityEval && authorityEval.featuresPatch && typeof authorityEval.featuresPatch === "object"
    ? authorityEval.featuresPatch
    : baseFeatures;
  recordActionShadowEvaluationSafe({
    envelope,
    authorityEval,
    features: featuresPatch,
    intent,
    qtyPct,
  });

  if (!authorityEval || authorityEval.ok !== true || !Number.isFinite(Number(authorityEval.qtyPctFinal)) || Number(authorityEval.qtyPctFinal) <= 0) {
    const reason = upper(authorityEval && authorityEval.reason) || "ACTION_PRE_HOOK_BLOCKED";
    emitActionEvent({
      event: "action_pre_blocked",
      envelope,
      extra: {
        hook: "pre",
        policy_stage: upper(policyStage),
        policy_reason: reason,
        policy_blocking_layer: upper(authorityEval && authorityEval.authority && authorityEval.authority.blockingLayer),
        intent: upper(intent),
      },
      level: "warn",
      writer,
      persist,
    });
    return {
      ok: false,
      blocked: true,
      reason,
      envelope,
      featuresPatch,
      policy: authorityEval && authorityEval.policy ? authorityEval.policy : null,
      authority: authorityEval && authorityEval.authority ? authorityEval.authority : null,
    };
  }

  emitActionEvent({
    event: "action_pre_ok",
    envelope,
      extra: {
        hook: "pre",
        policy_stage: upper(policyStage),
        policy_reason: upper(authorityEval && authorityEval.reason) || "OPENCLAW_EXECUTION_AUTHORITY_OK",
        intent: upper(intent),
        qty_pct_final: Number(authorityEval.qtyPctFinal),
      },
      writer,
      persist,
  });
  return {
    ok: true,
    blocked: false,
    reason: upper(authorityEval && authorityEval.reason) || "OPENCLAW_EXECUTION_AUTHORITY_OK",
    envelope,
    featuresPatch,
    policy: authorityEval && authorityEval.policy ? authorityEval.policy : null,
    authority: authorityEval && authorityEval.authority ? authorityEval.authority : null,
  };
}

function runActionPostHooks({
  envelope,
  ok = true,
  result = null,
  reason = null,
  level = null,
  writer = null,
  persist = false,
  extra = {},
} = {}) {
  const event = ok ? "action_post_ok" : "action_post_fail";
  const finalLevel = level || (ok ? "log" : "warn");
  emitActionEvent({
    event,
    envelope,
    level: finalLevel,
    writer,
    persist,
    extra: {
      hook: "post",
      ok: ok === true,
      decision_reason: upper(reason) || (envelope && envelope.decision_reason) || null,
      result: result || null,
      ...extra,
    },
  });
}

module.exports = {
  buildActionEnvelope,
  emitActionEvent,
  runActionPreHooks,
  runActionPostHooks,
  __test: {
    isEntryLikeIntent,
  },
};
