"use strict";

const { buildOpenClawDecisionBundle } = require("./openclawControlPlane");

function buildWebhookBundle() {
  return buildOpenClawDecisionBundle({
    signalSourceMode: "WEBHOOK_ASSISTED",
    signalLineageId: "LINEAGE__BTC__WEB__1",
    symbol: "BTCUSDT",
    side: "LONG",
    qualityScore: 0.72,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "LIVE",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "webhook approved",
    policyScope: "BTC_15M",
    htfDirection: "LONG",
    htfConfidence: 0.78,
  });
}

function buildNativeBundle(overrides = {}) {
  return buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__BTC__NATIVE__1",
    symbol: "BTCUSDT",
    side: "LONG",
    qualityScore: 0.74,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "CANARY",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "native approved",
    policyScope: "BTC_15M",
    htfDirection: "LONG",
    htfConfidence: 0.76,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v1",
    featureValues: {
      trend_bias: 0.74,
      volatility_rank: 0.43,
    },
    proposalVerdict: "PASS",
    rankScore: 0.69,
    sizeRatio: 0.5,
    riskBand: "MEDIUM",
    featuresHash: "feat_hash_btc_native_v1",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "native approved with aligned trend",
    ...overrides,
  });
}

function buildReferenceComparisonFixtures(profile = "REFERENCE_CLEAN") {
  const normalized = String(profile || "").trim().toUpperCase() || "REFERENCE_CLEAN";
  if (normalized === "REFERENCE_CLEAN") {
    return Object.freeze({
      shadowLivePairs: [{
        label: "BTC_CLEAN",
        shadowProposal: {
          symbol: "BTCUSDT",
          side: "LONG",
          timeframe: "15M",
          proposal_verdict: "PASS",
          strategy_filter_verdict: "PASS",
          quality_score: 0.81,
          rank_score: 0.72,
          size_ratio: 0.5,
        },
        liveProposal: {
          symbol: "BTCUSDT",
          side: "LONG",
          timeframe: "15M",
          proposal_verdict: "PASS",
          strategy_filter_verdict: "PASS",
          quality_score: 0.8,
          rank_score: 0.73,
          size_ratio: 0.5,
        },
        shadowDecision: { approved: true },
        liveDecision: { approved: true },
      }],
      sourceModePairs: [{
        label: "BTC_SOURCE_CLEAN",
        webhookBundle: buildWebhookBundle(),
        nativeBundle: buildNativeBundle(),
      }],
    });
  }
  if (normalized === "REFERENCE_WARN") {
    return Object.freeze({
      shadowLivePairs: [{
        label: "SOL_WARN",
        shadowProposal: {
          symbol: "SOLUSDT",
          side: "LONG",
          timeframe: "15M",
          proposal_verdict: "PASS",
          strategy_filter_verdict: "PASS",
          quality_score: 0.9,
          rank_score: 0.85,
          size_ratio: 0.8,
        },
        liveProposal: {
          symbol: "SOLUSDT",
          side: "LONG",
          timeframe: "15M",
          proposal_verdict: "PASS",
          strategy_filter_verdict: "PASS",
          quality_score: 0.7,
          rank_score: 0.55,
          size_ratio: 0.45,
        },
        shadowDecision: { approved: true },
        liveDecision: { approved: true },
      }],
      sourceModePairs: [{
        label: "BTC_SOURCE_WARN",
        webhookBundle: buildWebhookBundle(),
        nativeBundle: buildNativeBundle({
          qualityScore: 0.92,
        }),
      }],
    });
  }
  if (normalized === "REFERENCE_BLOCKED") {
    return Object.freeze({
      shadowLivePairs: [{
        label: "ETH_BLOCK",
        shadowProposal: {
          symbol: "ETHUSDT",
          side: "SHORT",
          timeframe: "15M",
          proposal_verdict: "PASS",
          strategy_filter_verdict: "PASS",
          quality_score: 0.76,
          rank_score: 0.77,
          size_ratio: 0.5,
        },
        liveProposal: {
          symbol: "ETHUSDT",
          side: "SHORT",
          timeframe: "15M",
          proposal_verdict: "BLOCK",
          strategy_filter_verdict: "PASS",
          quality_score: 0.76,
          rank_score: 0.52,
          size_ratio: 0.2,
        },
      }],
      sourceModePairs: [{
        label: "BTC_SOURCE_BLOCKED",
        webhookBundle: buildWebhookBundle(),
        nativeBundle: buildNativeBundle({
          recommendedAction: "BLOCK_ENTRY",
          approved: false,
          decisionSummary: "native blocked",
          proposalVerdict: "BLOCK",
        }),
      }],
    });
  }
  throw new Error(`V2_COMPARISON_FIXTURE_PROFILE_INVALID:${normalized}`);
}

module.exports = {
  buildWebhookBundle,
  buildNativeBundle,
  buildReferenceComparisonFixtures,
};
