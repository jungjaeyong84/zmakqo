"use strict";

const crypto = require("crypto");
const {
  V2_STRATEGY_FILTERS,
  V2_STRATEGY_FILTER_VERDICTS,
} = require("./constants");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function hash10(payload) {
  return crypto.createHash("sha1").update(String(payload || "")).digest("hex").slice(0, 10);
}

function resolveStrategyFilter(strategyFilterResult) {
  const result = strategyFilterResult && typeof strategyFilterResult === "object" ? strategyFilterResult : null;
  if (!result) {
    return Object.freeze({
      ok: false,
      reason: "STRATEGY_FILTER_REQUIRED",
      detail: null,
    });
  }

  const filterName = upper(result.filter_name);
  const verdict = upper(result.verdict);
  const detail = upper(result.reason);
  if (!V2_STRATEGY_FILTERS.includes(filterName)) {
    throw new Error("STRATEGY_FILTER_NAME_INVALID");
  }
  if (!V2_STRATEGY_FILTER_VERDICTS.includes(verdict)) {
    throw new Error("STRATEGY_FILTER_VERDICT_INVALID");
  }
  if (verdict !== "PASS") {
    return Object.freeze({
      ok: false,
      reason: "STRATEGY_FILTER_BLOCKED",
      detail,
    });
  }

  return Object.freeze({
    ok: true,
    reason: null,
    detail,
  });
}

function extractStrategyFilterFromDecision(openclawDecision) {
  return {
    filter_name: openclawDecision.filter_name || openclawDecision.strategy_filter_name,
    verdict: openclawDecision.verdict || openclawDecision.strategy_filter_verdict,
    reason: openclawDecision.reason || openclawDecision.strategy_filter_reason,
  };
}

function extractMlAiProposalFromDecision(openclawDecision) {
  const decision = openclawDecision && typeof openclawDecision === "object" ? openclawDecision : null;
  const summary = decision && decision.canonical_evidence_summary && typeof decision.canonical_evidence_summary === "object"
    ? decision.canonical_evidence_summary
    : null;
  const proposal = summary && summary.ml_ai_signal_proposal && typeof summary.ml_ai_signal_proposal === "object"
    ? summary.ml_ai_signal_proposal
    : null;
  return proposal;
}

function resolveMlAiProposalGate({ signalIntent, openclawDecision } = {}) {
  const intent = signalIntent && typeof signalIntent === "object" ? signalIntent : null;
  const decision = openclawDecision && typeof openclawDecision === "object" ? openclawDecision : null;
  const sourceMode = upper(intent && intent.signal_source_mode);
  const proposal = extractMlAiProposalFromDecision(decision);
  const proposalPresent = proposal && proposal.present === true;
  if (sourceMode !== "SERVER_NATIVE_ML_AI" && !proposalPresent) {
    return Object.freeze({
      ok: true,
      reason: null,
      detail: null,
      proposal_verdict: null,
    });
  }
  const verdict = upper(proposal && proposal.proposal_verdict);
  if (verdict !== "PASS") {
    return Object.freeze({
      ok: false,
      reason: "ML_AI_PROPOSAL_NOT_APPROVED",
      detail: verdict || "MISSING_ML_AI_PROPOSAL_VERDICT",
      proposal_verdict: verdict,
    });
  }
  return Object.freeze({
    ok: true,
    reason: null,
    detail: null,
    proposal_verdict: verdict,
  });
}

function resolveMarketDataQualityDecisionGate(openclawDecision) {
  const decision = openclawDecision && typeof openclawDecision === "object" ? openclawDecision : null;
  const summary = decision && decision.canonical_evidence_summary && typeof decision.canonical_evidence_summary === "object"
    ? decision.canonical_evidence_summary
    : null;
  const marketData = summary && summary.market_data_quality && typeof summary.market_data_quality === "object"
    ? summary.market_data_quality
    : null;
  if (!marketData || marketData.present !== true) {
    return Object.freeze({ ok: true, reason: null, blockers: Object.freeze([]) });
  }
  if (marketData.ok !== true) {
    return Object.freeze({
      ok: false,
      reason: "MARKET_DATA_QUALITY_BLOCKED",
      blockers: Object.freeze(Array.isArray(marketData.blockers) ? marketData.blockers : []),
    });
  }
  return Object.freeze({ ok: true, reason: null, blockers: Object.freeze([]) });
}

function resolveEntryIntentFromOpenClaw({
  signalIntent,
  openclawDecision,
  strategyFilterResult,
} = {}) {
  const intent = signalIntent && typeof signalIntent === "object" ? signalIntent : null;
  const decision = openclawDecision && typeof openclawDecision === "object" ? openclawDecision : null;
  if (!intent) throw new Error("SIGNAL_INTENT_REQUIRED");
  if (!decision) throw new Error("OPENCLAW_DECISION_REQUIRED");
  if (trimOrNull(intent.signal_intent_id) !== trimOrNull(decision.signal_intent_id)) {
    throw new Error("SIGNAL_DECISION_MISMATCH");
  }

  const decisionMode = upper(decision.decision_mode);
  const recommendedAction = upper(decision.recommended_action);
  const decisionStatus = upper(intent.decision_status);
  const budgetCheck = upper(intent.budget_check_result);
  const minOrderCheck = upper(intent.min_order_check_result);
  const approved = decision.approved === true;

  if (decisionMode === "SHADOW" || decisionStatus === "SHADOW_ONLY") {
    return Object.freeze({
      ok: false,
      reason: "SHADOW_ONLY_MODE",
      entryIntent: null,
    });
  }

  if (!approved || decisionStatus !== "APPROVED" || recommendedAction !== "APPROVE_ENTRY") {
    return Object.freeze({
      ok: false,
      reason: "OPENCLAW_NOT_APPROVED",
      entryIntent: null,
    });
  }

  if (budgetCheck !== "PASS") {
    return Object.freeze({
      ok: false,
      reason: "BUDGET_GUARD_BLOCKED",
      entryIntent: null,
    });
  }

  if (minOrderCheck !== "PASS") {
    return Object.freeze({
      ok: false,
      reason: "MIN_ORDER_GUARD_BLOCKED",
      entryIntent: null,
    });
  }

  const filterCheck = resolveStrategyFilter(strategyFilterResult || extractStrategyFilterFromDecision(decision));
  if (!filterCheck.ok) {
    return Object.freeze({
      ok: false,
      reason: filterCheck.reason,
      detail: filterCheck.detail,
      entryIntent: null,
    });
  }

  const mlAiProposalGate = resolveMlAiProposalGate({
    signalIntent: intent,
    openclawDecision: decision,
  });
  if (!mlAiProposalGate.ok) {
    return Object.freeze({
      ok: false,
      reason: mlAiProposalGate.reason,
      detail: mlAiProposalGate.detail,
      ml_ai_proposal_gate: mlAiProposalGate,
      entryIntent: null,
    });
  }

  const marketDataGate = resolveMarketDataQualityDecisionGate(decision);
  if (!marketDataGate.ok) {
    return Object.freeze({
      ok: false,
      reason: marketDataGate.reason,
      detail: marketDataGate.blockers.join(","),
      market_data_quality_gate: marketDataGate,
      entryIntent: null,
    });
  }

  const signalIntentId = trimOrNull(intent.signal_intent_id);
  const entryIntentId = `EINTV2__${hash10(signalIntentId)}`;
  return Object.freeze({
    ok: true,
    reason: null,
    entryIntent: Object.freeze({
      entry_intent_id: entryIntentId,
      signal_intent_id: signalIntentId,
      signal_source_mode: upper(intent.signal_source_mode),
      symbol: upper(intent.symbol),
      side: upper(intent.side),
      quality_score: Number(intent.quality_score),
      decision_mode: decisionMode,
      policy_scope: trimOrNull(decision.policy_scope),
      openclaw_decision_id: trimOrNull(decision.openclaw_decision_id),
      ml_ai_proposal_verdict: mlAiProposalGate.proposal_verdict,
    }),
  });
}

module.exports = {
  resolveStrategyFilter,
  extractMlAiProposalFromDecision,
  resolveMlAiProposalGate,
  resolveMarketDataQualityDecisionGate,
  resolveEntryIntentFromOpenClaw,
};
