"use strict";

const assert = require("assert");
const { __test } = require("../utils/evGateCompositePolicy");

(() => {
  const out = __test.buildEvGateCompositePolicy({
    provider: "binancefut",
    systemSettings: {
      ev_gate_enabled: true,
      ev_gate_early_enabled: true,
      ev_gate_core_enabled: true,
      ev_gate_tp1_prob_min: 0.55,
      ev_gate_tp1_prob_min_early: 0.6,
      ev_gate_tp1_prob_min_core: 0.57,
      ev_gate_tp1_prob_full: 0.6,
      ev_gate_tp1_prob_kill: 0.5,
      ev_gate_default_tp0_pct: 0.8,
      ev_gate_default_tp0_qty_ratio: 0.25,
      ev_gate_default_tp1_pct: 3.25,
      ev_gate_default_sl_pct: 1.65,
      ev_gate_qty_scale_mid: 0.7,
      ev_gate_qty_scale_low: 0.4,
      ev_gate_lookback_bars: 12,
      ev_gate_atr_bars: 8,
    },
  });

  assert.strictEqual(out.status, "EV_GATE_COMPOSITE_POLICY_READY");
  assert.strictEqual(out.provider, "BINANCEFUT");
  assert.strictEqual(out.policy_basis, "TP_COMPOSITE_EXIT_VALUE_V1");
  assert.strictEqual(out.canonical_policy_version, "EV_COMPOSITE_EXIT_VALUE_V1");
  assert.strictEqual(out.compatibility_policy_version, "TP1_WEIGHT_V1");
  assert.strictEqual(out.threshold_metric, "exit_value_lower_bound");
  assert.strictEqual(out.compatibility_drop_reason, "DROP_EV_GATE_TP1_PROB");
  assert.strictEqual(out.default_tp0_pct, 0.8);
  assert.strictEqual(out.default_tp0_qty_ratio, 0.25);
  assert.strictEqual(out.composite_lb_min_global, 0.55);
  assert.strictEqual(out.composite_lb_min_early, 0.6);
  assert.strictEqual(out.composite_lb_min_core, 0.57);
  assert.strictEqual(out.composite_lb_full, 0.6);
  assert.strictEqual(out.composite_lb_kill, 0.5);
  assert.strictEqual(out.tp1_prob_min_global, 0.55);
  assert.strictEqual(out.tp1_prob_min_early, 0.6);
  assert.strictEqual(out.tp1_prob_min_core, 0.57);
  assert.ok(Array.isArray(out.composite_components));
  assert.ok(out.composite_components.includes("tp0_hit_probability"));
  assert.ok(Array.isArray(out.legacy_threshold_setting_keys));
  assert.ok(out.legacy_threshold_setting_keys.includes("ev_gate_tp1_prob_min"));
  assert.ok(Array.isArray(out.interpretation_notes));
  assert.ok(out.interpretation_notes.some((row) => String(row).includes("exit_value_lower_bound")));

  console.log("EV_GATE_COMPOSITE_POLICY_TEST_OK");
})();
