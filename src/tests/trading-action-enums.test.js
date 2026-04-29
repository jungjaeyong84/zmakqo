"use strict";

// 2026-04-29 P1-1.5 — trading-action enum normalizer extraction tests.
//
// Four predicates/normalizers that classify the action / side /
// tradingMode enum strings used throughout paperBinanceRunner.
// Extracted from the runner's inline copies (lines 3305, 3311,
// 3319, 3326) into src/utils/tradingActionEnums.js with no
// behavioural change. The tests below pin the contract from the
// new module's perspective.

const assert = require("assert");

delete require.cache[require.resolve("../utils/tradingActionEnums")];
const {
  allowByTradingMode,
  normalizeSideValue,
  normalizeActionValue,
  actionAllowsEntry,
} = require("../utils/tradingActionEnums");

// ── (A) allowByTradingMode ─────────────────────────────────────
(function testAllowByTradingMode() {
  // RUNNING accepts both.
  assert.strictEqual(allowByTradingMode("RUNNING", "BUY"), true, "(A1) RUNNING + BUY");
  assert.strictEqual(allowByTradingMode("RUNNING", "SELL"), true, "(A2) RUNNING + SELL");
  // EXIT_ONLY accepts only SELL.
  assert.strictEqual(allowByTradingMode("EXIT_ONLY", "SELL"), true, "(A3) EXIT_ONLY + SELL");
  assert.strictEqual(allowByTradingMode("EXIT_ONLY", "BUY"), false, "(A4) EXIT_ONLY + BUY rejected");
  assert.strictEqual(allowByTradingMode("EXIT_ONLY", "HOLD"), false, "(A5) EXIT_ONLY + HOLD rejected");
  // Unknown mode rejects everything.
  assert.strictEqual(allowByTradingMode("PAUSED", "SELL"), false, "(A6) unknown mode rejects");
  assert.strictEqual(allowByTradingMode(null, "BUY"), false, "(A7) null mode rejects");
  assert.strictEqual(allowByTradingMode("", "BUY"), false, "(A8) empty mode rejects");
  // Case-sensitive on mode (callers normalize upstream).
  assert.strictEqual(allowByTradingMode("running", "BUY"), false,
    "(A9) lowercase mode rejected — caller responsible for normalization");
})();

// ── (B) normalizeSideValue ─────────────────────────────────────
(function testNormalizeSide() {
  // Signal → broker translation.
  assert.strictEqual(normalizeSideValue("LONG"), "BUY", "(B1) LONG → BUY");
  assert.strictEqual(normalizeSideValue("SHORT"), "SELL", "(B2) SHORT → SELL");
  // Pass-through.
  assert.strictEqual(normalizeSideValue("BUY"), "BUY", "(B3) BUY pass-through");
  assert.strictEqual(normalizeSideValue("SELL"), "SELL", "(B4) SELL pass-through");
  // Case normalization.
  assert.strictEqual(normalizeSideValue("long"), "BUY", "(B5) lowercase LONG → BUY");
  assert.strictEqual(normalizeSideValue("Buy"), "BUY", "(B6) mixed-case BUY");
  // Unknown → HOLD sentinel.
  assert.strictEqual(normalizeSideValue("EXIT"), "HOLD", "(B7) EXIT → HOLD");
  assert.strictEqual(normalizeSideValue(""), "HOLD", "(B8) empty → HOLD");
  assert.strictEqual(normalizeSideValue(null), "HOLD", "(B9) null → HOLD");
  assert.strictEqual(normalizeSideValue(undefined), "HOLD", "(B10) undefined → HOLD");
})();

// ── (C) normalizeActionValue ───────────────────────────────────
(function testNormalizeAction() {
  // Known actions pass through uppercased.
  assert.strictEqual(normalizeActionValue("ENTRY"), "ENTRY", "(C1) ENTRY");
  assert.strictEqual(normalizeActionValue("ADD"), "ADD", "(C2) ADD");
  assert.strictEqual(normalizeActionValue("EXIT"), "EXIT", "(C3) EXIT");
  assert.strictEqual(normalizeActionValue("DROP"), "DROP", "(C4) DROP");
  assert.strictEqual(normalizeActionValue("entry"), "ENTRY", "(C5) lowercase normalized");
  // Unknown actions fall through uppercased (caller policy gates).
  assert.strictEqual(normalizeActionValue("RESCUE"), "RESCUE",
    "(C6) unknown action passes through uppercased");
  // Empty/null → null sentinel.
  assert.strictEqual(normalizeActionValue(""), null, "(C7) empty → null");
  assert.strictEqual(normalizeActionValue(null), null, "(C8) null → null");
  assert.strictEqual(normalizeActionValue(undefined), null, "(C9) undefined → null");
})();

// ── (D) actionAllowsEntry ──────────────────────────────────────
(function testActionAllowsEntry() {
  assert.strictEqual(actionAllowsEntry("ENTRY"), true, "(D1) ENTRY opens position");
  assert.strictEqual(actionAllowsEntry("ADD"), true, "(D2) ADD increases position");
  assert.strictEqual(actionAllowsEntry("EXIT"), false, "(D3) EXIT does not");
  assert.strictEqual(actionAllowsEntry("DROP"), false, "(D4) DROP does not");
  assert.strictEqual(actionAllowsEntry(null), false, "(D5) null does not");
  assert.strictEqual(actionAllowsEntry(""), false, "(D6) empty does not");
  // Note: this predicate is case-sensitive — callers must
  // normalizeActionValue() upstream before calling. Pin that here
  // so a future "make it case-insensitive" change requires an
  // explicit decision.
  assert.strictEqual(actionAllowsEntry("entry"), false,
    "(D7) lowercase rejected — caller responsible for normalization");
})();

// ── (E) paperBinanceRunner internal binding still works ────────
(function testRunnerLoads() {
  delete require.cache[require.resolve("../engine/paperBinanceRunner")];
  const runner = require("../engine/paperBinanceRunner");
  assert.ok(runner && typeof runner === "object",
    "(E1) paperBinanceRunner still loads after trading-action extraction");
})();

console.log("TRADING_ACTION_ENUMS_TEST_OK");
