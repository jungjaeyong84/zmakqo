"use strict";

const assert = require("assert");
const { __test } = require("../services/liveTrailingStageRepair");

function run() {
  assert.strictEqual(typeof __test.resolveRepairTargetStage, "function");
  assert.strictEqual(typeof __test.buildRepairedMeta, "function");
  assert.strictEqual(typeof __test.shouldEnforceSingleStopWriter, "function");
  assert.strictEqual(__test.shouldEnforceSingleStopWriter(), true);

  const stage = __test.resolveRepairTargetStage({
    positionSnapshot: {
      qty_base: 0.167,
      meta: {
        tp_p0_done: true,
        tp_p1_done: true,
        trail_active: false,
      },
    },
    externalQty: 0.167,
  });
  assert.strictEqual(stage.stage, "TRAIL");
  assert.strictEqual(stage.reason, "TP1_DONE_WITH_OPEN_RUNNER");

  const nextMeta = __test.buildRepairedMeta({
    tp_p0_done: false,
    tp_p1_done: false,
    trail_active: false,
  }, stage);
  assert.strictEqual(nextMeta.tp_p0_done, true);
  assert.strictEqual(nextMeta.tp_p1_done, true);
  assert.strictEqual(nextMeta.trail_active, true);

  console.log("LIVE_TRAILING_STAGE_REPAIR_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("LIVE_TRAILING_STAGE_REPAIR_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
