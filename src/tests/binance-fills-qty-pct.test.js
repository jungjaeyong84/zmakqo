const assert = require("assert");
const { __test } = require("../services/binanceFuturesFillsSync");

async function run() {
  const clearConsumedTakeProfitProtectionMeta = __test && __test.clearConsumedTakeProfitProtectionMeta;
  assert.strictEqual(typeof clearConsumedTakeProfitProtectionMeta, "function", "clearConsumedTakeProfitProtectionMeta export missing");
  const clearedProtectionMeta = clearConsumedTakeProfitProtectionMeta({
    native_protection_stop_order_id: "stop-1",
    native_protection_tp0_order_id: "tp0-1",
    native_protection_tp_order_id: "tp1-1",
    native_protection_tp0_status: "OK",
    native_protection_tp_status: "OK",
    native_protection_tp0_qty_ratio: 0.25,
    native_protection_tp_qty_ratio: 0.5,
  });
  assert.strictEqual(clearedProtectionMeta.native_protection_stop_order_id, "stop-1");
  assert.strictEqual(clearedProtectionMeta.native_protection_tp0_order_id, null);
  assert.strictEqual(clearedProtectionMeta.native_protection_tp_order_id, null);
  assert.strictEqual(clearedProtectionMeta.native_protection_tp0_status, null);
  assert.strictEqual(clearedProtectionMeta.native_protection_tp_status, null);
  assert.strictEqual(clearedProtectionMeta.native_protection_tp0_qty_ratio, null);
  assert.strictEqual(clearedProtectionMeta.native_protection_tp_qty_ratio, null);

  const fn = __test && __test.computeSyncedQtyPct;
  assert.strictEqual(typeof fn, "function", "computeSyncedQtyPct export missing");

  const scaledByNotional = fn({
    intent: { qty_pct: 0.15, budget_used_krw: 15000 },
    tradeNotional: 1500,
    execQtyBase: 1,
  });
  assert.ok(Math.abs(scaledByNotional.qtyPct - 0.015) < 1e-12);
  assert.strictEqual(scaledByNotional.mode, "SCALED_NOTIONAL");

  const capped = fn({
    intent: { qty_pct: 0.15, budget_used_krw: 15000 },
    tradeNotional: 30000,
    execQtyBase: 1,
  });
  assert.ok(Math.abs(capped.qtyPct - 0.15) < 1e-12);

  const scaledByQtyBase = fn({
    intent: { qty_pct: 0.20, qty_base: 4 },
    tradeNotional: null,
    execQtyBase: 1,
  });
  assert.ok(Math.abs(scaledByQtyBase.qtyPct - 0.05) < 1e-12);
  assert.strictEqual(scaledByQtyBase.mode, "SCALED_QTY_BASE");

  const noScale = fn({
    intent: { qty_pct: 0.25 },
    tradeNotional: null,
    execQtyBase: null,
  });
  assert.strictEqual(noScale.qtyPct, null);
  assert.strictEqual(noScale.mode, "UNSCALED_INTENT");

  const noIntentQty = fn({
    intent: { qty_pct: null, budget_used_krw: 10000 },
    tradeNotional: 1000,
    execQtyBase: 1,
  });
  assert.strictEqual(noIntentQty.qtyPct, null);
  assert.strictEqual(noIntentQty.mode, "NO_INTENT_QTY");

  const flatTrailIssues = __test.buildImmediateProjectionIssues({
    event: "EXIT_TRAIL_1P",
    position: {
      state: "FLAT",
      qty_base: 0,
      meta: { trail_active: false, tp_p0_done: false, tp_p1_done: false },
    },
  });
  assert.deepStrictEqual(flatTrailIssues, [], "settled flat position must not raise trail projection mismatch");

  const immediateAlertGate = __test && __test.shouldSendImmediateProjectionMismatchAlert;
  assert.strictEqual(typeof immediateAlertGate, "function", "shouldSendImmediateProjectionMismatchAlert export missing");
  const immediateAlertFirst = immediateAlertGate({
    symbol: "SOLUSDT",
    event: "EXIT_TP_P1_3P",
    issues: ["TP1_FILL_PROJECTION_MISSING"],
    nowMs: 1000,
  });
  assert.strictEqual(immediateAlertFirst.send, true);
  assert.strictEqual(immediateAlertFirst.repeatCount, 1);
  const immediateAlertSecond = immediateAlertGate({
    symbol: "SOLUSDT",
    event: "EXIT_TP_P1_3P",
    issues: ["TP1_FILL_PROJECTION_MISSING"],
    nowMs: 2000,
  });
  assert.strictEqual(immediateAlertSecond.send, false);
  assert.strictEqual(immediateAlertSecond.repeatCount, 2);
  const immediateAlertThird = immediateAlertGate({
    symbol: "SOLUSDT",
    event: "EXIT_TP_P1_3P",
    issues: ["TP1_FILL_PROJECTION_MISSING"],
    nowMs: 3000,
  });
  assert.strictEqual(immediateAlertThird.send, true);
  assert.strictEqual(immediateAlertThird.repeatCount, 3);

  const pickIntentForTrade = __test && __test.pickIntentForTrade;
  assert.strictEqual(typeof pickIntentForTrade, "function", "pickIntentForTrade export missing");
  const trade = {
    symbol: "SOLUSDT",
    side: "SELL",
    time: Date.parse("2026-03-04T01:42:26.074Z"),
  };
  const intents = [
    {
      exchange: "BINANCEFUT",
      symbol_or_pair_id: "SOLUSDT",
      side: "SELL",
      scheduled_exec_bar_close_time_utc_ms: Date.parse("2026-03-04T01:42:30.906Z"),
      created_at: "2026-03-04T01:42:31.448Z", // trade 이후 생성 → 매칭 제외되어야 함
      intent_id: "late_intent",
    },
    {
      exchange: "BINANCEFUT",
      symbol_or_pair_id: "SOLUSDT",
      side: "SELL",
      scheduled_exec_bar_close_time_utc_ms: Date.parse("2026-03-04T01:42:00.000Z"),
      created_at: "2026-03-04T01:41:59.000Z",
      intent_id: "valid_intent",
    },
  ];
  const picked = pickIntentForTrade(trade, intents, 2 * 60 * 60 * 1000, 3000);
  assert.ok(picked, "intent should be matched");
  assert.strictEqual(picked.intent_id, "valid_intent");

  const resolveExternalExitEvent = __test && __test.resolveExternalExitEvent;
  const inferStageConstrainedTakeProfitKind = __test && __test.inferStageConstrainedTakeProfitKind;
  assert.strictEqual(typeof resolveExternalExitEvent, "function", "resolveExternalExitEvent export missing");
  assert.strictEqual(typeof inferStageConstrainedTakeProfitKind, "function", "inferStageConstrainedTakeProfitKind export missing");
  const rules = { SL: -0.015, TP_P1: 0.03, TRAIL_PCT: 0.01 };

  assert.strictEqual(
    inferStageConstrainedTakeProfitKind({ tpP0Done: false, tpP1Done: false, trailActive: false }, null),
    "TP0"
  );
  assert.strictEqual(
    inferStageConstrainedTakeProfitKind({ tpP0Done: true, tpP1Done: false, trailActive: false }, null),
    "TP1"
  );
  assert.strictEqual(
    inferStageConstrainedTakeProfitKind({ tpP0Done: true, tpP1Done: true, trailActive: true }, "TP1"),
    null
  );

  const overridden = await resolveExternalExitEvent({
    intent: { event: "EXIT_TP_P1_3P" },
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 123, orderType: "MARKET", closePosition: true, reduceOnly: true },
    positionCtx: { trailActive: false },
    rules,
  });
  assert.strictEqual(overridden, "EXIT_EXTERNAL_SYNC");

  const nativeSl = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "SOLUSDT", realizedPnl: -10 },
    orderMeta: { orderId: 126, orderType: "STOP_MARKET", closePosition: true, reduceOnly: true, clientOrderId: "dbj_stop" },
    positionCtx: { trailActive: false },
    rules,
  });
  assert.strictEqual(nativeSl, "EXIT_SL_1.5P");

  const nativeTrail = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 127, orderType: "TAKE_PROFIT_MARKET", closePosition: true, reduceOnly: true, clientOrderId: "dbj_tp" },
    positionCtx: { trailActive: true, tpP1Done: true },
    rules,
  });
  assert.strictEqual(nativeTrail, "EXIT_TRAIL_1P");

  const trailViaRecentTp1 = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 12701, orderType: "TAKE_PROFIT_MARKET", closePosition: true, reduceOnly: true, clientOrderId: "native_trail_recent" },
    positionCtx: { trailActive: false, tpP1Done: false },
    recentTp1: { event: "EXIT_TP_P1_3P", orderId: 555 },
    rules,
  });
  assert.strictEqual(trailViaRecentTp1, "EXIT_TRAIL_1P");

  const noTp1NoTrail = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 1271, orderType: "TAKE_PROFIT_MARKET", closePosition: true, reduceOnly: true, clientOrderId: "dbj_tp" },
    positionCtx: { trailActive: true, tpP1Done: false },
    rules,
  });
  assert.strictEqual(noTp1NoTrail, "EXIT_TP_P1_3P");

  const inferredTp0 = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 1272, orderType: "TAKE_PROFIT_MARKET", closePosition: false, reduceOnly: true, clientOrderId: "native_x" },
    positionCtx: { trailActive: false, tpP1Done: false },
    rules: { SL: -0.015, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.03, TP_P1_QTY: 0.5, TRAIL_PCT: 0.01 },
    qtyPct: 0.25,
  });
  assert.strictEqual(inferredTp0, "EXIT_TP_P0_0.8P");

  const inferredTp1 = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 1273, orderType: "TAKE_PROFIT_MARKET", closePosition: false, reduceOnly: true, clientOrderId: "native_y" },
    positionCtx: { trailActive: false, tpP1Done: false },
    rules: { SL: -0.015, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.03, TP_P1_QTY: 0.5, TRAIL_PCT: 0.01 },
    qtyPct: 0.5,
  });
  assert.strictEqual(inferredTp1, "EXIT_TP_P1_3P");

  const stageFallbackTp0 = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 1274, orderType: "TAKE_PROFIT_MARKET", closePosition: false, reduceOnly: true, clientOrderId: "native_z" },
    positionCtx: { trailActive: false, tpP0Done: false, tpP1Done: false },
    rules: { SL: -0.015, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.03, TP_P1_QTY: 0.5, TRAIL_PCT: 0.01 },
    qtyPct: null,
  });
  assert.strictEqual(stageFallbackTp0, "EXIT_TP_P0_0.8P");

  const stageFallbackTp1 = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 1275, orderType: "TAKE_PROFIT_MARKET", closePosition: false, reduceOnly: true, clientOrderId: "native_k" },
    positionCtx: { trailActive: false, tpP0Done: true, tpP1Done: false },
    rules: { SL: -0.015, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.03, TP_P1_QTY: 0.5, TRAIL_PCT: 0.01 },
    qtyPct: null,
  });
  assert.strictEqual(stageFallbackTp1, "EXIT_TP_P1_3P");

  process.env.BINANCE_NATIVE_TP_ENABLED = "0";
  const nativeTrackedMarketStop = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "BTCUSDT", realizedPnl: -11.014 },
    orderMeta: { orderId: 128, orderType: "MARKET", closePosition: true, reduceOnly: true, clientOrderId: "dbj_native_stop" },
    positionCtx: { trailActive: false },
    rules,
  });
  assert.strictEqual(nativeTrackedMarketStop, "EXIT_SL_1.5P");

  const addRefreshSl = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "BNBUSDT", realizedPnl: -4.25, time: Date.parse("2026-03-11T00:01:10Z") },
    orderMeta: { orderId: 129, orderType: "MARKET", closePosition: true, reduceOnly: true, clientOrderId: null },
    positionCtx: {
      trailActive: false,
      nativeProtectionStale: true,
      nativeProtectionRefreshStatus: "FAILED",
      nativeProtectionRefreshContext: "ADD",
      nativeProtectionRefreshAtMs: Date.parse("2026-03-11T00:00:30Z"),
    },
    rules,
  });
  assert.strictEqual(addRefreshSl, "EXIT_SL_1.5P");

  const addRefreshOkShouldNotReclassify = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "BNBUSDT", realizedPnl: -4.25, time: Date.parse("2026-03-11T00:01:10Z") },
    orderMeta: { orderId: 130, orderType: "MARKET", closePosition: true, reduceOnly: true, clientOrderId: null },
    positionCtx: {
      trailActive: false,
      nativeProtectionStale: false,
      nativeProtectionRefreshStatus: "OK",
      nativeProtectionRefreshContext: "ADD",
      nativeProtectionRefreshAtMs: Date.parse("2026-03-11T00:00:30Z"),
    },
    rules,
  });
  assert.strictEqual(addRefreshOkShouldNotReclassify, "EXIT_EXTERNAL_SYNC");

  const tp1ByIntent = await resolveExternalExitEvent({
    intent: { event: "EXIT_TP_P1_3P" },
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 124, orderType: "MARKET", closePosition: false, reduceOnly: true },
    positionCtx: { trailActive: false },
    rules,
  });
  assert.strictEqual(tp1ByIntent, "EXIT_TP_P1_3P");

  const staleTp0IntentMustYieldTp1 = await resolveExternalExitEvent({
    intent: { event: "EXIT_TP_P0_0.8P" },
    trade: { symbol: "XRPUSDT", realizedPnl: 8.181, time: Date.parse("2026-04-10T08:00:00Z") },
    orderMeta: { orderId: 777001, orderType: "TAKE_PROFIT_MARKET", closePosition: false, reduceOnly: true, clientOrderId: "dbj_tp1_live" },
    positionCtx: {
      trailActive: false,
      tpP0Done: true,
      tpP1Done: false,
      nativeProtectionTpOrderId: 777001,
      nativeProtectionTp0OrderId: 777000,
    },
    rules: { SL: -0.0165, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.0165, TP_P1_QTY: 0.75, TRAIL_R_MULTIPLE: 0.6, BE_PCT: 0.0015 },
    qtyPct: 0.75,
  });
  assert.strictEqual(staleTp0IntentMustYieldTp1, "EXIT_TP_P1_1.65P");

  const staleTp0IntentMustYieldTp1ByStage = await resolveExternalExitEvent({
    intent: { event: "EXIT_TP_P0_0.8P" },
    trade: { symbol: "XRPUSDT", realizedPnl: 8.181, time: Date.parse("2026-04-10T08:00:00Z") },
    orderMeta: { orderId: 777101, orderType: "TAKE_PROFIT_MARKET", closePosition: false, reduceOnly: true, clientOrderId: "dbj_tp1_stage" },
    positionCtx: {
      trailActive: false,
      tpP0Done: true,
      tpP1Done: false,
    },
    rules: { SL: -0.0165, TP_P0: 0.008, TP_P0_QTY: 0.25, TP_P1: 0.0165, TP_P1_QTY: 0.75, TRAIL_R_MULTIPLE: 0.6, BE_PCT: 0.0015 },
    qtyPct: 0.75,
  });
  assert.strictEqual(staleTp0IntentMustYieldTp1ByStage, "EXIT_TP_P1_1.65P");

  const syntheticTimeStop = await resolveExternalExitEvent({
    intent: { event: "EXIT_TIME_STOP_18B" },
    trade: { symbol: "SOLUSDT", realizedPnl: -0.018 },
    orderMeta: { orderId: 125, orderType: "MARKET", closePosition: false, reduceOnly: true },
    positionCtx: { trailActive: false },
    rules,
  });
  assert.strictEqual(syntheticTimeStop, "EXIT_EXTERNAL_SYNC");

  console.log("BINANCE_FILLS_QTY_PCT_TEST_OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
