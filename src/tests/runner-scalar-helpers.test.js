"use strict";

// 2026-04-29 P1-1.13 — runner small scalar/list/symbol helper
// extraction tests.
//
// Three small pure helpers extracted from paperBinanceRunner.js
// (lines 1585, 1606, 1840) into src/utils/runnerScalarHelpers.js.
// Cohesion is intentionally weak — see module header.

const assert = require("assert");

delete require.cache[require.resolve("../utils/runnerScalarHelpers")];
const {
  pickMarketOverride,
  parseUpperList,
  normalizeFuturesSymbolKey,
} = require("../utils/runnerScalarHelpers");

// ── (A) pickMarketOverride ─────────────────────────────────────
(function testPick() {
  // Symbol present.
  assert.strictEqual(
    pickMarketOverride({ BTCUSDT: 5 }, "BTCUSDT", 1),
    5,
    "(A1) symbol hit"
  );
  // Symbol coerced to number.
  assert.strictEqual(
    pickMarketOverride({ BTCUSDT: "7" }, "BTCUSDT", 1),
    7,
    "(A2) string value coerced via Number()"
  );
  // Symbol missing → fallback.
  assert.strictEqual(
    pickMarketOverride({ BTCUSDT: 5 }, "ETHUSDT", 2),
    2,
    "(A3) symbol miss → fallback"
  );
  // Null map → fallback.
  assert.strictEqual(pickMarketOverride(null, "BTCUSDT", 3), 3, "(A4) null map");
  assert.strictEqual(pickMarketOverride(undefined, "BTCUSDT", 3), 3, "(A5) undefined map");
  // Non-object map → fallback.
  assert.strictEqual(pickMarketOverride("garbage", "BTCUSDT", 3), 3, "(A6) string map");
  // Empty symbol → fallback.
  assert.strictEqual(
    pickMarketOverride({ "": 5 }, "", 9),
    9,
    "(A7) empty symbol skips lookup → fallback"
  );
  // null map entry → fallback (not 0/NaN).
  assert.strictEqual(
    pickMarketOverride({ BTCUSDT: null }, "BTCUSDT", 1),
    1,
    "(A8) null entry → fallback"
  );
})();

// ── (B) parseUpperList ─────────────────────────────────────────
(function testParseUpperList() {
  // Comma-delimited string.
  assert.deepStrictEqual(
    parseUpperList("a,b,c"),
    ["A", "B", "C"],
    "(B1) comma split + uppercase"
  );
  // Whitespace-delimited.
  assert.deepStrictEqual(
    parseUpperList("a b c"),
    ["A", "B", "C"],
    "(B2) whitespace split"
  );
  // Mixed.
  assert.deepStrictEqual(
    parseUpperList("a, b\nc"),
    ["A", "B", "C"],
    "(B3) mixed delimiters"
  );
  // Array input.
  assert.deepStrictEqual(
    parseUpperList(["a", "b", "C"]),
    ["A", "B", "C"],
    "(B4) array uppercased"
  );
  // CRITICAL: dedup contract — distinct from splitRuntimeList.
  assert.deepStrictEqual(
    parseUpperList(["a", "A", "b", "a"]),
    ["A", "B"],
    "(B5) DEDUPS — pinned distinction from splitRuntimeList (P1-1.6)"
  );
  // Empty entries dropped.
  assert.deepStrictEqual(
    parseUpperList("a,,b,\n,c"),
    ["A", "B", "C"],
    "(B6) drop empty"
  );
  // Null/undefined → fallback (default []).
  assert.deepStrictEqual(parseUpperList(null), [], "(B7) null → default fallback");
  assert.deepStrictEqual(parseUpperList(undefined), [], "(B8) undefined → default");
  // Custom fallback.
  assert.deepStrictEqual(
    parseUpperList(null, ["x", "y"]),
    ["X", "Y"],
    "(B9) null + fallback array"
  );
})();

// ── (C) normalizeFuturesSymbolKey ──────────────────────────────
(function testNormalizeSymbol() {
  // Strip .P perpetual suffix.
  assert.strictEqual(
    normalizeFuturesSymbolKey("BTCUSDT.P"),
    "BTCUSDT",
    "(C1) .P stripped"
  );
  // Already canonical.
  assert.strictEqual(
    normalizeFuturesSymbolKey("BTCUSDT"),
    "BTCUSDT",
    "(C2) already canonical"
  );
  // Case + trim.
  assert.strictEqual(
    normalizeFuturesSymbolKey("  btcusdt.p  "),
    "BTCUSDT",
    "(C3) trim + uppercase + strip"
  );
  // Empty/null returns empty string (NOT null) — usable as
  // Firestore doc-id without null-guard.
  assert.strictEqual(
    normalizeFuturesSymbolKey(""),
    "",
    "(C4) empty → empty string (NOT null)"
  );
  assert.strictEqual(
    normalizeFuturesSymbolKey(null),
    "",
    "(C5) null → empty string"
  );
  assert.strictEqual(
    normalizeFuturesSymbolKey(undefined),
    "",
    "(C6) undefined → empty string"
  );
  // Only strips terminal .P, not embedded.
  assert.strictEqual(
    normalizeFuturesSymbolKey("BTC.PUSDT"),
    "BTC.PUSDT",
    "(C7) only terminal .P stripped"
  );
})();

// ── (D) paperBinanceRunner internal binding ───────────────────
(function testRunnerLoads() {
  delete require.cache[require.resolve("../engine/paperBinanceRunner")];
  const runner = require("../engine/paperBinanceRunner");
  assert.ok(runner && typeof runner === "object",
    "(D1) paperBinanceRunner still loads after runnerScalarHelpers extraction");
})();

console.log("RUNNER_SCALAR_HELPERS_TEST_OK");
