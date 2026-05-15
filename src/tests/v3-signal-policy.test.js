"use strict";

const assert = require("assert");

const { normalizeSignalForV3, evaluateV3SignalPolicy } = require("../v3/signalPolicy");

(() => {
  const signal = normalizeSignalForV3({
    signal_id: "sig-long-buildable-core",
    event: "LONG",
    side: "BUY",
    exchange: "BINANCEFUT",
    tf: "15m",
    created_at: "2026-05-11T00:00:00.000Z",
    features_json: {
      setup_type: "CONTINUATION",
      trigger_type: "CONTINUATION",
      entry_grade: "CORE",
      source_band: "CORE",
      market_state: "BULL",
      htf_bias: "BULL",
      risk_mode: "PASS",
      opportunity_score: 0.82,
      confidence: 0.81,
      setup_quality_score: 0.92,
      structure_alignment: 0.97,
      htf_alignment_score: 0.96,
      market_quality_score: 0.85,
      spread_bps: 1.2,
      funding_rate: -0.0001,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
      rr: 1.6,
      signal_price: 100,
      stop_price: 95,
      target_price: 108,
    },
  });
  assert.strictEqual(signal.setup_type, "MOMENTUM_CONTINUATION");
  assert.strictEqual(signal.structural_regime, "TREND");
  const verdict = evaluateV3SignalPolicy(signal);
  // 2026-05-16 phase 1B: this cohort is demoted to SHADOW (n=8 R, exp
  // -0.044R). The raw signal still matches the profile (so it shows up
  // in audit) but the paper-policy returns ok:false with a SHADOW
  // reason and the apply_mode propagates through signalPolicy so
  // downstream can distinguish "shadowed cohort" from other blocks.
  assert.strictEqual(verdict.ok, false);
  assert.strictEqual(verdict.reason, "V3_PAPER_COHORT_SHADOWED");
  assert.strictEqual(verdict.apply_mode, "SHADOW");
  assert.strictEqual(verdict.profile_id, "LONG_MC_TREND_BUILDABLE_CORE");
  assert.strictEqual(verdict.cohort_key, "LONG | MOMENTUM_CONTINUATION | TREND | BUILDABLE_EDGE | CORE");
})();

(() => {
  const signal = normalizeSignalForV3({
    signal_id: "sig-short-trend-core",
    event: "SHORT",
    side: "SELL",
    exchange: "BINANCEFUT",
    features_json: {
      setup_type: "CONTINUATION",
      entry_grade: "CORE",
      source_band: "CORE",
      market_state: "BEAR",
      htf_bias: "BEAR",
      trigger_type: "CONTINUATION",
      risk_mode: "PASS",
      opportunity_score: 0.78,
      confidence: 0.77,
      setup_quality_score: 0.74,
      structure_alignment: 0.82,
      htf_alignment_score: 0.82,
      market_quality_score: 0.73,
      spread_bps: 1.5,
      funding_rate: -0.0002,
      btc_1h_trend: "SHORT",
      mtf_1h_direction: "SHORT",
      rr: 1.5,
      signal_price: 10,
      stop_price: 10.8,
      target_price: 8.7,
    },
  });
  const verdict = evaluateV3SignalPolicy(signal);
  assert.strictEqual(signal.setup_type, "MOMENTUM_CONTINUATION");
  assert.strictEqual(signal.structural_regime, "TREND");
  assert.strictEqual(verdict.ok, true);
  assert.strictEqual(verdict.profile_id, "SHORT_MC_TREND_MARGINAL_CORE");
  assert.strictEqual(verdict.cohort_key, "SHORT | MOMENTUM_CONTINUATION | TREND | MARGINAL_EDGE | CORE");
})();

(() => {
  const signal = normalizeSignalForV3({
    signal_id: "sig-long-cont-early-blocked",
    event: "LONG",
    side: "BUY",
    exchange: "BINANCEFUT",
    features_json: {
      setup_type: "CONTINUATION",
      trigger_type: "CONTINUATION",
      entry_grade: "EARLY",
      source_band: "EARLY",
      market_state: "BULL",
      htf_bias: "BULL",
      risk_mode: "PASS",
      opportunity_score: 0.76,
      confidence: 0.76,
      setup_quality_score: 0.72,
      structure_alignment: 0.72,
      htf_alignment_score: 0.72,
      market_quality_score: 0.72,
      spread_bps: 1.1,
      funding_rate: 0.00002,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
      rr: 1.5,
      signal_price: 100,
      stop_price: 98,
      target_price: 103.1,
    },
  });
  const verdict = evaluateV3SignalPolicy(signal);
  assert.strictEqual(signal.setup_type, "MOMENTUM_CONTINUATION");
  assert.strictEqual(verdict.ok, false);
  assert.strictEqual(verdict.reason, "V3_SIGNAL_NO_ACTIVE_PROFILE_MATCH");
})();

(() => {
  const signal = normalizeSignalForV3({
    signal_id: "sig-long-range-early",
    event: "LONG",
    side: "BUY",
    exchange: "BINANCEFUT",
    features_json: {
      setup_type: "BREAKOUT",
      trigger_type: "BREAKOUT",
      entry_grade: "EARLY",
      source_band: "EARLY",
      market_state: "RANGE",
      htf_bias: "BULL",
      risk_mode: "PASS",
      opportunity_score: 0.66,
      confidence: 0.66,
      setup_quality_score: 0.46,
      structure_alignment: 0.4,
      htf_alignment_score: 0.4,
      market_quality_score: 0.58,
      spread_bps: 1.3,
      funding_rate: 0.00005,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
      rr: 1.5,
      signal_price: 22,
      stop_price: 21,
      target_price: 23.6,
    },
  });
  const verdict = evaluateV3SignalPolicy(signal);
  assert.strictEqual(signal.setup_type, "BREAKOUT_RETEST");
  // 2026-05-16 phase 1B: this cohort is demoted to SHADOW (n=2 R noise
  // tier). Same shape as the LONG_MC_TREND_BUILDABLE_CORE shadow case
  // — signal matches the profile but is blocked at paper-policy.
  assert.strictEqual(verdict.ok, false);
  assert.strictEqual(verdict.reason, "V3_PAPER_COHORT_SHADOWED");
  assert.strictEqual(verdict.apply_mode, "SHADOW");
  assert.strictEqual(verdict.profile_id, "LONG_BR_RANGE_MARGINAL_EARLY");
  assert.strictEqual(verdict.cohort_key, "LONG | BREAKOUT_RETEST | RANGE | MARGINAL_EDGE | EARLY");
})();

(() => {
  const signal = normalizeSignalForV3({
    signal_id: "sig-reclaim-blocked",
    event: "LONG",
    side: "BUY",
    exchange: "BINANCEFUT",
    features_json: {
      setup_type: "RECLAIM",
      trigger_type: "LOSS",
      entry_grade: "CORE",
      source_band: "CORE",
      market_state: "BULL",
      htf_bias: "BULL",
      risk_mode: "PASS",
      opportunity_score: 0.9,
      confidence: 0.9,
      setup_quality_score: 0.9,
      structure_alignment: 0.9,
      htf_alignment_score: 0.9,
      market_quality_score: 0.9,
      spread_bps: 1.1,
      funding_rate: 0.0001,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
      rr: 1.5,
      signal_price: 100,
      stop_price: 95,
      target_price: 108,
    },
  });
  const verdict = evaluateV3SignalPolicy(signal);
  assert.strictEqual(signal.setup_type, "PULLBACK_RECLAIM");
  assert.strictEqual(verdict.ok, false);
  assert.strictEqual(verdict.reason, "V3_SIGNAL_PULLBACK_RECLAIM_DISABLED");
})();

(() => {
  const signal = normalizeSignalForV3({
    signal_id: "sig-no-profile",
    event: "LONG",
    side: "BUY",
    exchange: "BINANCEFUT",
    features_json: {
      setup_type: "BREAKOUT",
      trigger_type: "BREAKOUT",
      entry_grade: "CORE",
      source_band: "CORE",
      market_state: "TRANSITION",
      htf_bias: "BULL",
      risk_mode: "PASS",
      opportunity_score: 0.72,
      confidence: 0.72,
      setup_quality_score: 0.55,
      structure_alignment: 0.62,
      htf_alignment_score: 0.62,
      market_quality_score: 0.6,
      spread_bps: 1.4,
      funding_rate: 0.00008,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
      rr: 1.5,
      signal_price: 50,
      stop_price: 48,
      target_price: 53,
    },
  });
  const verdict = evaluateV3SignalPolicy(signal);
  assert.strictEqual(verdict.ok, false);
  assert.strictEqual(verdict.reason, "V3_SIGNAL_NO_ACTIVE_PROFILE_MATCH");
})();

(() => {
  const signal = normalizeSignalForV3({
    signal_id: "sig-missing-evidence",
    event: "LONG",
    side: "BUY",
    exchange: "BINANCEFUT",
    features_json: {
      setup_type: "BREAKOUT",
      trigger_type: "BREAKOUT",
      entry_grade: "CORE",
      source_band: "CORE",
      market_state: "BULL",
      htf_bias: "BULL",
      risk_mode: "PASS",
      opportunity_score: 0.72,
      confidence: 0.72,
      setup_quality_score: 0.7,
      structure_alignment: 0.73,
      htf_alignment_score: 0.73,
      market_quality_score: 0.7,
      rr: 1.5,
      signal_price: 50,
      stop_price: 48,
      target_price: 53,
    },
  });
  const verdict = evaluateV3SignalPolicy(signal);
  assert.strictEqual(verdict.ok, false);
  assert.strictEqual(verdict.reason, "V3_SIGNAL_SPREAD_BPS_REQUIRED");
})();

console.log("v3-signal-policy.test.js PASS");
