"use strict";

const assert = require("assert");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { resolveEntryIntentFromOpenClaw } = require("../v2/signalAuthorityRouter");

(function approvedCanaryDecisionProducesEntryIntent() {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__SOL__1",
    symbol: "SOLUSDT",
    side: "LONG",
    qualityScore: 0.77,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "CANARY",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "canary-approved native signal",
    policyScope: "SOL_15M",
    htfDirection: "LONG",
    htfConfidence: 0.76,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v1",
    featureValues: {
      trend_bias: 0.77,
      volatility_rank: 0.48,
    },
    proposalVerdict: "PASS",
    rankScore: 0.79,
    sizeRatio: 0.45,
    featuresHash: "feat_hash_sol_1",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "native quality passed canary threshold",
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  assert.strictEqual(routed.ok, true);
  assert.strictEqual(routed.entryIntent.signal_intent_id, bundle.signalIntent.signal_intent_id);
  assert.strictEqual(routed.entryIntent.policy_scope, "SOL_15M");
})();

(function shadowDecisionNeverProducesLiveEntryIntent() {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "WEBHOOK_ASSISTED",
    signalLineageId: "LINEAGE__XRP__1",
    symbol: "XRPUSDT",
    side: "SHORT",
    qualityScore: 0.66,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "SHADOW",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "shadow comparison only",
    policyScope: "XRP_15M",
    htfDirection: "SHORT",
    htfConfidence: 0.74,
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  assert.strictEqual(routed.ok, false);
  assert.strictEqual(routed.reason, "SHADOW_ONLY_MODE");
})();

(function minOrderFailureBlocksEntryIntent() {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "WEBHOOK_ASSISTED",
    signalLineageId: "LINEAGE__ADA__1",
    symbol: "ADAUSDT",
    side: "LONG",
    qualityScore: 0.71,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "BLOCKED",
    decisionStatus: "APPROVED",
    decisionMode: "LIVE",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "budget okay but min order failed",
    policyScope: "ADA_15M",
    htfDirection: "LONG",
    htfConfidence: 0.78,
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  assert.strictEqual(routed.ok, false);
  assert.strictEqual(routed.reason, "MIN_ORDER_GUARD_BLOCKED");
})();

(function mismatchedDecisionAndIntentHardFail() {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "WEBHOOK_ASSISTED",
    signalLineageId: "LINEAGE__DOGE__1",
    symbol: "DOGEUSDT",
    side: "LONG",
    qualityScore: 0.64,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "LIVE",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "approved webhook signal",
    policyScope: "DOGE_15M",
    htfDirection: "LONG",
    htfConfidence: 0.67,
  });
  let err = null;
  try {
    resolveEntryIntentFromOpenClaw({
      signalIntent: bundle.signalIntent,
      openclawDecision: {
        ...bundle.openclawDecision,
        signal_intent_id: "SIGINTV2__OTHER",
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "SIGNAL_DECISION_MISMATCH");
})();

(function missingStrategyFilterHardBlocks() {
  let err = null;
  try {
    buildOpenClawDecisionBundle({
      signalSourceMode: "WEBHOOK_ASSISTED",
      signalLineageId: "LINEAGE__BTC__FILTER__1",
      symbol: "BTCUSDT",
      side: "LONG",
      qualityScore: 0.88,
      budgetCheckResult: "PASS",
      minOrderCheckResult: "PASS",
      decisionStatus: "APPROVED",
      decisionMode: "LIVE",
      recommendedAction: "APPROVE_ENTRY",
      approved: true,
      rationaleSummary: "missing filter should fail closed",
      policyScope: "BTC_15M",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "STRATEGY_FILTER_EVIDENCE_REQUIRED");
})();

(function blockedStrategyFilterPreventsEntry() {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__ETH__FILTER__1",
    symbol: "ETHUSDT",
    side: "SHORT",
    qualityScore: 0.79,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "LIVE",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "filter blocked short entry",
    policyScope: "ETH_15M",
    htfDirection: "LONG",
    htfConfidence: 0.83,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v1",
    featureValues: {
      trend_bias: -0.64,
      volatility_rank: 0.59,
    },
    proposalVerdict: "BLOCK",
    rankScore: 0.41,
    sizeRatio: 0.2,
    featuresHash: "feat_hash_eth_filter_1",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "approved before filter gate",
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  assert.strictEqual(routed.ok, false);
  assert.strictEqual(routed.reason, "STRATEGY_FILTER_BLOCKED");
  assert.strictEqual(routed.detail, "HTF_DIRECTION_MISMATCH");
})();

console.log("V2_SIGNAL_AUTHORITY_ROUTER_TEST_OK");
