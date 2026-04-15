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
      avg_price: 100,
      position_side: "LONG",
      meta: {
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
  assert.equal(stage.tp1_qty_pct, 0.375);
  assert.equal(stage.canonical_exit_stage, null);
  assert.equal(stage.canonical_exit_stage_source, null);
})();

(() => {
  const stage = buildExitStageView({
    exchange: "BINANCEFUT",
    closePrice: 108,
    leverageFallback: 2,
    position: {
      state: "ACTIVE",
      size_pct: 0.15,
      avg_price: 100,
      position_side: "LONG",
      meta: {
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
})();

console.log("EXIT_STAGE_SUMMARY_TEST_OK");
