"use strict";

const assert = require("assert");
const { DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP } = require("../v2/discoveryCanaryNotionalPolicy");

const BINANCE_FUTURES_FILTER_FIXTURES = Object.freeze({
  BTCUSDT: { mark_price: 77430, min_notional: 50, min_qty: 0.001, step_size: 0.001 },
  ETHUSDT: { mark_price: 2316, min_notional: 20, min_qty: 0.001, step_size: 0.001 },
  LINKUSDT: { mark_price: 9.39, min_notional: 20, min_qty: 0.01, step_size: 0.01 },
  BNBUSDT: { mark_price: 637, min_notional: 5, min_qty: 0.01, step_size: 0.01 },
  XRPUSDT: { mark_price: 1.44, min_notional: 5, min_qty: 0.1, step_size: 0.1 },
  SOLUSDT: { mark_price: 87, min_notional: 5, min_qty: 0.01, step_size: 0.01 },
  AXSUSDT: { mark_price: 1.14, min_notional: 5, min_qty: 1, step_size: 1 },
  DOGEUSDT: { mark_price: 0.099, min_notional: 5, min_qty: 1, step_size: 1 },
});

function floorToStep(value, step) {
  return Math.floor(value / step) * step;
}

function evaluatePolicy({ notional, markPrice, minNotional, minQty, stepSize }) {
  const entryQty = floorToStep(notional / markPrice, stepSize);
  const tp1Qty = floorToStep(entryQty * 0.5, stepSize);
  return {
    entryQty,
    entryNotional: entryQty * markPrice,
    tp1Qty,
    tp1Notional: tp1Qty * markPrice,
    ok: entryQty >= minQty
      && entryQty * markPrice >= minNotional
      && tp1Qty >= minQty
      && tp1Qty * markPrice >= minNotional,
  };
}

for (const [symbol, fixture] of Object.entries(BINANCE_FUTURES_FILTER_FIXTURES)) {
  const notional = DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP[symbol];
  assert.ok(Number.isFinite(notional), `${symbol} policy missing`);
  const result = evaluatePolicy({
    notional,
    markPrice: fixture.mark_price,
    minNotional: fixture.min_notional,
    minQty: fixture.min_qty,
    stepSize: fixture.step_size,
  });
  assert.strictEqual(result.ok, true, `${symbol} policy cannot place entry + 50% TP1: ${JSON.stringify(result)}`);
}

console.log("V2_DISCOVERY_CANARY_NOTIONAL_POLICY_TEST_OK");
