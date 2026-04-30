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
  assert.strictEqual(typeof auditTest.normalizeOrderId, "function", "audit normalizeOrderId export missing");
  assert.strictEqual(typeof auditTest.normalizeOrderQuantity, "function", "audit normalizeOrderQuantity export missing");
  assert.strictEqual(typeof auditTest.isStrictTp1OrderCandidate, "function", "isStrictTp1OrderCandidate export missing");
  assert.strictEqual(typeof auditTest.isV2LiveWriteRuntime, "function", "isV2LiveWriteRuntime export missing");

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
  assert.strictEqual(auditTest.normalizeOrderId({ algoId: 123456 }), "123456");
  assert.strictEqual(auditTest.normalizeOrderQuantity({ origQty: "0.125" }), 0.125);
  assert.strictEqual(typeof auditTest.normalizeExpectedTp1QuantityForExchangeInfo, "function",
    "normalizeExpectedTp1QuantityForExchangeInfo export missing");
  assert.strictEqual(auditTest.normalizeExpectedTp1QuantityForExchangeInfo(0.095, { stepSize: 0.01 }), 0.09,
    "TP1 expected qty must be normalized to Binance LOT_SIZE step before reconciliation");
  assert.strictEqual(auditTest.normalizeExpectedTp1QuantityForExchangeInfo(43.85, { stepSize: 0.1 }), 43.8,
    "TP1 expected qty must floor to exchange step just like the writer");
  assert.strictEqual(auditTest.normalizeExpectedTp1QuantityForExchangeInfo(0.001, { stepSize: 0.001 }), 0.001,
    "already step-aligned quantities must remain unchanged");
  assert.strictEqual(auditTest.isStrictTp1OrderCandidate({
    orderType: "TAKE_PROFIT_MARKET",
    side: "SELL",
    reduceOnly: true,
    closePosition: false,
  }, "SELL"), true);
  assert.strictEqual(auditTest.isStrictTp1OrderCandidate({
    orderType: "TAKE_PROFIT_MARKET",
    side: "SELL",
    reduceOnly: true,
    closePosition: true,
  }, "SELL"), false);
  assert.strictEqual(auditTest.isStrictTp1OrderCandidate({
    orderType: "TAKE_PROFIT_MARKET",
    side: "SELL",
    reduceOnly: false,
    closePosition: false,
  }, "SELL"), false);
  assert.strictEqual(auditTest.isV2LiveWriteRuntime({
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "1",
  }), true);
  assert.strictEqual(auditTest.isV2LiveWriteRuntime({
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "1",
    DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "1",
  }), false);

  assert.strictEqual(auditTest.hasTrackedNativeProtectionMeta({
    native_protection_refresh_status: "OK",
    native_protection_stop_order_id: "123",
  }), true);
  assert.strictEqual(auditTest.hasTrackedNativeProtectionMeta({}), false);

  // ── PR #12: `isValidTrailReference` same-class boundary-value contract.
  //   양수 finite 만 valid.  null/undefined/0/음수/NaN/Infinity/문자열은
  //   전부 invalid 로 분류되어 TP1_TRAIL_REF_MISSING 경보가 누락되지
  //   않도록 잠근다.
  assert.strictEqual(typeof auditTest.isValidTrailReference, "function",
    "isValidTrailReference export missing");
  // valid cases
  for (const v of [1, 0.0001, 100, 1e12]) {
    assert.strictEqual(auditTest.isValidTrailReference(v), true,
      `positive finite ${v} must be valid`);
  }
  // invalid cases — 이 helper 의 목적은 same-class 경계값 버그 (null/0/
  // 음수/비-finite) 를 걸러내는 것.  문자열 "5.0" 같은 것은 `Number()` 로
  // 양수 finite 가 되므로 valid 로 통과한다 (audit 호출부가 원래
  // `Number(trailSnapshot.trail_low)` 를 하던 계약을 보존).
  for (const v of [null, undefined, 0, -0, -1, -1e-9, NaN, Infinity, -Infinity, "not-a-number", {}, [1, 2]]) {
    assert.strictEqual(auditTest.isValidTrailReference(v), false,
      `${JSON.stringify(v)} must be invalid trail reference (same-class guard)`);
  }
})();

console.log("BINANCE_ALGO_ENDPOINT_UNAVAILABLE_TEST_OK");
