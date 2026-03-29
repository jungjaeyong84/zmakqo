const assert = require("assert");
const binancePrivate = require("../exchanges/binanceFuturesPrivate");
const exitAudit = require("../services/exitIntegrityAudit");

(() => {
  const privateTest = binancePrivate.__test || {};
  const auditTest = exitAudit.__test || {};
  assert.strictEqual(typeof privateTest.isAlgoEndpointUnavailableError, "function", "isAlgoEndpointUnavailableError export missing");
  assert.strictEqual(typeof privateTest.normalizeAlgoOpenOrdersResponse, "function", "normalizeAlgoOpenOrdersResponse export missing");
  assert.strictEqual(typeof privateTest.normalizeAlgoOrderResponse, "function", "normalizeAlgoOrderResponse export missing");
  assert.strictEqual(typeof auditTest.normalizeAlgoOrderFetchResult, "function", "audit normalizeAlgoOrderFetchResult export missing");
  assert.strictEqual(typeof auditTest.hasTrackedNativeProtectionMeta, "function", "hasTrackedNativeProtectionMeta export missing");
  assert.strictEqual(typeof auditTest.normalizeOrderType, "function", "audit normalizeOrderType export missing");
  assert.strictEqual(typeof auditTest.normalizeOrderTriggerPrice, "function", "audit normalizeOrderTriggerPrice export missing");

  const unavailableErr = {
    status: 404,
    message: "BINANCEFUT_HTTP_404: <!doctype html><html><body>Error code: 404</body></html>",
    body: "<!doctype html><html><body>Error code: 404</body></html>",
  };
  assert.strictEqual(privateTest.isAlgoEndpointUnavailableError(unavailableErr), true);

  const normalizedUnavailable = privateTest.normalizeAlgoOpenOrdersResponse({
    orders: [],
    endpointUnavailable: true,
    note: "ALGO_ENDPOINT_UNAVAILABLE",
  });
  assert.deepStrictEqual(normalizedUnavailable, {
    orders: [],
    endpointUnavailable: true,
    note: "ALGO_ENDPOINT_UNAVAILABLE",
  });

  const normalizedArray = auditTest.normalizeAlgoOrderFetchResult([]);
  assert.deepStrictEqual(normalizedArray, {
    orders: [],
    endpointUnavailable: false,
    note: null,
  });

  const normalizedAlgoOrder = privateTest.normalizeAlgoOrderResponse({
    algoId: 123456,
    orderType: "STOP_MARKET",
    triggerPrice: "100.5",
    algoStatus: "NEW",
  });
  assert.strictEqual(normalizedAlgoOrder.orderId, "123456");
  assert.strictEqual(normalizedAlgoOrder.type, "STOP_MARKET");
  assert.strictEqual(normalizedAlgoOrder.origType, "STOP_MARKET");
  assert.strictEqual(normalizedAlgoOrder.stopPrice, "100.5");
  assert.strictEqual(normalizedAlgoOrder.status, "NEW");

  assert.strictEqual(auditTest.normalizeOrderType({ orderType: "TAKE_PROFIT_MARKET" }), "TAKE_PROFIT_MARKET");
  assert.strictEqual(auditTest.normalizeOrderTriggerPrice({ triggerPrice: "123.45" }), 123.45);

  assert.strictEqual(auditTest.hasTrackedNativeProtectionMeta({
    native_protection_refresh_status: "OK",
    native_protection_stop_order_id: "123",
  }), true);
  assert.strictEqual(auditTest.hasTrackedNativeProtectionMeta({}), false);
})();

console.log("BINANCE_ALGO_ENDPOINT_UNAVAILABLE_TEST_OK");
