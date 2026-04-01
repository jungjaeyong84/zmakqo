"use strict";

const assert = require("assert");
const { buildServerNativeInitialSignals } = require("../services/serverNativeInitialSignal");

function buildBullBars() {
  const bars = [];
  let p = 100;
  for (let i = 0; i < 100; i += 1) {
    const open = p;
    const close = p + 0.08 + (i % 7 === 0 ? 0.02 : 0);
    const high = Math.max(open, close) + 0.06;
    const low = Math.min(open, close) - 0.05;
    bars.push({ open, high, low, close, volume: 1000 + (i * 6), closeTimeUtcMs: 900000 * (i + 1) });
    p = close - 0.03;
  }
  for (let i = 100; i < 119; i += 1) {
    const open = p + (i % 2 === 0 ? -0.06 : 0.03);
    const close = p + (i % 3 === 0 ? 0.02 : -0.01);
    const high = Math.max(open, close) + 0.04;
    const low = Math.min(open, close) - 0.04;
    bars.push({ open, high, low, close, volume: 1100 + (i * 5), closeTimeUtcMs: 900000 * (i + 1) });
    p = close;
  }
  const recentHigh = Math.max(...bars.slice(-5).map((bar) => bar.high));
  const open = p - 0.02;
  const close = recentHigh + 0.05;
  const high = close + 0.03;
  const low = open - 0.03;
  bars.push({ open, high, low, close, volume: 2600, closeTimeUtcMs: 900000 * 120 });
  return bars;
}

function buildBullHtfBars() {
  const bars = [];
  let p = 95;
  for (let i = 0; i < 40; i += 1) {
    const open = p;
    const close = p + 0.6;
    const high = close + 0.15;
    const low = open - 0.1;
    bars.push({ open, high, low, close, volume: 3000, closeTimeUtcMs: 14400000 * (i + 1) });
    p = close - 0.02;
  }
  return bars;
}

function buildFlatBars() {
  const bars = [];
  let p = 100;
  for (let i = 0; i < 120; i += 1) {
    const open = p;
    const close = p + (i % 2 === 0 ? 0.01 : -0.01);
    const high = Math.max(open, close) + 0.03;
    const low = Math.min(open, close) - 0.03;
    bars.push({ open, high, low, close, volume: 500, closeTimeUtcMs: 900000 * (i + 1) });
    p = close;
  }
  return bars;
}

(() => {
  const bullBars = buildBullBars();
  const bullSignals = buildServerNativeInitialSignals({
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    tf: "15m",
    bars: bullBars,
    htfBars: buildBullHtfBars(),
    barCloseMs: bullBars.at(-1).closeTimeUtcMs,
  });
  assert.strictEqual(bullSignals.length, 1);
  assert.strictEqual(bullSignals[0].event, "LONG");
  assert.strictEqual(bullSignals[0].features.entry_grade, "CORE");
  assert.strictEqual(bullSignals[0].features.server_native_initial_signal, true);
  assert.strictEqual(bullSignals[0].features.canonical_engine_candidate_source, "SERVER_NATIVE");

  const flatBars = buildFlatBars();
  const flatSignals = buildServerNativeInitialSignals({
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    tf: "15m",
    bars: flatBars,
    htfBars: buildBullHtfBars(),
    barCloseMs: flatBars.at(-1).closeTimeUtcMs,
  });
  assert.deepStrictEqual(flatSignals, []);

  console.log("SERVER_NATIVE_INITIAL_SIGNAL_TEST_OK");
})();
