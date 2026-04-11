const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

(() => {
  assert.strictEqual(typeof __test.resolveShortEntryGateConfig, "function", "resolveShortEntryGateConfig export missing");
  assert.strictEqual(typeof __test.evaluateShortEntryGate, "function", "evaluateShortEntryGate export missing");

  const cfg = __test.resolveShortEntryGateConfig({}, "BINANCEFUT");
  assert.strictEqual(cfg.transitionExceptionEnabled, true);
  assert.strictEqual(cfg.transitionExceptionCoreEnabled, true);
  assert.strictEqual(cfg.transitionExceptionPreRealEnabled, false);
  assert.strictEqual(cfg.transitionExceptionRealEnabled, false);

  const allowedCoreShort = __test.evaluateShortEntryGate({
    intent: "ENTRY",
    intentDir: "SHORT",
    eventUpper: "CORE_SHORT",
    cfg,
    features: {
      pro_regime_state: "transition",
      score: -43.3229785961,
      zz_post_prob_short: 0.7640035439,
      zz_wave_conf: 0.6252034081,
      confidence: 0.7,
      pro_conflict_short: false,
    },
  });
  assert.strictEqual(allowedCoreShort.ok, true);
  assert.strictEqual(allowedCoreShort.detail.gate_transition_exception, true);

  const allowedWeakPosteriorTransitionShort = __test.evaluateShortEntryGate({
    intent: "ENTRY",
    intentDir: "SHORT",
    eventUpper: "CORE_SHORT",
    cfg,
    features: {
      pro_regime_state: "transition",
      score: -43.3229785961,
      zz_post_prob_short: 0.70,
      zz_wave_conf: 0.6252034081,
      confidence: 0.7,
      pro_conflict_short: false,
    },
  });
  assert.strictEqual(allowedWeakPosteriorTransitionShort.ok, true);
  assert.strictEqual(allowedWeakPosteriorTransitionShort.detail.gate_transition_exception, true);

  const allowedCoreLong = __test.evaluateShortEntryGate({
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "CORE_LONG",
    cfg,
    features: {
      pro_regime_state: "transition",
      score: 43.3229785961,
      zz_post_prob_long: 0.7640035439,
      zz_wave_conf: 0.6252034081,
      confidence: 0.7,
      pro_conflict_long: false,
    },
  });
  assert.strictEqual(allowedCoreLong.ok, true);
  assert.strictEqual(allowedCoreLong.detail.gate_transition_exception, true);

  const bypassedRealLongByDefault = __test.evaluateShortEntryGate({
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "REAL_LONG",
    cfg,
    features: {
      pro_regime_state: "transition",
      score: 50,
      zz_post_prob_long: 0.9,
      zz_wave_conf: 0.8,
      confidence: 0.8,
      pro_conflict_long: false,
    },
  });
  assert.strictEqual(bypassedRealLongByDefault.ok, true);
  assert.strictEqual(bypassedRealLongByDefault.reason, undefined);

  const blockedRangeShort = __test.evaluateShortEntryGate({
    intent: "ENTRY",
    intentDir: "SHORT",
    eventUpper: "CORE_SHORT",
    cfg,
    features: {
      pro_regime_state: "range",
      score: -50,
      zz_post_prob_short: 0.9,
      zz_wave_conf: 0.8,
      confidence: 0.8,
      pro_conflict_short: false,
    },
  });
  assert.strictEqual(blockedRangeShort.ok, false);
  assert.strictEqual(blockedRangeShort.reason, "DROP_SHORT_GATE_REGIME");

  const allowedCoreShortDespiteLowPosterior = __test.evaluateShortEntryGate({
    intent: "ENTRY",
    intentDir: "SHORT",
    eventUpper: "CORE_SHORT",
    cfg,
    features: {
      pro_regime_state: "trend",
      score: -50,
      zz_post_prob_short: 0.40,
      zz_wave_conf: 0.8,
      confidence: 0.8,
      pro_conflict_short: false,
    },
  });
  assert.strictEqual(allowedCoreShortDespiteLowPosterior.ok, true);

  const allowedEarlyShortDespiteLowPosterior = __test.evaluateShortEntryGate({
    intent: "ENTRY",
    intentDir: "SHORT",
    eventUpper: "EARLY_SHORT",
    cfg,
    features: {
      pro_regime_state: "trend",
      score: -30,
      zz_post_prob_short: 0.40,
      zz_wave_conf: 0.8,
      confidence: 0.8,
      pro_conflict_short: false,
    },
  });
  assert.strictEqual(allowedEarlyShortDespiteLowPosterior.ok, true);

  console.log("SHORT_GATE_TRANSITION_EXCEPTION_TEST_OK");
})();
