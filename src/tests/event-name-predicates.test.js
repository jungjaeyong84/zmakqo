"use strict";

// 2026-04-29 P1-1.3 — event-name predicate extraction unit tests.
//
// Three predicates that classify the upper-cased event-label
// string emitted by the Pine v6.1.1.0 strategy port. They used to
// live inline in src/engine/paperBinanceRunner.js. They are
// extracted to src/utils/eventNamePredicates.js with no
// behavioural change. The tests below pin the contract from the
// new module's perspective.
//
// Existing integration coverage:
// - opposite-transition-entry-scope.test.js exercises
//   isCoreOrRealEvent through paperBinanceRunner.__test (still
//   passes because the runner re-exports the same reference).

const assert = require("assert");

delete require.cache[require.resolve("../utils/eventNamePredicates")];
const {
  isPrimaryLongShortEventName,
  isPreRealEventName,
  isCoreOrRealEvent,
} = require("../utils/eventNamePredicates");

// ── (A) isPrimaryLongShortEventName ────────────────────────────
(function testPrimary() {
  assert.strictEqual(isPrimaryLongShortEventName("LONG"), true, "(A1) LONG");
  assert.strictEqual(isPrimaryLongShortEventName("SHORT"), true, "(A2) SHORT");
  assert.strictEqual(isPrimaryLongShortEventName("long"), true, "(A3) lowercase normalized");
  assert.strictEqual(isPrimaryLongShortEventName("Short"), true, "(A4) mixed case");
  assert.strictEqual(isPrimaryLongShortEventName("CORE_LONG"), false, "(A5) CORE_* not primary");
  assert.strictEqual(isPrimaryLongShortEventName("REAL_LONG"), false, "(A6) REAL_* not primary");
  assert.strictEqual(isPrimaryLongShortEventName("PRE_REAL_LONG"), false, "(A7) PRE_REAL_* not primary");
  assert.strictEqual(isPrimaryLongShortEventName("EARLY_LONG"), false, "(A8) EARLY_* not primary");
  assert.strictEqual(isPrimaryLongShortEventName(""), false, "(A9) empty");
  assert.strictEqual(isPrimaryLongShortEventName(null), false, "(A10) null");
  assert.strictEqual(isPrimaryLongShortEventName(undefined), false, "(A11) undefined");
})();

// ── (B) isPreRealEventName ─────────────────────────────────────
(function testPreReal() {
  assert.strictEqual(isPreRealEventName("PRE_REAL_LONG"), true, "(B1) prefix matches");
  assert.strictEqual(isPreRealEventName("PRE_REAL_SHORT"), true, "(B2) prefix matches");
  assert.strictEqual(isPreRealEventName("PRE_REAL_CORE_LONG"), true, "(B3) nested prefix");
  assert.strictEqual(isPreRealEventName("pre_real_long"), true, "(B4) lowercase normalized");
  assert.strictEqual(isPreRealEventName("REAL_LONG"), false, "(B5) REAL_* alone is not PRE_REAL_*");
  assert.strictEqual(isPreRealEventName("PRE_LONG"), false, "(B6) partial prefix mismatch");
  assert.strictEqual(isPreRealEventName(""), false, "(B7) empty");
  assert.strictEqual(isPreRealEventName(null), false, "(B8) null");
})();

// ── (C) isCoreOrRealEvent ──────────────────────────────────────
//
// The "this counts as a tradable real signal" classifier. Mirrors
// the pre-existing call sites at paperBinanceRunner line 3453 and
// the assertions in opposite-transition-entry-scope.test.js.
(function testCoreOrReal() {
  // Primaries
  assert.strictEqual(isCoreOrRealEvent("LONG"), true, "(C1) LONG");
  assert.strictEqual(isCoreOrRealEvent("SHORT"), true, "(C2) SHORT");
  // CORE_*
  assert.strictEqual(isCoreOrRealEvent("CORE_LONG"), true, "(C3) CORE_LONG");
  assert.strictEqual(isCoreOrRealEvent("CORE_SHORT"), true, "(C4) CORE_SHORT");
  // PRE_REAL_*
  assert.strictEqual(isCoreOrRealEvent("PRE_REAL_LONG"), true, "(C5) PRE_REAL_LONG");
  assert.strictEqual(isCoreOrRealEvent("PRE_REAL_SHORT"), true, "(C6) PRE_REAL_SHORT");
  // REAL_*
  assert.strictEqual(isCoreOrRealEvent("REAL_LONG"), true, "(C7) REAL_LONG");
  assert.strictEqual(isCoreOrRealEvent("REAL_SHORT"), true, "(C8) REAL_SHORT");
  // Out of scope
  assert.strictEqual(isCoreOrRealEvent("EARLY_LONG"), false,
    "(C9) EARLY_* legacy early-only signals stay outside core/real-only confirm flow");
  assert.strictEqual(isCoreOrRealEvent("EMO_LONG"), false, "(C10) EMO_* out of scope");
  assert.strictEqual(isCoreOrRealEvent(""), false, "(C11) empty");
  assert.strictEqual(isCoreOrRealEvent(null), false, "(C12) null");
  // Lowercase round-trip
  assert.strictEqual(isCoreOrRealEvent("real_long"), true, "(C13) lowercase normalized");
})();

// ── (D) paperBinanceRunner __test still re-exports isCoreOrRealEvent ──
(function testPaperRunnerReExports() {
  delete require.cache[require.resolve("../engine/paperBinanceRunner")];
  const { __test: paperTest } = require("../engine/paperBinanceRunner");
  assert.strictEqual(typeof paperTest.isCoreOrRealEvent, "function",
    "(D1) paperBinanceRunner.__test still exposes isCoreOrRealEvent");
  // Identity — runner must re-export the SAME reference.
  assert.strictEqual(paperTest.isCoreOrRealEvent, isCoreOrRealEvent,
    "(D2) paperBinanceRunner re-exports the SAME function reference (no fork)");
})();

console.log("EVENT_NAME_PREDICATES_TEST_OK");
