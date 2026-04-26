"use strict";

const assert = require("assert");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { resolveEntryIntentFromOpenClaw } = require("../v2/signalAuthorityRouter");
const { buildPassSignalCriteriaSeed } = require("./helpers/passSignalCriteriaSeed");

function buildNativeSignalBundle(overrides = {}) {
  const side = String(overrides.side || "LONG").trim().toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  return buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__NATIVE_SIGNAL_ROUTER__1",
    symbol: "ETHUSDT",
    side,
    qualityScore: 0.79,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "CANARY",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "native router fixture",
    policyScope: "ETH_15M",
    htfDirection: side,
    htfConfidence: 0.83,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v1",
    featureValues: {
      trend_bias: side === "LONG" ? 0.64 : -0.64,
      volatility_rank: 0.59,
    },
    proposalVerdict: "PASS",
    rankScore: 0.72,
    sizeRatio: 0.3,
    featuresHash: "feat_hash_signal_router_native_1",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "native router fixture",
    marketDataQuality: {
      ok: true,
      reason: "V2_MARKET_DATA_QUALITY_PASS",
      blockers: [],
      metrics: { symbol: "ETHUSDT", spread_bps: 2, mark_index_gap_bps: 1 },
    },
    signalCriteria: buildPassSignalCriteriaSeed(side),
    ...overrides,
  });
}

(function approvedCanaryDecisionProducesEntryIntent() {
  const bundle = buildNativeSignalBundle({
    signalLineageId: "LINEAGE__SOL__1",
    symbol: "SOLUSDT",
    qualityScore: 0.77,
    rationaleSummary: "canary-approved native signal",
    policyScope: "SOL_15M",
    htfConfidence: 0.76,
    featureValues: { trend_bias: 0.77, volatility_rank: 0.48 },
    rankScore: 0.79,
    sizeRatio: 0.45,
    featuresHash: "feat_hash_sol_1",
    decisionSummary: "native quality passed canary threshold",
    marketDataQuality: {
      ok: true,
      reason: "V2_MARKET_DATA_QUALITY_PASS",
      blockers: [],
      metrics: { symbol: "SOLUSDT", spread_bps: 2, mark_index_gap_bps: 1 },
    },
    signalCriteria: buildPassSignalCriteriaSeed("LONG"),
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  assert.strictEqual(routed.ok, true);
  assert.strictEqual(routed.entryIntent.signal_intent_id, bundle.signalIntent.signal_intent_id);
  assert.strictEqual(routed.entryIntent.policy_scope, "SOL_15M");
})();

(function missingMarketDataQualityBlocksServerNativeEntry() {
  const bundle = buildNativeSignalBundle({
    signalLineageId: "LINEAGE__SOL__MISSING_MDQ",
    symbol: "SOLUSDT",
    qualityScore: 0.77,
    rationaleSummary: "missing market data quality should fail closed",
    policyScope: "SOL_15M",
    htfConfidence: 0.76,
    featureValues: { trend_bias: 0.77, volatility_rank: 0.48 },
    rankScore: 0.79,
    sizeRatio: 0.45,
    featuresHash: "feat_hash_sol_missing_mdq",
    decisionSummary: "native quality passed but market data evidence missing",
    marketDataQuality: null,
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  assert.strictEqual(routed.ok, false);
  assert.strictEqual(routed.reason, "MARKET_DATA_QUALITY_REQUIRED");
  assert.ok(routed.market_data_quality_gate.blockers.includes("MARKET_DATA:QUALITY_EVIDENCE_REQUIRED"));
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
  const bundle = buildNativeSignalBundle({
    signalLineageId: "LINEAGE__ETH__FILTER__1",
    side: "SHORT",
    qualityScore: 0.79,
    decisionMode: "LIVE",
    rationaleSummary: "filter blocked short entry",
    policyScope: "ETH_15M",
    htfDirection: "LONG",
    htfConfidence: 0.83,
    featureValues: { trend_bias: -0.64, volatility_rank: 0.59 },
    proposalVerdict: "BLOCK",
    rankScore: 0.41,
    sizeRatio: 0.2,
    featuresHash: "feat_hash_eth_filter_1",
    decisionSummary: "approved before filter gate",
    signalCriteria: buildPassSignalCriteriaSeed("SHORT"),
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  assert.strictEqual(routed.ok, false);
  assert.strictEqual(routed.reason, "STRATEGY_FILTER_BLOCKED");
  assert.strictEqual(routed.detail, "HTF_DIRECTION_MISMATCH");
})();

(function blockedMlAiProposalPreventsServerNativeEntryEvenWhenStrategyFilterPasses() {
  const bundle = buildNativeSignalBundle({
    signalLineageId: "LINEAGE__ETH__ML_BLOCK__1",
    side: "LONG",
    qualityScore: 0.79,
    decisionMode: "LIVE",
    rationaleSummary: "strategy passes but ML blocks entry",
    policyScope: "ETH_15M",
    htfConfidence: 0.83,
    featureValues: { trend_bias: 0.64, volatility_rank: 0.59 },
    proposalVerdict: "BLOCK",
    rankScore: 0.41,
    sizeRatio: 0.2,
    featuresHash: "feat_hash_eth_ml_block_1",
    decisionSummary: "ML rejected this setup",
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  assert.strictEqual(routed.ok, false);
  assert.strictEqual(routed.reason, "ML_AI_PROPOSAL_NOT_APPROVED");
  assert.strictEqual(routed.detail, "BLOCK");
})();

(function blockedSignalCriteriaPreventsServerNativeEntryEvenWhenProposalPasses() {
  const bundle = buildNativeSignalBundle({
    signalLineageId: "LINEAGE__BTC__SIGNAL_CRITERIA_BLOCK__1",
    symbol: "BTCUSDT",
    side: "LONG",
    qualityScore: 0.81,
    decisionMode: "CANARY",
    rationaleSummary: "criteria should block weak expected edge",
    policyScope: "BTC_15M",
    htfConfidence: 0.83,
    featureValues: {
      trend_bias: 0.64,
      volatility_rank: 0.44,
      setup_type: "PULLBACK_RECLAIM",
      setup_quality_score: 0.79,
      trigger_confirmed: true,
      volume_zscore: 1.3,
      rsi_entry_tf: 58,
      expected_gross_r: 1.0,
      expected_net_r_after_cost: 0.03,
      cost_estimate_bps: 5,
      cost_r_equivalent: 0.9,
      market_quality_score: 0.9,
      funding_penalty_bps: 1,
    },
    rankScore: 0.72,
    sizeRatio: 0.3,
    featuresHash: "feat_hash_btc_signal_criteria_block_1",
    decisionSummary: "proposal passes but expected edge is too weak",
    marketDataQuality: {
      ok: true,
      reason: "V2_MARKET_DATA_QUALITY_PASS",
      blockers: [],
      metrics: { symbol: "BTCUSDT", spread_bps: 2, mark_index_gap_bps: 1 },
    },
    signalCriteria: buildPassSignalCriteriaSeed("LONG", {
      expected_edge_gate: {
        expected_gross_r: 1.0,
        expected_net_r_after_cost: 0.03,
        cost_estimate_bps: 5,
        cost_r_equivalent: 0.9,
      },
    }),
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  assert.strictEqual(routed.ok, false);
  assert.strictEqual(routed.reason, "SIGNAL_CRITERIA_BLOCKED");
  assert.ok(routed.detail.includes("EXPECTED_EDGE:NET_R_REQUIRED"));
})();

(function missingSignalCriteriaBlocksServerNativeEntry() {
  const bundle = buildNativeSignalBundle({
    signalLineageId: "LINEAGE__BTC__CRITERIA_REQUIRED__1",
  });
  const routed = resolveEntryIntentFromOpenClaw({
    signalIntent: bundle.signalIntent,
    openclawDecision: {
      ...bundle.openclawDecision,
      canonical_evidence_summary: {
        ...bundle.openclawDecision.canonical_evidence_summary,
        signal_criteria: {
          present: false,
          verdict: null,
          blockers: [],
        },
      },
    },
  });
  assert.strictEqual(routed.ok, false);
  assert.strictEqual(routed.reason, "SIGNAL_CRITERIA_REQUIRED");
})();

console.log("V2_SIGNAL_AUTHORITY_ROUTER_TEST_OK");
