"use strict";

// 2026-04-18 P1-1: shared constant for the single authorized writer of
// Binance native stop protection.
//
// Background: `paperBinanceRunner.isAuthorizedBinanceNativeStopWriter`
// gates which code path may place / cancel native STOP_MARKET orders on
// Binance. The invariant is "only the tick-exit authority layer can
// write native stops"; every other layer must delegate through the
// exit-repair queue. That invariant was expressed as two independent
// string literals — the check inside `isAuthorizedBinanceNativeStopWriter`
// and the literal passed as `writerSource` when the delegating runner
// calls `refreshDirect`. If one string was ever renamed without the
// other, the authority check would silently fail-open or fail-closed
// without a test catching it.
//
// This module is the single source of truth. Every layer that needs the
// writer-source identifier must import `BINANCE_NATIVE_STOP_WRITER_SOURCE`
// from here.
//
// The concrete value is preserved verbatim (`BINANCE_TICK_EXIT`) so
// there is no behavior change — only a locked-in shared identifier.

const BINANCE_NATIVE_STOP_WRITER_SOURCE = "BINANCE_TICK_EXIT";

function isBinanceNativeStopWriterSource(value) {
  return String(value || "").trim().toUpperCase() === BINANCE_NATIVE_STOP_WRITER_SOURCE;
}

module.exports = {
  BINANCE_NATIVE_STOP_WRITER_SOURCE,
  isBinanceNativeStopWriterSource,
};
