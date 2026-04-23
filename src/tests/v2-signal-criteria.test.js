"use strict";

const assert = require("assert");
const { buildSignalCriteria } = require("../v2/signalCriteria");
const { buildPassSignalCriteriaSeed } = require("./helpers/passSignalCriteriaSeed");

(function passingCriteriaBuildsPassVerdict() {
  const criteria = buildSignalCriteria({
    signalSide: "LONG",
    signalCriteria: buildPassSignalCriteriaSeed("LONG"),
    qualityScore: 0.84,
    featureValues: {
      market_regime: "trend",
      htf_regime: "LONG",
      htf_alignment_score: 0.82,
      setup_type: "PULLBACK_RECLAIM",
      setup_quality_score: 0.8,
      trigger_confirmed: true,
      volume_zscore: 1.4,
      rsi_entry_tf: 58,
      volatility_zscore: 0.2,
      liquidity_score: 0.92,
      expected_gross_r: 2.0,
      expected_net_r_after_cost: 0.3,
      cost_estimate_bps: 5,
      cost_r_equivalent: 1.7,
      funding_penalty_bps: 1,
      market_quality_score: 0.9,
      spread_bps: 2,
      mark_index_gap_bps: 1,
    },
    marketDataQuality: {
      ok: true,
      metrics: {
        spread_bps: 2,
        mark_index_gap_bps: 1,
      },
    },
  });
  assert.strictEqual(criteria.verdict, "PASS");
  assert.strictEqual(criteria.htf_regime.ok, true);
  assert.strictEqual(criteria.setup_gate.ok, true);
  assert.strictEqual(criteria.trigger_gate.ok, true);
  assert.strictEqual(criteria.expected_edge_gate.ok, true);
  assert.strictEqual(criteria.regime_profile.structural_regime, "TREND");
  assert.strictEqual(criteria.regime_profile.regime_cohort, "TREND__NORMAL_VOL__ADEQUATE");
  assert.strictEqual(criteria.expected_edge_model.edge_cohort, "STRONG_EDGE");
  assert.ok(criteria.expected_edge_model.tp1_reach_probability > 0.5);
  assert.ok(criteria.signal_score >= 80);
})();

(function missingEvidenceFailsClosed() {
  const criteria = buildSignalCriteria({
    signalSide: "LONG",
    featureValues: {},
    marketDataQuality: null,
  });
  assert.strictEqual(criteria.verdict, "BLOCK");
  assert.ok(criteria.blockers.includes("NO_TRADE:NO_EVIDENCE:MARKET_QUALITY_SCORE"));
  assert.ok(criteria.blockers.includes("SETUP:NO_EVIDENCE:SETUP_TYPE"));
  assert.ok(criteria.blockers.includes("TRIGGER:NO_EVIDENCE:TRIGGER_CONFIRMED"));
  assert.ok(criteria.blockers.includes("EXPECTED_EDGE:NO_EVIDENCE:EXPECTED_NET_R_AFTER_COST"));
})();

(function setupIsNotSynthesizedFromHtfAlignment() {
  const criteria = buildSignalCriteria({
    signalSide: "LONG",
    signalCriteria: buildPassSignalCriteriaSeed("LONG", {
      setup_gate: { setup_type: "NONE", setup_quality_score: null },
    }),
    qualityScore: 0.84,
    featureValues: {
      market_regime: "trend",
      htf_regime: "LONG",
      htf_alignment_score: 0.82,
      trigger_confirmed: true,
      volume_zscore: 1.4,
      rsi_entry_tf: 58,
      volatility_zscore: 0.2,
      liquidity_score: 0.92,
      expected_gross_r: 2.0,
      expected_net_r_after_cost: 0.3,
      cost_estimate_bps: 5,
      cost_r_equivalent: 1.7,
      funding_penalty_bps: 1,
      market_quality_score: 0.9,
      spread_bps: 2,
      mark_index_gap_bps: 1,
    },
    marketDataQuality: {
      ok: true,
      metrics: {
        spread_bps: 2,
        mark_index_gap_bps: 1,
      },
    },
  });
  assert.strictEqual(criteria.verdict, "BLOCK");
  assert.strictEqual(criteria.setup_gate.setup_type, "NONE");
  assert.ok(criteria.blockers.includes("SETUP:NO_EVIDENCE:SETUP_TYPE"));
})();

(function externalSignalScoreCannotOverrideComputedScore() {
  const criteria = buildSignalCriteria({
    signalSide: "LONG",
    signalCriteria: {
      ...buildPassSignalCriteriaSeed("LONG"),
      signal_score: 99,
    },
    signalScore: 99,
    featureValues: {
      market_regime: "trend",
      htf_regime: "LONG",
      htf_alignment_score: 0.82,
      setup_type: "PULLBACK_RECLAIM",
      setup_quality_score: 0.8,
      trigger_confirmed: true,
      volume_zscore: 1.4,
      rsi_entry_tf: 58,
      volatility_zscore: 0.2,
      liquidity_score: 0.92,
      expected_gross_r: 2.0,
      expected_net_r_after_cost: 0.3,
      cost_estimate_bps: 5,
      cost_r_equivalent: 1.7,
      funding_penalty_bps: 1,
      market_quality_score: 0.9,
      spread_bps: 2,
      mark_index_gap_bps: 1,
    },
    marketDataQuality: {
      ok: true,
      metrics: {
        spread_bps: 2,
        mark_index_gap_bps: 1,
      },
    },
  });
  const componentSum = Object.values(criteria.signal_score_components).reduce((sum, value) => sum + value, 0);
  assert.strictEqual(criteria.signal_score, componentSum);
  assert.notStrictEqual(criteria.signal_score, 99);
})();

(function inconsistentAccountingBlocksExpectedEdge() {
  const criteria = buildSignalCriteria({
    signalSide: "LONG",
    signalCriteria: buildPassSignalCriteriaSeed("LONG", {
      expected_edge_gate: {
        expected_gross_r: 1.8,
        expected_net_r_after_cost: 0.3,
        cost_estimate_bps: 50,
        cost_r_equivalent: 0.2,
      },
    }),
    featureValues: {
      market_regime: "trend",
      htf_regime: "LONG",
      htf_alignment_score: 0.82,
      setup_type: "PULLBACK_RECLAIM",
      setup_quality_score: 0.8,
      trigger_confirmed: true,
      volume_zscore: 1.4,
      rsi_entry_tf: 58,
      volatility_zscore: 0.2,
      liquidity_score: 0.92,
      expected_gross_r: 1.8,
      expected_net_r_after_cost: 0.3,
      cost_estimate_bps: 50,
      cost_r_equivalent: 0.2,
      funding_penalty_bps: 1,
      market_quality_score: 0.9,
      spread_bps: 2,
      mark_index_gap_bps: 1,
    },
    marketDataQuality: {
      ok: true,
      metrics: {
        spread_bps: 2,
        mark_index_gap_bps: 1,
      },
    },
  });
  assert.strictEqual(criteria.verdict, "BLOCK");
  assert.ok(criteria.blockers.includes("EXPECTED_EDGE:ACCOUNTING_INCONSISTENT"));
})();

console.log("V2_SIGNAL_CRITERIA_TEST_OK");
