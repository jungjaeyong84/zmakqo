"use strict";

// 2026-04-29 P1-1.1 — bar/TF helper extraction unit tests.
//
// These three helpers used to live inline in
// src/engine/paperBinanceRunner.js. They are extracted to
// src/utils/barTfHelpers.js with no behavioural change. The tests
// below pin the contract from the new module's perspective so a
// future P1-1.x extraction (or any unrelated change in
// barTfHelpers) can't silently regress the behaviour that
// paperBinanceRunner-internal callers, the V2 server-native signal
// generator, and the discovery-canary bridge all depend on.

const assert = require("assert");

delete require.cache[require.resolve("../utils/barTfHelpers")];
const {
  resolveTfFromMs,
  scaleBaseBarCountByTf,
  resolveBinanceMaxHoldBars,
} = require("../utils/barTfHelpers");

// ── (A) resolveTfFromMs ────────────────────────────────────────
(function testResolveTf() {
  assert.strictEqual(resolveTfFromMs(15 * 60 * 1000), "15m", "(A1) 15m round-trip");
  assert.strictEqual(resolveTfFromMs(30 * 60 * 1000), "30m", "(A2) 30m round-trip");
  assert.strictEqual(resolveTfFromMs(60 * 60 * 1000), "60m", "(A3) 60m round-trip");

  assert.strictEqual(resolveTfFromMs(0), null, "(A4) zero ms → null (rejected)");
  assert.strictEqual(resolveTfFromMs(-1), null, "(A5) negative ms → null");
  assert.strictEqual(resolveTfFromMs(NaN), null, "(A6) NaN → null");
  assert.strictEqual(resolveTfFromMs(undefined), null, "(A7) undefined → null");
  assert.strictEqual(resolveTfFromMs("15m"), null, "(A8) string TF label is not the API; only ms input");
  assert.strictEqual(resolveTfFromMs(45 * 60 * 1000), null, "(A9) unsupported TF (45m) → null");
})();

// ── (B) scaleBaseBarCountByTf ──────────────────────────────────
(function testScale() {
  // 60m anchor: 12 bars on 60m → 12 bars on 60m (identity).
  assert.strictEqual(
    scaleBaseBarCountByTf(12, 60 * 60 * 1000),
    12,
    "(B1) 60m identity"
  );
  // 12 bars on 60m → 48 bars on 15m (4× as many).
  assert.strictEqual(
    scaleBaseBarCountByTf(12, 15 * 60 * 1000),
    48,
    "(B2) 60m→15m scales 4×"
  );
  // 12 bars on 60m → 24 bars on 30m (2× as many).
  assert.strictEqual(
    scaleBaseBarCountByTf(12, 30 * 60 * 1000),
    24,
    "(B3) 60m→30m scales 2×"
  );
  // Non-positive base → 0 (the helper's documented "no scaling needed" branch).
  assert.strictEqual(scaleBaseBarCountByTf(0, 15 * 60 * 1000), 0, "(B4) base=0 → 0");
  assert.strictEqual(scaleBaseBarCountByTf(-3, 15 * 60 * 1000), 0, "(B5) base<0 → 0");
  assert.strictEqual(scaleBaseBarCountByTf(NaN, 15 * 60 * 1000), 0, "(B6) base=NaN → 0");
  // Bad signalTfMs falls back to the unscaled base.
  assert.strictEqual(scaleBaseBarCountByTf(12, 0), 12, "(B7) signalTfMs=0 → unscaled");
  assert.strictEqual(scaleBaseBarCountByTf(12, NaN), 12, "(B8) signalTfMs=NaN → unscaled");
  // Floor of 1: scaling that would round below 1 is clamped.
  assert.strictEqual(scaleBaseBarCountByTf(1, 1000 * 60 * 60 * 60), 1,
    "(B9) sub-1 scaled count is clamped to 1");
})();

// ── (C) resolveBinanceMaxHoldBars ──────────────────────────────
//
// Pre-existing edge-case quirk preserved for now (audit follow-up):
// when sysCfg is null/undefined, the helper's `sysCfg &&
// sysCfg.max_hold_bars` short-circuits to that null/undefined, and
// the inner Number(null) coerces to 0 — which Number.isFinite()
// accepts, so the env/default fallback is bypassed and the function
// returns 0 instead of the documented default of 12. In production
// the value of `sysCfg` is always a well-formed object returned by
// `getSystemSettingsForProvider` (it has a default branch), so this
// quirk never reaches the runtime caller. P1-1.1's contract is
// "behaviour-preserving extraction" so we keep the quirk and pin
// the current behaviour here; a separate follow-up commit will fix
// the null-fallthrough.
(function testMaxHold() {
  const prev = process.env.BINANCE_MAX_HOLD_BARS;
  delete process.env.BINANCE_MAX_HOLD_BARS;
  try {
    // sysCfg=null currently returns 0 (see audit note above).
    assert.strictEqual(
      resolveBinanceMaxHoldBars(null, 15 * 60 * 1000),
      0,
      "(C1) null sysCfg currently returns 0 (legacy null-fallthrough quirk preserved by P1-1.1)"
    );
    // sysCfg explicit 24@60m → 96@15m.
    assert.strictEqual(
      resolveBinanceMaxHoldBars({ max_hold_bars: 24 }, 15 * 60 * 1000),
      96,
      "(C2) sysCfg max_hold_bars overrides default"
    );
    // sysCfg with no max_hold_bars → env / hardcoded default applies
    // (this branch hits the well-formed-object code path, so the
    // null-quirk does not bite).
    assert.strictEqual(
      resolveBinanceMaxHoldBars({}, 60 * 60 * 1000),
      12,
      "(C3) sysCfg without max_hold_bars → hardcoded default 12"
    );
    process.env.BINANCE_MAX_HOLD_BARS = "6";
    assert.strictEqual(
      resolveBinanceMaxHoldBars({}, 60 * 60 * 1000),
      6,
      "(C4) BINANCE_MAX_HOLD_BARS env overrides hardcoded default"
    );
    assert.strictEqual(
      resolveBinanceMaxHoldBars({ max_hold_bars: 8 }, 60 * 60 * 1000),
      8,
      "(C5) sysCfg overrides env when present"
    );
  } finally {
    if (prev === undefined) delete process.env.BINANCE_MAX_HOLD_BARS;
    else process.env.BINANCE_MAX_HOLD_BARS = prev;
  }
})();

// ── (D) paperBinanceRunner __test surface still re-exports the
//        same names — back-compat for legacy test files. ─────────
(function testPaperRunnerReExports() {
  delete require.cache[require.resolve("../engine/paperBinanceRunner")];
  const { __test: paperTest } = require("../engine/paperBinanceRunner");
  assert.strictEqual(typeof paperTest.resolveTfFromMs, "function",
    "(D1) paperBinanceRunner.__test still exposes resolveTfFromMs");
  assert.strictEqual(typeof paperTest.scaleBaseBarCountByTf, "function",
    "(D2) paperBinanceRunner.__test still exposes scaleBaseBarCountByTf");
  assert.strictEqual(typeof paperTest.resolveBinanceMaxHoldBars, "function",
    "(D3) paperBinanceRunner.__test still exposes resolveBinanceMaxHoldBars");
  // Identity check — re-exports must point to the new module's
  // function, not a re-implementation.
  assert.strictEqual(paperTest.resolveTfFromMs, resolveTfFromMs,
    "(D4) paperBinanceRunner re-exports the SAME function reference (no fork)");
  assert.strictEqual(paperTest.scaleBaseBarCountByTf, scaleBaseBarCountByTf,
    "(D5) same identity for scaleBaseBarCountByTf");
  assert.strictEqual(paperTest.resolveBinanceMaxHoldBars, resolveBinanceMaxHoldBars,
    "(D6) same identity for resolveBinanceMaxHoldBars");
})();

console.log("BAR_TF_HELPERS_TEST_OK");
