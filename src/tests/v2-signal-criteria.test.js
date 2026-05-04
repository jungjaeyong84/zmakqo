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
  assert.strictEqual(criteria.criteria_profile, "V6_COMPAT_DISCOVERY");
  assert.strictEqual(criteria.entry_grade, "CORE");
  assert.strictEqual(criteria.trigger_type, "NONE");
})();

(function v6CompatDiscoveryAllowsEarlySignalsWithoutStrictMode() {
  const criteria = buildSignalCriteria({
    signalSide: "LONG",
    criteriaProfile: "V6_COMPAT_DISCOVERY",
    featureValues: {
      market_regime: "transition",
      htf_regime: "LONG",
      htf_alignment_score: 0.55,
      setup_type: "MOMENTUM_CONTINUATION",
      setup_quality_score: 0.6,
      trigger_type: "CONTINUATION",
      trigger_confirmed: true,
      volume_zscore: 0.8,
      rsi_entry_tf: 52,
      expected_gross_r: 1.5,
      expected_net_r_after_cost: 0.5,
      cost_estimate_bps: 8,
      cost_r_equivalent: 1,
      funding_penalty_bps: 1,
      market_quality_score: 0.8,
      spread_bps: 8,
      mark_index_gap_bps: 3,
    },
    marketDataQuality: { ok: true, metrics: { spread_bps: 8, mark_index_gap_bps: 3 } },
  });
  assert.strictEqual(criteria.verdict, "PASS");
  assert.strictEqual(criteria.criteria_profile, "V6_COMPAT_DISCOVERY");
  assert.strictEqual(criteria.entry_grade, "EARLY");
  assert.strictEqual(criteria.trigger_type, "CONTINUATION");
})();

(function strictProfileRejectsSameEarlySignal() {
  const criteria = buildSignalCriteria({
    signalSide: "LONG",
    criteriaProfile: "STRICT",
    featureValues: {
      market_regime: "transition",
      htf_regime: "LONG",
      htf_alignment_score: 0.55,
      setup_type: "MOMENTUM_CONTINUATION",
      setup_quality_score: 0.6,
      trigger_type: "CONTINUATION",
      trigger_confirmed: true,
      volume_zscore: 0.8,
      rsi_entry_tf: 52,
      expected_gross_r: 1.5,
      expected_net_r_after_cost: 0.5,
      cost_estimate_bps: 8,
      cost_r_equivalent: 1,
      funding_penalty_bps: 1,
      market_quality_score: 0.8,
      spread_bps: 8,
      mark_index_gap_bps: 3,
    },
    marketDataQuality: { ok: true, metrics: { spread_bps: 8, mark_index_gap_bps: 3 } },
  });
  assert.strictEqual(criteria.verdict, "BLOCK");
  assert.strictEqual(criteria.criteria_profile, "STRICT");
  assert.ok(criteria.blockers.includes("HTF_REGIME:ALIGNMENT_REQUIRED"));
  assert.ok(criteria.blockers.includes("TRIGGER:CONFIRMATION_REQUIRED"));
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

(function marketDataQualityAliasesAreAcceptedAsEvidence() {
  const criteria = buildSignalCriteria({
    signalSide: "LONG",
    featureValues: {
      market_regime: "trend",
      htf_regime: "LONG",
      htf_alignment_score: 0.82,
      setup_type: "PULLBACK_RECLAIM",
      setup_quality_score: 0.8,
      trigger_confirmed: true,
      volume_zscore: 1.4,
      rsi_entry_tf: 58,
      expected_gross_r: 1.6,
      expected_net_r_after_cost: 1.5,
      cost_estimate_bps: 10,
      cost_r_equivalent: 0.1,
      funding_penalty_bps: 0,
      market_quality_score: 0.9,
    },
    marketDataQuality: {
      ok: true,
      spread_bps: 3,
      mark_index_divergence_bps: 1.1,
    },
  });
  assert.strictEqual(criteria.verdict, "PASS");
  assert.strictEqual(criteria.no_trade_gate.spread_bps, 3);
  assert.strictEqual(criteria.no_trade_gate.mark_index_gap_bps, 1.1);
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

(function weakPullbackReclaimIsDowngradedToProbeAndBlocked() {
  const criteria = buildSignalCriteria({
    signalSide: "LONG",
    criteriaProfile: "V6_COMPAT_DISCOVERY",
    featureValues: {
      market_regime: "trend",
      htf_regime: "LONG",
      htf_alignment_score: 0.5,
      setup_type: "PULLBACK_RECLAIM",
      setup_quality_score: 0.5,
      trigger_type: "RECLAIM",
      trigger_confirmed: true,
      reclaim_confirmed: true,
      hold_after_reclaim: false,
      stop_distance_sane: false,
      volume_zscore: 0.5,
      rsi_entry_tf: 53,
      expected_gross_r: 1.8,
      expected_net_r_after_cost: 1.2,
      cost_estimate_bps: 8,
      cost_r_equivalent: 0.6,
      funding_penalty_bps: 1,
      market_quality_score: 0.85,
      spread_bps: 3,
      mark_index_gap_bps: 1,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
    },
    marketDataQuality: { ok: true, metrics: { spread_bps: 3, mark_index_gap_bps: 1 } },
  });
  assert.strictEqual(criteria.verdict, "BLOCK");
  assert.strictEqual(criteria.setup_gate.setup_type, "PULLBACK_PROBE");
  assert.strictEqual(criteria.feature_snapshot_contract.pullback_reclaim_downgraded, true);
  assert.ok(criteria.blockers.includes("SETUP:PULLBACK_RECLAIM:HOLD_NOT_CONFIRMED"));
})();

(function adverseSelectionPenaltyReducesEffectiveNetRAndBlocksOpposedMtf() {
  const criteria = buildSignalCriteria({
    signalSide: "LONG",
    criteriaProfile: "V6_COMPAT_DISCOVERY",
    featureValues: {
      market_regime: "trend",
      htf_regime: "LONG",
      htf_alignment_score: 0.82,
      setup_type: "BREAKOUT_RETEST",
      setup_quality_score: 0.8,
      trigger_type: "BREAKOUT",
      trigger_confirmed: true,
      volume_zscore: 1.4,
      rsi_entry_tf: 58,
      expected_gross_r: 1.8,
      expected_net_r_after_cost: 0.35,
      cost_estimate_bps: 8,
      cost_r_equivalent: 1.45,
      funding_penalty_bps: 1,
      market_quality_score: 0.9,
      spread_bps: 2,
      mark_index_gap_bps: 1,
      btc_1h_trend: "SHORT",
      mtf_1h_direction: "SHORT",
      open_interest_delta_pct: 4,
      liquidation_notional_5m_quote: 12000000,
      orderbook_imbalance_top5: -0.3,
    },
    marketDataQuality: { ok: true, metrics: { spread_bps: 2, mark_index_gap_bps: 1 } },
  });
  assert.strictEqual(criteria.verdict, "BLOCK");
  assert.strictEqual(criteria.feature_snapshot_contract.btc_1h_alignment, "OPPOSED");
  assert.ok(criteria.expected_edge_gate.adverse_selection_penalty_r >= 0.5);
  assert.strictEqual(criteria.expected_edge_gate.effective_expected_net_r_after_cost, 0);
  assert.ok(criteria.blockers.includes("EXPECTED_EDGE:NET_R_REQUIRED"));
})();

(function realizedNegativeEdgeCohortDowngradesBuildableEdge() {
  const criteria = buildSignalCriteria({
    signalSide: "LONG",
    criteriaProfile: "V6_COMPAT_DISCOVERY",
    featureValues: {
      market_regime: "trend",
      htf_regime: "LONG",
      htf_alignment_score: 0.82,
      setup_type: "BREAKOUT_RETEST",
      setup_quality_score: 0.82,
      trigger_type: "BREAKOUT",
      trigger_confirmed: true,
      volume_zscore: 1.4,
      rsi_entry_tf: 58,
      expected_gross_r: 1.9,
      expected_net_r_after_cost: 0.4,
      cost_estimate_bps: 8,
      cost_r_equivalent: 1.5,
      funding_penalty_bps: 1,
      market_quality_score: 0.9,
      spread_bps: 2,
      mark_index_gap_bps: 1,
      edge_cohort_rolling_expectancy_r: -0.01,
    },
    marketDataQuality: { ok: true, metrics: { spread_bps: 2, mark_index_gap_bps: 1 } },
  });
  assert.strictEqual(criteria.expected_edge_model.edge_cohort_downgraded_by_realized_expectancy, true);
  assert.strictEqual(criteria.expected_edge_model.edge_cohort, "MARGINAL_EDGE");
})();

console.log("V2_SIGNAL_CRITERIA_TEST_OK");
