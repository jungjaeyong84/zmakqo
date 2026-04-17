"use strict";

const assert = require("assert");
const { __test } = require("../exchanges/binanceFuturesPrivate");

(() => {
  assert.strictEqual(
    __test.isDuplicateClientOrderError({
      code: -4116,
      message: "BINANCEFUT_HTTP_400",
      body: "{\"code\":-4116,\"msg\":\"ClientOrderId is duplicated.\"}",
    }),
    true
  );

  assert.strictEqual(
    __test.isDuplicateClientOrderError({
      code: -2010,
      message: "Duplicate order sent.",
      body: "",
    }),
    true
  );

  assert.strictEqual(
    __test.isDuplicateClientOrderError({
      code: -2022,
      message: "ReduceOnly Order is rejected.",
      body: "{\"code\":-2022,\"msg\":\"ReduceOnly Order is rejected.\"}",
    }),
    false
  );

  assert.strictEqual(__test.floorToStep(637.7483725, 0.01), 637.74);
  assert.strictEqual(__test.ceilToStep(637.7483725, 0.01), 637.75);

  assert.strictEqual(
    __test.normalizeFuturesTriggerPriceFromExchangeInfo(
      637.7483725,
      { tickSize: 0.01, pricePrecision: 2 },
      { roundingMode: "ceil" }
    ),
    "637.75"
  );

  assert.strictEqual(
    __test.normalizeFuturesTriggerPriceFromExchangeInfo(
      642.966745,
      { tickSize: 0.01, pricePrecision: 2 },
      { roundingMode: "floor" }
    ),
    "642.96"
  );

  console.log("BINANCE_FUTURES_PRIVATE_TEST_OK");
})();
