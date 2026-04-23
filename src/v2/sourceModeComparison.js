"use strict";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function absDelta(left, right) {
  const a = toNumberOrNull(left);
  const b = toNumberOrNull(right);
  if (a === null || b === null) return null;
  return Math.abs(a - b);
}

function extractBundle(bundle, expectedMode) {
  const row = bundle && typeof bundle === "object" ? bundle : null;
  if (!row) throw new Error(`${expectedMode}_BUNDLE_REQUIRED`);
  const intent = row.signalIntent && typeof row.signalIntent === "object" ? row.signalIntent : null;
  const decision = row.openclawDecision && typeof row.openclawDecision === "object" ? row.openclawDecision : null;
  if (!intent) throw new Error(`${expectedMode}_SIGNAL_INTENT_REQUIRED`);
  if (!decision) throw new Error(`${expectedMode}_OPENCLAW_DECISION_REQUIRED`);
  if (upper(intent.signal_source_mode) !== expectedMode) {
    throw new Error(`${expectedMode}_SIGNAL_SOURCE_MODE_REQUIRED`);
  }
  return {
    signalIntent: intent,
    openclawDecision: decision,
    strategyFilterResult: row.strategyFilterResult || {
      verdict: decision.strategy_filter_verdict,
      reason: decision.strategy_filter_reason,
    },
    mlAiSignalProposal: row.mlAiSignalProposal || null,
  };
}

function compareSourceModePair({
  label = null,
  webhookBundle,
  nativeBundle,
  thresholds = {},
} = {}) {
  const webhook = extractBundle(webhookBundle, "WEBHOOK_ASSISTED");
  const native = extractBundle(nativeBundle, "SERVER_NATIVE_ML_AI");
  const effective = {
    qualityScoreAbsDeltaWarn: toNumberOrNull(thresholds.qualityScoreAbsDeltaWarn) ?? 0.15,
  };

  const blockerReasons = [];
  const warnReasons = [];
  if (upper(webhook.signalIntent.symbol) !== upper(native.signalIntent.symbol)) blockerReasons.push("SYMBOL_MISMATCH");
  if (upper(webhook.signalIntent.side) !== upper(native.signalIntent.side)) blockerReasons.push("SIDE_MISMATCH");
  if (upper(webhook.openclawDecision.policy_scope) !== upper(native.openclawDecision.policy_scope)) blockerReasons.push("POLICY_SCOPE_MISMATCH");
  if (upper(webhook.openclawDecision.strategy_filter_verdict) !== upper(native.openclawDecision.strategy_filter_verdict)) blockerReasons.push("FILTER_VERDICT_MISMATCH");
  if (upper(webhook.openclawDecision.recommended_action) !== upper(native.openclawDecision.recommended_action)) blockerReasons.push("RECOMMENDED_ACTION_MISMATCH");
  if ((webhook.openclawDecision.approved === true) !== (native.openclawDecision.approved === true)) blockerReasons.push("DECISION_APPROVAL_MISMATCH");

  const qualityScoreAbsDelta = absDelta(webhook.signalIntent.quality_score, native.signalIntent.quality_score);
  if (qualityScoreAbsDelta !== null && qualityScoreAbsDelta >= effective.qualityScoreAbsDeltaWarn) {
    warnReasons.push("QUALITY_SCORE_DRIFT");
  }

  return Object.freeze({
    label: trimOrNull(label) || `${upper(native.signalIntent.symbol) || "UNKNOWN"}__${upper(native.signalIntent.side) || "UNKNOWN"}__SOURCE_MODE`,
    pass: blockerReasons.length === 0,
    blocker_reasons: blockerReasons,
    warn_reasons: warnReasons,
    symbol: upper(native.signalIntent.symbol),
    side: upper(native.signalIntent.side),
    source_pair: Object.freeze({
      webhook: upper(webhook.signalIntent.signal_source_mode),
      native: upper(native.signalIntent.signal_source_mode),
    }),
    approved_pair: Object.freeze({
      webhook: webhook.openclawDecision.approved === true,
      native: native.openclawDecision.approved === true,
    }),
    action_pair: Object.freeze({
      webhook: upper(webhook.openclawDecision.recommended_action),
      native: upper(native.openclawDecision.recommended_action),
    }),
    filter_pair: Object.freeze({
      webhook: upper(webhook.openclawDecision.strategy_filter_verdict),
      native: upper(native.openclawDecision.strategy_filter_verdict),
    }),
    native_proposal: Object.freeze(native.mlAiSignalProposal ? {
      proposal_verdict: upper(native.mlAiSignalProposal.proposal_verdict),
      rank_score: toNumberOrNull(native.mlAiSignalProposal.rank_score),
      size_ratio: toNumberOrNull(native.mlAiSignalProposal.size_ratio),
      risk_band: upper(native.mlAiSignalProposal.risk_band),
    } : {
      proposal_verdict: null,
      rank_score: null,
      size_ratio: null,
      risk_band: null,
    }),
    deltas: Object.freeze({
      quality_score_abs: qualityScoreAbsDelta,
    }),
  });
}

function buildSourceModeComparisonReport({
  pairs,
  thresholds = {},
} = {}) {
  const rows = Array.isArray(pairs) ? pairs.map((pair) => compareSourceModePair({ ...pair, thresholds })) : [];
  const blockerRows = rows.filter((row) => row.blocker_reasons.length > 0);
  const warnRows = rows.filter((row) => row.warn_reasons.length > 0);
  return Object.freeze({
    pass: rows.length > 0 && blockerRows.length === 0,
    pair_n: rows.length,
    block_n: blockerRows.length,
    warn_n: warnRows.length,
    blockers: blockerRows.flatMap((row) => row.blocker_reasons.map((reason) => `${row.label}:${reason}`)),
    warnings: warnRows.flatMap((row) => row.warn_reasons.map((reason) => `${row.label}:${reason}`)),
    rows,
  });
}

module.exports = {
  compareSourceModePair,
  buildSourceModeComparisonReport,
};
