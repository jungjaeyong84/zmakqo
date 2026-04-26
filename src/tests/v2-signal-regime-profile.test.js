"use strict";

const assert = require("assert");
const { buildSignalRegimeProfile } = require("../v2/signalRegimeProfile");

(function trendProfileClassifiesAlignedTradableSetup() {
  const profile = buildSignalRegimeProfile({
    signalSide: "LONG",
    featureValues: {
      market_regime: "trend",
      volatility_zscore: 0.25,
      liquidity_score: 0.91,
      volume_quote_24h: 18000000,
    },
    marketDataQuality: {
      ok: true,
      metrics: {
        spread_bps: 2,
        volume_quote_24h: 18000000,
      },
    },
    htfRegime: "LONG",
    htfAlignmentScore: 0.88,
    setupType: "PULLBACK_RECLAIM",
    marketQualityScore: 0.95,
    spreadBps: 2,
  });

  assert.strictEqual(profile.structural_regime, "TREND");
  assert.strictEqual(profile.volatility_regime, "NORMAL_VOL");
  assert.strictEqual(profile.liquidity_regime, "ADEQUATE");
  assert.strictEqual(profile.directional_bias, "ALIGNED");
  assert.strictEqual(profile.regime_cohort, "TREND__NORMAL_VOL__ADEQUATE");
  assert.ok(profile.regime_score > 0.8);
})();

(function thinRangeProfileClassifiesDefensiveContext() {
  const profile = buildSignalRegimeProfile({
    signalSide: "LONG",
    featureValues: {
      range_compression_score: 0.84,
      trend_strength_score: 0.31,
      volatility_zscore: 1.9,
      liquidity_score: 0.42,
      volume_quote_24h: 500000,
    },
    marketDataQuality: {
      ok: true,
      metrics: {
        spread_bps: 11,
        volume_quote_24h: 500000,
      },
    },
    htfRegime: "NEUTRAL",
    htfAlignmentScore: 0.41,
    setupType: "PULLBACK_RECLAIM",
    marketQualityScore: 0.45,
    spreadBps: 11,
  });

  assert.strictEqual(profile.structural_regime, "RANGE");
  assert.strictEqual(profile.volatility_regime, "HIGH_VOL");
  assert.strictEqual(profile.liquidity_regime, "THIN");
  assert.strictEqual(profile.action_bias, "DEFENSIVE_OR_NO_TRADE");
  assert.ok(profile.regime_score < 0.4);
})();

console.log("V2_SIGNAL_REGIME_PROFILE_TEST_OK");
