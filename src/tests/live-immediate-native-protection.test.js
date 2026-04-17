"use strict";

const assert = require("assert");
const paperRunner = require("../engine/paperBinanceRunner");

async function run() {
  assert.ok(paperRunner.__test, "__test export missing");

  const requestCalls = [];
  const refreshCalls = [];
  const openingResult = await paperRunner.__test.ensureLiveImmediateNativeProtection({
    liveCfg: { liveDryRun: false },
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    requestArgs: {
      fallbackSide: "BUY",
      fallbackEntryPrice: 70000,
      fallbackLeverage: 2,
      exitRulesOverride: { TP_P1: 0.0165, TP_P1_QTY: 0.5, SL: -0.0165 },
      posMeta: { position_side: "LONG" },
    },
    opening: true,
    closing: false,
    remainingQtyBase: null,
    intent: "ENTRY",
    requestRepair: async (payload) => {
      requestCalls.push(payload);
      return { ok: false, skipped: true, reason: "REPAIR_REQUESTED_NON_AUTHORITY_LAYER", request_id: "REQ1", dispatch_ok: false };
    },
    refreshDirect: async (payload) => {
      refreshCalls.push(payload);
      return { ok: true, stop_order_id: "STOP1", tp_order_id: "TP1" };
    },
  });

  assert.strictEqual(requestCalls.length, 1, "opening flow must still record a repair request");
  assert.strictEqual(requestCalls[0].dispatchExitWorker, false, "opening flow must not depend on async worker dispatch");
  assert.strictEqual(requestCalls[0].executeImmediately, false, "opening flow must keep request path audit-only");
  assert.strictEqual(refreshCalls.length, 1, "opening flow must directly refresh native protection");
  assert.strictEqual(refreshCalls[0].writerSource, "BINANCE_TICK_EXIT", "direct refresh must use authority writer source");
  assert.strictEqual(openingResult.ok, true);
  assert.strictEqual(openingResult.immediate_authority_refresh, true);
  assert.strictEqual(openingResult.queued_request_id, "REQ1");

  requestCalls.length = 0;
  refreshCalls.length = 0;

  const exitResult = await paperRunner.__test.ensureLiveImmediateNativeProtection({
    liveCfg: { liveDryRun: false },
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    requestArgs: {
      fallbackSide: "BUY",
      fallbackEntryPrice: 70000,
      fallbackLeverage: 2,
      exitRulesOverride: { TP_P1: 0.0165, TP_P1_QTY: 0.5, SL: -0.0165 },
      posMeta: { position_side: "LONG" },
    },
    opening: false,
    closing: false,
    remainingQtyBase: 0.01,
    intent: "EXIT",
    requestRepair: async (payload) => {
      requestCalls.push(payload);
      return { ok: false, skipped: true, reason: "REPAIR_REQUESTED_NON_AUTHORITY_LAYER", request_id: "REQ2", dispatch_ok: true };
    },
    refreshDirect: async (payload) => {
      refreshCalls.push(payload);
      return { ok: true, stop_order_id: "STOP2" };
    },
  });

  assert.strictEqual(requestCalls.length, 1, "non-immediate flow must queue a repair request");
  assert.strictEqual(requestCalls[0].dispatchExitWorker, true, "non-immediate flow keeps worker dispatch");
  assert.strictEqual(refreshCalls.length, 0, "non-immediate flow must not direct-write native protection");
  assert.strictEqual(exitResult.request_id, "REQ2");

  console.log("LIVE_IMMEDIATE_NATIVE_PROTECTION_TEST_OK");
}

run().catch((err) => {
  console.error("LIVE_IMMEDIATE_NATIVE_PROTECTION_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
