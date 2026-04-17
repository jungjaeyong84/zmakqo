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
      size_pct: 0.5,
      qty_base: 0.75,
      avg_price: 100,
      position_side: "LONG",
      meta: {
        simplified_exit_v2_enabled: true,
        entry_qty_base: 1,
        leverage: 2,
        ev_gate_atr_pct: 0.012,
        tp_p0_done: true,
        tp_p1_done: false,
        trail_active: false,
      },
    },
  });
  assert(stage, "stage should exist");
  assert.strictEqual(stage.label, "TP1 대기");
  assert.strictEqual(stage.tp0_price, null);
  assert.ok(Math.abs(stage.legacy_tp0_price - 100.48) < 1e-9);
  assert.strictEqual(stage.tp0_done, false);
  assert.strictEqual(stage.legacy_tp0_done, true);
  assert.strictEqual(stage.canonical_exit_stage, null);
  assert.strictEqual(stage.canonical_exit_stage_source, "POSITION_STATE_MACHINE_V2_PRE_TP1");
  assert.equal(stage.simplified_exit_v2_available, true);
  assert.equal(stage.simplified_exit_v2_state, "FULL");
  assert.ok(stage.simplified_exit_v2_divergence_codes.includes("LEGACY_TP0_PRESENT"));
  assert.ok(stage.simplified_exit_v2_divergence_codes.includes("PRE_TP1_QTY_REDUCED"));
})();

console.log("EXIT_STAGE_FAST_TP0_TEST_OK");
