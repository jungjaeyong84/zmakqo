"use strict";

const assert = require("assert");

const { generateV3SourceSignalForSymbol, generateV3SourceSignalsForSymbolWindow, __test } = require("../v3/rawSignalGenerator");

function makeBullBars({ count = 260, start = 100, drift = 0.25, intervalMs = 900000, startTime = 1778400000000 }) {
  const bars = [];
  let price = start;
  let openTime = startTime;
  for (let index = 0; index < count; index += 1) {
    const open = price;
    price = price + drift + (index % 5 === 0 ? 0.05 : -0.02);
    const close = price;
    bars.push([
      openTime,
      String(open),
      String(Math.max(open, close) + 0.15),
      String(Math.min(open, close) - 0.12),
      String(close),
      String(1000 + ((index % 7) * 50)),
      openTime + intervalMs - 1,
    ]);
    openTime += intervalMs;
  }
  return bars;
}

function makeBearShortBars({ intervalMs = 900000 } = {}) {
  const bars = [];
  let openTime = 1778400000000;
  let price = 100;
  for (let index = 0; index < 200; index += 1) {
    const open = price;
    price -= 0.18;
    const close = price;
    bars.push([
      openTime,
      String(open),
      String(open + 0.08),
      String(close - 0.18),
      String(close),
      String(1000 + ((index % 7) * 70)),
      openTime + intervalMs - 1,
    ]);
    openTime += intervalMs;
  }
  for (let index = 0; index < 60; index += 1) {
    const open = price;
    price -= 0.35;
    const close = price;
    bars.push([
      openTime,
      String(open),
      String(open + 0.08),
      String(close - 0.18),
      String(close),
      String(1200 + ((index % 7) * 90)),
      openTime + intervalMs - 1,
    ]);
    openTime += intervalMs;
  }
  return bars;
}

function makeBull1hBars({ count = 260, start = 100, startTime = 1778400000000 }) {
  return makeBullBars({ count, start, drift: 0.8, intervalMs: 3600000, startTime });
}

function makeBearShort1hBars() {
  const bars = [];
  let openTime = 1778400000000;
  let price = 100;
  for (let index = 0; index < 160; index += 1) {
    const open = price;
    price -= 0.5;
    const close = price;
    bars.push([
      openTime,
      String(open),
      String(open + 0.2),
      String(close - 0.3),
      String(close),
      "5000",
      openTime + 3600000 - 1,
    ]);
    openTime += 3600000;
  }
  for (let index = 0; index < 100; index += 1) {
    const open = price;
    price -= 0.45;
    const close = price;
    bars.push([
      openTime,
      String(open),
      String(open + 0.2),
      String(close - 0.25),
      String(close),
      "5200",
      openTime + 3600000 - 1,
    ]);
    openTime += 3600000;
  }
  return bars;
}

(() => {
  const bars15m = makeBullBars({});
  const bars1h = makeBull1hBars({ startTime: 1777800000000 });
  const result = generateV3SourceSignalForSymbol({
    symbol: "TESTUSDT",
    bars15m,
    bars1h,
    marketMeta: {
      spread_bps: 1.25,
      funding_rate: 0.0001,
    },
    nowMs: Number(bars1h[bars1h.length - 1][6]) + 1000,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.signal.side, "BUY");
  assert.strictEqual(result.verdict.profile_id, "LONG_MC_TREND_MARGINAL_CORE");
  assert.strictEqual(result.signal.features_json.spread_bps, 1.25);
  assert.strictEqual(result.signal.features_json.funding_rate, 0.0001);
  assert.strictEqual(result.signal.features_json.btc_1h_trend, "LONG");
  assert.strictEqual(result.signal.features_json.mtf_1h_direction, "LONG");
})();

(() => {
  const bars15m = makeBullBars({});
  const bars1h = makeBull1hBars({ startTime: 1777800000000 });
  const extra15 = [...bars15m, [
    Number(bars15m[bars15m.length - 1][0]) + 900000,
    "200",
    "201",
    "199",
    "200.5",
    "1200",
    Number(bars15m[bars15m.length - 1][6]) + 900000,
  ]];
  const extra1h = [...bars1h, [
    Number(bars1h[bars1h.length - 1][0]) + 3600000,
    "300",
    "301",
    "299",
    "300.5",
    "5200",
    Number(bars1h[bars1h.length - 1][6]) + 3600000,
  ]];
  const nowMs = Number(bars15m[bars15m.length - 1][6]) + 1000;
  const result = generateV3SourceSignalForSymbol({
    symbol: "TESTUSDT",
    bars15m: extra15,
    bars1h: extra1h,
    marketMeta: {
      spread_bps: 1.25,
      funding_rate: 0.0001,
    },
    nowMs,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.signal.created_at, new Date(Number(bars15m[bars15m.length - 1][6])).toISOString());
  assert.notStrictEqual(result.signal.created_at, new Date(Number(extra15[extra15.length - 1][6])).toISOString());
})();

(() => {
  const bars15m = makeBearShortBars();
  const bars1h = makeBearShort1hBars();
  const result = generateV3SourceSignalForSymbol({
    symbol: "TESTUSDT",
    bars15m,
    bars1h,
    marketMeta: {
      spread_bps: 1.75,
      funding_rate: -0.0002,
    },
    nowMs: Number(bars1h[bars1h.length - 1][6]) + 1000,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.signal.side, "SELL");
  assert.strictEqual(result.verdict.profile_id, "SHORT_MC_TREND_MARGINAL_CORE");
  assert.strictEqual(result.signal.features_json.setup_type, "CONTINUATION");
  assert.strictEqual(result.signal.features_json.market_state, "BEAR");
  assert.strictEqual(result.signal.features_json.htf_bias, "BEAR");
  assert.strictEqual(result.signal.features_json.spread_bps, 1.75);
  assert.strictEqual(result.signal.features_json.funding_rate, -0.0002);
})();

(() => {
  const bars15m = makeBullBars({});
  const bars1h = makeBull1hBars({ startTime: 1777800000000 });
  const firstCloseMs = Number(bars15m[bars15m.length - 2][6]);
  const secondCloseMs = Number(bars15m[bars15m.length - 1][6]);
  const manualFirst = generateV3SourceSignalForSymbol({
    symbol: "TESTUSDT",
    bars15m: bars15m.slice(0, bars15m.length - 1),
    bars1h,
    marketMeta: {
      spread_bps: 1.25,
      funding_rate: 0.0001,
    },
    nowMs: firstCloseMs + 1,
  });
  const manualSecond = generateV3SourceSignalForSymbol({
    symbol: "TESTUSDT",
    bars15m,
    bars1h,
    marketMeta: {
      spread_bps: 1.25,
      funding_rate: 0.0001,
    },
    nowMs: secondCloseMs + 1,
  });
  const window = generateV3SourceSignalsForSymbolWindow({
    symbol: "TESTUSDT",
    bars15m,
    bars1h,
    marketMeta: {
      spread_bps: 1.25,
      funding_rate: 0.0001,
    },
    nowMs: secondCloseMs + 1,
    sinceCreatedAt: new Date(Number(bars15m[bars15m.length - 3][6])).toISOString(),
  });
  const manualSignals = [manualFirst, manualSecond]
    .filter((row) => row && row.ok && row.signal)
    .map((row) => row.signal.signal_id);
  assert.strictEqual(window.evaluated_bar_n, 2);
  assert.deepStrictEqual(window.signals.map((row) => row.signal_id), manualSignals);
})();

(() => {
  const candidates = __test.generateCandidates({
    symbol: "TESTUSDT",
    close_time_ms: 1778400000000,
    created_at: "2026-05-11T00:00:00.000Z",
    close: 105,
    high: 105.2,
    low: 104.5,
    prev_close: 104.7,
    prev10High: 104.9,
    prev10Low: 103.8,
    ema20: 104.2,
    ema50: 103.6,
    ema200: 101.4,
    atr14: 0.8,
    close_pos_long: 0.6,
    close_pos_short: 0.2,
    trend_strength: 0.01,
    breakout_atr: 0.04,
    breakdown_atr: -1.2,
    volume_ratio: 0.95,
    market_state: "BULL",
    htf_bias: "BULL",
    btc_1h_trend: "LONG",
    mtf_1h_direction: "LONG",
    spread_bps: 1.1,
    funding_rate: 0.00001,
  });
  const continuationRows = candidates.filter((row) => row.features_json && row.features_json.setup_type === "CONTINUATION");
  assert.strictEqual(continuationRows.length, 0);
})();

console.log("v3-raw-signal-generator.test.js PASS");
