"use strict";

const assert = require("assert");
const { buildExitStageView } = require("../utils/exitStageView");

(() => {
  const stage = buildExitStageView({
    exchange: "BINANCEFUT",
    closePrice: 101,
    leverageFallback: 2,
    position: {
      state: "ACTIVE",
      size_pct: 0.15,
      qty_base: 0.15,
      avg_price: 100,
      position_side: "LONG",
      meta: {
        simplified_exit_v2_enabled: true,
        entry_qty_base: 0.15,
        leverage: 2,
        tp_p1_done: false,
        trail_active: false,
        native_protection_stop_price: 98.35,
        native_protection_tp_price: 103.25,
        native_protection_refresh_status: "OK",
        native_protection_tp_status: "OK",
        exit_rules_override: {
          SL: 0.0165,
          TP_P1: 0.0325,
          TP_P1_QTY: 0.5,
          TRAIL_R_MULTIPLE: 0.9,
          TRAIL_PCT: 0.01,
          BE_PCT: 0.0025,
        },
      },
    },
  });
  assert(stage, "stage must exist for active position");
  assert.equal(stage.compact_headline.left_label, "SL");
  assert.equal(stage.compact_headline.right_label, "TP1");
  assert.equal(stage.compact_headline.left_price, 98.35);
  assert.equal(stage.compact_headline.right_price, 103.25);
  assert.equal(stage.native_protection_active, true);
  assert.equal(stage.tp1_qty_pct, 0.5);
  assert.equal(stage.canonical_exit_stage, null);
  assert.equal(stage.canonical_exit_stage_source, null);
  assert.equal(stage.simplified_exit_v2_available, true);
  assert.equal(stage.simplified_exit_v2_state, "FULL");
  assert.deepStrictEqual(stage.simplified_exit_v2_divergence_codes, []);
  assert(stage.simplified_exit_v2_shadow, "shadow view must exist");
  assert.equal(stage.simplified_exit_v2_shadow.tp1_target_qty_abs, 0.075);
  assert.equal(stage.simplified_exit_v2_shadow.runner_qty_abs, 0.075);
  assert.ok(Math.abs(stage.simplified_exit_v2_shadow.tp1_target_price - 102.5) < 1e-9);
})();

(() => {
  const stage = buildExitStageView({
    exchange: "BINANCEFUT",
    closePrice: 102,
    position: {
      state: "ACTIVE",
      position_state: "ACTIVE",
      size_pct: 1,
      qty_base: 1,
      avg_price: 100,
      position_side: "LONG",
      meta: {
        simplified_exit_v2_enabled: true,
        entry_qty_base: 1,
        tp_p0_done: true,
        tp_p1_done: false,
        trail_active: false,
        exit_rules_override: {
          SL: 0.0165,
          TP_P0: 0.008,
          TP_P1: 0.025,
          TP_P1_QTY: 0.5,
          TRAIL_R_MULTIPLE: 0.6,
          TRAIL_PCT: 0.01,
          BE_PCT: 0.0015,
        },
      },
    },
  });
  assert(stage, "stage must exist for simplified v2 legacy tp0 leak view");
  assert.equal(stage.label, "TP1 대기");
  assert.equal(stage.tp0_done, false);
  assert.equal(stage.legacy_tp0_done, false);
  assert.equal(stage.tp0_price, null);
  assert.equal(stage.legacy_tp0_price, null);
  assert.deepStrictEqual(stage.simplified_exit_v2_divergence_codes, []);
})();

(() => {
  const stage = buildExitStageView({
    exchange: "BINANCEFUT",
    closePrice: 108,
    leverageFallback: 2,
    position: {
      state: "ACTIVE",
      size_pct: 0.15,
      qty_base: 0.125,
      avg_price: 100,
      position_side: "LONG",
      meta: {
        simplified_exit_v2_enabled: true,
        entry_qty_base: 0.25,
        leverage: 2,
        tp_p1_done: true,
        trail_active: true,
        trail_high: 110,
        canonical_exit_stage: "TRAIL",
        canonical_runner_remaining_abs: 0.125,
        native_protection_stop_price: 98.35,
        exit_rules_override: {
          SL: 0.0165,
          TP_P1: 0.0325,
          TP_P1_QTY: 0.5,
          TRAIL_R_MULTIPLE: 0.9,
          TRAIL_PCT: 0.01,
          BE_PCT: 0.0025,
        },
      },
    },
  });
  assert(stage, "stage must exist for trailing position");
  assert.equal(stage.trail_r_multiple, 0.6);
  assert.equal(stage.compact_headline.left_label, "Trail");
  assert.equal(stage.compact_headline.left_price, 109.505);
  assert.equal(stage.compact_headline.right_label, "SL");
  assert.equal(stage.compact_headline.right_price, 98.35);
  assert.equal(stage.canonical_exit_stage, "TRAIL");
  assert.equal(stage.canonical_exit_stage_source, "POSITION_STATE_MACHINE_TRAIL_ACTIVE");
  assert.equal(stage.canonical_runner_remaining_abs, 0.125);
  assert.equal(stage.canonical_runner_remaining_source, "META");
  assert.equal(stage.trail_stop_by_r, 109.505);
  assert.equal(stage.r_based_trail_stop, 109.505);
  assert.equal(stage.chosen_stop_source, "TRAIL");
  assert.equal(stage.chosen_stop_price, 109.505);
  assert.equal(stage.final_effective_stop, 109.505);
  assert.deepStrictEqual(stage.stop_divergence_codes, ["NATIVE_STOP_MISMATCH"]);
  assert.equal(stage.simplified_exit_v2_available, true);
  assert.equal(stage.simplified_exit_v2_state, "RUNNER");
  assert.deepStrictEqual(stage.simplified_exit_v2_divergence_codes, []);
  assert.ok(Math.abs(stage.simplified_exit_v2_shadow.final_effective_stop - 108.9) < 1e-9);
  assert.equal(stage.simplified_exit_v2_shadow.chosen_stop_source, "TRAIL");
})();

(() => {
  const stage = buildExitStageView({
    exchange: "BINANCEFUT",
    closePrice: 75647.3,
    leverageFallback: 2,
    position: {
      state: "ACTIVE",
      position_state: "ACTIVE",
      size_pct: 0.5,
      qty_base: 0.013,
      entry_qty_base: 0.026,
      avg_price: 74987.2,
      position_side: "LONG",
      meta: {
        simplified_exit_v2_enabled: true,
        tp_p1_done: false,
        trail_active: false,
        exit_rules_override: {
          SL: -0.0165,
          TP_P1: 0.025,
          TP_P1_QTY: 0.5,
          TRAIL_PCT: 0.01,
          RUNNER_MIN_PROFIT_PCT: 0.0025,
          BE_PCT: 0.0015,
        },
      },
    },
  });
  assert(stage, "runner qty inferred stage must exist");
  assert.equal(stage.label, "트레일링");
  assert.equal(stage.canonical_exit_stage, "TRAIL");
  assert.equal(stage.canonical_exit_stage_source, "POSITION_STATE_MACHINE_V2_RUNNER_QTY");
  assert.equal(stage.simplified_exit_v2_state, "RUNNER");
  assert.equal(stage.compact_headline.left_label, "Trail");
  assert.ok(stage.compact_headline.left_price > 0);
})();

console.log("EXIT_STAGE_SUMMARY_TEST_OK");
