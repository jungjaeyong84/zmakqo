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
      avg_price: 100,
      position_side: "LONG",
      meta: {
        leverage: 2,
        ev_gate_atr_pct: 0.012,
        tp_p0_done: true,
        tp_p1_done: false,
        trail_active: false,
      },
    },
  });
  assert(stage, "stage should exist");
  assert.strictEqual(stage.label, "TP0 완료");
  assert.ok(Math.abs(stage.tp0_price - 100.48) < 1e-9);
})();

console.log("EXIT_STAGE_FAST_TP0_TEST_OK");
