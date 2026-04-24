"use strict";

// Unit tests for `nativeProtectionMetaSync._internal`.
//
// These tests lock the classifier behavior that decides which open-order
// entry becomes the SL / TP_close / TP_partial meta value, without touching
// live credentials or the position store.

const assert = require("assert");
const {
  _internal: {
    normalizeOrderShape,
    classifyOrders,
    buildMetaPatchFromClassifiedOrders,
    isV2Tp1Partial,
  },
} = require("../services/nativeProtectionMetaSync");

(function normalizesRegularOrderShape() {
  const n = normalizeOrderShape({
    orderId: 12345,
    type: "STOP_MARKET",
    side: "sell",
    stopPrice: "0.09825",
    closePosition: true,
  });
  assert.strictEqual(n.type, "STOP_MARKET");
  assert.strictEqual(n.side, "SELL");
  assert.strictEqual(n.triggerPrice, 0.09825);
  assert.strictEqual(n.orderId, "12345");
  assert.strictEqual(n.closePosition, true);
})();

(function normalizesAlgoOrderShape() {
  const n = normalizeOrderShape({
    algoId: "4000001112563983",
    orderType: "TAKE_PROFIT_MARKET",
    side: "SELL",
    triggerPrice: 0.096,
    closePosition: "true",
  });
  assert.strictEqual(n.type, "TAKE_PROFIT_MARKET");
  assert.strictEqual(n.orderId, "4000001112563983");
  assert.strictEqual(n.triggerPrice, 0.096);
  assert.strictEqual(n.closePosition, true);
})();

(function normalizesReduceOnlyPartialTpShape() {
  const n = normalizeOrderShape({
    algoId: "4000001160643929",
    orderType: "TAKE_PROFIT_MARKET",
    side: "SELL",
    triggerPrice: "1.4436",
    quantity: "2.0",
    reduceOnly: "true",
    closePosition: false,
  });
  assert.strictEqual(n.type, "TAKE_PROFIT_MARKET");
  assert.strictEqual(n.orderId, "4000001160643929");
  assert.strictEqual(n.triggerPrice, 1.4436);
  assert.strictEqual(n.quantity, 2);
  assert.strictEqual(n.reduceOnly, true);
  assert.strictEqual(n.closePosition, false);
  assert.strictEqual(isV2Tp1Partial(n), true);
})();

(function classifiesShortTightestSlAndSplitsTpCloseVsPartial() {
  const orders = [
    // Mismatched side — must be ignored (SHORT close side is BUY).
    { orderId: 1, type: "STOP_MARKET", side: "SELL", stopPrice: 0.1, closePosition: true },
    // Two closePosition STOP_MARKETs — the tightest (lowest trigger for SHORT) wins.
    { orderId: 2, type: "STOP_MARKET", side: "BUY", stopPrice: 0.099, closePosition: true },
    { orderId: 3, type: "STOP_MARKET", side: "BUY", stopPrice: 0.0985, closePosition: true },
    // Runner TP (closePosition) + partial TP0 (not closePosition).
    { orderId: 4, type: "TAKE_PROFIT_MARKET", side: "BUY", stopPrice: 0.09, closePosition: true },
    { orderId: 5, type: "TAKE_PROFIT_MARKET", side: "BUY", stopPrice: 0.093, closePosition: false },
  ];
  const { sl, tpClose, tpPartial } = classifyOrders(orders, "SHORT");
  assert.ok(sl, "expected SL");
  assert.strictEqual(sl.orderId, "3");
  assert.strictEqual(sl.triggerPrice, 0.0985);
  assert.ok(tpClose, "expected TP close");
  assert.strictEqual(tpClose.orderId, "4");
  assert.ok(tpPartial, "expected TP partial");
  assert.strictEqual(tpPartial.orderId, "5");
})();

(function classifiesLongTightestSlWithOppositeOrdering() {
  const orders = [
    // LONG close side is SELL — tightest SL is the HIGHEST trigger.
    { orderId: 1, type: "STOP_MARKET", side: "SELL", stopPrice: 77_000, closePosition: true },
    { orderId: 2, type: "STOP_MARKET", side: "SELL", stopPrice: 77_800, closePosition: true },
    { orderId: 3, type: "STOP_MARKET", side: "BUY", stopPrice: 78_000, closePosition: true }, // wrong side
  ];
  const { sl } = classifyOrders(orders, "LONG");
  assert.ok(sl);
  assert.strictEqual(sl.orderId, "2");
  assert.strictEqual(sl.triggerPrice, 77_800);
})();

(function buildsV2MetaPatchWithReduceOnlyPartialAsTp1NotTp0() {
  const orders = [
    { orderId: "sl-1", type: "STOP_MARKET", side: "SELL", stopPrice: 1.4221, closePosition: true },
    {
      algoId: "tp1-1",
      orderType: "TAKE_PROFIT_MARKET",
      side: "SELL",
      triggerPrice: 1.4436,
      quantity: 2,
      reduceOnly: true,
      closePosition: false,
    },
  ];
  const classified = classifyOrders(orders, "LONG");
  const patch = buildMetaPatchFromClassifiedOrders({
    ...classified,
    positionQtyBase: 4,
    nowMs: 123,
    regularOrderN: 0,
    algoOrderN: 2,
  });
  assert.strictEqual(patch.native_protection_stop_order_id, "sl-1");
  assert.strictEqual(patch.native_protection_tp_order_id, "tp1-1");
  assert.strictEqual(patch.native_protection_tp_price, 1.4436);
  assert.strictEqual(patch.native_protection_tp_qty_base, 2);
  assert.strictEqual(patch.native_protection_tp_qty_ratio, 0.5);
  assert.strictEqual(patch.native_protection_tp_status, "OK");
  assert.strictEqual(patch.native_protection_tp0_order_id, null);
  assert.strictEqual(patch.native_protection_tp0_price, null);
})();

(function keepsLegacyPartialTpSeparateWhenItIsNotReduceOnlyAndHasNoQty() {
  const orders = [
    { orderId: "runner-1", type: "TAKE_PROFIT_MARKET", side: "BUY", stopPrice: 0.09, closePosition: true },
    { orderId: "legacy-tp0-1", type: "TAKE_PROFIT_MARKET", side: "BUY", stopPrice: 0.093, closePosition: false },
  ];
  const classified = classifyOrders(orders, "SHORT");
  const patch = buildMetaPatchFromClassifiedOrders({
    ...classified,
    positionQtyBase: 10,
    nowMs: 456,
  });
  assert.strictEqual(patch.native_protection_tp_order_id, "runner-1");
  assert.strictEqual(patch.native_protection_tp0_order_id, "legacy-tp0-1");
})();

(function ignoresOrdersWithoutTriggerOrOrderId() {
  const orders = [
    { orderId: null, type: "STOP_MARKET", side: "BUY", stopPrice: 0.1, closePosition: true },
    { orderId: 99, type: "STOP_MARKET", side: "BUY", stopPrice: "NaN", closePosition: true },
  ];
  const out = classifyOrders(orders, "SHORT");
  assert.strictEqual(out.sl, null);
  assert.strictEqual(out.tpClose, null);
  assert.strictEqual(out.tpPartial, null);
})();

console.log("NATIVE_PROTECTION_META_SYNC_TEST_OK");
