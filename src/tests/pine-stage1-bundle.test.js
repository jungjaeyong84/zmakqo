const assert = require("assert");
const { __test } = require("../engine/paperUpbitRunner");

(() => {
  assert.strictEqual(typeof __test.resolvePineStage1BundleMeta, "function", "resolvePineStage1BundleMeta export missing");
  assert.strictEqual(typeof __test.resolveShortEntryGateConfig, "function", "resolveShortEntryGateConfig export missing");
  assert.strictEqual(typeof __test.evaluateShortEntryGate, "function", "evaluateShortEntryGate export missing");
  assert.strictEqual(typeof __test.resolveEntryQualityGateConfig, "function", "resolveEntryQualityGateConfig export missing");
  assert.strictEqual(typeof __test.evaluateEntryQualityGate, "function", "evaluateEntryQualityGate export missing");
  assert.strictEqual(typeof __test.resolveSignalTier, "function", "resolveSignalTier export missing");
  assert.strictEqual(typeof __test.resolveEntryQualityTier, "function", "resolveEntryQualityTier export missing");
  assert.strictEqual(typeof __test.resolveEntryTierBudgetMax, "function", "resolveEntryTierBudgetMax export missing");

  const trustedBundleFeatures = {
    pine_stage1_bundle_owner: "PINE",
    pine_stage1_bundle_version: "REGIME_SCORE_CONF_POSTERIOR_WAVE_EV_V2",
    pine_stage1_bundle_enabled: true,
    pine_stage1_bundle_owned: true,
    pine_stage1_bundle_stage_pass: true,
    pine_stage1_bundle_quality_filter_runtime: true,
  };

  const bundle = __test.resolvePineStage1BundleMeta(trustedBundleFeatures);
  assert.strictEqual(bundle.trusted, true);

  const shortCfg = __test.resolveShortEntryGateConfig({}, "BINANCEFUT");
  const shortBypassed = __test.evaluateShortEntryGate({
    intent: "ENTRY",
    intentDir: "SHORT",
    eventUpper: "CORE_SHORT",
    cfg: shortCfg,
    features: {
      ...trustedBundleFeatures,
      pro_regime_state: "range",
      score: -5,
      confidence: 0.2,
      zz_wave_conf: 0.2,
      pro_conflict_short: true,
    },
  });
  assert.strictEqual(shortBypassed.ok, true);
  assert.strictEqual(shortBypassed.detail.pine_stage1_bundle_trusted, true);

  const untrustedBundleShort = __test.evaluateShortEntryGate({
    intent: "ENTRY",
    intentDir: "SHORT",
    eventUpper: "CORE_SHORT",
    cfg: shortCfg,
    features: {
      ...trustedBundleFeatures,
      pine_stage1_bundle_quality_filter_runtime: false,
      pro_regime_state: "range",
      score: -5,
      confidence: 0.2,
      zz_wave_conf: 0.2,
      pro_conflict_short: false,
    },
  });
  assert.strictEqual(untrustedBundleShort.ok, false);
  assert.strictEqual(untrustedBundleShort.reason, "DROP_SHORT_GATE_REGIME");

  const qualityCfg = __test.resolveEntryQualityGateConfig({
    entry_quality_gate_enabled: true,
    entry_quality_gate_require_confidence: true,
    entry_quality_gate_require_posterior: true,
    entry_quality_gate_require_wave_conf: true,
    entry_quality_gate_disallow_range: true,
  }, "BINANCEFUT");
  const qualityBypassed = __test.evaluateEntryQualityGate({
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "PRE_REAL_LONG",
    cfg: qualityCfg,
    features: {
      ...trustedBundleFeatures,
      pro_regime_state: "range",
      score: 1,
      confidence: 0.1,
      zz_wave_conf: 0.1,
      zz_post_prob_long: 0.2,
      pro_conflict_long: true,
      pro_conflict: true,
    },
  });
  assert.strictEqual(qualityBypassed.ok, true);
  assert.strictEqual(qualityBypassed.detail.pine_stage1_bundle_trusted, true);

  const qualityNotBypassed = __test.evaluateEntryQualityGate({
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "PRE_REAL_LONG",
    cfg: qualityCfg,
    features: {
      ...trustedBundleFeatures,
      pine_stage1_bundle_version: "REGIME_CONF_SCORE_V1",
      pro_regime_state: "range",
      score: 1,
      confidence: 0.1,
      zz_wave_conf: 0.1,
      zz_post_prob_long: 0.2,
      pro_conflict_long: false,
      pro_conflict: false,
    },
  });
  assert.strictEqual(qualityNotBypassed.ok, false);
  assert.strictEqual(qualityNotBypassed.reason, "DROP_ENTRY_QUALITY_RANGE");

  assert.strictEqual(__test.resolveSignalTier("LONG"), "EARLY");
  assert.strictEqual(__test.resolveSignalTier("LONG", { entry_grade: "CORE" }), "CORE");
  assert.strictEqual(__test.resolveEntryQualityTier("LONG"), "EARLY");
  assert.strictEqual(__test.resolveEntryQualityTier("LONG", { entry_grade: "CORE" }), "CORE");

  const tierBudget = __test.resolveEntryTierBudgetMax({
    intent: "ENTRY",
    event: "LONG",
    features: { entry_qty_profile: "FIXED", entry_grade: "CORE" },
    side: "BUY",
    qtyFraction: 0.22,
    budgetMax: 100,
  });
  assert.strictEqual(tierBudget.tier, "CORE");
  assert.strictEqual(tierBudget.fixedQty, true);
  assert.strictEqual(tierBudget.applied, true);
  assert.strictEqual(tierBudget.reason, "FIXED_MARGIN_TARGET_OVERRIDE");
  assert.strictEqual(tierBudget.targetMargin, 1000);
  assert.strictEqual(tierBudget.budgetMax, 1000);

  console.log("PINE_STAGE1_BUNDLE_TEST_OK");
})();
