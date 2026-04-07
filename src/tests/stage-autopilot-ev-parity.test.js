const assert = require("assert");
const { __test } = require("../../scripts/automation-stage-autopilot");

(() => {
  const evParityCandidate = __test.buildEvParityCandidate(
    {
      data: {
        summary: {
          shadow_observed_n: 7,
          source_parity_mismatch_n: 0,
          parity_mismatch_rate: 0.57,
          by_actual_drop_reason_family: [
            { key: "EV_POLICY", count: 2 },
            { key: "COOLDOWN_POLICY", count: 1 },
          ],
        },
      },
    },
    null,
    null,
    {
      ev_gate_tp1_prob_min: 0.55,
      ev_gate_tp1_prob_min_early: 0.525,
      ev_gate_tp1_prob_min_core: 0.525,
      ev_gate_tp1_prob_min_pre_real: 0.525,
      ev_gate_tp1_prob_min_real: 0.525,
      ev_gate_tp1_prob_full: 0.60,
      ev_gate_tp1_prob_kill: 0.50,
    },
    {
      objective: { enough_sample: false },
    }
  );

  assert.strictEqual(evParityCandidate.actionable, true);
  assert.strictEqual(evParityCandidate.nextSettings.ev_gate_tp1_prob_min, 0.515);
  assert.strictEqual(evParityCandidate.nextSettings.ev_gate_tp1_prob_min_early, 0.515);
  assert.strictEqual(evParityCandidate.nextSettings.ev_gate_tp1_prob_min_core, 0.515);
  assert.strictEqual(evParityCandidate.nextSettings.ev_gate_tp1_prob_min_pre_real, 0.515);
  assert.strictEqual(evParityCandidate.nextSettings.ev_gate_tp1_prob_min_real, 0.515);
  assert.strictEqual(evParityCandidate.nextSettings.ev_gate_tp1_prob_full, 0.59);
  assert.strictEqual(evParityCandidate.nextSettings.ev_gate_tp1_prob_kill, 0.5);
  assert.strictEqual(evParityCandidate.canonical_policy_basis, "TP_COMPOSITE_EXIT_VALUE_V1");
  assert.strictEqual(evParityCandidate.threshold_metric, "exit_value_lower_bound");
  assert.ok(Array.isArray(evParityCandidate.legacy_threshold_setting_keys));
  assert.ok(evParityCandidate.legacy_threshold_setting_keys.includes("ev_gate_tp1_prob_min"));

  console.log("STAGE_AUTOPILOT_EV_PARITY_TEST_OK");
})();
