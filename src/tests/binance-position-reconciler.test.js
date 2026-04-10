const assert = require("assert");
const { reconcileBinancePositionMetaWithExchange, __test } = require("../services/binancePositionReconciler");

async function run() {
  assert.strictEqual(typeof reconcileBinancePositionMetaWithExchange, "function", "reconcileBinancePositionMetaWithExchange export missing");

  const classifiedLong = __test.classifyTakeProfitOrders({
    orders: [
      { orderId: "tp1", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "105", origQty: "5" },
      { orderId: "tp0", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "102", origQty: "2.5" },
    ],
    positionSide: "LONG",
    qtyBase: 10,
    meta: {},
  });
  assert.strictEqual(classifiedLong.tp0.orderId, "tp0");
  assert.strictEqual(classifiedLong.tp1.orderId, "tp1");
  assert.strictEqual(__test.inferTakeProfitKindFromQtyRatio(0.25), "TP0");
  assert.strictEqual(__test.inferTakeProfitKindFromQtyRatio(0.5), "TP1");
  assert.strictEqual(__test.inferTakeProfitKindFromQtyRatio(0.3), "TP0");
  assert.strictEqual(__test.inferTakeProfitKindFromQtyRatio(0.375), null);

  const classifiedShort = __test.classifyTakeProfitOrders({
    orders: [
      { orderId: "tp1", type: "TAKE_PROFIT_MARKET", side: "BUY", reduceOnly: true, stopPrice: "95", origQty: "5" },
      { orderId: "tp0", type: "TAKE_PROFIT_MARKET", side: "BUY", reduceOnly: true, stopPrice: "98", origQty: "2.5" },
    ],
    positionSide: "SHORT",
    qtyBase: 10,
    meta: {},
  });
  assert.strictEqual(classifiedShort.tp0.orderId, "tp0");
  assert.strictEqual(classifiedShort.tp1.orderId, "tp1");

  const trailPatch = reconcileBinancePositionMetaWithExchange({
    active: true,
    meta: {
      tp_p1_done: true,
      trail_active: true,
      native_protection_tp0_order_id: "old-tp0",
      native_protection_tp_order_id: "old-tp1",
    },
    positionSide: "LONG",
    qtyBase: 12,
    entryPrice: 100,
    leverage: 2,
    openOrders: [],
    algoOrders: [
      { orderId: "stop-1", type: "STOP_MARKET", side: "SELL", closePosition: true, stopPrice: "109" },
      { orderId: "tp0-1", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "102", origQty: "3" },
      { orderId: "tp1-1", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "105", origQty: "6" },
    ],
  });
  assert.strictEqual(trailPatch.meta.native_protection_stop_order_id, "stop-1");
  assert.strictEqual(trailPatch.meta.native_protection_tp0_order_id, null);
  assert.strictEqual(trailPatch.meta.native_protection_tp_order_id, null);

  const invalidTrail = reconcileBinancePositionMetaWithExchange({
    active: true,
    meta: {
      tp_p1_done: false,
      trail_active: true,
    },
    positionSide: "LONG",
    qtyBase: 10,
    entryPrice: 100,
    leverage: 2,
    openOrders: [],
    algoOrders: [],
  });
  assert.strictEqual(invalidTrail.meta.trail_active, false);
  assert.ok(invalidTrail.invariants.includes("TRAIL_WITHOUT_TP1"));

  const flatProjection = reconcileBinancePositionMetaWithExchange({
    active: false,
    meta: {
      tp_p0_done: true,
      tp_p1_done: true,
      trail_active: true,
      native_protection_stop_order_id: "stop-old",
    },
  });
  assert.strictEqual(flatProjection.meta.tp_p0_done, false);
  assert.strictEqual(flatProjection.meta.tp_p1_done, false);
  assert.strictEqual(flatProjection.meta.trail_active, false);
  assert.strictEqual(flatProjection.meta.native_protection_stop_order_id, null);

  console.log("BINANCE_POSITION_RECONCILER_TEST_OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
