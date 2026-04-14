"use strict";

const assert = require("assert");
const { __test } = require("../services/liveTrailingStageRepair");

function run() {
  assert.strictEqual(typeof __test.groupTrades, "function");
  assert.strictEqual(typeof __test.extractActiveCycleTrades, "function");
  assert.strictEqual(typeof __test.inferStageFromCycle, "function");
  assert.strictEqual(typeof __test.buildRepairedMeta, "function");
  assert.strictEqual(typeof __test.shouldEnforceSingleStopWriter, "function");
  assert.strictEqual(__test.shouldEnforceSingleStopWriter(), true);

  const grouped = __test.groupTrades([
    { orderId: 1, time: 100, side: "BUY", qty: 0.887, quoteQty: 2002.91696, realizedPnl: 0, price: 2258.08 },
    { orderId: 2, time: 200, side: "SELL", qty: 0.221, quoteQty: 501.11971, realizedPnl: 2.08403, price: 2267.51 },
    { orderId: 3, time: 300, side: "SELL", qty: 0.332, quoteQty: 755.87884, realizedPnl: 6.19628, price: 2276.74 },
  ]);
  assert.strictEqual(grouped.length, 3);

  const cycle = __test.extractActiveCycleTrades(grouped, {
    positionQty: 0.334,
    positionSide: "LONG",
  });
  assert.strictEqual(cycle.length, 3);

  const stage = __test.inferStageFromCycle(cycle, {
    positionQty: 0.334,
    tp0QtyRatio: 0.25,
    tp1QtyRatio: 0.5,
  });
  assert.strictEqual(stage.stage, "TRAIL");

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
