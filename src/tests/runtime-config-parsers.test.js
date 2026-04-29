"use strict";

// 2026-04-29 P1-1.6 — runtime-config parser extraction tests.
//
// Four parsers for the operator's runtime-limit surface
// (UNLIMITED/INF sentinels + positive number coercion).
// Extracted from paperBinanceRunner.js (lines 6003, 6010, 6015,
// 6020) into src/utils/runtimeConfigParsers.js with no
// behavioural change.

const assert = require("assert");

delete require.cache[require.resolve("../utils/runtimeConfigParsers")];
const {
  splitRuntimeList,
  positiveNumberOrNull,
  isUnlimitedRuntimeLimit,
  positiveNumberOrUnlimited,
} = require("../utils/runtimeConfigParsers");

// ── (A) splitRuntimeList ───────────────────────────────────────
(function testSplit() {
  // Comma-delimited.
  assert.deepStrictEqual(
    splitRuntimeList("a,b,c"),
    ["A", "B", "C"],
    "(A1) comma split + uppercase"
  );
  // Pipe-delimited.
  assert.deepStrictEqual(
    splitRuntimeList("a|b|c"),
    ["A", "B", "C"],
    "(A2) pipe split"
  );
  // Whitespace-delimited.
  assert.deepStrictEqual(
    splitRuntimeList("a b c"),
    ["A", "B", "C"],
    "(A3) whitespace split"
  );
  // Mixed.
  assert.deepStrictEqual(
    splitRuntimeList("a, b | c\nd"),
    ["A", "B", "C", "D"],
    "(A4) mixed delimiters"
  );
  // Falsy → empty.
  assert.deepStrictEqual(splitRuntimeList(""), [], "(A5) empty");
  assert.deepStrictEqual(splitRuntimeList(null), [], "(A6) null");
  assert.deepStrictEqual(splitRuntimeList(undefined), [], "(A7) undefined");
  // Drop empties from extra delimiters.
  assert.deepStrictEqual(
    splitRuntimeList(",a,,b,"),
    ["A", "B"],
    "(A8) drop empty entries"
  );
  // Note: the contract is NOT to dedup. Pin that — accidental
  // dedup would change downstream iteration semantics.
  assert.deepStrictEqual(
    splitRuntimeList("a,a,b"),
    ["A", "A", "B"],
    "(A9) duplicates preserved (no Set semantics)"
  );
})();

// ── (B) positiveNumberOrNull ───────────────────────────────────
(function testPositiveOrNull() {
  assert.strictEqual(positiveNumberOrNull(5), 5, "(B1) positive int");
  assert.strictEqual(positiveNumberOrNull(0.5), 0.5, "(B2) positive float");
  assert.strictEqual(positiveNumberOrNull("3"), 3, "(B3) numeric string");
  assert.strictEqual(positiveNumberOrNull(0), null, "(B4) zero → null");
  assert.strictEqual(positiveNumberOrNull(-1), null, "(B5) negative → null");
  assert.strictEqual(positiveNumberOrNull(NaN), null, "(B6) NaN → null");
  assert.strictEqual(positiveNumberOrNull(""), null, "(B7) empty → null");
  assert.strictEqual(positiveNumberOrNull(null), null, "(B8) null → null");
  assert.strictEqual(positiveNumberOrNull(undefined), null, "(B9) undefined → null");
  assert.strictEqual(positiveNumberOrNull("abc"), null, "(B10) garbage → null");
})();

// ── (C) isUnlimitedRuntimeLimit ────────────────────────────────
(function testIsUnlimited() {
  assert.strictEqual(isUnlimitedRuntimeLimit("UNLIMITED"), true, "(C1) UNLIMITED");
  assert.strictEqual(isUnlimitedRuntimeLimit("INF"), true, "(C2) INF");
  assert.strictEqual(isUnlimitedRuntimeLimit("INFINITY"), true, "(C3) INFINITY");
  assert.strictEqual(isUnlimitedRuntimeLimit("*"), true, "(C4) wildcard");
  // Case-insensitive.
  assert.strictEqual(isUnlimitedRuntimeLimit("unlimited"), true, "(C5) lowercase");
  assert.strictEqual(isUnlimitedRuntimeLimit("Inf"), true, "(C6) mixed case");
  // Whitespace tolerated.
  assert.strictEqual(isUnlimitedRuntimeLimit("  UNLIMITED  "), true, "(C7) whitespace trimmed");
  // Non-sentinels.
  assert.strictEqual(isUnlimitedRuntimeLimit("NONE"), false, "(C8) NONE not a sentinel");
  assert.strictEqual(isUnlimitedRuntimeLimit(""), false, "(C9) empty");
  assert.strictEqual(isUnlimitedRuntimeLimit(null), false, "(C10) null");
  assert.strictEqual(isUnlimitedRuntimeLimit(undefined), false, "(C11) undefined");
  assert.strictEqual(isUnlimitedRuntimeLimit(123), false, "(C12) numeric");
})();

// ── (D) positiveNumberOrUnlimited ──────────────────────────────
(function testPositiveOrUnlimited() {
  // Sentinel branch.
  assert.strictEqual(positiveNumberOrUnlimited("UNLIMITED"), "UNLIMITED", "(D1) sentinel returns UNLIMITED literal");
  assert.strictEqual(positiveNumberOrUnlimited("inf"), "UNLIMITED", "(D2) INF case-insensitive");
  assert.strictEqual(positiveNumberOrUnlimited("*"), "UNLIMITED", "(D3) wildcard");
  // Number branch.
  assert.strictEqual(positiveNumberOrUnlimited(5), 5, "(D4) positive number passes through");
  assert.strictEqual(positiveNumberOrUnlimited("12"), 12, "(D5) numeric string");
  // Falls through to null.
  assert.strictEqual(positiveNumberOrUnlimited(0), null, "(D6) zero → null");
  assert.strictEqual(positiveNumberOrUnlimited(-1), null, "(D7) negative → null");
  assert.strictEqual(positiveNumberOrUnlimited(""), null, "(D8) empty → null");
  assert.strictEqual(positiveNumberOrUnlimited(null), null, "(D9) null → null");
})();

// ── (E) paperBinanceRunner internal binding still works ────────
(function testRunnerLoads() {
  delete require.cache[require.resolve("../engine/paperBinanceRunner")];
  const runner = require("../engine/paperBinanceRunner");
  assert.ok(runner && typeof runner === "object",
    "(E1) paperBinanceRunner still loads after runtime-config-parsers extraction");
})();

console.log("RUNTIME_CONFIG_PARSERS_TEST_OK");
