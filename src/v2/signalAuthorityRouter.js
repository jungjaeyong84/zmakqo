"use strict";

const crypto = require("crypto");
const { sendSignalDroppedAlert } = require("../services/signalLifecycleAlert");
const {
  V2_STRATEGY_FILTERS,
  V2_STRATEGY_FILTER_VERDICTS,
} = require("./constants");

let sendSignalDroppedAlertImpl = sendSignalDroppedAlert;

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

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeExecutionModeForLifecycle() {
  const directMode = upper(
    process.env.DONBEOLJA_V2_EXECUTION_MODE
    || process.env.DONBEOLJA_EXECUTION_MODE
    || process.env.EXECUTION_MODE
  );
  if (directMode === "LIVE" || directMode === "LIVE_DRY_RUN") return directMode;
  if (String(process.env.DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED || "").trim() === "1") {
    return String(process.env.DONBEOLJA_V2_LIVE_DRY_RUN || "").trim() === "1" ? "LIVE_DRY_RUN" : "LIVE";
  }
  return null;
}

function resolveLifecycleSignalId({ signalIntent, openclawDecision } = {}) {
  const intent = asObject(signalIntent);
  const decision = asObject(openclawDecision);
  const summary = asObject(decision && decision.canonical_evidence_summary);
  return trimOrNull(
    (intent && intent.signal_lineage_id)
    || (summary && summary.signal_lineage_id)
    || (decision && decision.signal_lineage_id)
    || (intent && intent.signal_intent_id)
  );
}

function maybeEmitServerNativeDroppedLifecycle({
  signalIntent,
  openclawDecision,
  reason,
  detail = null,
} = {}) {
  const intent = asObject(signalIntent);
  const decision = asObject(openclawDecision);
  const summary = asObject(decision && decision.canonical_evidence_summary);
  const sourceMode = upper(
    (intent && intent.signal_source_mode)
    || (summary && summary.signal_source_mode)
    || (decision && decision.signal_source_mode)
  );
  if (sourceMode !== "SERVER_NATIVE_ML_AI") return;
  const executionMode = normalizeExecutionModeForLifecycle();
  if (!executionMode) return;
  const signalId = resolveLifecycleSignalId({ signalIntent: intent, openclawDecision: decision });
  const payload = {
    exchange: "BINANCEFUT",
    symbol: upper((intent && intent.symbol) || (decision && decision.symbol) || (summary && summary.symbol)),
    tf: trimOrNull(
      summary && summary.feature_snapshot && summary.feature_snapshot.timeframe
    ) || trimOrNull(intent && intent.timeframe) || "15m",
    event: upper((intent && intent.side) || (decision && decision.side) || (summary && summary.side)),
    side: upper((intent && intent.side) || (decision && decision.side) || (summary && summary.side)),
    qtyPct: 1,
    reason,
    dropReasonCode: reason,
    signalId,
    executionMode,
    source: "SERVER",
    authoritative: true,
    meta: {
      routed_detail: detail,
      signal_intent_id: trimOrNull(intent && intent.signal_intent_id),
      openclaw_decision_id: trimOrNull(decision && decision.openclaw_decision_id),
    },
  };
  if (!payload.symbol || !payload.event) return;
  Promise.resolve(sendSignalDroppedAlertImpl(payload)).catch((err) => {
    try {
      console.warn("[V2_SIGNAL_AUTHORITY_ROUTER_DROPPED_ALERT_FAIL]", JSON.stringify({
        signal_intent_id: trimOrNull(intent && intent.signal_intent_id),
        signal_lineage_id: signalId,
        reason,
        error_message: err && err.message ? String(err.message) : String(err),
      }));
    } catch (_) {}
  });
}

// Stage J — surveillance (Stage F) caught CANARY entry intents flowing
// through resolveEntryIntentFromOpenClaw without any leverage value, which
// meant production entry route's resolveProductionEntryLeverage had no
// per-intent candidate to honor (env fallback worked at production layer
// but the entry intent itself was leverage-blind). Stamp leverage onto
// the entryIntent so the caller chain carries an explicit number from
// the source of truth (signal intent / openclaw decision / evidence /
// signal criteria) instead of relying on env fallback alone.
function resolveEntryIntentLeverage({ signalIntent, openclawDecision } = {}) {
  const intent = asObject(signalIntent);
  const decision = asObject(openclawDecision);
  const evidence = asObject(decision && decision.canonical_evidence_summary);
  const criteria = asObject(evidence && evidence.signal_criteria);
  const candidates = [
    intent && intent.leverage,
    intent && intent.futures_leverage,
    decision && decision.leverage,
    decision && decision.futures_leverage,
    evidence && evidence.leverage,
    evidence && evidence.futures_leverage,
    criteria && criteria.leverage,
    criteria && criteria.futures_leverage,
  ];
  for (const cand of candidates) {
    if (cand === undefined || cand === null || cand === "") continue;
    const num = Number(cand);
    if (Number.isFinite(num) && num > 0) return num;
  }
  return null;
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
  const sourceMode = upper((summary && summary.signal_source_mode) || (decision && decision.signal_source_mode));
  const marketData = summary && summary.market_data_quality && typeof summary.market_data_quality === "object"
    ? summary.market_data_quality
    : null;
  if (!marketData || marketData.present !== true) {
    if (sourceMode === "SERVER_NATIVE_ML_AI") {
      return Object.freeze({
        ok: false,
        reason: "MARKET_DATA_QUALITY_REQUIRED",
        blockers: Object.freeze(["MARKET_DATA:QUALITY_EVIDENCE_REQUIRED"]),
      });
    }
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

function resolveSignalCriteriaGate(openclawDecision) {
  const decision = openclawDecision && typeof openclawDecision === "object" ? openclawDecision : null;
  const summary = decision && decision.canonical_evidence_summary && typeof decision.canonical_evidence_summary === "object"
    ? decision.canonical_evidence_summary
    : null;
  const sourceMode = upper((summary && summary.signal_source_mode) || (decision && decision.signal_source_mode));
  const criteria = summary && summary.signal_criteria && typeof summary.signal_criteria === "object"
    ? summary.signal_criteria
    : null;

  // 2026-04-29 — diagnostic surface for SIGNAL_CRITERIA_BLOCKED. The
  // handoff_dispatched log emitted by paperBinanceRunner only sees
  // routedDecision.detail and bundle.canonical_evidence_summary.signal_criteria,
  // both of which arrive here as `criteria.blockers` already populated.
  // When the verdict isn't PASS, dump every sub-gate's state so the
  // operator can see exactly which gate (NO_TRADE / HTF_REGIME / SETUP /
  // TRIGGER / EXPECTED_EDGE / SIGNAL_SCORE) is blocking and what
  // input it saw — instead of getting a bare reason="SIGNAL_CRITERIA_BLOCKED"
  // with no blocker list.
  function emitBlockedDiagnostic(result) {
    try {
      console.log(JSON.stringify({
        event: "v2_signal_criteria_gate_blocked",
        ts: new Date().toISOString(),
        signal_intent_id: decision && decision.signal_intent_id || null,
        signal_lineage_id: decision && decision.signal_lineage_id || null,
        symbol: decision && decision.symbol || (summary && summary.symbol) || null,
        side: decision && decision.side || (summary && summary.side) || null,
        source_mode: sourceMode || null,
        gate_reason: result.reason || null,
        gate_verdict: result.verdict || null,
        gate_blockers: result.blockers || [],
        criteria_present: !!(criteria && criteria.present === true),
        criteria_profile: criteria && criteria.criteria_profile || null,
        criteria_verdict: criteria && criteria.verdict || null,
        criteria_blockers: (criteria && Array.isArray(criteria.blockers)) ? criteria.blockers.slice(0, 30) : null,
        signal_score: criteria && Number.isFinite(Number(criteria.signal_score)) ? Number(criteria.signal_score) : null,
        thresholds: criteria && criteria.thresholds || null,
        no_trade_gate: criteria && criteria.no_trade_gate || null,
        htf_regime: criteria && criteria.htf_regime || null,
        setup_gate: criteria && criteria.setup_gate || null,
        trigger_gate: criteria && criteria.trigger_gate || null,
        expected_edge_gate: criteria && criteria.expected_edge_gate || null,
      }));
    } catch (_) { /* observability only */ }
  }

  if (sourceMode !== "SERVER_NATIVE_ML_AI" && (!criteria || criteria.present !== true)) {
    return Object.freeze({ ok: true, reason: null, blockers: Object.freeze([]), verdict: null });
  }
  if (!criteria || criteria.present !== true) {
    const result = Object.freeze({
      ok: false,
      reason: "SIGNAL_CRITERIA_REQUIRED",
      blockers: Object.freeze(["SIGNAL_CRITERIA:EVIDENCE_REQUIRED"]),
      verdict: null,
    });
    emitBlockedDiagnostic(result);
    return result;
  }
  const verdict = upper(criteria.verdict);
  if (verdict !== "PASS") {
    const result = Object.freeze({
      ok: false,
      reason: "SIGNAL_CRITERIA_BLOCKED",
      blockers: Object.freeze(Array.isArray(criteria.blockers) ? criteria.blockers : []),
      verdict,
    });
    emitBlockedDiagnostic(result);
    return result;
  }
  return Object.freeze({
    ok: true,
    reason: null,
    blockers: Object.freeze([]),
    verdict,
  });
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
    maybeEmitServerNativeDroppedLifecycle({
      signalIntent: intent,
      openclawDecision: decision,
      reason: "SHADOW_ONLY_MODE",
    });
    return Object.freeze({
      ok: false,
      reason: "SHADOW_ONLY_MODE",
      entryIntent: null,
    });
  }

  if (!approved || decisionStatus !== "APPROVED" || recommendedAction !== "APPROVE_ENTRY") {
    maybeEmitServerNativeDroppedLifecycle({
      signalIntent: intent,
      openclawDecision: decision,
      reason: "OPENCLAW_NOT_APPROVED",
    });
    return Object.freeze({
      ok: false,
      reason: "OPENCLAW_NOT_APPROVED",
      entryIntent: null,
    });
  }

  if (budgetCheck !== "PASS") {
    maybeEmitServerNativeDroppedLifecycle({
      signalIntent: intent,
      openclawDecision: decision,
      reason: "BUDGET_GUARD_BLOCKED",
    });
    return Object.freeze({
      ok: false,
      reason: "BUDGET_GUARD_BLOCKED",
      entryIntent: null,
    });
  }

  if (minOrderCheck !== "PASS") {
    maybeEmitServerNativeDroppedLifecycle({
      signalIntent: intent,
      openclawDecision: decision,
      reason: "MIN_ORDER_GUARD_BLOCKED",
    });
    return Object.freeze({
      ok: false,
      reason: "MIN_ORDER_GUARD_BLOCKED",
      entryIntent: null,
    });
  }

  const filterCheck = resolveStrategyFilter(strategyFilterResult || extractStrategyFilterFromDecision(decision));
  if (!filterCheck.ok) {
    maybeEmitServerNativeDroppedLifecycle({
      signalIntent: intent,
      openclawDecision: decision,
      reason: filterCheck.reason,
      detail: filterCheck.detail,
    });
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
    maybeEmitServerNativeDroppedLifecycle({
      signalIntent: intent,
      openclawDecision: decision,
      reason: mlAiProposalGate.reason,
      detail: mlAiProposalGate.detail,
    });
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
    maybeEmitServerNativeDroppedLifecycle({
      signalIntent: intent,
      openclawDecision: decision,
      reason: marketDataGate.reason,
      detail: marketDataGate.blockers.join(","),
    });
    return Object.freeze({
      ok: false,
      reason: marketDataGate.reason,
      detail: marketDataGate.blockers.join(","),
      market_data_quality_gate: marketDataGate,
      entryIntent: null,
    });
  }

  const signalCriteriaGate = resolveSignalCriteriaGate(decision);
  if (!signalCriteriaGate.ok) {
    maybeEmitServerNativeDroppedLifecycle({
      signalIntent: intent,
      openclawDecision: decision,
      reason: signalCriteriaGate.reason,
      detail: signalCriteriaGate.blockers.join(","),
    });
    return Object.freeze({
      ok: false,
      reason: signalCriteriaGate.reason,
      detail: signalCriteriaGate.blockers.join(","),
      signal_criteria_gate: signalCriteriaGate,
      entryIntent: null,
    });
  }

  const signalIntentId = trimOrNull(intent.signal_intent_id);
  const entryIntentId = `EINTV2__${hash10(signalIntentId)}`;
  const summary = decision.canonical_evidence_summary && typeof decision.canonical_evidence_summary === "object"
    ? decision.canonical_evidence_summary
    : {};
  const criteria = summary.signal_criteria && typeof summary.signal_criteria === "object"
    ? summary.signal_criteria
    : {};
  const leverage = resolveEntryIntentLeverage({
    signalIntent: intent,
    openclawDecision: decision,
  });
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
      signal_criteria_verdict: signalCriteriaGate.verdict,
      signal_criteria_profile: trimOrNull(criteria.criteria_profile),
      entry_grade: upper(criteria.entry_grade),
      trigger_type: upper(criteria.trigger_type),
      leverage,
      futures_leverage: leverage,
    }),
  });
}

module.exports = {
  resolveStrategyFilter,
  extractMlAiProposalFromDecision,
  resolveMlAiProposalGate,
  resolveMarketDataQualityDecisionGate,
  resolveSignalCriteriaGate,
  resolveEntryIntentFromOpenClaw,
  resolveEntryIntentLeverage,
  __test: {
    maybeEmitServerNativeDroppedLifecycle,
    normalizeExecutionModeForLifecycle,
    resolveLifecycleSignalId,
    __setSendSignalDroppedAlertForTest(fn) {
      sendSignalDroppedAlertImpl = typeof fn === "function" ? fn : sendSignalDroppedAlert;
    },
    __resetSendSignalDroppedAlertForTest() {
      sendSignalDroppedAlertImpl = sendSignalDroppedAlert;
    },
  },
};
