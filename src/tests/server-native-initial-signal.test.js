"use strict";

const assert = require("assert");
const { buildServerNativeInitialSignals, HTF_TF, minBaseBarsForDerivedHtf, __test } = require("../services/serverNativeInitialSignal");

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

function buildLongBullBars(totalBars = 960) {
  const bars = [];
  let p = 100;
  for (let i = 0; i < totalBars; i += 1) {
    const open = p;
    const close = p + 0.05 + (i % 11 === 0 ? 0.02 : 0);
    const high = Math.max(open, close) + 0.04;
    const low = Math.min(open, close) - 0.03;
    bars.push({ open, high, low, close, volume: 900 + (i * 2), closeTimeUtcMs: 900000 * (i + 1) });
    p = close - 0.01;
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

function buildHistoricalSignalBars() {
  const bars = buildBullBars();
  let p = bars.at(-1).close;
  for (let i = 0; i < 12; i += 1) {
    const open = p;
    const close = p + (i % 2 === 0 ? 0.004 : -0.004);
    const high = Math.max(open, close) + 0.01;
    const low = Math.min(open, close) - 0.01;
    bars.push({ open, high, low, close, volume: 420, closeTimeUtcMs: 900000 * (121 + i) });
    p = close;
  }
  return bars;
}

function buildMixedTrendBars() {
  const bars = [];
  let p = 300;
  for (let i = 0; i < 900; i += 1) {
    const open = p;
    const close = p - 0.12;
    const high = Math.max(open, close) + 0.03;
    const low = Math.min(open, close) - 0.04;
    bars.push({ open, high, low, close, volume: 900, closeTimeUtcMs: 900000 * (i + 1) });
    p = close + 0.01;
  }
  for (let i = 900; i < 2200; i += 1) {
    const open = p;
    const close = p + 0.10;
    const high = Math.max(open, close) + 0.04;
    const low = Math.min(open, close) - 0.03;
    bars.push({ open, high, low, close, volume: 1100, closeTimeUtcMs: 900000 * (i + 1) });
    p = close - 0.01;
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
  assert.strictEqual(bullSignals[0].features.htf_mode, "PINE_PARITY");
  assert.strictEqual(bullSignals[0].features.htf_bias, "BULL");
  assert.strictEqual(bullSignals[0].features.htf_bias_pine_parity, "BULL");
  assert.strictEqual(bullSignals[0].features.htf_bias_full_history, "BULL");

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

  const longBullBars = buildLongBullBars(minBaseBarsForDerivedHtf({ sourceTf: "15m" }));
  const derivedHtfBars = __test.deriveHigherTimeframeBars({
    bars: longBullBars,
    sourceTf: "15m",
    targetTf: HTF_TF,
  });
  assert(derivedHtfBars.length >= 55);
  assert.strictEqual(__test.resolveHtfBias(derivedHtfBars, derivedHtfBars.at(-1).timestamp), "BULL");

  const fallbackBiasBars = __test.resolveEffectiveHtfBars({
    bars: longBullBars,
    htfBars: [],
    tf: "15m",
  });
  assert(fallbackBiasBars.length >= 55);

  const alignedBias = __test.buildAlignedDerivedHtfBiasSeries({
    bars: longBullBars,
    sourceTf: "15m",
  });
  assert(alignedBias.effectiveBarCount >= 55);
  assert.strictEqual(alignedBias.biasByIndex.at(-1), "BULL");

  const mixedTrendBars = buildMixedTrendBars();
  const limitedMixedBars = __test.limitSourceBarsForDerivedHtf(mixedTrendBars);
  assert.strictEqual(limitedMixedBars.length, 1200);
  const mixedAlignedBias = __test.buildAlignedDerivedHtfBiasSeries({
    bars: mixedTrendBars,
    sourceTf: "15m",
  });
  assert.strictEqual(mixedAlignedBias.biasByIndex.length, mixedTrendBars.length);
  assert.strictEqual(mixedAlignedBias.biasByIndex.at(-1), "BULL");
  const mixedFullBias = __test.buildAlignedDerivedHtfBiasSeries({
    bars: mixedTrendBars,
    sourceTf: "15m",
    maxSourceBars: null,
  });
  assert.strictEqual(mixedFullBias.biasByIndex.at(-1), "BULL");

  const historicalBars = buildHistoricalSignalBars();
  const historicalTargetBarMs = buildBullBars().at(-1).closeTimeUtcMs;
  const historicalSignals = buildServerNativeInitialSignals({
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    tf: "15m",
    bars: historicalBars,
    htfBars: buildBullHtfBars(),
    barCloseMs: historicalTargetBarMs,
  });
  assert.strictEqual(historicalSignals.length, 1);
  assert.strictEqual(historicalSignals[0].event, "LONG");

  console.log("SERVER_NATIVE_INITIAL_SIGNAL_TEST_OK");
})();
