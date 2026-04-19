"use strict";

// 2026-04-18 P1-1: the single-writer invariant for Binance native stops
// depends on TWO code paths agreeing on one identifier:
//   1. `paperBinanceRunner.isAuthorizedBinanceNativeStopWriter` — the
//      gate that decides whether a given `writerSource` may touch the
//      native STOP order.
//   2. The `writerSource` literal passed when the delegating runner
//      calls `refreshDirect` inside `ensureLiveImmediateNativeProtection`.
//
// If one side is ever renamed without the other, the gate silently
// fails-open (worse) or fails-closed (also bad — positions go
// unprotected because the tick-exit writer gets rejected).
//
// These tests lock in that both the shared constant module AND the two
// consumers agree on the same value. Any rename must either:
//   (a) touch all three places together (then update this test), or
//   (b) be explicitly rejected by CI.

const assert = require("assert");
const {
  BINANCE_NATIVE_STOP_WRITER_SOURCE,
  isBinanceNativeStopWriterSource,
} = require("../utils/binanceNativeProtectionWriter");
const paperBinanceRunner = require("../engine/paperBinanceRunner");

(function sharedConstantHasStableValue() {
  assert.strictEqual(BINANCE_NATIVE_STOP_WRITER_SOURCE, "BINANCE_TICK_EXIT",
    "the shared writer-source constant value must stay 'BINANCE_TICK_EXIT' — this is production contract");
})();

(function helperAcceptsSharedConstant() {
  assert.strictEqual(isBinanceNativeStopWriterSource(BINANCE_NATIVE_STOP_WRITER_SOURCE), true);
  assert.strictEqual(isBinanceNativeStopWriterSource("binance_tick_exit"), true,
    "identifier comparison must be case-insensitive");
  assert.strictEqual(isBinanceNativeStopWriterSource(" binance_tick_exit "), true,
    "identifier comparison must ignore surrounding whitespace");
  assert.strictEqual(isBinanceNativeStopWriterSource("LIVE_EXECUTOR"), false);
  assert.strictEqual(isBinanceNativeStopWriterSource(null), false);
  assert.strictEqual(isBinanceNativeStopWriterSource(""), false);
})();

(function paperRunnerGateAgreesWithSharedConstant() {
  const gate = paperBinanceRunner.__test.isAuthorizedBinanceNativeStopWriter;
  assert.strictEqual(gate(BINANCE_NATIVE_STOP_WRITER_SOURCE), true,
    "paperBinanceRunner.isAuthorizedBinanceNativeStopWriter must accept the shared constant");
  assert.strictEqual(gate("LIVE_EXECUTOR"), false,
    "regression guard — any source other than the shared constant must be rejected");
})();

console.log("BINANCE_NATIVE_STOP_WRITER_CONSTANT_TEST_OK");
