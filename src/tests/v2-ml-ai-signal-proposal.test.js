"use strict";

const assert = require("assert");
const { buildMlAiSignalProposal } = require("../v2/mlAiSignalProposal");

(function proposalRequiresSignalIntentFeatureSnapshotAndFilter() {
  let err = null;
  try {
    buildMlAiSignalProposal({
      signalIntent: null,
      featureSnapshot: null,
      strategyFilterResult: null,
      decisionMode: "CANARY",
      proposalVerdict: "PASS",
      rankScore: 0.8,
      sizeRatio: 0.5,
      rationaleSummary: "invalid fixture",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "SIGNAL_INTENT_REQUIRED");
})();

(function proposalBuildsDeterministicContract() {
  const proposal = buildMlAiSignalProposal({
    signalIntent: {
      signal_intent_id: "SIGINTV2__SERVER_NATIVE_ML_AI__BTCUSDT__LONG__abc123",
      signal_source_mode: "SERVER_NATIVE_ML_AI",
      symbol: "BTCUSDT",
      side: "LONG",
      quality_score: 0.82,
    },
    featureSnapshot: {
      feature_snapshot_id: "FSV2__btc123",
      timeframe: "15M",
    },
    strategyFilterResult: {
      filter_name: "HTF_DIRECTION_ALIGNMENT",
      verdict: "PASS",
    },
    signalCriteria: {
      setup_gate: {
        setup_type: "PULLBACK_RECLAIM",
      },
      regime_profile: {
        structural_regime: "TREND",
        regime_cohort: "TREND__NORMAL_VOL__ADEQUATE",
      },
      signal_score: 86,
      expected_edge_gate: {
        expected_net_r_after_cost: 0.31,
      },
      expected_edge_model: {
        edge_cohort: "BUILDABLE_EDGE",
        tp1_reach_probability: 0.64,
        stop_hit_probability: 0.29,
      },
    },
    decisionMode: "CANARY",
    proposalVerdict: "PASS",
    rankScore: 0.88,
    sizeRatio: 0.5,
    riskBand: "LOW",
    rationaleSummary: "native model proposes entry",
  });
  assert.ok(proposal.ml_ai_signal_proposal_id.startsWith("MSPV2__CANARY__PASS__"));
  assert.strictEqual(proposal.signal_intent_id, "SIGINTV2__SERVER_NATIVE_ML_AI__BTCUSDT__LONG__abc123");
  assert.strictEqual(proposal.feature_snapshot_id, "FSV2__btc123");
  assert.strictEqual(proposal.rank_score, 0.88);
  assert.strictEqual(proposal.size_ratio, 0.5);
  assert.strictEqual(proposal.risk_band, "LOW");
  assert.strictEqual(proposal.setup_type, "PULLBACK_RECLAIM");
  assert.strictEqual(proposal.signal_score, 86);
  assert.strictEqual(proposal.expected_net_r_after_cost, 0.31);
  assert.strictEqual(proposal.structural_regime, "TREND");
  assert.strictEqual(proposal.regime_cohort, "TREND__NORMAL_VOL__ADEQUATE");
  assert.strictEqual(proposal.edge_cohort, "BUILDABLE_EDGE");
  assert.strictEqual(proposal.tp1_reach_probability, 0.64);
  assert.strictEqual(proposal.stop_hit_probability, 0.29);
})();

console.log("V2_ML_AI_SIGNAL_PROPOSAL_TEST_OK");
