const assert = require("assert");
const engine = require("../engine/paperUpbitRunner");
const tradingActionsRoutes = require("../routes/trading.actions.routes");

function run() {
  const engineTest = engine && engine.__test;
  const routeTest = tradingActionsRoutes && tradingActionsRoutes.__test;

  assert.strictEqual(typeof engineTest.isManualRetryFeatures, "function", "isManualRetryFeatures export missing");
  assert.strictEqual(typeof engineTest.resolveManualRetryQtyBase, "function", "resolveManualRetryQtyBase export missing");
  assert.strictEqual(typeof routeTest.normalizeManualRetryEvent, "function", "normalizeManualRetryEvent export missing");
  assert.strictEqual(typeof routeTest.sideFromRetryEvent, "function", "sideFromRetryEvent export missing");
  assert.strictEqual(typeof routeTest.resolveRetryQtyBaseFromTrades, "function", "resolveRetryQtyBaseFromTrades export missing");

  assert.strictEqual(engineTest.isManualRetryFeatures({ _manual_retry_by_user: true }), true);
  assert.strictEqual(engineTest.isManualRetryFeatures({ manual_retry_by_user: "1" }), true);
  assert.strictEqual(engineTest.isManualRetryFeatures({}), false);

  assert.strictEqual(engineTest.resolveManualRetryQtyBase({ _manual_retry_qty_base: "0.019" }), 0.019);
  assert.strictEqual(engineTest.resolveManualRetryQtyBase({ manual_retry_qty_base: 0.01 }), 0.01);
  assert.strictEqual(engineTest.resolveManualRetryQtyBase({ _manual_retry_qty_base: "0" }), null);

  assert.strictEqual(routeTest.normalizeManualRetryEvent("long", null), "LONG");
  assert.strictEqual(routeTest.normalizeManualRetryEvent("", "BUY"), "LONG");
  assert.strictEqual(routeTest.normalizeManualRetryEvent("", "SELL"), "SHORT");
  assert.strictEqual(routeTest.sideFromRetryEvent("LONG"), "BUY");
  assert.strictEqual(routeTest.sideFromRetryEvent("SHORT"), "SELL");

  const trades = [
    { side: "BUY", qty: "0.010" },
    { side: "SELL", qty: "0.017" },
    { side: "SELL", qty: "0.019" },
  ];
  assert.strictEqual(routeTest.resolveRetryQtyBaseFromTrades(trades, "BUY"), 0.019);
  assert.strictEqual(routeTest.resolveRetryQtyBaseFromTrades(trades, "SELL"), 0.01);
}

try {
  run();
  console.log("MANUAL_RETRY_PATH_TEST_OK");
} catch (err) {
  console.error("MANUAL_RETRY_PATH_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
