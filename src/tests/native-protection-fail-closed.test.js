"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

async function run() {
  assert.strictEqual(
    typeof __test.placeNativeStopImmediateTriggerFailClosed,
    "function",
    "placeNativeStopImmediateTriggerFailClosed export missing"
  );

  const fn = __test.placeNativeStopImmediateTriggerFailClosed;
  const source = fn.toString();
  assert.ok(source.includes("MARKET_FAIL_CLOSED"), "helper must identify the fail-closed market path");

  const orderCalls = [];
  const placeOrderStub = async (payload) => {
    orderCalls.push(payload);
    return { orderId: "MC1", clientOrderId: "dbj_fail_closed" };
  };

  const result = await fn({
    liveCfg: { apiKey: "k", apiSecret: "s" },
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    positionSide: "LONG",
    closeSide: "SELL",
    entryPrice: 75000,
    leverage: 2,
    triggerPrice: 75605.8,
    quantity: 0.013,
    placeOrder: placeOrderStub,
  }).catch((err) => {
    throw err;
  });

  assert.strictEqual(orderCalls.length, 1, "fail-closed helper must place exactly one market order");
  assert.strictEqual(orderCalls[0].symbol, "BTCUSDT");
  assert.strictEqual(orderCalls[0].side, "SELL");
  assert.strictEqual(orderCalls[0].quantity, 0.013);
  assert.strictEqual(orderCalls[0].reduceOnly, true);
  assert.strictEqual(result.client_order_mode, "MARKET_FAIL_CLOSED");
  assert.strictEqual(result.order.orderId, "MC1");

  await assert.rejects(
    () => fn({
      liveCfg: { apiKey: "k", apiSecret: "s" },
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      positionSide: "LONG",
      closeSide: "SELL",
      entryPrice: 75000,
      leverage: 2,
      triggerPrice: 75605.8,
      quantity: 0,
      placeOrder: placeOrderStub,
    }),
    /FAIL_CLOSED_QTY_INVALID/
  );

  console.log("NATIVE_PROTECTION_FAIL_CLOSED_TEST_OK");
}

run().catch((err) => {
  console.error("NATIVE_PROTECTION_FAIL_CLOSED_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
