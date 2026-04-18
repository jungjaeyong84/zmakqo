"use strict";

// Unit tests for `nativeProtectionMetaSync._internal`.
//
// These tests lock the classifier behavior that decides which open-order
// entry becomes the SL / TP_close / TP_partial meta value, without touching
// live credentials or the position store.

const assert = require("assert");
const {
  _internal: { normalizeOrderShape, classifyOrders },
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
