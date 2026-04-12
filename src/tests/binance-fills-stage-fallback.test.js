"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceFuturesFillsSync");

async function run() {
  const rules = {
    TP_P0: 0.008,
    TP_P0_QTY: 0.25,
    TP_P1: 0.0165,
    TP_P1_QTY: 0.5,
  };

  const ambiguousWithoutRecentTp0 = await __test.resolveExternalExitEvent({
    intent: null,
    trade: {
      realizedPnl: 1.23,
      qty: 0.2,
      time: Date.parse("2026-04-11T19:33:10.067Z"),
      symbol: "BTCUSDT",
    },
    orderMeta: {
      orderType: "TAKE_PROFIT_MARKET",
      closePosition: false,
      orderId: 1002,
      clientOrderId: "dbj_native_tp",
    },
    positionCtx: {
      qtyBase: 0.3,
      tpP0Done: false,
      tpP1Done: false,
      trailActive: false,
      nativeTp0OrderId: 1001,
      nativeTpOrderId: 1003,
    },
    recentTp1: null,
    recentTp0: null,
    rules,
    qtyPct: null,
  });
  assert.strictEqual(
    ambiguousWithoutRecentTp0,
    "EXIT_TP_P1_1.65P",
    "when post-fill remaining-aware quantity is closer to TP1, the classifier must not default back to TP0"
  );

  const ambiguousAfterRecentTp0 = await __test.resolveExternalExitEvent({
    intent: null,
    trade: {
      realizedPnl: 1.23,
      qty: 0.2,
      time: Date.parse("2026-04-11T19:33:10.067Z"),
      symbol: "BTCUSDT",
    },
    orderMeta: {
      orderType: "TAKE_PROFIT_MARKET",
      closePosition: false,
      orderId: 1002,
      clientOrderId: "dbj_native_tp",
    },
    positionCtx: {
      qtyBase: 0.3,
      tpP0Done: false,
      tpP1Done: false,
      trailActive: false,
      nativeTp0OrderId: 1001,
      nativeTpOrderId: 1003,
    },
    recentTp1: null,
    recentTp0: {
      event: "EXIT_TP_P0_0.8P",
      orderId: 1001,
      tradeMs: Date.parse("2026-04-11T18:36:36.112Z"),
    },
    rules,
    qtyPct: null,
  });
  assert.strictEqual(ambiguousAfterRecentTp0, "EXIT_TP_P1_1.65P");

  const matchedTrailIntentMustStayTrail = await __test.resolveExternalExitEvent({
    intent: {
      event: "EXIT_TRAIL",
    },
    trade: {
      realizedPnl: 0.91,
      qty: 0.5,
      time: Date.parse("2026-04-11T20:45:18.250Z"),
      symbol: "XRPUSDT",
    },
    orderMeta: {
      orderType: "TAKE_PROFIT_MARKET",
      closePosition: true,
      orderId: 2001,
      clientOrderId: null,
    },
    positionCtx: {
      qtyBase: 0,
      tpP0Done: false,
      tpP1Done: false,
      trailActive: false,
    },
    recentTp1: null,
    recentTp0: null,
    rules,
    qtyPct: null,
  });
  assert.strictEqual(matchedTrailIntentMustStayTrail, "EXIT_TRAIL");

  console.log("BINANCE_FILLS_STAGE_FALLBACK_TEST_OK");
}

run().catch((err) => {
  console.error("BINANCE_FILLS_STAGE_FALLBACK_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
