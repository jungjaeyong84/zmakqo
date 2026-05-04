"use strict";

const assert = require("assert");
const { buildSignalCriteria } = require("../v2/signalCriteria");
const { buildSignalShadowFilters } = require("../v2/signalShadowFilters");

function baseFeatures(overrides = {}) {
  return {
    market_regime: "trend",
    htf_regime: "LONG",
    htf_alignment_score: 0.82,
    mtf_1h_direction: "LONG",
    btc_1h_trend: "LONG",
    setup_type: "PULLBACK_RECLAIM",
    reclaim_confirmed: true,
    hold_after_reclaim: true,
    stop_distance_sane: true,
    setup_quality_score: 0.8,
    trigger_confirmed: true,
    volume_zscore: 1.4,
    rsi_entry_tf: 58,
    volatility_30m_baseline_ratio: 1.2,
    expected_gross_r: 2.0,
    expected_net_r_after_cost: 0.3,
    expected_alpha_bps: 35,
    total_cost_bps: 12,
    cost_estimate_bps: 12,
    cost_r_equivalent: 1.7,
    funding_penalty_bps: 1,
    market_quality_score: 0.9,
    spread_bps: 2,
    mark_index_gap_bps: 1,
    ...overrides,
  };
}

(function altLongWouldBlockWhenBtcOneHourTrendIsDown() {
  const decision = buildSignalShadowFilters({
    symbol: "SOLUSDT",
    signalSide: "LONG",
    featureValues: baseFeatures({ btc_1h_trend: "SHORT" }),
    marketDataQuality: { ok: true, metrics: {} },
  });
  assert.strictEqual(decision.mode, "SHADOW_ONLY");
  assert.strictEqual(decision.would_block, true);
  assert.ok(decision.blockers.some((row) => row.includes("BTC_1H_TREND_ALT_LONG")));
})();

(function multiTfOppositeWouldBlock() {
  const decision = buildSignalShadowFilters({
    symbol: "XRPUSDT",
    signalSide: "LONG",
    featureValues: baseFeatures({ mtf_1h_direction: "SHORT" }),
    marketDataQuality: { ok: true, metrics: {} },
  });
  assert.strictEqual(decision.would_block, true);
  assert.ok(decision.blockers.some((row) => row.includes("MULTI_TF_1H_ALIGNMENT")));
})();

(function volatilityChaosWouldBlock() {
  const decision = buildSignalShadowFilters({
    symbol: "BNBUSDT",
    signalSide: "LONG",
    featureValues: baseFeatures({ volatility_30m_baseline_ratio: 3.5 }),
    marketDataQuality: { ok: true, metrics: {} },
  });
  assert.strictEqual(decision.would_block, true);
  assert.ok(decision.blockers.some((row) => row.includes("VOLATILITY_CHAOS_30M")));
})();

(function costAdjustedEdgeWouldBlockWhenCostExceedsAlpha() {
  const decision = buildSignalShadowFilters({
    symbol: "DOGEUSDT",
    signalSide: "LONG",
    featureValues: baseFeatures({ expected_alpha_bps: 8, total_cost_bps: 12 }),
    marketDataQuality: { ok: true, metrics: {} },
  });
  assert.strictEqual(decision.would_block, true);
  assert.ok(decision.blockers.some((row) => row.includes("COST_ADJUSTED_EDGE")));
})();

(function btcOpposedNowHardBlocksSignalCriteriaViaAdverseSelection() {
  const criteria = buildSignalCriteria({
    symbol: "SOLUSDT",
    signalSide: "LONG",
    featureValues: baseFeatures({
      btc_1h_trend: "SHORT",
      mtf_1h_direction: "LONG",
    }),
    marketDataQuality: {
      ok: true,
      metrics: {
        spread_bps: 2,
        mark_index_gap_bps: 1,
      },
    },
  });
  assert.strictEqual(criteria.verdict, "BLOCK");
  assert.ok(criteria.blockers.includes("EXPECTED_EDGE:NET_R_REQUIRED"));
  assert.ok(criteria.expected_edge_gate.adverse_selection_reasons.includes("BTC_1H_OPPOSED"));
  assert.ok(criteria.expected_edge_gate.adverse_selection_penalty_r > 0);
  assert.strictEqual(criteria.shadow_filter_decision.would_block, true);
  assert.strictEqual(criteria.shadow_filter_decision.hard_block_enabled, false);
})();

console.log("V2_SIGNAL_SHADOW_FILTERS_TEST_OK");
