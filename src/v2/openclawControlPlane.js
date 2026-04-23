"use strict";

const crypto = require("crypto");
const {
  buildSignalIntentDoc,
  buildFeatureSnapshotDoc,
  buildMlAiEvidenceLedgerDoc,
  buildOpenClawDecisionDoc,
} = require("./contracts");
const { buildMlAiSignalProposal } = require("./mlAiSignalProposal");
const { evaluateHtfDirectionAlignment } = require("./singleStrategyFilter");
const { buildSignalCriteria } = require("./signalCriteria");
const { putV2Doc } = require("./storage");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function stableJson(value) {
  if (value === null || value === undefined) return "null";
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (typeof value === "object") {
    return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

function sha256Hex(value) {
  return crypto.createHash("sha256").update(String(value || "")).digest("hex");
}

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function cloneJson(value) {
  if (value === null || value === undefined) return null;
  return JSON.parse(JSON.stringify(value));
}

function buildOpenClawDecisionBundleId({ bundleHash } = {}) {
  const hash = trimOrNull(bundleHash);
  if (!hash) throw new Error("OPENCLAW_DECISION_BUNDLE_HASH_REQUIRED");
  return `OCDBV2__${hash.slice(0, 32)}`;
}

function buildCanonicalEvidenceSummary({
  signalIntent,
  strategyFilterResult,
  featureSnapshot,
  mlAiSignalProposal,
  mlAiEvidence,
  marketDataQuality = null,
  signalCriteria = null,
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
      setup_type: mlAiSignalProposal.setup_type || null,
      signal_score: mlAiSignalProposal.signal_score ?? null,
      expected_net_r_after_cost: mlAiSignalProposal.expected_net_r_after_cost ?? null,
    } : {
      present: false,
      proposal_id: null,
      proposal_verdict: null,
      rank_score: null,
      size_ratio: null,
      risk_band: null,
      setup_type: null,
      signal_score: null,
      expected_net_r_after_cost: null,
    }),
    ml_ai_evidence: Object.freeze({
      present: !!mlAiEvidence,
      decision_id: mlAiEvidence ? mlAiEvidence.decision_id : null,
      model_version: mlAiEvidence ? mlAiEvidence.model_version : null,
    }),
    market_data_quality: Object.freeze(marketDataQuality ? {
      present: true,
      ok: marketDataQuality.ok === true,
      reason: marketDataQuality.reason || null,
      blockers: Array.isArray(marketDataQuality.blockers) ? marketDataQuality.blockers : [],
      metrics: marketDataQuality.metrics && typeof marketDataQuality.metrics === "object" ? marketDataQuality.metrics : {},
    } : {
      present: false,
      ok: null,
      reason: null,
      blockers: [],
      metrics: {},
    }),
    signal_criteria: signalCriteria ? cloneJson(signalCriteria) : {
      present: false,
      verdict: null,
      blockers: [],
    },
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
  marketDataQuality = null,
  signalCriteria = null,
  htfRegime = null,
  htfAlignmentScore = null,
  setupType = null,
  setupQualityScore = null,
  triggerLevel = null,
  triggerConfirmed = null,
  volumeZScore = null,
  rsiEntryTf = null,
  marketQualityScore = null,
  spreadBps = null,
  markIndexGapBps = null,
  expectedGrossR = null,
  expectedNetRAfterCost = null,
  costEstimateBps = null,
  fundingPenaltyBps = null,
  signalScore = null,
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

  const resolvedSignalCriteria = requiresMlEvidence
    ? buildSignalCriteria({
        signalSide: signalIntent.side,
        qualityScore: signalIntent.quality_score,
        featureValues: featureSnapshot ? featureSnapshot.feature_values : featureValues,
        marketDataQuality,
        signalCriteria,
        htfRegime: htfRegime ?? htfDirection,
        htfAlignmentScore: htfAlignmentScore ?? htfConfidence,
        setupType,
        setupQualityScore,
        triggerLevel,
        triggerConfirmed,
        volumeZScore,
        rsiEntryTf,
        marketQualityScore,
        spreadBps,
        markIndexGapBps,
        expectedGrossR,
        expectedNetRAfterCost,
        costEstimateBps,
        fundingPenaltyBps,
        signalScore,
      })
    : null;

  const mlAiSignalProposal = hasProposalPayload
    ? buildMlAiSignalProposal({
        signalIntent,
        featureSnapshot,
        strategyFilterResult: resolvedStrategyFilterResult,
        signalCriteria: resolvedSignalCriteria,
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
    marketDataQuality,
    signalCriteria: resolvedSignalCriteria,
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
  const bundleHashPayload = Object.freeze({
    signalIntent,
    featureSnapshot,
    mlAiSignalProposal,
    openclawDecision,
    mlAiEvidence,
    strategyFilterResult: resolvedStrategyFilterResult,
    canonicalEvidenceSummary,
    marketDataQuality,
    signalCriteria: resolvedSignalCriteria,
  });
  const openclawDecisionBundleHash = sha256Hex(stableJson(bundleHashPayload));
  const enrichedOpenClawDecision = Object.freeze({
    ...openclawDecision,
    openclaw_decision_bundle_hash: openclawDecisionBundleHash,
  });

  return Object.freeze({
    signalIntent,
    featureSnapshot,
    mlAiSignalProposal,
    openclawDecision: enrichedOpenClawDecision,
    mlAiEvidence,
    strategyFilterResult: resolvedStrategyFilterResult,
    canonicalEvidenceSummary,
    marketDataQuality,
    signalCriteria: resolvedSignalCriteria,
    openclawDecisionBundleHash,
  });
}

function buildOpenClawDecisionBundleLedgerDoc({
  bundle,
  source = "OPENCLAW_CONTROL_PLANE",
  createdAt = null,
} = {}) {
  const row = asObject(bundle);
  if (!row) throw new Error("OPENCLAW_DECISION_BUNDLE_REQUIRED");
  const signalIntent = asObject(row.signalIntent);
  const decision = asObject(row.openclawDecision);
  if (!signalIntent) throw new Error("SIGNAL_INTENT_REQUIRED");
  if (!decision) throw new Error("OPENCLAW_DECISION_REQUIRED");
  const bundleHash = trimOrNull(row.openclawDecisionBundleHash || decision.openclaw_decision_bundle_hash);
  if (!bundleHash) throw new Error("OPENCLAW_DECISION_BUNDLE_HASH_REQUIRED");
  const decisionPayload = cloneJson(row.openclawDecision);
  const hashDecisionPayload = cloneJson(row.openclawDecision);
  if (hashDecisionPayload) delete hashDecisionPayload.openclaw_decision_bundle_hash;
  const payload = Object.freeze({
    signalIntent: cloneJson(row.signalIntent),
    featureSnapshot: cloneJson(row.featureSnapshot),
    mlAiSignalProposal: cloneJson(row.mlAiSignalProposal),
    openclawDecision: decisionPayload,
    mlAiEvidence: cloneJson(row.mlAiEvidence),
    strategyFilterResult: cloneJson(row.strategyFilterResult),
    canonicalEvidenceSummary: cloneJson(row.canonicalEvidenceSummary),
    marketDataQuality: cloneJson(row.marketDataQuality),
    signalCriteria: cloneJson(row.signalCriteria),
  });
  const hashPayload = Object.freeze({
    ...payload,
    openclawDecision: hashDecisionPayload,
  });
  const canonicalJson = stableJson(hashPayload);
  const payloadHash = sha256Hex(canonicalJson);
  if (payloadHash !== bundleHash) {
    throw new Error("OPENCLAW_DECISION_BUNDLE_HASH_MISMATCH");
  }
  return Object.freeze({
    openclaw_decision_bundle_id: buildOpenClawDecisionBundleId({ bundleHash }),
    openclaw_decision_bundle_hash: bundleHash,
    openclaw_decision_id: trimOrNull(decision.openclaw_decision_id),
    signal_intent_id: trimOrNull(signalIntent.signal_intent_id),
    signal_source_mode: trimOrNull(signalIntent.signal_source_mode),
    decision_mode: trimOrNull(decision.decision_mode),
    recommended_action: trimOrNull(decision.recommended_action),
    ml_ai_signal_proposal_id: trimOrNull(row.mlAiSignalProposal && row.mlAiSignalProposal.ml_ai_signal_proposal_id),
    feature_snapshot_id: trimOrNull(row.featureSnapshot && row.featureSnapshot.feature_snapshot_id),
    ml_ai_evidence_decision_id: trimOrNull(row.mlAiEvidence && row.mlAiEvidence.decision_id),
    strategy_filter_verdict: trimOrNull(decision.strategy_filter_verdict),
    bundle_payload: payload,
    canonical_json_sha256: payloadHash,
    source: trimOrNull(source) || "OPENCLAW_CONTROL_PLANE",
    created_at: trimOrNull(createdAt) || trimOrNull(decision.created_at) || new Date().toISOString(),
    schema_version: 1,
  });
}

async function persistOpenClawDecisionBundleLedger({
  db = null,
  env = process.env,
  bundle,
  source = "OPENCLAW_CONTROL_PLANE",
  createdAt = null,
} = {}) {
  const doc = buildOpenClawDecisionBundleLedgerDoc({ bundle, source, createdAt });
  const persisted = await putV2Doc({
    db,
    env,
    collectionKey: "OPENCLAW_DECISION_BUNDLES",
    doc,
  });
  return Object.freeze({
    ok: true,
    reason: "OPENCLAW_DECISION_BUNDLE_LEDGER_WRITTEN",
    doc,
    persisted,
  });
}

module.exports = {
  stableJson,
  sha256Hex,
  buildOpenClawDecisionBundleId,
  buildCanonicalEvidenceSummary,
  buildOpenClawDecisionBundle,
  buildOpenClawDecisionBundleLedgerDoc,
  persistOpenClawDecisionBundleLedger,
};
