"use strict";

function buildPassSignalCriteriaSeed(side = "LONG", overrides = {}) {
  const normalizedSide = String(side || "").trim().toUpperCase() === "SHORT" ? "SHORT" : "LONG";
  const base = {
    htf_regime: {
      regime: normalizedSide,
      alignment_score: 0.94,
    },
    setup_gate: {
      setup_type: "PULLBACK_RECLAIM",
      setup_quality_score: 0.92,
    },
    trigger_gate: {
      trigger_confirmed: true,
      volume_zscore: 2.1,
      rsi_entry_tf: normalizedSide === "LONG" ? 65 : 35,
    },
    no_trade_gate: {
      market_quality_score: 1,
      spread_bps: 2,
      mark_index_gap_bps: 1,
      funding_penalty_bps: 1,
    },
    expected_edge_gate: {
      expected_gross_r: 2.2,
      expected_net_r_after_cost: 0.5,
      cost_estimate_bps: 5,
      cost_r_equivalent: 1.7,
    },
    feature_snapshot_contract: {
      btc_1h_trend: normalizedSide,
      mtf_1h_direction: normalizedSide,
    },
  };
  return Object.freeze({
    ...base,
    ...overrides,
    htf_regime: { ...base.htf_regime, ...(overrides.htf_regime || {}) },
    setup_gate: { ...base.setup_gate, ...(overrides.setup_gate || {}) },
    trigger_gate: { ...base.trigger_gate, ...(overrides.trigger_gate || {}) },
    no_trade_gate: { ...base.no_trade_gate, ...(overrides.no_trade_gate || {}) },
    expected_edge_gate: { ...base.expected_edge_gate, ...(overrides.expected_edge_gate || {}) },
    feature_snapshot_contract: {
      ...base.feature_snapshot_contract,
      ...(overrides.feature_snapshot_contract || {}),
    },
  });
}

module.exports = {
  buildPassSignalCriteriaSeed,
};
