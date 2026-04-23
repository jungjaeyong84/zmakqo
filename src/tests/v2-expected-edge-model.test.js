"use strict";

const assert = require("assert");
const { buildExpectedEdgeModel } = require("../v2/expectedEdgeModel");

(function edgeModelRewardsAlignedCleanTrade() {
  const model = buildExpectedEdgeModel({
    signalSide: "LONG",
    htfAlignmentScore: 0.9,
    setupQualityScore: 0.88,
    volumeZScore: 2.2,
    rsiEntryTf: 64,
    marketQualityScore: 0.94,
    spreadBps: 2,
    fundingPenaltyBps: 1,
    expectedGrossR: 2.3,
    expectedNetRAfterCost: 0.52,
    costEstimateBps: 5,
    costREquivalent: 1.78,
    regimeProfile: {
      regime_score: 0.92,
      liquidity_regime: "ADEQUATE",
    },
  });

  assert.ok(model.tp1_reach_probability > 0.6);
  assert.ok(model.stop_hit_probability < 0.5);
  assert.ok(model.edge_score_out_of_20 >= 14);
  assert.strictEqual(model.edge_cohort, "STRONG_EDGE");
})();

(function edgeModelPenalizesThinFriction() {
  const model = buildExpectedEdgeModel({
    signalSide: "LONG",
    htfAlignmentScore: 0.62,
    setupQualityScore: 0.61,
    volumeZScore: 1.05,
    rsiEntryTf: 56,
    marketQualityScore: 0.68,
    spreadBps: 9,
    fundingPenaltyBps: 3,
    expectedGrossR: 1.85,
    expectedNetRAfterCost: 0.27,
    costEstimateBps: 18,
    costREquivalent: 1.58,
    regimeProfile: {
      regime_score: 0.48,
      liquidity_regime: "THIN",
    },
  });

  assert.ok(model.friction_penalty_score > 0.5);
  assert.ok(model.edge_score_out_of_20 < 14);
  assert.strictEqual(model.edge_cohort, "MARGINAL_EDGE");
})();

console.log("V2_EXPECTED_EDGE_MODEL_TEST_OK");
