"use strict";

// 2026-04-29 P1-1.10 — OpenClaw cohort + TP1-ladder profile
// normalizer extraction tests.
//
// Two helpers extracted from paperBinanceRunner.js (lines 586,
// 592) into src/utils/openClawCohort.js.

const assert = require("assert");

delete require.cache[require.resolve("../utils/openClawCohort")];
const {
  normalizeOpenClawCohort,
  normalizeTp1LadderProfile,
} = require("../utils/openClawCohort");

// ── (A) normalizeOpenClawCohort ────────────────────────────────
(function testCohort() {
  assert.strictEqual(normalizeOpenClawCohort("RESCUE"), "RESCUE", "(A1) RESCUE");
  assert.strictEqual(normalizeOpenClawCohort("MIXED"), "MIXED", "(A2) MIXED");
  assert.strictEqual(normalizeOpenClawCohort("KEEP_DROP"), "KEEP_DROP", "(A3) KEEP_DROP");
  assert.strictEqual(normalizeOpenClawCohort("HOLD_SAMPLE"), "HOLD_SAMPLE", "(A4) HOLD_SAMPLE");
  // Case-insensitive.
  assert.strictEqual(normalizeOpenClawCohort("rescue"), "RESCUE", "(A5) lowercase");
  assert.strictEqual(normalizeOpenClawCohort("  Mixed  "), "MIXED", "(A6) trim + case");
  // Anything outside the set → null.
  assert.strictEqual(normalizeOpenClawCohort("BASE"), null,
    "(A7) BASE is NOT a cohort label (it's a ladder profile)");
  assert.strictEqual(normalizeOpenClawCohort("UNKNOWN"), null, "(A8) unknown → null");
  assert.strictEqual(normalizeOpenClawCohort(""), null, "(A9) empty → null");
  assert.strictEqual(normalizeOpenClawCohort(null), null, "(A10) null → null");
  assert.strictEqual(normalizeOpenClawCohort(undefined), null, "(A11) undefined → null");
})();

// ── (B) normalizeTp1LadderProfile ──────────────────────────────
(function testLadderProfile() {
  assert.strictEqual(normalizeTp1LadderProfile("RESCUE"), "RESCUE", "(B1) RESCUE");
  assert.strictEqual(normalizeTp1LadderProfile("MIXED"), "MIXED", "(B2) MIXED");
  assert.strictEqual(normalizeTp1LadderProfile("BASE"), "BASE", "(B3) BASE");
  // Case-insensitive.
  assert.strictEqual(normalizeTp1LadderProfile("base"), "BASE", "(B4) lowercase");
  // The set difference vs. cohort: KEEP_DROP / HOLD_SAMPLE are NOT
  // recognized as ladder profiles. Pin that explicitly so a future
  // accidental "merge the two enums" change requires explicit
  // decision.
  assert.strictEqual(normalizeTp1LadderProfile("KEEP_DROP"), null,
    "(B5) KEEP_DROP is NOT a ladder profile (it's a cohort label)");
  assert.strictEqual(normalizeTp1LadderProfile("HOLD_SAMPLE"), null,
    "(B6) HOLD_SAMPLE is NOT a ladder profile");
  // Out of range.
  assert.strictEqual(normalizeTp1LadderProfile("AGGRESSIVE"), null,
    "(B7) AGGRESSIVE is NOT a ladder profile (different axis)");
  assert.strictEqual(normalizeTp1LadderProfile(""), null, "(B8) empty");
  assert.strictEqual(normalizeTp1LadderProfile(null), null, "(B9) null");
})();

// ── (C) paperBinanceRunner internal binding ───────────────────
(function testRunnerLoads() {
  delete require.cache[require.resolve("../engine/paperBinanceRunner")];
  const runner = require("../engine/paperBinanceRunner");
  assert.ok(runner && typeof runner === "object",
    "(C1) paperBinanceRunner still loads after openClawCohort extraction");
})();

console.log("OPEN_CLAW_COHORT_TEST_OK");
