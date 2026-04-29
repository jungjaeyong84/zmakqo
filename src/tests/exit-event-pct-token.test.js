"use strict";

// 2026-04-29 P1-1.18 — exit-event pct-token formatter tests.
//
// Pin the two-pass trailing-zero-stripping regex contract so a
// future simplification can't silently change the token suffix
// (downstream alert routing matches "EXIT_TP_P1_3P" literally).

const assert = require("assert");

delete require.cache[require.resolve("../utils/exitEventPctToken")];
const { ratioToPctTokenLocal } = require("../utils/exitEventPctToken");

// ── (A) basic ratio → pct token ────────────────────────────────
(function testBasic() {
  // 0.03 → "3"
  assert.strictEqual(ratioToPctTokenLocal(0.03), "3", "(A1) 3% integer");
  // 0.015 → "1.5"
  assert.strictEqual(ratioToPctTokenLocal(0.015), "1.5", "(A2) 1.5% one decimal");
  // 0.0125 → "1.25"
  assert.strictEqual(ratioToPctTokenLocal(0.0125), "1.25", "(A3) 1.25% two decimals");
  // 0.05 → "5"
  assert.strictEqual(ratioToPctTokenLocal(0.05), "5", "(A4) 5% integer");
})();

// ── (B) sign / abs ─────────────────────────────────────────────
(function testAbs() {
  // Always unsigned (the SL ratio is negative but the event token
  // is "EXIT_SL_1.5P" not "EXIT_SL_-1.5P").
  assert.strictEqual(ratioToPctTokenLocal(-0.015), "1.5", "(B1) negative → abs");
  assert.strictEqual(ratioToPctTokenLocal(-0.05), "5", "(B2) negative integer → abs");
})();

// ── (C) trailing-zero stripping (two-pass regex contract) ──────
//
// Pre-existing two-regex behaviour: first strip ".00" → "",
// second strip trailing zeros after a non-zero decimal. Pin the
// edge cases that would break under a one-regex simplification.
(function testTrailingZeros() {
  // 0.0150 (literal precision) → "1.5"
  assert.strictEqual(ratioToPctTokenLocal(0.015), "1.5", "(C1) 1.5 strip trailing zero");
  // 0.0105 → "1.05" (NOT "1.5" or "1.05" → "1.5")
  assert.strictEqual(ratioToPctTokenLocal(0.0105), "1.05",
    "(C2) 1.05 — interior zero preserved (regex pass 2 only strips trailing)");
  // 0.025 → "2.5"
  assert.strictEqual(ratioToPctTokenLocal(0.025), "2.5", "(C3) 2.5");
  // 0.001 (rounding to 0.1) → "0.1"
  assert.strictEqual(ratioToPctTokenLocal(0.001), "0.1", "(C4) 0.1");
})();

// ── (D) zero / non-finite → null ───────────────────────────────
(function testNullCases() {
  // Zero is rejected (event "EXIT_TP_P1_0P" makes no sense).
  assert.strictEqual(ratioToPctTokenLocal(0), null, "(D1) 0 → null");
  assert.strictEqual(ratioToPctTokenLocal(-0), null, "(D2) -0 → null");
  // Non-finite.
  assert.strictEqual(ratioToPctTokenLocal(NaN), null, "(D3) NaN");
  assert.strictEqual(ratioToPctTokenLocal(Infinity), null, "(D4) Infinity");
  assert.strictEqual(ratioToPctTokenLocal(-Infinity), null, "(D5) -Infinity");
  // null/undefined → 0 via Math.abs(Number(null)) which is 0 → null branch.
  assert.strictEqual(ratioToPctTokenLocal(null), null, "(D6) null");
  assert.strictEqual(ratioToPctTokenLocal(undefined), null, "(D7) undefined");
  // Non-numeric strings → NaN → null.
  assert.strictEqual(ratioToPctTokenLocal("garbage"), null, "(D8) garbage");
  // Numeric strings parse.
  assert.strictEqual(ratioToPctTokenLocal("0.03"), "3", "(D9) numeric string");
})();

// ── (E) rounding contract ──────────────────────────────────────
(function testRounding() {
  // Math.round at 4dp precision: 0.0124999 rounds to 1.2 (Round
  // half-to-even quirk doesn't bite here).
  // 0.012345 → 1.2345 → 1.23
  assert.strictEqual(ratioToPctTokenLocal(0.012345), "1.23",
    "(E1) Math.round(n*10000)/100 = 2dp");
  // 0.0125 → 1.25
  assert.strictEqual(ratioToPctTokenLocal(0.0125), "1.25",
    "(E2) exact 2dp value");
})();

console.log("EXIT_EVENT_PCT_TOKEN_TEST_OK");
