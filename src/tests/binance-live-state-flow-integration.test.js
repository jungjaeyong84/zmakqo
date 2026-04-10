"use strict";

const assert = require("assert");
const { __test: userStreamTest } = require("../services/binanceUserDataStream");
const { reconcileBinancePositionMetaWithExchange } = require("../services/binancePositionReconciler");
const { __test: selfHealTest } = require("../services/binanceLiveStateSelfHeal");
const { __test: tickExitTest } = require("../services/binanceTickExit");

(async () => {
  const calls = [];
  const handled = await userStreamTest.handleUserDataMessage(
    JSON.stringify({ e: "ORDER_TRADE_UPDATE", o: { s: "DOGEUSDT", x: "TRADE" } }),
    {
      syncFills: async (args) => {
        calls.push({ fn: "fills", args });
        return { ok: true, results: [{ symbol: args.markets[0], inserted: 1 }] };
      },
      syncPosition: async (args) => {
        calls.push({ fn: "position", args });
        return { ok: true, position: { symbol_or_pair_id: args.symbol } };
      },
    }
  );
  assert.strictEqual(handled.ok, true);
  assert.deepStrictEqual(
    calls.map((row) => row.fn),
    ["fills", "position"],
    "user-data trade update should run fills sync before position sync"
  );

  const reconciled = reconcileBinancePositionMetaWithExchange({
    active: true,
    meta: {
      tp_p1_done: true,
      trail_active: true,
      trail_high: 0.101,
      native_protection_refresh_status: "OK",
    },
    positionSide: "LONG",
    qtyBase: 1000,
    entryPrice: 0.1,
    leverage: 2,
    openOrders: [],
    algoOrders: [
      { orderId: "stop-1", type: "STOP_MARKET", side: "SELL", closePosition: true, stopPrice: "0.099" },
      { orderId: "tp0-1", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "0.1008", origQty: "250" },
      { orderId: "tp1-1", type: "TAKE_PROFIT_MARKET", side: "SELL", reduceOnly: true, stopPrice: "0.1016", origQty: "500" },
    ],
  });
  assert.strictEqual(reconciled.meta.native_protection_tp0_order_id, "tp0-1");
  assert.strictEqual(reconciled.meta.native_protection_tp_order_id, "tp1-1");
  assert.ok(reconciled.invariants.includes("TP1_DONE_WITH_TP_ORDER"));

  assert.strictEqual(
    selfHealTest.shouldRepairBinanceLivePosition({
      ...reconciled.meta,
      exchange_projection_invariants: reconciled.invariants,
    }),
    true,
    "self-heal should request repair when reconcile surfaces TP1_DONE_WITH_TP_ORDER"
  );

  let healCalls = 0;
  const skippedHeal = await tickExitTest.runTickExitSelfHealPhase({
    enabled: true,
    leaseHeartbeatOk: false,
    reason: "RACE_TEST",
    runSelfHeal: async () => {
      healCalls += 1;
      return { ok: true };
    },
  });
  assert.strictEqual(skippedHeal.skipped, true);
  assert.strictEqual(skippedHeal.reason, "LEASE_LOST");
  assert.strictEqual(healCalls, 0, "tick-exit must not run self-heal after lease loss");

  const executedHeal = await tickExitTest.runTickExitSelfHealPhase({
    enabled: true,
    leaseHeartbeatOk: true,
    reason: "RACE_TEST",
    maxPositions: 3,
    runSelfHeal: async (args) => {
      healCalls += 1;
      return { ok: true, args };
    },
  });
  assert.strictEqual(executedHeal.ok, true);
  assert.strictEqual(executedHeal.args.exchange, "BINANCEFUT");
  assert.strictEqual(executedHeal.args.reason, "RACE_TEST");
  assert.strictEqual(executedHeal.args.maxPositions, 3);
  assert.strictEqual(healCalls, 1, "tick-exit should run self-heal exactly once when lease is healthy");

  console.log("BINANCE_LIVE_STATE_FLOW_INTEGRATION_TEST_OK");
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
