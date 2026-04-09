const assert = require("assert");
const { __test } = require("../services/binanceFuturesFillsSync");

async function run() {
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
  assert.strictEqual(typeof resolveExternalExitEvent, "function", "resolveExternalExitEvent export missing");
  const rules = { SL: -0.015, TP_P1: 0.03, TRAIL_PCT: 0.01 };

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

  const noTp1NoTrail = await resolveExternalExitEvent({
    intent: null,
    trade: { symbol: "SOLUSDT", realizedPnl: 10 },
    orderMeta: { orderId: 1271, orderType: "TAKE_PROFIT_MARKET", closePosition: true, reduceOnly: true, clientOrderId: "dbj_tp" },
    positionCtx: { trailActive: true, tpP1Done: false },
    rules,
  });
  assert.strictEqual(noTp1NoTrail, "EXIT_TP_P1_3P");

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
