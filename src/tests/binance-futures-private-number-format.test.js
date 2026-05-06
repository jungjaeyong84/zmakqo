"use strict";

const assert = require("assert");
const fut = require("../exchanges/binanceFuturesPrivate");

(function preservesIntegerTrailingZeros() {
  assert.strictEqual(fut.__test.toBinanceNumberString(1030, 0), "1030");
  assert.strictEqual(fut.__test.toBinanceNumberString("120", 0), "120");
})();

(function trimsOnlyFractionalZeros() {
  assert.strictEqual(fut.__test.toBinanceNumberString(1030.5, 2), "1030.5");
  assert.strictEqual(fut.__test.toBinanceNumberString(0.01, 4), "0.01");
  assert.strictEqual(fut.__test.toBinanceNumberString(1.234500, 6), "1.2345");
})();

(function quantityNormalizationKeepsWholeContracts() {
  assert.strictEqual(
    fut.__test.normalizeFuturesQuantityFromExchangeInfo(1030, {
      stepSize: "1",
      minQty: "1",
      quantityPrecision: 0,
    }),
    "1030"
  );
})();

console.log("BINANCE_FUTURES_PRIVATE_NUMBER_FORMAT_TEST_OK");
