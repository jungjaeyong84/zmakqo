"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperUpbitRunner");

(async () => {
  assert.strictEqual(typeof __test.resolveWaitOneBarConfig, "function");
  assert.strictEqual(typeof __test.evaluateWaitOneBarTiming, "function");

  const cfg = __test.resolveWaitOneBarConfig({
    wait_one_bar_enabled: true,
    wait_one_bar_core_enabled: true,
    wait_one_bar_pre_real_enabled: true,
    wait_one_bar_real_enabled: true,
    wait_one_bar_early_enabled: true,
    wait_one_bar_same_dir_streak_min: 3,
    wait_one_bar_chase_ratio_min: 1.75,
    wait_one_bar_last_close_control_min: 0.80,
    wait_one_bar_last_dir_body_min: 0.45,
    wait_one_bar_last_opposite_wick_max: 0.18,
    wait_one_bar_recent_move1_pct_min: 0.45,
    wait_one_bar_counter_dir_bars_max: 0,
  }, "BINANCEFUT");

  const wait = __test.evaluateWaitOneBarTiming({
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "LONG",
    cfg,
    features: {
      ev_gate_same_dir_streak: 3,
      ev_gate_chase_ratio: 1.92,
      ev_gate_last_close_control: 0.88,
      ev_gate_last_dir_body: 0.56,
      ev_gate_last_opposite_wick: 0.09,
      ev_gate_recent_move_1_pct: 0.52,
      ev_gate_counter_dir_bars: 0,
    },
  });
  assert.strictEqual(wait.ok, false);
  assert.strictEqual(wait.action, "WAIT_ONE_BAR");
  assert.strictEqual(wait.reason, "DROP_WAIT_ONE_BAR_TIMING");

  const allow = __test.evaluateWaitOneBarTiming({
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "LONG",
    cfg,
    features: {
      ev_gate_same_dir_streak: 2,
      ev_gate_chase_ratio: 1.10,
      ev_gate_last_close_control: 0.62,
      ev_gate_last_dir_body: 0.31,
      ev_gate_last_opposite_wick: 0.24,
      ev_gate_recent_move_1_pct: 0.21,
      ev_gate_counter_dir_bars: 1,
    },
  });
  assert.strictEqual(allow.ok, true);
  assert.strictEqual(allow.action, "ALLOW");

  const physicsAssist = __test.evaluateWaitOneBarTiming({
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "LONG",
    cfg,
    features: {
      ev_gate_same_dir_streak: 2,
      ev_gate_chase_ratio: 1.55,
      ev_gate_last_close_control: 0.76,
      ev_gate_last_dir_body: 0.43,
      ev_gate_last_opposite_wick: 0.19,
      ev_gate_recent_move_1_pct: 0.40,
      ev_gate_counter_dir_bars: 1,
      sp_entropy_score: 0.79,
      sp_coherence_score: 0.34,
      sp_transition_risk: 0.76,
      sp_state: "DISORDERED",
    },
  });
  assert.strictEqual(physicsAssist.ok, false);
  assert.strictEqual(physicsAssist.action, "WAIT_ONE_BAR");
  assert.strictEqual(physicsAssist.detail.wait_one_bar_trigger_path, "PHYSICS_ASSIST");
  assert.strictEqual(physicsAssist.detail.wait_one_bar_market_state_action, "REDUCE");
  assert.strictEqual(physicsAssist.detail.wait_one_bar_market_state_wait_assist, true);

  const physicsHard = __test.evaluateWaitOneBarTiming({
    intent: "ENTRY",
    intentDir: "LONG",
    eventUpper: "LONG",
    cfg,
    features: {
      ev_gate_same_dir_streak: 2,
      ev_gate_chase_ratio: 1.40,
      ev_gate_last_close_control: 0.74,
      ev_gate_last_dir_body: 0.41,
      ev_gate_last_opposite_wick: 0.16,
      ev_gate_recent_move_1_pct: 0.37,
      ev_gate_counter_dir_bars: 1,
      sp_entropy_score: 0.58,
      sp_coherence_score: 0.47,
      sp_transition_risk: 0.66,
      sp_field_alignment: 0.38,
      sp_domain_wall_density: 0.59,
      sp_susceptibility: 0.71,
      sp_free_energy: 0.75,
      sp_state: "CRITICAL",
    },
  });
  assert.strictEqual(physicsHard.ok, false);
  assert.strictEqual(physicsHard.action, "WAIT_ONE_BAR");
  assert.strictEqual(physicsHard.detail.wait_one_bar_trigger_path, "PHYSICS_HARD");
  assert.strictEqual(physicsHard.detail.wait_one_bar_market_state_action, "DROP");
  assert.strictEqual(physicsHard.detail.wait_one_bar_market_state_wait_hard, true);

  const skip = __test.evaluateWaitOneBarTiming({
    intent: "ENTRY",
    intentDir: "SHORT",
    eventUpper: "SHORT",
    cfg,
    features: {},
  });
  assert.strictEqual(skip.ok, true);
  assert.strictEqual(skip.action, "SKIP");
  assert.strictEqual(skip.detail.wait_one_bar_skip_reason, "FEATURES_MISSING");

  console.log("WAIT_ONE_BAR_POLICY_TEST_OK");
})().catch((err) => {
  console.error("WAIT_ONE_BAR_POLICY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
