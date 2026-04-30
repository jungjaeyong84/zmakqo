"use strict";

const assert = require("assert");
const {
  placeFuturesTakeProfitMarketOrder,
  __test,
} = require("../exchanges/binanceFuturesPrivate");

async function takeProfitMarketNormalizesQuantityToLotStep() {
  const previousBaseUrl = process.env.BINANCE_FUTURES_BASE_URL;
  const previousFetch = global.fetch;
  process.env.BINANCE_FUTURES_BASE_URL = "https://binance.test";
  const calls = [];
  global.fetch = async (url, options = {}) => {
    calls.push({ url: String(url), method: options.method || "GET" });
    if (String(url).includes("/fapi/v1/exchangeInfo")) {
      return new Response(JSON.stringify({
        symbols: [{
          symbol: "LINKUSDT",
          quantityPrecision: 2,
          pricePrecision: 3,
          filters: [
            { filterType: "LOT_SIZE", minQty: "0.01", maxQty: "100000", stepSize: "0.01" },
            { filterType: "PRICE_FILTER", tickSize: "0.001" },
          ],
        }],
      }), { status: 200 });
    }
    if (String(url).includes("/fapi/v1/order")) {
      const parsed = new URL(String(url));
      assert.strictEqual(parsed.searchParams.get("symbol"), "LINKUSDT");
      assert.strictEqual(parsed.searchParams.get("type"), "TAKE_PROFIT_MARKET");
      assert.strictEqual(parsed.searchParams.get("quantity"), "2.68");
      assert.strictEqual(parsed.searchParams.get("stopPrice"), "9.15");
      return new Response(JSON.stringify({ orderId: "tp1_order", stopPrice: "9.15" }), { status: 200 });
    }
    throw new Error(`UNEXPECTED_FETCH:${url}`);
  };

  try {
    const result = await placeFuturesTakeProfitMarketOrder({
      apiKey: "key",
      apiSecret: "secret",
      symbol: "LINKUSDT",
      side: "BUY",
      stopPrice: 9.1506424,
      closePosition: false,
      quantity: 2.685,
      reduceOnly: true,
      clientOrderId: "tp1_link_precision",
    });
    assert.strictEqual(result.orderId, "tp1_order");
    assert.strictEqual(calls.some((call) => call.url.includes("/fapi/v1/exchangeInfo")), true);
    assert.strictEqual(calls.some((call) => call.url.includes("/fapi/v1/order")), true);
  } finally {
    global.fetch = previousFetch;
    if (previousBaseUrl == null) delete process.env.BINANCE_FUTURES_BASE_URL;
    else process.env.BINANCE_FUTURES_BASE_URL = previousBaseUrl;
  }
}

(async () => {
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

  assert.strictEqual(
    __test.normalizeFuturesQuantityFromExchangeInfo(
      2.685,
      { stepSize: 0.01, minQty: 0.01, quantityPrecision: 2 }
    ),
    "2.68"
  );

  assert.strictEqual(
    __test.normalizeFuturesQuantityFromExchangeInfo(
      0.009,
      { stepSize: 0.01, minQty: 0.01, quantityPrecision: 2 }
    ),
    null
  );

  await takeProfitMarketNormalizesQuantityToLotStep();

  console.log("BINANCE_FUTURES_PRIVATE_TEST_OK");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
