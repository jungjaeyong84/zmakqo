"use strict";

// 2026-04-29 P1-1.21 — runner generic object/value helpers tests.

const assert = require("assert");

delete require.cache[require.resolve("../utils/runnerObjectHelpers")];
const {
  hasPositionSize,
  mergeMeta,
  trimTextOrNull,
  numOrNull,
} = require("../utils/runnerObjectHelpers");

const { POS_SIZE_EPSILON } = require("../utils/qtyCalculation");

// ── (A) hasPositionSize ─────────────────────────────────────────
(function testHasPositionSize() {
  // Strictly greater than epsilon → true.
  assert.strictEqual(hasPositionSize(0.5), true, "(A1) 0.5 > epsilon");
  assert.strictEqual(hasPositionSize(POS_SIZE_EPSILON * 2), true, "(A2) 2× epsilon");
  // At epsilon → false (strict >).
  assert.strictEqual(hasPositionSize(POS_SIZE_EPSILON), false, "(A3) exactly epsilon → false");
  // Below epsilon → false.
  assert.strictEqual(hasPositionSize(POS_SIZE_EPSILON / 2), false, "(A4) below epsilon");
  // Zero / negative → false.
  assert.strictEqual(hasPositionSize(0), false, "(A5) zero");
  assert.strictEqual(hasPositionSize(-1), false, "(A6) negative");
  // Non-finite → false.
  assert.strictEqual(hasPositionSize(NaN), false, "(A7) NaN");
  assert.strictEqual(hasPositionSize(Infinity), false, "(A8) Infinity (not finite)");
  assert.strictEqual(hasPositionSize(null), false, "(A9) null (Number(null)=0, not >epsilon)");
  assert.strictEqual(hasPositionSize(undefined), false, "(A10) undefined → NaN → false");
  // Numeric strings parse.
  assert.strictEqual(hasPositionSize("0.5"), true, "(A11) numeric string");
  assert.strictEqual(hasPositionSize("garbage"), false, "(A12) garbage → false");
})();

// ── (B) mergeMeta ──────────────────────────────────────────────
(function testMergeMeta() {
  // Basic merge.
  assert.deepStrictEqual(
    mergeMeta({ a: 1, b: 2 }, { b: 99, c: 3 }),
    { a: 1, b: 99, c: 3 },
    "(B1) patch overrides base"
  );
  // Undefined drops, null/0/"" pass through.
  assert.deepStrictEqual(
    mergeMeta({ a: 1, b: 2, c: 3 }, { a: undefined, b: null, c: 0 }),
    { a: 1, b: null, c: 0 },
    "(B2) undefined dropped; null/0 kept"
  );
  // Empty string passes through.
  assert.deepStrictEqual(
    mergeMeta({ a: "old" }, { a: "" }),
    { a: "" },
    "(B3) empty string passes through (only undefined dropped)"
  );
  // Null base → empty object base.
  assert.deepStrictEqual(
    mergeMeta(null, { a: 1 }),
    { a: 1 },
    "(B4) null base"
  );
  // Null patch → just base copy.
  assert.deepStrictEqual(
    mergeMeta({ a: 1 }, null),
    { a: 1 },
    "(B5) null patch"
  );
  // Both null → empty.
  assert.deepStrictEqual(mergeMeta(null, null), {}, "(B6) both null");
  // Returns new object (no mutation).
  const base = { a: 1 };
  const out = mergeMeta(base, { b: 2 });
  assert.notStrictEqual(out, base, "(B7) returns new object (no mutation)");
  assert.deepStrictEqual(base, { a: 1 }, "(B8) base unchanged");
})();

// ── (C) trimTextOrNull ─────────────────────────────────────────
(function testTrimTextOrNull() {
  assert.strictEqual(trimTextOrNull("hello"), "hello", "(C1) plain string");
  assert.strictEqual(trimTextOrNull("  spaced  "), "spaced", "(C2) trim");
  assert.strictEqual(trimTextOrNull(""), null, "(C3) empty → null");
  assert.strictEqual(trimTextOrNull("   "), null, "(C4) whitespace-only → null");
  assert.strictEqual(trimTextOrNull(null), null, "(C5) null → null");
  assert.strictEqual(trimTextOrNull(undefined), null, "(C6) undefined → null");
  assert.strictEqual(trimTextOrNull(42), "42", "(C7) number coerced");
})();

// ── (D) numOrNull — sentinel distinction ───────────────────────
(function testNumOrNull() {
  // Finite numbers pass.
  assert.strictEqual(numOrNull(42), 42, "(D1) integer");
  assert.strictEqual(numOrNull(0), 0, "(D2) zero (note: NOT treated as null!)");
  assert.strictEqual(numOrNull(-1.5), -1.5, "(D3) negative float");
  // Numeric strings parse.
  assert.strictEqual(numOrNull("3.14"), 3.14, "(D4) numeric string");
  // Sentinel values for "no value provided" → null.
  assert.strictEqual(numOrNull(null), null, "(D5) null sentinel");
  assert.strictEqual(numOrNull(undefined), null, "(D6) undefined sentinel");
  assert.strictEqual(numOrNull(""), null, "(D7) empty string sentinel");
  // Distinguishing pin: empty string and null → null,
  // BUT 0 → 0 (a real value). This contract is critical for
  // callers using numOrNull to detect "field unset" vs. "field
  // explicitly zero".
  assert.notStrictEqual(numOrNull(0), null, "(D8) 0 is NOT null");
  // Non-numeric → null.
  assert.strictEqual(numOrNull("garbage"), null, "(D9) non-numeric");
  assert.strictEqual(numOrNull(NaN), null, "(D10) NaN");
})();

console.log("RUNNER_OBJECT_HELPERS_TEST_OK");
