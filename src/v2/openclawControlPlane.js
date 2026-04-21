"use strict";

const {
  buildSignalIntentDoc,
  buildFeatureSnapshotDoc,
  buildMlAiEvidenceLedgerDoc,
  buildOpenClawDecisionDoc,
} = require("./contracts");
const { buildMlAiSignalProposal } = require("./mlAiSignalProposal");
const { evaluateHtfDirectionAlignment } = require("./singleStrategyFilter");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function buildCanonicalEvidenceSummary({
  signalIntent,
  strategyFilterResult,
  featureSnapshot,
  mlAiSignalProposal,
  mlAiEvidence,
} = {}) {
  const intent = signalIntent && typeof signalIntent === "object" ? signalIntent : null;
  const filter = strategyFilterResult && typeof strategyFilterResult === "object" ? strategyFilterResult : null;
  if (!intent) throw new Error("SIGNAL_INTENT_REQUIRED");
  if (!filter) throw new Error("STRATEGY_FILTER_RESULT_REQUIRED");
  return Object.freeze({
    signal_source_mode: intent.signal_source_mode,
    signal_lineage_id: intent.signal_lineage_id,
    symbol: intent.symbol,
    side: intent.side,
    quality_score: intent.quality_score,
    hard_guards: Object.freeze({
      budget_min_order: `${intent.budget_check_result}__${intent.min_order_check_result}`,
      entry_lineage_required: trimOrNull(intent.signal_lineage_id) ? "PASS" : "BLOCK",
      exchange_protection_health: "PRE_ENTRY_NOT_EVALUATED",
    }),
    strategy_filter: Object.freeze({
      filter_name: filter.filter_name,
      verdict: filter.verdict,
      reason: filter.reason,
      signal_side: filter.signal_side,
      htf_direction: filter.htf_direction,
      htf_confidence: filter.htf_confidence,
      min_confidence: filter.min_confidence,
    }),
    feature_snapshot: Object.freeze(featureSnapshot ? {
      present: true,
      feature_snapshot_id: featureSnapshot.feature_snapshot_id,
      feature_schema_version: featureSnapshot.feature_schema_version,
      feature_vector_hash: featureSnapshot.feature_vector_hash,
      timeframe: featureSnapshot.timeframe,
    } : {
      present: false,
      feature_snapshot_id: null,
      feature_schema_version: null,
      feature_vector_hash: null,
      timeframe: null,
    }),
    ml_ai_signal_proposal: Object.freeze(mlAiSignalProposal ? {
      present: true,
      proposal_id: mlAiSignalProposal.ml_ai_signal_proposal_id,
      proposal_verdict: mlAiSignalProposal.proposal_verdict,
      rank_score: mlAiSignalProposal.rank_score,
      size_ratio: mlAiSignalProposal.size_ratio,
      risk_band: mlAiSignalProposal.risk_band,
    } : {
      present: false,
      proposal_id: null,
      proposal_verdict: null,
      rank_score: null,
      size_ratio: null,
      risk_band: null,
    }),
    ml_ai_evidence: Object.freeze({
      present: !!mlAiEvidence,
      decision_id: mlAiEvidence ? mlAiEvidence.decision_id : null,
      model_version: mlAiEvidence ? mlAiEvidence.model_version : null,
    }),
    evidence_complete: true,
  });
}

function buildOpenClawDecisionBundle({
  signalSourceMode,
  signalLineageId,
  symbol,
  side,
  qualityScore,
  budgetCheckResult,
  minOrderCheckResult,
  decisionStatus,
  decisionMode,
  recommendedAction,
  approved,
  rationaleSummary,
  policyScope,
  strategyFilterResult = null,
  htfDirection = null,
  htfConfidence = null,
  minConfidence = 0.6,
  timeframe = null,
  featureSchemaVersion = null,
  featureValues = null,
  marketRegime = null,
  proposalVerdict = null,
  rankScore = null,
  sizeRatio = null,
  riskBand = "MEDIUM",
  featuresHash = null,
  modelVersion = null,
  decisionSummary = null,
  createdAt = null,
} = {}) {
  const signalIntent = buildSignalIntentDoc({
    signalSourceMode,
    signalLineageId,
    symbol,
    side,
    qualityScore,
    budgetCheckResult,
    minOrderCheckResult,
    decisionStatus,
    createdAt,
  });

  const requiresMlEvidence = signalIntent.signal_source_mode === "SERVER_NATIVE_ML_AI";
  const hasMlEvidencePayload = !!(trimOrNull(featuresHash) && trimOrNull(modelVersion) && trimOrNull(decisionSummary));
  if (requiresMlEvidence && !hasMlEvidencePayload) {
    throw new Error("ML_AI_EVIDENCE_REQUIRED");
  }

  const hasFeatureSnapshotPayload = !!(trimOrNull(timeframe) && trimOrNull(featureSchemaVersion) && featureValues && typeof featureValues === "object" && !Array.isArray(featureValues) && Object.keys(featureValues).length);
  if (requiresMlEvidence && !hasFeatureSnapshotPayload) {
    throw new Error("FEATURE_SNAPSHOT_REQUIRED");
  }

  const featureSnapshot = hasFeatureSnapshotPayload
    ? buildFeatureSnapshotDoc({
        signalIntentId: signalIntent.signal_intent_id,
        signalSourceMode: signalIntent.signal_source_mode,
        symbol: signalIntent.symbol,
        side: signalIntent.side,
        timeframe,
        schemaVersion: featureSchemaVersion,
        featureVectorHash: featuresHash,
        featureValues,
        marketRegime,
        snapshotAt: createdAt,
      })
    : null;

  const mlAiEvidence = hasMlEvidencePayload
    ? buildMlAiEvidenceLedgerDoc({
        signalIntentId: signalIntent.signal_intent_id,
        featureSnapshotId: featureSnapshot ? featureSnapshot.feature_snapshot_id : null,
        featureSchemaVersion: featureSnapshot ? featureSnapshot.feature_schema_version : null,
        decisionMode,
        featuresHash,
        modelVersion,
        decisionSummary,
        recommendedAction,
        createdAt,
      })
    : null;

  const resolvedStrategyFilterResult = strategyFilterResult || (() => {
    const direction = trimOrNull(htfDirection);
    if (!direction) return null;
    return evaluateHtfDirectionAlignment({
      signalSide: signalIntent.side,
      htfDirection: direction,
      htfConfidence,
      minConfidence,
      decisionMode,
      evaluatedAt: createdAt,
    });
  })();

  if (!resolvedStrategyFilterResult) {
    throw new Error("STRATEGY_FILTER_EVIDENCE_REQUIRED");
  }

  const hasProposalPayload = !!(trimOrNull(proposalVerdict) && rankScore !== null && rankScore !== undefined && sizeRatio !== null && sizeRatio !== undefined);
  if (requiresMlEvidence && !hasProposalPayload) {
    throw new Error("ML_AI_SIGNAL_PROPOSAL_REQUIRED");
  }

  const mlAiSignalProposal = hasProposalPayload
    ? buildMlAiSignalProposal({
        signalIntent,
        featureSnapshot,
        strategyFilterResult: resolvedStrategyFilterResult,
        decisionMode,
        proposalVerdict,
        qualityScore: signalIntent.quality_score,
        rankScore,
        sizeRatio,
        riskBand,
        rationaleSummary: decisionSummary || rationaleSummary,
        createdAt,
      })
    : null;

  const canonicalEvidenceSummary = buildCanonicalEvidenceSummary({
    signalIntent,
    strategyFilterResult: resolvedStrategyFilterResult,
    featureSnapshot,
    mlAiSignalProposal,
    mlAiEvidence,
  });

  const openclawDecision = buildOpenClawDecisionDoc({
    signalIntentId: signalIntent.signal_intent_id,
    decisionMode,
    recommendedAction,
    approved,
    rationaleSummary,
    policyScope,
    strategyFilterResult: resolvedStrategyFilterResult,
    canonicalEvidenceSummary,
    mlAiEvidenceDecisionId: mlAiEvidence ? mlAiEvidence.decision_id : null,
    createdAt,
  });

  return Object.freeze({
    signalIntent,
    featureSnapshot,
    mlAiSignalProposal,
    openclawDecision,
    mlAiEvidence,
    strategyFilterResult: resolvedStrategyFilterResult,
    canonicalEvidenceSummary,
  });
}

module.exports = {
  buildCanonicalEvidenceSummary,
  buildOpenClawDecisionBundle,
};
