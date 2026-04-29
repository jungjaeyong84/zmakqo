"use strict";

// 2026-04-29 P1-1.9 — futures exit-profile mode helper tests.
//
// Two helpers extracted from paperBinanceRunner.js (lines 3206,
// 3211) into src/utils/futuresExitProfileMode.js. The pre-existing
// integration test live-exit-profile-config.test.js continues to
// exercise the runner-internal call sites; this file pins the
// contract at the unit level.

const assert = require("assert");

delete require.cache[require.resolve("../utils/futuresExitProfileMode")];
const {
  normalizeFuturesExitProfileMode,
  resolveConfiguredFuturesExitProfileMode,
} = require("../utils/futuresExitProfileMode");

// ── (A) normalizeFuturesExitProfileMode ────────────────────────
(function testNormalize() {
  // Recognized inputs.
  assert.strictEqual(normalizeFuturesExitProfileMode("BASE"), "BASE", "(A1) BASE");
  assert.strictEqual(normalizeFuturesExitProfileMode("AGGRESSIVE"), "AGGRESSIVE", "(A2) AGGRESSIVE");
  assert.strictEqual(normalizeFuturesExitProfileMode("base"), "BASE", "(A3) lowercase normalized");
  assert.strictEqual(normalizeFuturesExitProfileMode("  Aggressive  "), "AGGRESSIVE", "(A4) trim + case");
  // Unknown → fallback (default BASE).
  assert.strictEqual(normalizeFuturesExitProfileMode("PORTFOLIO"), "BASE", "(A5) unknown → default");
  assert.strictEqual(normalizeFuturesExitProfileMode(""), "BASE", "(A6) empty → default");
  assert.strictEqual(normalizeFuturesExitProfileMode(null), "BASE", "(A7) null → default");
  // Custom fallback.
  assert.strictEqual(normalizeFuturesExitProfileMode("X", "AGGRESSIVE"), "AGGRESSIVE",
    "(A8) custom fallback");
  // Fallback itself is normalized.
  assert.strictEqual(normalizeFuturesExitProfileMode("X", "  base  "), "BASE",
    "(A9) fallback trim + uppercase");
  // Empty fallback collapses to BASE sentinel.
  assert.strictEqual(normalizeFuturesExitProfileMode("X", ""), "BASE",
    "(A10) empty fallback → BASE");
  assert.strictEqual(normalizeFuturesExitProfileMode("X", null), "BASE",
    "(A11) null fallback → BASE");
})();

// ── (B) resolveConfiguredFuturesExitProfileMode ────────────────
(function testResolveConfigured() {
  // Empty raw + null fallback → null sentinel.
  assert.strictEqual(resolveConfiguredFuturesExitProfileMode(""), null,
    "(B1) empty raw + default null fallback → null");
  assert.strictEqual(resolveConfiguredFuturesExitProfileMode(null), null,
    "(B2) null raw → null");
  assert.strictEqual(resolveConfiguredFuturesExitProfileMode(undefined), null,
    "(B3) undefined raw → null");
  // Empty raw + explicit fallback → normalized fallback.
  assert.strictEqual(
    resolveConfiguredFuturesExitProfileMode("", "AGGRESSIVE"),
    "AGGRESSIVE",
    "(B4) empty raw + explicit fallback → fallback normalized"
  );
  assert.strictEqual(
    resolveConfiguredFuturesExitProfileMode("", "garbage"),
    "BASE",
    "(B5) empty raw + garbage fallback → BASE (collapsed via inner normalize)"
  );
  // Non-empty raw → normalize(raw).
  assert.strictEqual(
    resolveConfiguredFuturesExitProfileMode("AGGRESSIVE"),
    "AGGRESSIVE",
    "(B6) raw=AGGRESSIVE"
  );
  assert.strictEqual(
    resolveConfiguredFuturesExitProfileMode("aggressive"),
    "AGGRESSIVE",
    "(B7) raw lowercase normalized"
  );
  assert.strictEqual(
    resolveConfiguredFuturesExitProfileMode("garbage"),
    "BASE",
    "(B8) raw garbage + null fallback → BASE (inner default)"
  );
  // Non-empty raw + explicit fallback → fallback used only when raw unrecognized.
  assert.strictEqual(
    resolveConfiguredFuturesExitProfileMode("garbage", "AGGRESSIVE"),
    "AGGRESSIVE",
    "(B9) garbage raw + explicit fallback → fallback"
  );
  assert.strictEqual(
    resolveConfiguredFuturesExitProfileMode("BASE", "AGGRESSIVE"),
    "BASE",
    "(B10) recognized raw wins over fallback"
  );
})();

// ── (C) paperBinanceRunner __test re-exports ──────────────────
(function testPaperRunnerReExports() {
  delete require.cache[require.resolve("../engine/paperBinanceRunner")];
  const { __test: paperTest } = require("../engine/paperBinanceRunner");
  assert.strictEqual(paperTest.resolveConfiguredFuturesExitProfileMode,
    resolveConfiguredFuturesExitProfileMode,
    "(C1) same ref for resolveConfiguredFuturesExitProfileMode");
})();

console.log("FUTURES_EXIT_PROFILE_MODE_TEST_OK");
