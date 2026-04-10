"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceUserDataStream");
const { __test: fillsSyncTest } = require("../services/binanceFuturesFillsSync");

(async () => {
  __test.clearRecentSyncMark("XRPUSDT");
  __test.clearRecentSyncMark("BTCUSDT");
  assert.strictEqual(__test.buildUserDataStreamUrl("abc123"), `${__test.resolveUserDataStreamBaseUrl()}/abc123`);

  assert.deepStrictEqual(
    __test.extractSymbolsFromUserDataEvent({ e: "ORDER_TRADE_UPDATE", o: { s: "DOGEUSDT" } }),
    ["DOGEUSDT"]
  );

  assert.deepStrictEqual(
    __test.extractSymbolsFromUserDataEvent({ e: "ACCOUNT_UPDATE", a: { P: [{ s: "BTCUSDT" }, { s: "ETHUSDT" }, { s: "BTCUSDT" }] } }),
    ["BTCUSDT", "ETHUSDT"]
  );

  assert.strictEqual(
    __test.isTradeExecutionUpdate({ e: "ORDER_TRADE_UPDATE", o: { x: "TRADE" } }),
    true
  );
  assert.strictEqual(
    __test.isTradeExecutionUpdate({ e: "ORDER_TRADE_UPDATE", o: { x: "NEW" } }),
    false
  );

  const syncCalls = [];
  const fillCalls = [];
  const handled = await __test.handleUserDataMessage(
    JSON.stringify({ e: "ORDER_TRADE_UPDATE", o: { s: "XRPUSDT", x: "TRADE" } }),
    {
      syncPosition: async (args) => {
        syncCalls.push(args);
        return { ok: true, position: { symbol_or_pair_id: args.symbol } };
      },
      syncFills: async (args) => {
        fillCalls.push(args);
        return { ok: true, results: [{ symbol: args.markets[0], inserted: 1 }] };
      },
    }
  );
  assert.strictEqual(handled.ok, true);
  assert.strictEqual(fillCalls.length, 1);
  assert.strictEqual(syncCalls.length, 1);
  assert.strictEqual(syncCalls[0].symbol, "XRPUSDT");

  const accountHandled = await __test.handleUserDataMessage(
    JSON.stringify({ e: "ACCOUNT_UPDATE", a: { P: [{ s: "SOLUSDT" }] } }),
    {
      syncPosition: async (args) => ({ ok: true, position: { symbol_or_pair_id: args.symbol } }),
      syncFills: async () => {
        throw new Error("ACCOUNT_UPDATE should not trigger fills sync");
      },
    }
  );
  assert.strictEqual(accountHandled.ok, true);
  assert.strictEqual(accountHandled.tradeExecution, false);

  const retryCalls = [];
  const firstFailure = await __test.handleUserDataMessage(
    JSON.stringify({ e: "ORDER_TRADE_UPDATE", o: { s: "BTCUSDT", x: "TRADE" } }),
    {
      syncPosition: async (args) => {
        retryCalls.push({ phase: "position", symbol: args.symbol });
        throw new Error("temporary sync failure");
      },
      syncFills: async (args) => {
        retryCalls.push({ phase: "fills", symbol: args.markets[0] });
        return { ok: true };
      },
    }
  );
  assert.strictEqual(firstFailure.results[0].ok, false, "first failed user-stream sync should surface as failed");

  const secondAttempt = await __test.handleUserDataMessage(
    JSON.stringify({ e: "ORDER_TRADE_UPDATE", o: { s: "BTCUSDT", x: "TRADE" } }),
    {
      syncPosition: async (args) => {
        retryCalls.push({ phase: "position-retry", symbol: args.symbol });
        return { ok: true, position: { symbol_or_pair_id: args.symbol } };
      },
      syncFills: async (args) => {
        retryCalls.push({ phase: "fills-retry", symbol: args.markets[0] });
        return { ok: true };
      },
    }
  );
  assert.strictEqual(secondAttempt.results[0].ok, true, "failed dedupe mark must be cleared so immediate retry can run");
  assert.deepStrictEqual(
    retryCalls.map((row) => row.phase),
    ["fills", "position", "fills-retry", "position-retry"],
    "failed user-stream sync should not suppress the immediate retry"
  );

  const issues = fillsSyncTest.buildImmediateProjectionIssues({
    event: "EXIT_TP_P0_0.8P",
    position: { meta: { tp_p0_done: false, native_protection_refresh_status: "OK" } },
  });
  assert.deepStrictEqual(issues, ["TP0_FILL_PROJECTION_MISSING"]);

  console.log("BINANCE_USER_DATA_STREAM_TEST_OK");
})().catch((err) => {
  console.error(err && err.stack ? err.stack : err);
  process.exit(1);
});
