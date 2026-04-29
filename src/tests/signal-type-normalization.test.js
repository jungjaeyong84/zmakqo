"use strict";

// 2026-04-29 P1-1.8 — signal-type normalization helper tests.
//
// Three helpers extracted from paperBinanceRunner.js (lines 3396,
// 3405, 3412) into src/utils/signalTypeNormalization.js with no
// behavioural change. AUDIT-SIGNIFICANT:
// `normalizeTpP1EventForExchange` has 3 sibling copies elsewhere
// (signals.js / webhook.routes.js / tradeExecutionAlert.js) that
// will be migrated to import from this module in subsequent
// audit-driven sub-steps. Those siblings are byte-identical to
// the body pinned here.

const assert = require("assert");

delete require.cache[require.resolve("../utils/signalTypeNormalization")];
const {
  normalizeSignalTypeList,
  normalizeTpP1EventForExchange,
  filterOutRealSignalTypes,
} = require("../utils/signalTypeNormalization");

// ── (A) normalizeSignalTypeList ────────────────────────────────
(function testNormalizeList() {
  // Array input.
  assert.deepStrictEqual(
    normalizeSignalTypeList(["LONG", "short", "EMO_LONG"]),
    ["LONG", "SHORT", "EMO_LONG"],
    "(A1) array uppercased"
  );
  // String input — comma + whitespace.
  assert.deepStrictEqual(
    normalizeSignalTypeList("LONG, SHORT,EMO_LONG"),
    ["LONG", "SHORT", "EMO_LONG"],
    "(A2) string split"
  );
  assert.deepStrictEqual(
    normalizeSignalTypeList("LONG SHORT"),
    ["LONG", "SHORT"],
    "(A3) whitespace split"
  );
  // Order-preservation contract.
  assert.deepStrictEqual(
    normalizeSignalTypeList("EMO_LONG,LONG,SHORT"),
    ["EMO_LONG", "LONG", "SHORT"],
    "(A4) order preserved (no dedup or sort)"
  );
  // Duplicates not collapsed.
  assert.deepStrictEqual(
    normalizeSignalTypeList(["LONG", "long", "LONG"]),
    ["LONG", "LONG", "LONG"],
    "(A5) duplicates preserved (caller responsibility if dedup needed)"
  );
  // Falsy / empty input.
  assert.deepStrictEqual(normalizeSignalTypeList(null), [], "(A6) null");
  assert.deepStrictEqual(normalizeSignalTypeList(undefined), [], "(A7) undefined");
  assert.deepStrictEqual(normalizeSignalTypeList(""), [], "(A8) empty string");
  assert.deepStrictEqual(normalizeSignalTypeList([]), [], "(A9) empty array");
  // Non-array, non-string returns [].
  assert.deepStrictEqual(normalizeSignalTypeList(42), [], "(A10) number → []");
  assert.deepStrictEqual(normalizeSignalTypeList({}), [], "(A11) object → []");
  // Empty entries dropped.
  assert.deepStrictEqual(
    normalizeSignalTypeList(["LONG", "", null, "SHORT"]),
    ["LONG", "SHORT"],
    "(A12) drop falsy entries from array"
  );
})();

// ── (B) normalizeTpP1EventForExchange ──────────────────────────
(function testTpP1Remap() {
  // The well-known Q1-2026 Binance remap.
  assert.strictEqual(
    normalizeTpP1EventForExchange("EXIT_TP_P1_5P", "BINANCEFUT"),
    "EXIT_TP_P1_3P",
    "(B1) Binance: EXIT_TP_P1_5P → EXIT_TP_P1_3P"
  );
  assert.strictEqual(
    normalizeTpP1EventForExchange("exit_tp_p1_5p", "BINANCE"),
    "EXIT_TP_P1_3P",
    "(B2) lowercase + Binance"
  );
  // Non-Binance keeps original.
  assert.strictEqual(
    normalizeTpP1EventForExchange("EXIT_TP_P1_5P", "BITHUMB"),
    "EXIT_TP_P1_5P",
    "(B3) non-Binance preserves event"
  );
  // Unrelated event passes through (uppercased).
  assert.strictEqual(
    normalizeTpP1EventForExchange("EXIT_TP_P1_3P", "BINANCEFUT"),
    "EXIT_TP_P1_3P",
    "(B4) already-3P passes through"
  );
  assert.strictEqual(
    normalizeTpP1EventForExchange("LONG", "BINANCEFUT"),
    "LONG",
    "(B5) unrelated event passes through"
  );
  // Empty / null input.
  assert.strictEqual(
    normalizeTpP1EventForExchange("", "BINANCEFUT"),
    "",
    "(B6) empty event → empty"
  );
  assert.strictEqual(
    normalizeTpP1EventForExchange(null, "BINANCEFUT"),
    "",
    "(B7) null event → empty"
  );
})();

// ── (C) filterOutRealSignalTypes ───────────────────────────────
(function testFilterReal() {
  assert.deepStrictEqual(
    filterOutRealSignalTypes(["LONG", "REAL", "SHORT", "REAL_LONG", "REAL_SHORT"]),
    ["LONG", "SHORT"],
    "(C1) drops REAL, REAL_LONG, REAL_SHORT"
  );
  // Case-insensitive.
  assert.deepStrictEqual(
    filterOutRealSignalTypes(["long", "real_long", "short"]),
    ["long", "short"],
    "(C2) case-insensitive filter (preserves original casing in output)"
  );
  // Empty entries dropped.
  assert.deepStrictEqual(
    filterOutRealSignalTypes(["LONG", "", null, "SHORT"]),
    ["LONG", "SHORT"],
    "(C3) drops empty entries"
  );
  // Non-array.
  assert.deepStrictEqual(filterOutRealSignalTypes(null), [], "(C4) null → []");
  assert.deepStrictEqual(filterOutRealSignalTypes("LONG,REAL"), [], "(C5) string → [] (caller must normalize first)");
  // No REAL entries → array preserved.
  assert.deepStrictEqual(
    filterOutRealSignalTypes(["LONG", "SHORT"]),
    ["LONG", "SHORT"],
    "(C6) no-op when nothing to filter"
  );
})();

// ── (D) paperBinanceRunner internal binding still works ────────
(function testRunnerLoads() {
  delete require.cache[require.resolve("../engine/paperBinanceRunner")];
  const runner = require("../engine/paperBinanceRunner");
  assert.ok(runner && typeof runner === "object",
    "(D1) paperBinanceRunner still loads after signal-type-normalization extraction");
})();

console.log("SIGNAL_TYPE_NORMALIZATION_TEST_OK");
