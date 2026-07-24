"use strict";

// Tests for the 2026-07-24 additions: funding-carry monitor pure logic and
// the maker-first entry helpers (cost engineering).

const assert = require("assert");
const { computeTrailingFundingApy, decideHotSymbols } = require("../v3/fundingMonitor");
const { __test: exec } = require("../v3/liveExecutor");

const NOW = Date.parse("2026-07-24T00:00:00.000Z");
const H8 = 8 * 3600 * 1000;

// ---- computeTrailingFundingApy ---------------------------------------------
(() => {
  // 21 events over 7d at +0.01% each → sum 0.21% / 7d → APY ≈ 10.95%
  const rows = Array.from({ length: 21 }, (_, i) => ({ fundingTime: NOW - i * H8, fundingRate: 0.0001 }));
  const m = computeTrailingFundingApy(rows, 7, NOW);
  assert.strictEqual(m.events, 21);
  assert.ok(Math.abs(m.apy_pct - 10.95) < 0.1, `expected ~10.95, got ${m.apy_pct}`);
  assert.strictEqual(m.negative_events, 0);
  // old events outside the window are excluded
  const stale = Array.from({ length: 21 }, (_, i) => ({ fundingTime: NOW - (10 * 24 * 3600 * 1000) - i * H8, fundingRate: 0.01 }));
  assert.strictEqual(computeTrailingFundingApy(stale, 7, NOW).events, 0);
})();

// ---- decideHotSymbols: threshold + coverage guard ---------------------------
(() => {
  const per = {
    HOT1: { apy_pct: 22.0, events: 21, negative_events: 0 },
    COLD: { apy_pct: 5.0, events: 21, negative_events: 3 },
    // huge APY but only 4 events in 7d — a data gap must not fake a spike
    GAPPY: { apy_pct: 80.0, events: 4, negative_events: 0 },
    NULLY: { apy_pct: null, events: 0, negative_events: 0 },
  };
  const hot = decideHotSymbols(per, { alertApyPct: 15, windowDays: 7 });
  assert.deepStrictEqual(hot.map((h) => h.symbol), ["HOT1"]);
})();

// ---- maker helpers ----------------------------------------------------------
(() => {
  // BUY joins the bid, SELL joins the ask
  const bt = { bidPrice: "100.1", askPrice: "100.2" };
  assert.strictEqual(exec.pickMakerPrice({ orderSide: "BUY", bookTicker: bt }), 100.1);
  assert.strictEqual(exec.pickMakerPrice({ orderSide: "SELL", bookTicker: bt }), 100.2);
  assert.strictEqual(exec.pickMakerPrice({ orderSide: "BUY", bookTicker: {} }), null);
  assert.strictEqual(exec.pickMakerPrice({ orderSide: "X", bookTicker: bt }), null);
  // wait clamp
  const prev = process.env.V3_LIVE_MAKER_WAIT_MS;
  try {
    delete process.env.V3_LIVE_MAKER_WAIT_MS;
    assert.strictEqual(exec.resolveMakerWaitMs(), 5000);
    process.env.V3_LIVE_MAKER_WAIT_MS = "100";
    assert.strictEqual(exec.resolveMakerWaitMs(), 1000, "clamped up");
    process.env.V3_LIVE_MAKER_WAIT_MS = "999999";
    assert.strictEqual(exec.resolveMakerWaitMs(), 30000, "clamped down");
  } finally {
    if (prev === undefined) delete process.env.V3_LIVE_MAKER_WAIT_MS; else process.env.V3_LIVE_MAKER_WAIT_MS = prev;
  }
  // maker-first defaults ON, "0" disables
  const prevM = process.env.V3_LIVE_MAKER_FIRST;
  try {
    delete process.env.V3_LIVE_MAKER_FIRST;
    assert.strictEqual(exec.resolveMakerFirstEnabled(), true);
    process.env.V3_LIVE_MAKER_FIRST = "0";
    assert.strictEqual(exec.resolveMakerFirstEnabled(), false);
  } finally {
    if (prevM === undefined) delete process.env.V3_LIVE_MAKER_FIRST; else process.env.V3_LIVE_MAKER_FIRST = prevM;
  }
})();

console.log("v3-funding-and-maker.test.js PASS");
