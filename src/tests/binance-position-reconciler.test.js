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
  assert.strictEqual(__test.inferTakeProfitKindFromQtyRatio(0.375), "TP1");

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

  const classifiedWithStaleMeta = __test.classifyTakeProfitOrders({
    orders: [
      { orderId: "tp1", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "105", origQty: "5" },
      { orderId: "tp0", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "102", origQty: "2.5" },
    ],
    positionSide: "LONG",
    qtyBase: 10,
    meta: { tp_p1_done: true, trail_active: true },
  });
  assert.strictEqual(classifiedWithStaleMeta.tp0.orderId, "tp0");
  assert.strictEqual(classifiedWithStaleMeta.tp1.orderId, "tp1");

  const trailPatch = reconcileBinancePositionMetaWithExchange({
    active: true,
    meta: {
      tp_p1_done: true,
      trail_active: false,
      trail_high: 111,
      trail_high_at_ms: 200,
      tp_p1_bar_ms: 150,
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
  assert.strictEqual(trailPatch.meta.native_protection_tp0_order_id, "tp0-1");
  assert.strictEqual(trailPatch.meta.native_protection_tp_order_id, "tp1-1");
  assert.strictEqual(trailPatch.meta.native_protection_tp0_qty_ratio, 0.25);
  assert.strictEqual(trailPatch.meta.native_protection_tp_qty_ratio, 0.5);
  assert.strictEqual(trailPatch.meta.trail_active, true);
  assert.ok(trailPatch.invariants.includes("TP1_DONE_WITH_TP_ORDER"));

  const tp1ContractRatioPatch = reconcileBinancePositionMetaWithExchange({
    active: true,
    meta: {
      exit_rules_override: {
        TP_P0_QTY: 0.25,
        TP_P1_QTY: 0.5,
      },
    },
    positionSide: "LONG",
    qtyBase: 7.5,
    entryPrice: 100,
    leverage: 2,
    openOrders: [],
    algoOrders: [
      { orderId: "stop-1", type: "STOP_MARKET", side: "SELL", closePosition: true, stopPrice: "101.5" },
      { orderId: "tp1-1", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "103.25", origQty: "5" },
    ],
  });
  assert.strictEqual(tp1ContractRatioPatch.meta.native_protection_tp_qty_ratio, 0.5, "reconciler must preserve TP1 contract ratio, not current remaining ratio");

  const staleTrail = reconcileBinancePositionMetaWithExchange({
    active: true,
    meta: {
      tp_p1_done: true,
      trail_active: false,
      trail_high: 111,
      trail_high_at_ms: 100,
      tp_p1_bar_ms: 150,
    },
    positionSide: "LONG",
    qtyBase: 12,
    entryPrice: 100,
    leverage: 2,
    openOrders: [],
    algoOrders: [
      { orderId: "stop-1", type: "STOP_MARKET", side: "SELL", closePosition: true, stopPrice: "109" },
    ],
  });
  assert.strictEqual(staleTrail.meta.trail_active, false);
  assert.ok(staleTrail.invariants.includes("STALE_TRAIL_OBSERVATION"));

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
