"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

function run() {
  const explicit = __test.resolveLiveOrderSignalRefs({
    signalId: "SIG__BINANCEFUT__ETHUSDT__15m__1776281400000__EXIT_TP_P1_1.65P",
    signalDocId: "SIG__BINANCEFUT__ETHUSDT__15m__1776281400000__EXIT_TP_P1_1.65P",
    entryEventId: "ENTRY__BINANCEFUT__ETHUSDT__15m__1776263400000__LONG",
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    tf: "15m",
    barCloseMs: 1776281400000,
    event: "EXIT_TP_P1_1.65P",
  });
  assert.deepStrictEqual(explicit, {
    signalId: "SIG__BINANCEFUT__ETHUSDT__15m__1776281400000__EXIT_TP_P1_1.65P",
    signalDocId: "SIG__BINANCEFUT__ETHUSDT__15m__1776281400000__EXIT_TP_P1_1.65P",
    entryEventId: "ENTRY__BINANCEFUT__ETHUSDT__15m__1776263400000__LONG",
  });

  const fallback = __test.resolveLiveOrderSignalRefs({
    features: {
      signal_id: "SIG__BINANCEFUT__BTCUSDT__15m__1770000000000__EXIT_TP_P1_1.65P",
      entry_event_id: "ENTRY__BINANCEFUT__BTCUSDT__15m__1769999100000__LONG",
    },
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    tf: "15m",
    barCloseMs: 1770000000000,
    event: "EXIT_TP_P1_1.65P",
  });
  assert.strictEqual(
    fallback.signalId,
    "SIG__BINANCEFUT__BTCUSDT__15m__1770000000000__EXIT_TP_P1_1.65P"
  );
  assert.strictEqual(
    fallback.signalDocId,
    "SIG__BINANCEFUT__BTCUSDT__15m__1770000000000__EXIT_TP_P1_1.65P"
  );
  assert.strictEqual(
    fallback.entryEventId,
    "ENTRY__BINANCEFUT__BTCUSDT__15m__1769999100000__LONG"
  );

  console.log("LIVE_ORDER_SIGNAL_REFS_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("LIVE_ORDER_SIGNAL_REFS_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
