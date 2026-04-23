"use strict";

const assert = require("assert");
const { buildSignalCriteria } = require("../v2/signalCriteria");

(function passingCriteriaBuildsPassVerdict() {
  const criteria = buildSignalCriteria({
    signalSide: "LONG",
    qualityScore: 0.84,
    featureValues: {
      htf_regime: "LONG",
      htf_alignment_score: 0.82,
      setup_type: "PULLBACK_RECLAIM",
      setup_quality_score: 0.8,
      trigger_confirmed: true,
      volume_zscore: 1.4,
      rsi_entry_tf: 58,
      expected_gross_r: 2.0,
      expected_net_r_after_cost: 0.33,
      cost_estimate_bps: 5,
      funding_penalty_bps: 1,
    },
    marketDataQuality: {
      ok: true,
      metrics: {
        spread_bps: 2,
        mark_index_gap_bps: 2,
      },
    },
  });
  assert.strictEqual(criteria.verdict, "PASS");
  assert.strictEqual(criteria.htf_regime.ok, true);
  assert.strictEqual(criteria.setup_gate.ok, true);
  assert.strictEqual(criteria.trigger_gate.ok, true);
  assert.strictEqual(criteria.expected_edge_gate.ok, true);
  assert.ok(criteria.signal_score >= 80);
})();

(function weakExpectedEdgeBlocksCriteria() {
  const criteria = buildSignalCriteria({
    signalSide: "LONG",
    qualityScore: 0.84,
    featureValues: {
      htf_regime: "LONG",
      htf_alignment_score: 0.82,
      setup_type: "PULLBACK_RECLAIM",
      setup_quality_score: 0.8,
      trigger_confirmed: true,
      volume_zscore: 1.4,
      rsi_entry_tf: 58,
      expected_gross_r: 1.1,
      expected_net_r_after_cost: 0.05,
      cost_estimate_bps: 12,
      funding_penalty_bps: 1,
    },
    marketDataQuality: {
      ok: true,
      metrics: {
        spread_bps: 2,
        mark_index_gap_bps: 2,
      },
    },
  });
  assert.strictEqual(criteria.verdict, "BLOCK");
  assert.ok(criteria.blockers.includes("EXPECTED_EDGE:NET_R_REQUIRED"));
})();

console.log("V2_SIGNAL_CRITERIA_TEST_OK");
