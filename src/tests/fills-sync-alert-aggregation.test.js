"use strict";

const assert = require("assert");
const { __test: fillsSyncTest } = require("../services/binanceFuturesFillsSync");
const { __test: alertTest } = require("../services/tradeExecutionAlert");

function approxEqual(actual, expected, epsilon = 1e-9) {
  return Math.abs(Number(actual) - Number(expected)) <= epsilon;
}

async function run() {
  const rescueExitRules = fillsSyncTest.resolveAlertExitRules({
    position: {
      meta: {
        openclaw_market_regime_cohort: "RESCUE",
        exit_rules_override: { SL: -0.0165, TP_P1: 0.0325, TRAIL_R_MULTIPLE: 0.9, RUNNER_MIN_PROFIT_PCT: 0.02, BE_PCT: 0.0025 },
      },
    },
  }, { SL: -0.0165, TP_P1: 0.0325, TRAIL_R_MULTIPLE: 0.9, RUNNER_MIN_PROFIT_PCT: 0.02, BE_PCT: 0.0025 });
  assert.ok(approxEqual(rescueExitRules.TP_P1, 0.0165), "rescue cohort alert must use current TP1");
  assert.ok(approxEqual(rescueExitRules.TRAIL_R_MULTIPLE, 0.6), "rescue cohort alert must use current trailing R");
  assert.ok(approxEqual(rescueExitRules.RUNNER_MIN_PROFIT_PCT, 0.012), "rescue cohort alert must use current runner floor");
  assert.ok(approxEqual(rescueExitRules.BE_PCT, 0.0015), "rescue cohort alert must use current BE");
  assert.strictEqual(
    fillsSyncTest.normalizeExitEventForRules("EXIT_TP_P1_3.25P", rescueExitRules),
    "EXIT_TP_P1_1.65P",
    "legacy TP1 event label must be normalized to current cohort rule"
  );

  const firstCloseRatio = fillsSyncTest.resolveFillSyncAlertCloseRatio({
    event: "EXIT_TP_P1_3.25P",
    intent: { qty_fraction: 0.5 },
    qtyScale: { ratio: 0.394 },
  });
  const secondCloseRatio = fillsSyncTest.resolveFillSyncAlertCloseRatio({
    event: "EXIT_TP_P1_3.25P",
    intent: { qty_fraction: 0.5 },
    qtyScale: { ratio: 0.606 },
  });

  assert.ok(approxEqual(firstCloseRatio, 0.197), "first split close ratio must be scaled from intent qty_fraction");
  assert.ok(approxEqual(secondCloseRatio, 0.303), "second split close ratio must be scaled from intent qty_fraction");
  assert.strictEqual(
    fillsSyncTest.resolveFillSyncAlertFullExit({
      event: "EXIT_TP_P1_3.25P",
      orderMeta: { closePosition: false },
      closeRatio: firstCloseRatio,
    }),
    false,
    "TP1 must not be classified as full exit"
  );

  const batches = new Map();
  fillsSyncTest.queueFillSyncAlertBatch(batches, {
    symbol: "XRPUSDT",
    event: "EXIT_TP_P1_3.25P",
    intent: "EXIT",
    side: "SELL",
    orderMeta: { orderId: 99123, clientOrderId: "fut_xrp_tp1" },
    tradeMs: 1_777_777_001_000,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "XRPUSDT",
      event: "EXIT_TP_P1_3.25P",
      side: "SELL",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 158.49,
      execPrice: 1.395,
      closeRatio: firstCloseRatio,
      fullExit: false,
      realizedPnl: 2.511,
      positionSideBefore: "LONG",
      positionSideAfter: null,
      appliedLeverage: 2,
      leverageReason: "BINANCE_USER_TRADES_SYNC",
      exitRules: { SL: -0.0165, TP_P1: 0.0325, TRAIL_PCT: 0.01, BE_PCT: 0.0025 },
      runId: "FILL_SYNC__XRPUSDT",
    },
  });
  fillsSyncTest.queueFillSyncAlertBatch(batches, {
    symbol: "XRPUSDT",
    event: "EXIT_TP_P1_3.25P",
    intent: "EXIT",
    side: "SELL",
    orderMeta: { orderId: 99123, clientOrderId: "fut_xrp_tp1" },
    tradeMs: 1_777_777_001_100,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "XRPUSDT",
      event: "EXIT_TP_P1_3.25P",
      side: "SELL",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 243.88,
      execPrice: 1.395,
      closeRatio: secondCloseRatio,
      fullExit: false,
      realizedPnl: 3.863,
      positionSideBefore: "LONG",
      positionSideAfter: null,
      appliedLeverage: 2,
      leverageReason: "BINANCE_USER_TRADES_SYNC",
      exitRules: { SL: -0.0165, TP_P1: 0.0325, TRAIL_PCT: 0.01, BE_PCT: 0.0025 },
      runId: "FILL_SYNC__XRPUSDT",
    },
  });

  assert.strictEqual(batches.size, 1, "split fills from the same TP1 order must be aggregated into one alert");
  const merged = Array.from(batches.values())[0];
  assert.ok(approxEqual(merged.payload.notional, 402.37), "aggregated notional must be summed");
  assert.ok(approxEqual(merged.payload.realizedPnl, 6.374), "aggregated pnl must be summed");
  assert.ok(approxEqual(merged.payload.closeRatio, 0.5), "aggregated close ratio must represent 50% TP1");
  assert.strictEqual(merged.payload.fullExit, false, "aggregated TP1 alert must remain partial");

  const nativeTpCloseRatio = fillsSyncTest.resolveFillSyncAlertCloseRatio({
    event: "EXIT_TP_P1_3.25P",
    intent: null,
    qtyScale: { ratio: null },
    execQtyBase: 49.19,
    positionCtx: {
      qtyBase: 49.19,
      nativeProtectionTpQtyBase: 49.19,
      nativeProtectionTpQtyRatio: 0.5,
    },
  });
  assert.ok(approxEqual(nativeTpCloseRatio, 0.5), "native TP1 close ratio must prefer native TP quantity metadata");

  const partialTp1CloseRatio = fillsSyncTest.resolveFillSyncAlertCloseRatio({
    event: "EXIT_TP_P1_1.65P",
    intent: { qty_fraction: 1 },
    qtyScale: { qtyPct: 0.5, ratio: 0.5 },
    execQtyBase: 365.5,
    positionCtx: {
      qtyBase: 731,
      nativeProtectionTpQtyBase: 365.5,
      nativeProtectionTpQtyRatio: 0.5,
    },
  });
  assert.ok(
    approxEqual(partialTp1CloseRatio, 0.5),
    "TP1 alert close ratio must prefer synced/native partial size over stale full intent fraction"
  );

  const ethLikeCloseRatio = fillsSyncTest.resolveFillSyncAlertCloseRatio({
    event: "EXIT_TP_P1_3.25P",
    intent: null,
    qtyScale: { ratio: null },
    execQtyBase: 0.165,
    positionCtx: {
      qtyBase: 0.166,
      nativeProtectionTpQtyBase: 0.165,
      nativeProtectionTpQtyRatio: 0.4984894259818731,
    },
  });
  assert.ok(
    approxEqual(ethLikeCloseRatio, 0.4984894259818731),
    "ETH-like TP1 sync must not treat current remaining qty as the close ratio denominator"
  );

  const missingTpMetaCloseRatio = fillsSyncTest.resolveFillSyncAlertCloseRatio({
    event: "EXIT_TP_P1_3.25P",
    intent: null,
    qtyScale: { ratio: null },
    execQtyBase: 0.165,
    positionCtx: { qtyBase: 0.166 },
  });
  assert.strictEqual(
    missingTpMetaCloseRatio,
    null,
    "TP1 without reliable intent/native metadata must not guess a close ratio from current remaining qty"
  );

  const msg = alertTest.buildMessage(merged.payload);
  assert.ok(msg, "aggregated TP1 alert message must be buildable");
  assert.strictEqual(msg.title, "XRPUSDT TP1_3.25 50% 청산");
  assert.ok(msg.body.includes("종류: 익절(TP1) 3.25%"), "TP1 label must be preserved");
  assert.ok(msg.body.includes("청산규모: 402.37 USDT"), "aggregated notional must be visible");

  const oppositeBatches = new Map();
  fillsSyncTest.queueFillSyncAlertBatch(oppositeBatches, {
    symbol: "BTCUSDT",
    event: "EXIT_OPPOSITE_SIGNAL",
    intent: "EXIT",
    side: "BUY",
    orderMeta: { orderId: 1001, clientOrderId: "first_partial" },
    tradeMs: 1_777_888_100_000,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      event: "EXIT_OPPOSITE_SIGNAL",
      side: "BUY",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 535.82,
      execPrice: 66977.2,
      closeRatio: 0.5,
      fullExit: true,
      realizedPnl: -0.062,
      positionSideBefore: "SHORT",
      entryEventId: "BINANCEFUT|BTCUSDT|15m|1775372400000|SHORT|SHORT",
      appliedLeverage: 2,
      leverageReason: "BINANCE_USER_TRADES_SYNC",
      exitRules: { SL: -0.0165, TP_P1: 0.0325, TRAIL_R_MULTIPLE: 0.9, RUNNER_MIN_PROFIT_PCT: 0.02, BE_PCT: 0.0025 },
      runId: "FILL_SYNC__BTCUSDT",
    },
  });
  fillsSyncTest.queueFillSyncAlertBatch(oppositeBatches, {
    symbol: "BTCUSDT",
    event: "EXIT_OPPOSITE_SIGNAL",
    intent: "EXIT",
    side: "BUY",
    orderMeta: { orderId: 1002, clientOrderId: "second_partial" },
    tradeMs: 1_777_888_100_200,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      event: "EXIT_OPPOSITE_SIGNAL",
      side: "BUY",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 267.92,
      execPrice: 66979.6,
      closeRatio: 0.25,
      fullExit: true,
      realizedPnl: -0.041,
      positionSideBefore: "SHORT",
      entryEventId: "BINANCEFUT|BTCUSDT|15m|1775372400000|SHORT|SHORT",
      appliedLeverage: 2,
      leverageReason: "BINANCE_USER_TRADES_SYNC",
      exitRules: { SL: -0.0165, TP_P1: 0.0325, TRAIL_R_MULTIPLE: 0.9, RUNNER_MIN_PROFIT_PCT: 0.02, BE_PCT: 0.0025 },
      runId: "FILL_SYNC__BTCUSDT",
    },
  });
  fillsSyncTest.queueFillSyncAlertBatch(oppositeBatches, {
    symbol: "BTCUSDT",
    event: "EXIT_OPPOSITE_SIGNAL",
    intent: "EXIT",
    side: "BUY",
    orderMeta: { orderId: 1003, clientOrderId: "third_partial" },
    tradeMs: 1_777_888_100_350,
    payload: {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      event: "EXIT_OPPOSITE_SIGNAL",
      side: "BUY",
      intent: "EXIT",
      executionMode: "LIVE",
      notional: 267.92,
      execPrice: 66979.6,
      closeRatio: 0.25,
      fullExit: true,
      realizedPnl: -0.041,
      positionSideBefore: "SHORT",
      entryEventId: "BINANCEFUT|BTCUSDT|15m|1775372400000|SHORT|SHORT",
      appliedLeverage: 2,
      leverageReason: "BINANCE_USER_TRADES_SYNC",
      exitRules: { SL: -0.0165, TP_P1: 0.0325, TRAIL_R_MULTIPLE: 0.9, RUNNER_MIN_PROFIT_PCT: 0.02, BE_PCT: 0.0025 },
      runId: "FILL_SYNC__BTCUSDT",
    },
  });

  assert.strictEqual(oppositeBatches.size, 1, "split opposite-signal fills from the same entry must be aggregated into one alert");
  const mergedOpposite = Array.from(oppositeBatches.values())[0];
  assert.ok(approxEqual(mergedOpposite.payload.notional, 1071.66), "aggregated opposite close notional must be summed");
  assert.ok(approxEqual(mergedOpposite.payload.realizedPnl, -0.144), "aggregated opposite close pnl must be summed");
  assert.ok(approxEqual(mergedOpposite.payload.closeRatio, 1), "aggregated opposite close ratio must clamp to full exit");
  assert.strictEqual(mergedOpposite.payload.fullExit, true, "aggregated opposite close must remain full exit");

  const rescueTrailMsg = alertTest.buildMessage({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TRAIL",
    side: "BUY",
    intent: "EXIT",
    executionMode: "LIVE",
    notional: 743.89,
    execPrice: 2038.06,
    fullExit: true,
    realizedPnl: 5.92,
    positionSideBefore: "SHORT",
    positionSideAfter: null,
    appliedLeverage: 2,
    leverageReason: "BINANCE_USER_TRADES_SYNC",
    features: { openclaw_market_regime_cohort: "RESCUE" },
    exitRules: rescueExitRules,
  });
  assert.ok(rescueTrailMsg.body.includes("청산규칙: SL_1.65 / TP1_1.65 / TRAIL_0.6R / RUNNER_MIN_1.2 / BE_0.15"), "trail alert must reflect current rescue cohort rules");

  const sameOrderAsRecentTp1 = fillsSyncTest.isSameOrderAsRecentTp1(
    { orderId: 14608292413, clientOrderId: "dbj_same_order" },
    { orderId: 14608292413, clientOrderId: "dbj_other", event: "EXIT_TP_P1_3.25P" }
  );
  assert.strictEqual(sameOrderAsRecentTp1, true, "same order id must be recognized as the same TP1 order");

  const sameOrderEvent = await fillsSyncTest.resolveExternalExitEvent({
    intent: null,
    trade: { realizedPnl: 9.792, time: 1_777_810_631_082, symbol: "AXSUSDT" },
    orderMeta: {
      orderId: 14608292413,
      clientOrderId: "dbj_same_order",
      orderType: "MARKET",
      closePosition: false,
      reduceOnly: true,
    },
    positionCtx: {
      trailActive: true,
    },
    recentTp1: {
      orderId: 14608292413,
      clientOrderId: "dbj_same_order",
      event: "EXIT_TP_P1_3.25P",
      tradeMs: 1_777_810_631_082,
    },
    rules: { SL: -0.0165, TP_P1: 0.0325, TRAIL_PCT: 0.01, BE_PCT: 0.0025 },
  });
  assert.strictEqual(
    sameOrderEvent,
    "EXIT_TP_P1_3.25P",
    "split fills from the same triggered TP1 order must stay classified as TP1, not TRAIL"
  );
}

(async () => {
  try {
    await run();
    console.log("FILL_SYNC_ALERT_AGGREGATION_TEST_OK");
  } catch (err) {
    console.error("FILL_SYNC_ALERT_AGGREGATION_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  }
})();
