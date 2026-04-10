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

  __test.clearRecentSyncMark("ETHUSDT");
  const rapidFillCalls = [];
  const firstRapid = await __test.handleUserDataMessage(
    JSON.stringify({ e: "ORDER_TRADE_UPDATE", E: 1710000000001, o: { s: "ETHUSDT", x: "TRADE", i: 11, t: 101 } }),
    {
      syncPosition: async (args) => {
        rapidFillCalls.push(`position:${args.symbol}:101`);
        return { ok: true, position: { symbol_or_pair_id: args.symbol } };
      },
      syncFills: async (args) => {
        rapidFillCalls.push(`fills:${args.markets[0]}:101`);
        return { ok: true };
      },
    }
  );
  const secondRapid = await __test.handleUserDataMessage(
    JSON.stringify({ e: "ORDER_TRADE_UPDATE", E: 1710000000002, o: { s: "ETHUSDT", x: "TRADE", i: 11, t: 102 } }),
    {
      syncPosition: async (args) => {
        rapidFillCalls.push(`position:${args.symbol}:102`);
        return { ok: true, position: { symbol_or_pair_id: args.symbol } };
      },
      syncFills: async (args) => {
        rapidFillCalls.push(`fills:${args.markets[0]}:102`);
        return { ok: true };
      },
    }
  );
  assert.strictEqual(firstRapid.results[0].ok, true);
  assert.strictEqual(secondRapid.results[0].ok, true);
  assert.deepStrictEqual(
    rapidFillCalls,
    ["fills:ETHUSDT:101", "position:ETHUSDT:101", "fills:ETHUSDT:102", "position:ETHUSDT:102"],
    "distinct rapid fills on the same symbol should not be dropped by dedupe"
  );
  assert.strictEqual(
    __test.buildEventSyncDedupeKey(
      { e: "ORDER_TRADE_UPDATE", E: 1710000001234, o: { s: "XLMUSDT", i: 99, t: 123, x: "TRADE" } },
      "XLMUSDT"
    ),
    "ORDER_TRADE_UPDATE:XLMUSDT:99:123:1710000001234"
  );
  assert.strictEqual(
    __test.shouldRetryUserStreamConnectResult({ ok: false, skipped: true, reason: "LEASE_HELD" }),
    true
  );
  assert.deepStrictEqual(
    __test.normalizeUserStreamStartResult({ ok: false, skipped: true, reason: "LEASE_HELD", holder: "leader-1" }),
    { ok: true, waiting: true, reason: "LEASE_WAITING", holder: "leader-1" }
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
