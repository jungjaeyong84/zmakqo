"use strict";

const { buildMlAiSignalProposalDoc } = require("./contracts");

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function buildMlAiSignalProposal({
  signalIntent,
  featureSnapshot,
  strategyFilterResult,
  signalCriteria = null,
  decisionMode,
  proposalVerdict,
  qualityScore = null,
  rankScore,
  sizeRatio,
  riskBand = "MEDIUM",
  rationaleSummary,
  createdAt = null,
} = {}) {
  const intent = signalIntent && typeof signalIntent === "object" ? signalIntent : null;
  const snapshot = featureSnapshot && typeof featureSnapshot === "object" ? featureSnapshot : null;
  const filter = strategyFilterResult && typeof strategyFilterResult === "object" ? strategyFilterResult : null;
  if (!intent) throw new Error("SIGNAL_INTENT_REQUIRED");
  if (!snapshot) throw new Error("FEATURE_SNAPSHOT_REQUIRED");
  if (!filter) throw new Error("STRATEGY_FILTER_RESULT_REQUIRED");

  const resolvedQualityScore = toNumberOrNull(qualityScore !== null ? qualityScore : intent.quality_score);
  const resolvedRankScore = toNumberOrNull(rankScore);
  const resolvedSizeRatio = toNumberOrNull(sizeRatio);
  if (resolvedRankScore === null) throw new Error("rank_score_REQUIRED");
  if (resolvedSizeRatio === null) throw new Error("size_ratio_REQUIRED");

  return Object.freeze(buildMlAiSignalProposalDoc({
    signalIntentId: intent.signal_intent_id,
    featureSnapshotId: snapshot.feature_snapshot_id,
    signalSourceMode: intent.signal_source_mode,
    symbol: intent.symbol,
    side: intent.side,
    timeframe: snapshot.timeframe,
    decisionMode,
    proposalVerdict,
    qualityScore: resolvedQualityScore,
    rankScore: resolvedRankScore,
    sizeRatio: resolvedSizeRatio,
    riskBand,
    strategyFilterName: filter.filter_name,
    strategyFilterVerdict: filter.verdict,
    setupType: signalCriteria && signalCriteria.setup_gate ? signalCriteria.setup_gate.setup_type : null,
    signalScore: signalCriteria ? signalCriteria.signal_score : null,
    expectedNetRAfterCost: signalCriteria && signalCriteria.expected_edge_gate
      ? signalCriteria.expected_edge_gate.expected_net_r_after_cost
      : null,
    rationaleSummary,
    createdAt,
  }));
}

module.exports = {
  buildMlAiSignalProposal,
};
