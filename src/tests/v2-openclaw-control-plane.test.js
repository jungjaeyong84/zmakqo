"use strict";

const assert = require("assert");
const { buildCanonicalEvidenceSummary, buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { V2_SERVICE_BOUNDARIES } = require("../v2/boundaries");

(function openclawServerNativeBundleRequiresMlEvidence() {
  let err = null;
  try {
    buildOpenClawDecisionBundle({
      signalSourceMode: "SERVER_NATIVE_ML_AI",
      signalLineageId: "LINEAGE__BTC__1",
      symbol: "BTCUSDT",
      side: "LONG",
      qualityScore: 0.82,
      budgetCheckResult: "PASS",
      minOrderCheckResult: "PASS",
      decisionStatus: "APPROVED",
      decisionMode: "SHADOW",
      recommendedAction: "APPROVE_ENTRY",
      approved: true,
      rationaleSummary: "quality and budget are both inside contract",
      policyScope: "BTC_15M",
      htfDirection: "LONG",
      htfConfidence: 0.72,
      timeframe: "15M",
      featureSchemaVersion: "ml_features_v1",
      featureValues: {
        trend_bias: 0.82,
        volatility_rank: 0.37,
      },
      proposalVerdict: "SHADOW",
      rankScore: 0.58,
      sizeRatio: 0.25,
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "ML_AI_EVIDENCE_REQUIRED");
})();

(function openclawBundleBuildsLinkedIntentDecisionAndEvidence() {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__ETH__1",
    symbol: "ETHUSDT",
    side: "SHORT",
    qualityScore: 0.74,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "CANARY",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "native model accepted the short setup",
    policyScope: "ETH_15M",
    htfDirection: "SHORT",
    htfConfidence: 0.74,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v1",
    featureValues: {
      trend_bias: -0.76,
      volatility_rank: 0.61,
      volume_impulse: 0.58,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "SHORT",
    },
    proposalVerdict: "PASS",
    rankScore: 0.81,
    sizeRatio: 0.5,
    riskBand: "MEDIUM",
    featuresHash: "feat_hash_v1",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "tp1 probability above canary threshold",
    marketDataQuality: {
      ok: true,
      reason: "V2_MARKET_DATA_QUALITY_PASS",
      blockers: [],
      metrics: {
        spread_bps: 1.2,
        mark_index_gap_bps: 0.8,
      },
    },
  });
  assert.ok(bundle.signalIntent.signal_intent_id.startsWith("SIGINTV2__SERVER_NATIVE_ML_AI__ETHUSDT__SHORT__"));
  assert.ok(bundle.featureSnapshot.feature_snapshot_id.startsWith("FSV2__"));
  assert.ok(bundle.mlAiSignalProposal.ml_ai_signal_proposal_id.startsWith("MSPV2__"));
  assert.strictEqual(bundle.openclawDecision.signal_intent_id, bundle.signalIntent.signal_intent_id);
  assert.strictEqual(bundle.mlAiEvidence.signal_intent_id, bundle.signalIntent.signal_intent_id);
  assert.strictEqual(bundle.mlAiEvidence.feature_snapshot_id, bundle.featureSnapshot.feature_snapshot_id);
  assert.strictEqual(bundle.openclawDecision.strategy_filter_name, "HTF_DIRECTION_ALIGNMENT");
  assert.strictEqual(bundle.openclawDecision.strategy_filter_verdict, "PASS");
  assert.strictEqual(bundle.openclawDecision.ml_ai_evidence_decision_id, bundle.mlAiEvidence.decision_id);
  assert.strictEqual(bundle.canonicalEvidenceSummary.strategy_filter.verdict, "PASS");
  assert.strictEqual(bundle.canonicalEvidenceSummary.feature_snapshot.present, true);
  assert.strictEqual(bundle.canonicalEvidenceSummary.ml_ai_signal_proposal.present, true);
  assert.strictEqual(bundle.signalCriteria.feature_snapshot_contract.btc_1h_trend, "LONG");
  assert.strictEqual(bundle.signalCriteria.feature_snapshot_contract.mtf_1h_direction, "SHORT");
  assert.strictEqual(bundle.marketDataQuality.metrics.btc_1h_trend, "LONG");
  assert.strictEqual(bundle.marketDataQuality.metrics.mtf_1h_direction, "SHORT");
  assert.strictEqual(bundle.canonicalEvidenceSummary.market_data_quality.metrics.btc_1h_trend, "LONG");
  assert.strictEqual(bundle.canonicalEvidenceSummary.market_data_quality.metrics.mtf_1h_direction, "SHORT");
})();

(function webhookSignalsCanSkipMlEvidence() {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "WEBHOOK_ASSISTED",
    signalLineageId: "LINEAGE__BNB__1",
    symbol: "BNBUSDT",
    side: "LONG",
    qualityScore: 0.91,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "LIVE",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "webhook confirmed and approved by OpenClaw policy",
    policyScope: "BNB_15M",
    htfDirection: "LONG",
    htfConfidence: 0.91,
  });
  assert.strictEqual(bundle.mlAiEvidence, null);
  assert.strictEqual(bundle.featureSnapshot, null);
})();

(function canonicalEvidenceSummaryIsDeterministic() {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "WEBHOOK_ASSISTED",
    signalLineageId: "LINEAGE__SOL__CANON__1",
    symbol: "SOLUSDT",
    side: "LONG",
    qualityScore: 0.69,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "LIVE",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "aligned long for canonical summary",
    policyScope: "SOL_15M",
    htfDirection: "LONG",
    htfConfidence: 0.67,
  });
  const summary = buildCanonicalEvidenceSummary({
    signalIntent: bundle.signalIntent,
    strategyFilterResult: bundle.strategyFilterResult,
    mlAiEvidence: bundle.mlAiEvidence,
  });
  assert.strictEqual(summary.hard_guards.budget_min_order, "PASS__PASS");
  assert.strictEqual(summary.strategy_filter.filter_name, "HTF_DIRECTION_ALIGNMENT");
  assert.strictEqual(summary.feature_snapshot.present, false);
  assert.strictEqual(summary.ml_ai_signal_proposal.present, false);
  assert.strictEqual(summary.ml_ai_evidence.present, false);
  assert.strictEqual(summary.evidence_complete, true);
})();

(function serverNativeBundleRequiresFeatureSnapshot() {
  let err = null;
  try {
    buildOpenClawDecisionBundle({
      signalSourceMode: "SERVER_NATIVE_ML_AI",
      signalLineageId: "LINEAGE__AVAX__1",
      symbol: "AVAXUSDT",
      side: "LONG",
      qualityScore: 0.73,
      budgetCheckResult: "PASS",
      minOrderCheckResult: "PASS",
      decisionStatus: "APPROVED",
      decisionMode: "CANARY",
      recommendedAction: "APPROVE_ENTRY",
      approved: true,
      rationaleSummary: "missing feature snapshot should fail closed",
      policyScope: "AVAX_15M",
      htfDirection: "LONG",
      htfConfidence: 0.7,
      featuresHash: "feat_hash_avax_v1",
      modelVersion: "openclaw-ml-v2",
      decisionSummary: "model would approve but snapshot absent",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "FEATURE_SNAPSHOT_REQUIRED");
})();

(function serverNativeBundleRequiresSignalProposal() {
  let err = null;
  try {
    buildOpenClawDecisionBundle({
      signalSourceMode: "SERVER_NATIVE_ML_AI",
      signalLineageId: "LINEAGE__LINK__1",
      symbol: "LINKUSDT",
      side: "SHORT",
      qualityScore: 0.68,
      budgetCheckResult: "PASS",
      minOrderCheckResult: "PASS",
      decisionStatus: "APPROVED",
      decisionMode: "CANARY",
      recommendedAction: "APPROVE_ENTRY",
      approved: true,
      rationaleSummary: "missing proposal should fail closed",
      policyScope: "LINK_15M",
      htfDirection: "SHORT",
      htfConfidence: 0.71,
      timeframe: "15M",
      featureSchemaVersion: "ml_features_v1",
      featureValues: {
        trend_bias: -0.68,
        volatility_rank: 0.49,
      },
      featuresHash: "feat_hash_link_v1",
      modelVersion: "openclaw-ml-v2",
      decisionSummary: "model produced evidence but no proposal contract",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "ML_AI_SIGNAL_PROPOSAL_REQUIRED");
})();

(function openclawAndMlServicesCannotWriteExchange() {
  assert.strictEqual(V2_SERVICE_BOUNDARIES.V2_OPENCLAW_CONTROL_PLANE.mayWriteExchange, false);
  assert.strictEqual(V2_SERVICE_BOUNDARIES.V2_ML_AI_SIGNAL_ENGINE.mayWriteExchange, false);
  assert.strictEqual(V2_SERVICE_BOUNDARIES.V2_SIGNAL_AUTHORITY_ROUTER.mayWriteExchange, false);
})();

console.log("V2_OPENCLAW_CONTROL_PLANE_TEST_OK");
