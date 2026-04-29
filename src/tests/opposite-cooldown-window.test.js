"use strict";

// 2026-04-29 P1-1.16 — opposite-cooldown-window helper unit tests.
//
// Pre-existing integration test
// opposite-transition-immediate-reentry.test.js continues to
// exercise the runner-internal call sites; this file pins the
// contract at the unit level (without going through the runner
// module load).

const assert = require("assert");

delete require.cache[require.resolve("../utils/oppositeCooldownWindow")];
const {
  resolveCooldownProfileFromMeta,
  resolveOppositeCooldownWindow,
  resolveOppositeCooldownWindowFromPosition,
} = require("../utils/oppositeCooldownWindow");

// ── (A) resolveCooldownProfileFromMeta ─────────────────────────
(function testProfile() {
  // RESCUE / MIXED cohorts.
  assert.strictEqual(
    resolveCooldownProfileFromMeta({ openclaw_market_regime_cohort: "RESCUE" }),
    "RESCUE",
    "(A1) RESCUE"
  );
  assert.strictEqual(
    resolveCooldownProfileFromMeta({ openclaw_market_regime_cohort: "MIXED" }),
    "MIXED",
    "(A2) MIXED"
  );
  // KEEP_DROP / HOLD_SAMPLE collapse to BASE.
  assert.strictEqual(
    resolveCooldownProfileFromMeta({ openclaw_market_regime_cohort: "KEEP_DROP" }),
    "BASE",
    "(A3) KEEP_DROP → BASE"
  );
  assert.strictEqual(
    resolveCooldownProfileFromMeta({ openclaw_market_regime_cohort: "HOLD_SAMPLE" }),
    "BASE",
    "(A4) HOLD_SAMPLE → BASE"
  );
  // Legacy market_regime_cohort key fallback.
  assert.strictEqual(
    resolveCooldownProfileFromMeta({ market_regime_cohort: "RESCUE" }),
    "RESCUE",
    "(A5) market_regime_cohort fallback"
  );
  // null / empty / non-object → BASE.
  assert.strictEqual(resolveCooldownProfileFromMeta(null), "BASE", "(A6) null");
  assert.strictEqual(resolveCooldownProfileFromMeta({}), "BASE", "(A7) empty");
  assert.strictEqual(resolveCooldownProfileFromMeta("string"), "BASE", "(A8) string");
})();

// ── (B) resolveOppositeCooldownWindow — RESCUE allows immediate ─
(function testRescueImmediate() {
  const w = resolveOppositeCooldownWindow({
    sysCfg: {},
    posMeta: { openclaw_market_regime_cohort: "RESCUE" },
  });
  assert.strictEqual(w.profile, "RESCUE", "(B1) profile=RESCUE");
  assert.strictEqual(w.cohort, "RESCUE", "(B2) cohort=RESCUE");
  assert.strictEqual(w.bars, 0, "(B3) RESCUE default 0 bars (immediate re-entry)");
  assert.strictEqual(w.timeMs, 0, "(B4) RESCUE default 0 ms");
  // sysCfg can raise the RESCUE cooldown.
  const raised = resolveOppositeCooldownWindow({
    sysCfg: { opposite_signal_cooldown_bars_rescue: 1, opposite_time_cooldown_ms_rescue: 5000 },
    posMeta: { openclaw_market_regime_cohort: "RESCUE" },
  });
  assert.strictEqual(raised.bars, 1, "(B5) RESCUE bars overridden");
  assert.strictEqual(raised.timeMs, 5000, "(B6) RESCUE timeMs overridden");
})();

// ── (C) resolveOppositeCooldownWindow — MIXED defaults ─────────
(function testMixed() {
  const w = resolveOppositeCooldownWindow({
    sysCfg: {},
    posMeta: { openclaw_market_regime_cohort: "MIXED" },
  });
  assert.strictEqual(w.profile, "MIXED", "(C1) profile=MIXED");
  assert.strictEqual(w.bars, 1, "(C2) MIXED default 1 bar");
  assert.strictEqual(w.timeMs, 60000, "(C3) MIXED default 60s");
})();

// ── (D) resolveOppositeCooldownWindow — BASE defaults ──────────
(function testBase() {
  const w = resolveOppositeCooldownWindow({
    sysCfg: {},
    posMeta: { openclaw_market_regime_cohort: "KEEP_DROP" },
  });
  assert.strictEqual(w.profile, "BASE", "(D1) KEEP_DROP cohort → BASE profile");
  assert.strictEqual(w.cohort, "KEEP_DROP", "(D2) cohort preserved (KEEP_DROP)");
  assert.strictEqual(w.bars, 3, "(D3) BASE default 3 bars");
  assert.strictEqual(w.timeMs, 300000, "(D4) BASE default 300s");
  // sysCfg can override BASE.
  const overridden = resolveOppositeCooldownWindow({
    sysCfg: { opposite_signal_cooldown_bars: 5, opposite_time_cooldown_ms: 600000 },
    posMeta: null,
  });
  assert.strictEqual(overridden.bars, 5, "(D5) BASE bars overridden");
  assert.strictEqual(overridden.timeMs, 600000, "(D6) BASE timeMs overridden");
  // null cohort → BASE.
  assert.strictEqual(overridden.cohort, "BASE", "(D7) null cohort → BASE sentinel");
})();

// ── (E) negative cooldowns are clamped to zero ─────────────────
(function testNegativeClamp() {
  const w = resolveOppositeCooldownWindow({
    sysCfg: { opposite_signal_cooldown_bars: -10, opposite_time_cooldown_ms: -500 },
  });
  assert.strictEqual(w.bars, 0, "(E1) negative bars → 0");
  assert.strictEqual(w.timeMs, 0, "(E2) negative timeMs → 0");
})();

// ── (F) resolveOppositeCooldownWindowFromPosition wrapper ──────
(function testFromPosition() {
  const w = resolveOppositeCooldownWindowFromPosition({
    sysCfg: {},
    position: { meta: { openclaw_market_regime_cohort: "MIXED" } },
  });
  assert.strictEqual(w.profile, "MIXED", "(F1) wraps + delegates");
  // Position without meta → BASE defaults.
  const noMeta = resolveOppositeCooldownWindowFromPosition({ position: {} });
  assert.strictEqual(noMeta.profile, "BASE", "(F2) no meta → BASE");
  // null position → BASE.
  const nullPos = resolveOppositeCooldownWindowFromPosition({ position: null });
  assert.strictEqual(nullPos.profile, "BASE", "(F3) null position → BASE");
})();

// ── (G) paperBinanceRunner __test re-exports ──────────────────
(function testPaperRunnerReExports() {
  delete require.cache[require.resolve("../engine/paperBinanceRunner")];
  const { __test: paperTest } = require("../engine/paperBinanceRunner");
  assert.strictEqual(paperTest.resolveOppositeCooldownWindow, resolveOppositeCooldownWindow,
    "(G1) same ref for resolveOppositeCooldownWindow");
  assert.strictEqual(paperTest.resolveOppositeCooldownWindowFromPosition,
    resolveOppositeCooldownWindowFromPosition,
    "(G2) same ref for resolveOppositeCooldownWindowFromPosition");
})();

console.log("OPPOSITE_COOLDOWN_WINDOW_TEST_OK");
