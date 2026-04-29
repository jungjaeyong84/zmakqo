"use strict";

// 2026-04-29 P1-1.7 — Binance margin-type helper extraction tests.
//
// Three margin-type helpers extracted from paperBinanceRunner.js
// (lines 3175, 3181, 3193) into src/utils/binanceMarginType.js
// with no behavioural change. Pre-existing integration test
// margin-type-multi-assets-fallback.test.js continues to exercise
// the runner-internal call sites; this file pins the contract at
// the unit level.

const assert = require("assert");

delete require.cache[require.resolve("../utils/binanceMarginType")];
const {
  normalizeFuturesMarginType,
  isBinanceMultiAssetsIsolatedMarginBlocked,
  isBinanceMarginTypeOpenOrdersConflict,
} = require("../utils/binanceMarginType");

// ── (A) normalizeFuturesMarginType ─────────────────────────────
(function testNormalize() {
  assert.strictEqual(normalizeFuturesMarginType("ISOLATED"), "ISOLATED", "(A1) ISOLATED");
  assert.strictEqual(normalizeFuturesMarginType("CROSSED"), "CROSSED", "(A2) CROSSED");
  assert.strictEqual(normalizeFuturesMarginType("isolated"), "ISOLATED", "(A3) lowercase normalized");
  assert.strictEqual(normalizeFuturesMarginType("  Crossed  "), "CROSSED", "(A4) trim + case");
  // Unknown → fallback (default ISOLATED).
  assert.strictEqual(normalizeFuturesMarginType("PORTFOLIO"), "ISOLATED", "(A5) unknown → default");
  assert.strictEqual(normalizeFuturesMarginType(""), "ISOLATED", "(A6) empty → default");
  assert.strictEqual(normalizeFuturesMarginType(null), "ISOLATED", "(A7) null → default");
  // Custom fallback.
  assert.strictEqual(normalizeFuturesMarginType("X", "CROSSED"), "CROSSED", "(A8) custom fallback");
  // Empty fallback string passes through (caller responsibility).
  assert.strictEqual(normalizeFuturesMarginType("X", ""), "", "(A9) empty fallback passed through");
})();

// ── (B) isBinanceMultiAssetsIsolatedMarginBlocked ──────────────
(function testMultiAssetsBlocked() {
  // Numeric code match.
  assert.strictEqual(
    isBinanceMultiAssetsIsolatedMarginBlocked({ code: -4168 }, "ISOLATED"),
    true,
    "(B1) -4168 numeric code"
  );
  // Body substring match.
  assert.strictEqual(
    isBinanceMultiAssetsIsolatedMarginBlocked({ body: "errcode -4168 something" }, "ISOLATED"),
    true,
    "(B2) -4168 substring in body"
  );
  // Message regex match.
  assert.strictEqual(
    isBinanceMultiAssetsIsolatedMarginBlocked({
      message: "Unable to adjust to isolated-margin mode under the Multi-Assets mode."
    }, "ISOLATED"),
    true,
    "(B3) canonical English error message"
  );
  // Only fires when caller wanted ISOLATED.
  assert.strictEqual(
    isBinanceMultiAssetsIsolatedMarginBlocked({ code: -4168 }, "CROSSED"),
    false,
    "(B4) CROSSED + -4168 → false (the predicate is ISOLATED-specific)"
  );
  // Unrelated error → false.
  assert.strictEqual(
    isBinanceMultiAssetsIsolatedMarginBlocked({ code: -1234, message: "other" }, "ISOLATED"),
    false,
    "(B5) unrelated error → false"
  );
  // Null/undefined errors handled.
  assert.strictEqual(
    isBinanceMultiAssetsIsolatedMarginBlocked(null, "ISOLATED"),
    false,
    "(B6) null error → false"
  );
})();

// ── (C) isBinanceMarginTypeOpenOrdersConflict ──────────────────
(function testOpenOrdersConflict() {
  // Numeric code match.
  assert.strictEqual(
    isBinanceMarginTypeOpenOrdersConflict({ code: -4067 }),
    true,
    "(C1) -4067 numeric code"
  );
  // Body substring.
  assert.strictEqual(
    isBinanceMarginTypeOpenOrdersConflict({ body: "binance: -4067 conflict" }),
    true,
    "(C2) -4067 substring"
  );
  // Canonical English message.
  assert.strictEqual(
    isBinanceMarginTypeOpenOrdersConflict({
      message: "Margin type cannot be changed if there exists open orders."
    }),
    true,
    "(C3) canonical message"
  );
  // Generic "open orders" catch-all (per existing fallthrough).
  assert.strictEqual(
    isBinanceMarginTypeOpenOrdersConflict({ message: "rejected: open orders present" }),
    true,
    "(C4) generic 'open orders' substring matches (legacy fallback)"
  );
  // Unrelated error.
  assert.strictEqual(
    isBinanceMarginTypeOpenOrdersConflict({ code: -1234, message: "other" }),
    false,
    "(C5) unrelated error → false"
  );
  assert.strictEqual(isBinanceMarginTypeOpenOrdersConflict(null), false, "(C6) null → false");
  assert.strictEqual(isBinanceMarginTypeOpenOrdersConflict({}), false, "(C7) empty err → false");
})();

// ── (D) paperBinanceRunner __test re-exports ──────────────────
(function testPaperRunnerReExports() {
  delete require.cache[require.resolve("../engine/paperBinanceRunner")];
  const { __test: paperTest } = require("../engine/paperBinanceRunner");
  // Identity — runner must re-export the SAME refs.
  assert.strictEqual(paperTest.isBinanceMultiAssetsIsolatedMarginBlocked,
    isBinanceMultiAssetsIsolatedMarginBlocked,
    "(D1) same ref for isBinanceMultiAssetsIsolatedMarginBlocked");
  assert.strictEqual(paperTest.isBinanceMarginTypeOpenOrdersConflict,
    isBinanceMarginTypeOpenOrdersConflict,
    "(D2) same ref for isBinanceMarginTypeOpenOrdersConflict");
})();

console.log("BINANCE_MARGIN_TYPE_TEST_OK");
