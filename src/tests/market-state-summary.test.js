"use strict";

const assert = require("assert");
const { resolveMarketStateSummary } = require("../utils/marketStateSummary");

function run() {
  const critical = resolveMarketStateSummary({
    pro_regime_state: "transition",
    sp_entropy_score: 0.63,
    sp_coherence_score: 0.48,
    sp_transition_risk: 0.66,
    sp_field_alignment: 0.36,
    sp_domain_wall_density: 0.57,
    sp_susceptibility: 0.72,
    sp_free_energy: 0.78,
    sp_state: "CRITICAL",
  });
  assert.strictEqual(critical.regime, "transition");
  assert.strictEqual(critical.state, "CRITICAL");
  assert.strictEqual(critical.physicsAction, "DROP");
  assert.strictEqual(critical.physicsQtyScale, 0);
  assert.strictEqual(critical.waitHard, true);
  assert.strictEqual(critical.waitAssist, true);

  const disordered = resolveMarketStateSummary({
    pro_regime_state: "trend",
    sp_entropy_score: 0.79,
    sp_coherence_score: 0.34,
    sp_transition_risk: 0.76,
    sp_field_alignment: 0.44,
    sp_domain_wall_density: 0.48,
    sp_susceptibility: 0.60,
    sp_free_energy: 0.58,
    sp_state: "DISORDERED",
  });
  assert.strictEqual(disordered.state, "DISORDERED");
  assert.strictEqual(disordered.physicsAction, "REDUCE");
  assert.strictEqual(disordered.physicsQtyScale, 0.5);
  assert.strictEqual(disordered.waitAssist, true);
  assert.strictEqual(disordered.waitHard, false);

  const ordered = resolveMarketStateSummary({
    pro_regime_state: "trend",
    sp_entropy_score: 0.28,
    sp_coherence_score: 0.74,
    sp_transition_risk: 0.22,
    sp_field_alignment: 0.77,
    sp_domain_wall_density: 0.18,
    sp_susceptibility: 0.24,
    sp_free_energy: 0.26,
    sp_state: "ORDERED",
  });
  assert.strictEqual(ordered.state, "ORDERED");
  assert.strictEqual(ordered.physicsAction, "ALLOW");
  assert.strictEqual(ordered.physicsQtyScale, 1);
  assert.strictEqual(ordered.waitAssist, false);
  assert.strictEqual(ordered.waitHard, false);

  console.log("MARKET_STATE_SUMMARY_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("MARKET_STATE_SUMMARY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
