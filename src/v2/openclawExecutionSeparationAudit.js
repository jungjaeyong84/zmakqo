"use strict";

const crypto = require("crypto");
const { V2_SERVICE_BOUNDARIES } = require("./boundaries");
const { V2_SERVICES } = require("./constants");
const { resolveEntryIntentFromOpenClaw } = require("./signalAuthorityRouter");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function hash12(payload) {
  return crypto.createHash("sha1").update(String(payload || "")).digest("hex").slice(0, 12);
}

function pushCheck(checks, id, ok, detail = null) {
  checks.push(Object.freeze({
    id,
    ok: ok === true,
    detail: detail && typeof detail === "object" ? Object.freeze({ ...detail }) : null,
  }));
}

function normalizeBundle(bundle) {
  const source = bundle && typeof bundle === "object" ? bundle : null;
  if (!source) throw new Error("OPENCLAW_BUNDLE_REQUIRED");
  const signalIntent = source.signalIntent && typeof source.signalIntent === "object" ? source.signalIntent : null;
  const openclawDecision = source.openclawDecision && typeof source.openclawDecision === "object" ? source.openclawDecision : null;
  if (!signalIntent) throw new Error("SIGNAL_INTENT_REQUIRED");
  if (!openclawDecision) throw new Error("OPENCLAW_DECISION_REQUIRED");
  return Object.freeze({
    signalIntent,
    openclawDecision,
    strategyFilterResult: source.strategyFilterResult || null,
  });
}

function resolveRoute(bundle, routedDecision) {
  if (routedDecision && typeof routedDecision === "object") return routedDecision;
  return resolveEntryIntentFromOpenClaw(bundle);
}

function evaluateOpenClawExecutionSeparation({
  bundle,
  routedDecision = null,
  executedEntry = null,
  now = () => new Date().toISOString(),
} = {}) {
  const normalized = normalizeBundle(bundle);
  const routed = resolveRoute(normalized, routedDecision);
  const executed = executedEntry && typeof executedEntry === "object" ? executedEntry : null;
  const entryContract = executed && executed.entryContract && typeof executed.entryContract === "object"
    ? executed.entryContract
    : null;

  const signalIntent = normalized.signalIntent;
  const openclawDecision = normalized.openclawDecision;
  const signalIntentId = trimOrNull(signalIntent.signal_intent_id);
  const openclawDecisionId = trimOrNull(openclawDecision.openclaw_decision_id);
  const decisionSignalIntentId = trimOrNull(openclawDecision.signal_intent_id);
  const decisionMode = upper(openclawDecision.decision_mode);
  const recommendedAction = upper(openclawDecision.recommended_action);
  const decisionStatus = upper(signalIntent.decision_status);
  const budgetCheck = upper(signalIntent.budget_check_result);
  const minOrderCheck = upper(signalIntent.min_order_check_result);
  const approved = openclawDecision.approved === true;
  const routedOk = routed && routed.ok === true;
  const entryIntent = routedOk ? routed.entryIntent : null;
  const boundary = V2_SERVICE_BOUNDARIES[V2_SERVICES.OPENCLAW_CONTROL_PLANE];

  const checks = [];
  pushCheck(checks, "OPENCLAW_HAS_NO_EXCHANGE_WRITE_AUTHORITY", boundary && boundary.mayWriteExchange === false, {
    service: V2_SERVICES.OPENCLAW_CONTROL_PLANE,
    may_write_exchange: boundary ? boundary.mayWriteExchange : null,
  });
  pushCheck(checks, "OPENCLAW_DECISION_LINKS_SIGNAL_INTENT", !!signalIntentId && signalIntentId === decisionSignalIntentId, {
    expected: signalIntentId,
    actual: decisionSignalIntentId,
  });
  pushCheck(checks, "OPENCLAW_DECISION_ID_PRESENT", !!openclawDecisionId, {
    openclaw_decision_id: openclawDecisionId,
  });
  pushCheck(checks, "OPENCLAW_STRATEGY_FILTER_EVIDENCE_PRESENT", !!trimOrNull(openclawDecision.strategy_filter_name) && !!trimOrNull(openclawDecision.strategy_filter_verdict), {
    strategy_filter_name: trimOrNull(openclawDecision.strategy_filter_name),
    strategy_filter_verdict: trimOrNull(openclawDecision.strategy_filter_verdict),
  });

  const shadowOnly = decisionMode === "SHADOW" || decisionStatus === "SHADOW_ONLY";
  const guardsPass = budgetCheck === "PASS" && minOrderCheck === "PASS";
  const openclawExecutableIntent = approved && decisionStatus === "APPROVED" && recommendedAction === "APPROVE_ENTRY";
  const deterministicMayRoute = !shadowOnly && openclawExecutableIntent && guardsPass && upper(openclawDecision.strategy_filter_verdict) === "PASS";

  pushCheck(checks, "SHADOW_DECISION_NEVER_ROUTES_ENTRY", !(shadowOnly && routedOk), {
    decision_mode: decisionMode,
    decision_status: decisionStatus,
    routed_ok: routedOk,
  });
  pushCheck(checks, "NON_APPROVED_DECISION_NEVER_ROUTES_ENTRY", !(!openclawExecutableIntent && routedOk), {
    approved,
    decision_status: decisionStatus,
    recommended_action: recommendedAction,
    routed_ok: routedOk,
  });
  pushCheck(checks, "HARD_GUARD_FAILURE_NEVER_ROUTES_ENTRY", !(!guardsPass && routedOk), {
    budget_check_result: budgetCheck,
    min_order_check_result: minOrderCheck,
    routed_ok: routedOk,
  });
  pushCheck(checks, "DETERMINISTIC_ROUTER_MATCHES_OPENCLAW_CONTRACT", deterministicMayRoute ? routedOk : !routedOk, {
    deterministic_may_route: deterministicMayRoute,
    routed_ok: routedOk,
    routed_reason: trimOrNull(routed && routed.reason),
  });

  if (executed) {
    pushCheck(checks, "EXECUTION_REQUIRES_ROUTED_ENTRY_INTENT", routedOk && !!entryIntent, {
      routed_ok: routedOk,
      entry_intent_id: entryIntent ? trimOrNull(entryIntent.entry_intent_id) : null,
    });
    pushCheck(checks, "EXECUTION_ENTRY_INTENT_MATCH", !!entryContract && entryIntent && trimOrNull(entryContract.entry_intent_id) === trimOrNull(entryIntent.entry_intent_id), {
      expected: entryIntent ? trimOrNull(entryIntent.entry_intent_id) : null,
      actual: entryContract ? trimOrNull(entryContract.entry_intent_id) : null,
    });
    pushCheck(checks, "EXECUTION_SIGNAL_INTENT_MATCH", !!entryContract && trimOrNull(entryContract.signal_intent_id) === signalIntentId, {
      expected: signalIntentId,
      actual: entryContract ? trimOrNull(entryContract.signal_intent_id) : null,
    });
    pushCheck(checks, "EXECUTION_OPENCLAW_DECISION_MATCH", !!entryContract && trimOrNull(entryContract.openclaw_decision_id) === openclawDecisionId, {
      expected: openclawDecisionId,
      actual: entryContract ? trimOrNull(entryContract.openclaw_decision_id) : null,
    });
    pushCheck(checks, "EXECUTION_DECISION_MODE_MATCH", !!entryContract && upper(entryContract.decision_mode) === decisionMode, {
      expected: decisionMode,
      actual: entryContract ? upper(entryContract.decision_mode) : null,
    });
  }

  const failedChecks = checks.filter((check) => check.ok !== true);
  return Object.freeze({
    ok: failedChecks.length === 0,
    audit_id: `OCEXSEPAUDV2__${hash12(`${signalIntentId}__${openclawDecisionId}`)}`,
    generated_at: now(),
    signal_intent_id: signalIntentId,
    openclaw_decision_id: openclawDecisionId,
    decision_mode: decisionMode,
    deterministic_route_status: routedOk ? "ENTRY_INTENT_CREATED" : "ENTRY_INTENT_BLOCKED",
    execution_kernel_status: executed ? "EXECUTED_ENTRY_PRESENT" : "NO_EXECUTION_ATTACHED",
    check_n: checks.length,
    fail_n: failedChecks.length,
    failed_check_ids: Object.freeze(failedChecks.map((check) => check.id)),
    checks: Object.freeze(checks),
  });
}

function assertOpenClawExecutionSeparation(input) {
  const audit = evaluateOpenClawExecutionSeparation(input);
  if (audit.ok) return audit;
  const error = new Error(audit.failed_check_ids[0] || "OPENCLAW_EXECUTION_SEPARATION_INVALID");
  error.audit = audit;
  throw error;
}

module.exports = {
  evaluateOpenClawExecutionSeparation,
  assertOpenClawExecutionSeparation,
  __test: {
    trimOrNull,
    upper,
    hash12,
    normalizeBundle,
  },
};
