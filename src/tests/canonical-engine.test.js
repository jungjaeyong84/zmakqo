"use strict";

const assert = require("assert");
const {
  resolveCanonicalFeatureSnapshot,
  resolveCanonicalEngineConfig,
  evaluateCanonicalDecision,
} = require("../services/canonicalEngine");

(() => {
  const snapshot = resolveCanonicalFeatureSnapshot({
    event: "LONG",
    side: "BUY",
    market: "BTCUSDT",
    tf: "15m",
    features: {
      entry_grade: "CORE",
      score: 34,
      confidence: 0.62,
      zz_wave_conf: 0.71,
      posterior_long: 0.68,
      regime: "transition",
      sp_transition_risk: 0.41,
      sp_field_alignment: 0.7,
      sp_coherence_score: 0.66,
      strategy_id: "donbeolja_v6.0.3.3",
    },
  });
  assert.strictEqual(snapshot.market, "BTCUSDT");
  assert.strictEqual(snapshot.tier, "CORE");
  assert.strictEqual(snapshot.regime, "transition");
  assert.strictEqual(snapshot.score_abs, 34);
  assert.strictEqual(snapshot.coherence, 0.66);
  assert.strictEqual(snapshot.posterior, 0.68);

  const cfg = resolveCanonicalEngineConfig({
    canonical_engine_enabled: true,
    canonical_engine_shadow_enabled: true,
    canonical_engine_source_mode: "PINE_PRIMARY",
    canonical_engine_core_score_abs: 33,
    canonical_engine_transition_core_score_abs: 29,
    canonical_engine_market_overrides: {
      BTCUSDT: {
        source_mode: "SERVER_PRIMARY",
        transition_core_score_abs: 31,
      },
    },
  }, { market: "BTCUSDT" });
  assert.strictEqual(cfg.marketOverrideActive, true);
  assert.strictEqual(cfg.sourceMode, "SERVER_PRIMARY");
  assert.strictEqual(cfg.transitionCoreScoreAbs, 31);
  assert.strictEqual(typeof cfg.bundleVersion, "string");
  assert.strictEqual(typeof cfg.thresholdBundleVersion, "string");
  assert.strictEqual(typeof cfg.thresholdBundleSignature, "string");

  const shadowCfg = {
    ...cfg,
    sourceMode: "PINE_PRIMARY",
    enforce: false,
  };
  const shadow = evaluateCanonicalDecision({
    features: {
      entry_grade: "CORE",
      score: 30,
      regime: "transition",
      confidence: 0.58,
      posterior_long: 0.64,
      zz_wave_conf: 0.61,
      sp_transition_risk: 0.42,
      sp_field_alignment: 0.68,
      sp_coherence_score: 0.60,
    },
    event: "LONG",
    side: "BUY",
    market: "BTCUSDT",
    tf: "15m",
    config: shadowCfg,
  });
  assert.strictEqual(shadow.ok, true);
  assert.strictEqual(shadow.detail.canonical_engine_shadow_pass, false);
  assert.strictEqual(shadow.detail.canonical_engine_shadow_reason, "TRANSITION_CORE_SCORE_FAIL");
  assert.strictEqual(shadow.detail.canonical_engine_bundle_version, shadowCfg.bundleVersion);
  assert.strictEqual(shadow.detail.canonical_engine_threshold_bundle_version, shadowCfg.thresholdBundleVersion);
  assert.strictEqual(shadow.detail.canonical_engine_source_mode_effective, "PINE_PRIMARY");
  assert.strictEqual(shadow.detail.canonical_engine_execution_source_effective, "PINE_ALERT");
  assert.strictEqual(typeof shadow.detail.canonical_engine_decision_id, "string");
  assert.strictEqual(shadow.detail.canonical_engine_policy_origin, "MARKET_OVERRIDE");
  assert.strictEqual(shadow.detail.pine_overlay_runtime_role, "PRIMARY_ALERT");
  assert.strictEqual(shadow.detail.pine_overlay_audit_only, false);
  assert.strictEqual(shadow.detail.pine_shadow_decision, "PASS");
  assert.strictEqual(shadow.detail.pine_shadow_parity_match, true);

  const primary = evaluateCanonicalDecision({
    features: {
      entry_grade: "CORE",
      score: 34,
      regime: "transition",
      confidence: 0.39,
      posterior_long: 0.47,
      zz_wave_conf: 0.49,
      sp_transition_risk: 0.57,
      sp_field_alignment: 0.42,
      sp_coherence_score: 0.44,
    },
    event: "LONG",
    side: "BUY",
    market: "BTCUSDT",
    tf: "15m",
    config: {
      ...cfg,
      sourceMode: "SERVER_PRIMARY",
      enforce: true,
    },
  });
  assert.strictEqual(primary.ok, false);
  assert.strictEqual(primary.reason, "DROP_CANONICAL_ENGINE_TRANSITION_CORE_QUALITY");
  assert.strictEqual(primary.detail.canonical_engine_shadow_reason, "TRANSITION_CORE_QUALITY_FAIL");
  assert.strictEqual(primary.detail.canonical_engine_transition_core_quality_observed, true);
  assert.strictEqual(primary.detail.canonical_engine_transition_core_quality_pass, false);
  assert.strictEqual(primary.detail.canonical_engine_execution_source_effective, "SERVER_CANONICAL");
  assert.strictEqual(primary.detail.pine_overlay_runtime_role, "SHADOW_AUDIT");
  assert.strictEqual(primary.detail.pine_overlay_audit_only, true);
  console.log("CANONICAL_ENGINE_TEST_OK");
})();
