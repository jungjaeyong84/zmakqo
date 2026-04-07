const assert = require("assert");
const { __test } = require("../storage/settings");

(() => {
  const normalized = __test.applyEvGateDefaultsForProvider({
    ev_gate_tp1_prob_min: 0.55,
    ev_gate_tp1_prob_min_early: 0.525,
    ev_gate_tp1_prob_min_core: 0.525,
    ev_gate_tp1_prob_min_pre_real: 0.525,
    ev_gate_tp1_prob_min_real: 0.525,
    ev_gate_tp1_prob_full: 0.6,
    ev_gate_tp1_prob_kill: 0.5,
  }, "BINANCEFUT");

  assert.strictEqual(normalized.ev_gate_tp1_prob_min, 0.525);
  assert.strictEqual(normalized.ev_gate_tp1_prob_min_early, 0.525);
  assert.strictEqual(normalized.ev_gate_tp1_prob_min_core, 0.525);
  assert.strictEqual(normalized.ev_gate_tp1_prob_min_pre_real, 0.525);
  assert.strictEqual(normalized.ev_gate_tp1_prob_min_real, 0.525);
  assert.strictEqual(normalized.ev_gate_tp1_prob_full, 0.6);
  assert.strictEqual(normalized.ev_gate_tp1_prob_kill, 0.5);
  assert.strictEqual(normalized.ev_gate_global_report_only_enabled, true);

  console.log("SETTINGS_EV_NORMALIZATION_TEST_OK");
})();
