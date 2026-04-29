"use strict";

// 2026-04-29 P0-fix-A — TF → Binance interval mapping tests.
//
// Background: production was emitting tf="240m" (or "240") for HTF
// snapshot refreshes which Binance Futures klines rejected with
// code -1120 ("Invalid interval"). The F2 server-native ENTRY
// signal generator's HTF bias classification was silently broken
// for 24h+ before this was caught by P0 production verification.
//
// This test pins:
//   - the minute→hour conversion table (60m→1h, 240m→4h, etc.)
//   - that already-canonical strings pass through (4h, 1d, 1M)
//   - that unknown forms fall through verbatim (loud-fail path)

const assert = require("assert");

delete require.cache[require.resolve("../exchanges/index")];
const { tfToBinanceInterval } = require("../exchanges/index");

// ── (A) minute-only intervals stay as-is ───────────────────────
(function testMinutePassthrough() {
  for (const m of ["1m", "3m", "5m", "15m", "30m"]) {
    assert.strictEqual(tfToBinanceInterval(m), m, `(A) ${m} pass-through`);
  }
})();

// ── (B) minute-bucket aliases → hour bucket ────────────────────
//
// These are the cases that broke production. Pin every one of
// them so any future HTF bump (e.g. switching from 240m to 360m)
// can't silently re-emit a Binance-rejecting interval.
(function testMinuteToHour() {
  assert.strictEqual(tfToBinanceInterval("60m"), "1h", "(B1) 60m → 1h");
  assert.strictEqual(tfToBinanceInterval("120m"), "2h", "(B2) 120m → 2h");
  assert.strictEqual(tfToBinanceInterval("240m"), "4h", "(B3) 240m → 4h ★ HTF");
  assert.strictEqual(tfToBinanceInterval("360m"), "6h", "(B4) 360m → 6h");
  assert.strictEqual(tfToBinanceInterval("480m"), "8h", "(B5) 480m → 8h");
  assert.strictEqual(tfToBinanceInterval("720m"), "12h", "(B6) 720m → 12h");
  assert.strictEqual(tfToBinanceInterval("1440m"), "1d", "(B7) 1440m → 1d");
})();

// ── (C) already-canonical hour intervals pass through ──────────
(function testHourPassthrough() {
  for (const h of ["1h", "2h", "4h", "6h", "8h", "12h"]) {
    assert.strictEqual(tfToBinanceInterval(h), h, `(C) ${h} pass-through`);
  }
})();

// ── (D) day/week/month intervals pass through ──────────────────
(function testDayWeekMonth() {
  for (const d of ["1d", "3d", "1w", "1M"]) {
    assert.strictEqual(tfToBinanceInterval(d), d, `(D) ${d} pass-through`);
  }
})();

// ── (E) unknown forms fall through verbatim (loud-fail path) ───
//
// The function intentionally does NOT silently coerce or default.
// If a future caller passes an unknown form, we want Binance to
// reject it with -1120 so the bug is visible in production logs
// instead of producing empty bars + silent strategy degradation.
(function testUnknownFallthrough() {
  assert.strictEqual(tfToBinanceInterval("90m"), "90m", "(E1) 90m unknown → fall through");
  assert.strictEqual(tfToBinanceInterval("garbage"), "garbage", "(E2) garbage → fall through");
  assert.strictEqual(tfToBinanceInterval(""), "", "(E3) empty → fall through");
})();

// ── (F) integration: fetchCandles uses the mapping ─────────────
//
// We don't actually call fetchCandles (it would hit the network)
// but verify the export shape so callers can rely on the same
// helper for tf normalization without re-implementing the table
// (i.e. so we don't end up with another copy-paste sibling).
(function testExports() {
  const exch = require("../exchanges/index");
  assert.strictEqual(typeof exch.tfToBinanceInterval, "function",
    "(F1) tfToBinanceInterval is exported");
  assert.strictEqual(typeof exch.fetchCandles, "function",
    "(F2) fetchCandles still exported");
})();

console.log("TF_TO_BINANCE_INTERVAL_TEST_OK");
