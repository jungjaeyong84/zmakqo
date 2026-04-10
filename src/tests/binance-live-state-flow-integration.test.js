"use strict";

const assert = require("assert");
const { __test: userStreamTest } = require("../services/binanceUserDataStream");
const { reconcileBinancePositionMetaWithExchange } = require("../services/binancePositionReconciler");
const { __test: selfHealTest } = require("../services/binanceLiveStateSelfHeal");
const { __test: tickExitTest } = require("../services/binanceTickExit");
const { __test: runnerTest } = require("../engine/paperUpbitRunner");

(async () => {
  userStreamTest.clearRecentSyncMark("BNBUSDT");
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

  const retryCalls = [];
  const failedFirstPass = await userStreamTest.handleUserDataMessage(
    JSON.stringify({ e: "ORDER_TRADE_UPDATE", o: { s: "BNBUSDT", x: "TRADE" } }),
    {
      syncFills: async (args) => {
        retryCalls.push({ fn: "fills", symbol: args.markets[0] });
        return { ok: true };
      },
      syncPosition: async (args) => {
        retryCalls.push({ fn: "position", symbol: args.symbol });
        throw new Error("temporary sync failure");
      },
    }
  );
  assert.strictEqual(failedFirstPass.results[0].ok, false, "first BNB user-stream pass should fail in test");

  const retryPass = await userStreamTest.handleUserDataMessage(
    JSON.stringify({ e: "ORDER_TRADE_UPDATE", o: { s: "BNBUSDT", x: "TRADE" } }),
    {
      syncFills: async (args) => {
        retryCalls.push({ fn: "fills-retry", symbol: args.markets[0] });
        return { ok: true };
      },
      syncPosition: async (args) => {
        retryCalls.push({ fn: "position-retry", symbol: args.symbol });
        return { ok: true, position: { symbol_or_pair_id: args.symbol } };
      },
    }
  );
  assert.strictEqual(retryPass.results[0].ok, true, "failed user-stream pass must allow immediate retry");
  assert.deepStrictEqual(
    retryCalls.map((row) => row.fn),
    ["fills", "position", "fills-retry", "position-retry"],
    "retry flow should preserve fills->position ordering after failure"
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

  const recentExternalFlatGuard = runnerTest.resolveRecentExternalFlatSyncGuard({
    active: false,
    prevActive: true,
    prevPos: {
      updated_at: "2026-04-10T05:30:20.000Z",
    },
    prevMeta: {
      intent: "ENTRY",
      native_protection_refresh_status: "OK",
      native_protection_refresh_at_ms: Date.now() - 5_000,
      last_fill_intent: "ENTRY",
    },
    nowMs: Date.now(),
    graceMs: 30_000,
  });
  assert.strictEqual(recentExternalFlatGuard.defer, true, "recent entry-like external flat should defer immediate flatten projection");
  assert.strictEqual(recentExternalFlatGuard.reason, "RECENT_ENTRY_GRACE");

  assert.strictEqual(
    runnerTest.shouldCleanupExternalFlatOrders({
      active: false,
      prevActive: true,
      liveCfg: {
        apiKey: "key",
        apiSecret: "secret",
      },
    }),
    true,
    "external flat should cleanup open orders when live credentials exist"
  );

  assert.strictEqual(
    runnerTest.shouldCleanupExternalFlatOrders({
      active: false,
      prevActive: true,
      liveCfg: null,
    }),
    false,
    "external flat cleanup should not run without live credentials"
  );

  console.log("BINANCE_LIVE_STATE_FLOW_INTEGRATION_TEST_OK");
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
