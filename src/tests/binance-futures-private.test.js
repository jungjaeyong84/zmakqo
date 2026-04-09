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

  console.log("BINANCE_FUTURES_PRIVATE_TEST_OK");
})();
