"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

function run() {
  assert.strictEqual(typeof __test.resolveAiBiasEntryGateConfig, "function");
  assert.strictEqual(typeof __test.evaluateAiBiasEntryGate, "function");

  const cfg = __test.resolveAiBiasEntryGateConfig({
    ai_bias_gate_enabled: true,
    ai_bias_gate_core_enabled: true,
    ai_bias_gate_pre_real_enabled: true,
    ai_bias_gate_real_enabled: true,
    ai_bias_gate_early_enabled: true,
    ai_bias_gate_neutral_policy: "allow",
    ai_bias_gate_score_threshold: 0.01,
    ai_bias_gate_conf_min: 0,
    ai_bias_gate_neutral_mult: 0.5,
    ai_bias_gate_opposite_mult: 0.35,
    ai_bias_gate_strong_opposite_score: 0.2,
    ai_bias_gate_strong_opposite_conf: 0.55,
  }, "BINANCEFUT");

  const aligned = __test.evaluateAiBiasEntryGate({
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "CORE_LONG",
    cfg,
    riskBudget: { sideAllocation: { biasDirection: "LONG", biasScore: 0.31, biasConfidence: 0.71 } },
  });
  assert.strictEqual(aligned.ok, true);
  assert.strictEqual(aligned.action, "ALLOW");
  assert.strictEqual(aligned.qtyScale, 1);

  const neutral = __test.evaluateAiBiasEntryGate({
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "CORE_LONG",
    cfg,
    riskBudget: { sideAllocation: { biasDirection: "NEUTRAL", biasScore: 0.0, biasConfidence: 0.3 } },
  });
  assert.strictEqual(neutral.ok, true);
  assert.strictEqual(neutral.action, "REDUCE");
  assert.strictEqual(neutral.qtyScale, 0.5);

  const weakOpposite = __test.evaluateAiBiasEntryGate({
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "CORE_LONG",
    cfg,
    riskBudget: { sideAllocation: { biasDirection: "SHORT", biasScore: -0.08, biasConfidence: 0.44 } },
  });
  assert.strictEqual(weakOpposite.ok, true);
  assert.strictEqual(weakOpposite.action, "REDUCE");
  assert.strictEqual(weakOpposite.qtyScale, 0.35);

  const strongOpposite = __test.evaluateAiBiasEntryGate({
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "CORE_LONG",
    cfg,
    riskBudget: { sideAllocation: { biasDirection: "SHORT", biasScore: -0.31, biasConfidence: 0.8 } },
  });
  assert.strictEqual(strongOpposite.ok, false);
  assert.strictEqual(strongOpposite.action, "DROP");
  assert.strictEqual(strongOpposite.reason, "DROP_AI_BIAS_OPPOSITE_SHORT");

  const marketPhysicsDrop = __test.evaluateAiBiasEntryGate({
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "CORE_LONG",
    cfg,
    features: {
      sp_entropy_score: 0.61,
      sp_coherence_score: 0.49,
      sp_transition_risk: 0.62,
      sp_field_alignment: 0.34,
      sp_domain_wall_density: 0.56,
      sp_susceptibility: 0.74,
      sp_free_energy: 0.78,
      sp_state: "CRITICAL",
    },
    riskBudget: { sideAllocation: { biasDirection: "LONG", biasScore: 0.31, biasConfidence: 0.71 } },
  });
  assert.strictEqual(marketPhysicsDrop.ok, false);
  assert.strictEqual(marketPhysicsDrop.action, "DROP");
  assert.strictEqual(marketPhysicsDrop.reason, "DROP_MARKET_PHYSICS_DISORDER");
  assert.strictEqual(marketPhysicsDrop.detail.market_state_summary_state, "CRITICAL");
  assert.strictEqual(marketPhysicsDrop.detail.market_state_summary_action, "DROP");
  assert.strictEqual(marketPhysicsDrop.detail.market_state_summary_qty_scale, 0);

  console.log("AI_BIAS_GATE_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("AI_BIAS_GATE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
