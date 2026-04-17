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

  const matchedTp0IntentMustStayTp0AcrossSplitFills = await __test.resolveExternalExitEvent({
    intent: {
      event: "EXIT_TP_P0_0.8P",
    },
    trade: {
      realizedPnl: 0.42,
      qty: 0.026,
      time: Date.parse("2026-04-16T01:45:26.083Z"),
      symbol: "AXSUSDT",
    },
    orderMeta: {
      orderType: "TAKE_PROFIT_MARKET",
      closePosition: false,
      orderId: 3001,
      clientOrderId: "fut_axs_tp0",
    },
    positionCtx: {
      qtyBase: 1.326,
      tpP0Done: true,
      tpP1Done: true,
      trailActive: true,
    },
    recentTp0: {
      event: "EXIT_TP_P0_0.8P",
      orderId: 3001,
      clientOrderId: "fut_axs_tp0",
      tradeMs: Date.parse("2026-04-16T01:45:26.010Z"),
    },
    recentTp1: null,
    rules,
    qtyPct: 0.0147,
  });
  assert.strictEqual(
    matchedTp0IntentMustStayTp0AcrossSplitFills,
    "EXIT_TP_P0_0.8P",
    "split fills under the same TP0 order must stay anchored to TP0 even if cached stage hints already drifted"
  );

  const tp0BackstopMustNotPromoteMatchedIntentToTrail = __test.applyActiveExitStageBackstopOverride({
    event: "EXIT_TP_P0_0.8P",
    intentEvent: "EXIT_TP_P0_0.8P",
    trade: {
      qty: 0.026,
    },
    orderMeta: {
      orderId: 3001,
      clientOrderId: "fut_axs_tp0",
    },
    positionCtx: {
      qtyBase: 1.326,
      tpP0Done: true,
      tpP1Done: true,
      trailActive: true,
    },
    recentTp0: {
      event: "EXIT_TP_P0_0.8P",
      orderId: 3001,
      clientOrderId: "fut_axs_tp0",
      tradeMs: Date.parse("2026-04-16T01:45:26.010Z"),
    },
    recentTp1: {
      event: "EXIT_TP_P1_1.65P",
      orderId: 3002,
      clientOrderId: "fut_axs_tp1",
      tradeMs: Date.parse("2026-04-16T01:46:48.408Z"),
    },
    recentTrail: {
      event: "EXIT_TRAIL",
      orderId: 3003,
      tradeMs: Date.parse("2026-04-16T01:46:50.917Z"),
    },
    rules,
    qtyPct: 0.0147,
  });
  // TP0 retirement policy (2026-04-17): a TP0 split fill arriving when the
  // position already has tpP1Done=true / trailActive=true is a leftover
  // from a legacy v1 cycle. Under the new policy (SL / TP1 / Trailing only)
  // the backstop routes such leftovers to TRAIL so the canonical ledger
  // does not stamp tp_p0_done on a v2 cycle. The OLD assertion preserved
  // the TP0 label; the new assertion reflects the policy change.
  assert.ok(
    String(tp0BackstopMustNotPromoteMatchedIntentToTrail || "").startsWith("EXIT_TRAIL"),
    `TP0 retirement: matched TP0 split fill under trail-active position must route to TRAIL, got ${tp0BackstopMustNotPromoteMatchedIntentToTrail}`
  );

  console.log("BINANCE_FILLS_STAGE_FALLBACK_TEST_OK");
}

run().catch((err) => {
  console.error("BINANCE_FILLS_STAGE_FALLBACK_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
