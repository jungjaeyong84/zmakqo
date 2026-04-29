"use strict";

// 2026-04-29 P1-1.11 — alert-payload number-format extraction tests.
//
// Three formatters extracted from paperBinanceRunner.js (lines
// 1602, 1610, 1618) into src/utils/alertNumberFormat.js. Pin the
// downstream alert-template contract (output shapes consumed by
// telegram/slack templates).

const assert = require("assert");

delete require.cache[require.resolve("../utils/alertNumberFormat")];
const {
  formatAlertNumber,
  formatRatioPctToken,
  formatExitRulesCompactLocal,
} = require("../utils/alertNumberFormat");

// ── (A) formatAlertNumber ──────────────────────────────────────
(function testNumber() {
  // Auto-precision by magnitude.
  assert.strictEqual(formatAlertNumber(12345.6789), "12345.68", "(A1) ≥1000 → 2dp");
  assert.strictEqual(formatAlertNumber(123.456789), "123.457", "(A2) ≥100 → 3dp");
  assert.strictEqual(formatAlertNumber(1.23456789), "1.2346", "(A3) ≥1 → 4dp");
  assert.strictEqual(formatAlertNumber(0.00012345), "0.000123", "(A4) <1 → digits param (default 6)");
  // Custom digits.
  assert.strictEqual(formatAlertNumber(0.00012345, 8), "0.00012345", "(A5) custom digits");
  // Negative numbers — magnitude bucketing uses abs.
  assert.strictEqual(formatAlertNumber(-12345.6789), "-12345.68", "(A6) negative ≥1000");
  // Trailing zero stripped.
  assert.strictEqual(formatAlertNumber(1.5), "1.5", "(A7) trailing zeros stripped");
  assert.strictEqual(formatAlertNumber(1), "1", "(A8) integer with stripped trailing dot");
  assert.strictEqual(formatAlertNumber(1.0), "1", "(A9) explicit zero stripped");
  // Non-finite → "NA".
  assert.strictEqual(formatAlertNumber(NaN), "NA", "(A10) NaN");
  assert.strictEqual(formatAlertNumber(Infinity), "NA", "(A11) Infinity");
  assert.strictEqual(formatAlertNumber("garbage"), "NA", "(A12) garbage string");
  // null/undefined coerce to 0/NaN respectively (pre-existing
  // behaviour — Number(null) === 0, Number(undefined) === NaN).
  // Pin both so a future Number()-replacement change is forced to
  // make an explicit decision.
  assert.strictEqual(formatAlertNumber(null), "0", "(A13) null coerces to 0 via Number()");
  assert.strictEqual(formatAlertNumber(undefined), "NA", "(A14) undefined coerces to NaN");
  // Numeric strings parse.
  assert.strictEqual(formatAlertNumber("123.456"), "123.456", "(A15) numeric string");
})();

// ── (B) formatRatioPctToken ────────────────────────────────────
(function testRatioPctToken() {
  // Basic conversion (ratio → percent token).
  assert.strictEqual(formatRatioPctToken(0.025), "2.5", "(B1) 0.025 → 2.5");
  assert.strictEqual(formatRatioPctToken(0.1234), "12.34", "(B2) ≥10pct → 2dp");
  // Sign preserved.
  assert.strictEqual(formatRatioPctToken(-0.015), "-1.5", "(B3) negative preserved");
  // abs:true uses unsigned.
  assert.strictEqual(formatRatioPctToken(-0.015, { abs: true }), "1.5", "(B4) abs:true");
  // Trailing zero stripped.
  assert.strictEqual(formatRatioPctToken(0.05), "5", "(B5) 0.05 → '5' (trailing zeros stripped)");
  // Non-finite → null (note: distinct from formatAlertNumber's "NA").
  assert.strictEqual(formatRatioPctToken(NaN), null, "(B6) NaN → null");
  assert.strictEqual(formatRatioPctToken(undefined), null, "(B7) undefined → null");
  assert.strictEqual(formatRatioPctToken("garbage"), null, "(B8) garbage → null");
  // null coerces to 0 via Number() — pre-existing quirk. Pin it
  // explicitly so a future Number()-replacement change is forced
  // to make a decision.
  assert.strictEqual(formatRatioPctToken(null), "0",
    "(B9) null coerces to 0 via Number() (pre-existing quirk)");
})();

// ── (C) formatExitRulesCompactLocal ────────────────────────────
(function testExitRulesCompact() {
  // Full rule set.
  assert.strictEqual(
    formatExitRulesCompactLocal({
      SL: -0.015,
      TP_P1: 0.03,
      TRAIL_R_MULTIPLE: 2,
      RUNNER_MIN_PROFIT_PCT: 0.005,
      BE_PCT: 0.004,
    }),
    "SL_1.5 / TP1_3 / TRAIL_2R / RUNNER_MIN_0.5 / BE_0.4",
    "(C1) full rule set canonical render"
  );
  // SL is rendered abs (polarity already in label).
  assert.strictEqual(
    formatExitRulesCompactLocal({ SL: -0.02 }),
    "SL_2",
    "(C2) SL polarity stripped via abs:true"
  );
  // TRAIL fallback to TRAIL_PCT when TRAIL_R_MULTIPLE missing.
  assert.strictEqual(
    formatExitRulesCompactLocal({ TRAIL_PCT: 0.01 }),
    "TRAIL_1",
    "(C3) TRAIL_PCT fallback when no R multiple"
  );
  // Non-finite TRAIL_R_MULTIPLE falls back to TRAIL_PCT.
  assert.strictEqual(
    formatExitRulesCompactLocal({ TRAIL_R_MULTIPLE: NaN, TRAIL_PCT: 0.012 }),
    "TRAIL_1.2",
    "(C4) NaN R multiple → TRAIL_PCT"
  );
  // R-multiple integer rendered without decimal.
  assert.strictEqual(
    formatExitRulesCompactLocal({ TRAIL_R_MULTIPLE: 1.5 }),
    "TRAIL_1.5R",
    "(C5) fractional R preserved"
  );
  // Empty rules → null.
  assert.strictEqual(formatExitRulesCompactLocal({}), null, "(C6) empty → null");
  assert.strictEqual(formatExitRulesCompactLocal(null), null, "(C7) null input");
  assert.strictEqual(formatExitRulesCompactLocal("not-an-object"), null, "(C8) string input");
})();

// ── (D) paperBinanceRunner internal binding ───────────────────
(function testRunnerLoads() {
  delete require.cache[require.resolve("../engine/paperBinanceRunner")];
  const runner = require("../engine/paperBinanceRunner");
  assert.ok(runner && typeof runner === "object",
    "(D1) paperBinanceRunner still loads after alertNumberFormat extraction");
})();

console.log("ALERT_NUMBER_FORMAT_TEST_OK");
