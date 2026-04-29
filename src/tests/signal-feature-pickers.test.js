"use strict";

// 2026-04-29 P1-1.14 — signal-feature picker extraction tests.

const assert = require("assert");

delete require.cache[require.resolve("../utils/signalFeaturePickers")];
const {
  pickSignalScore,
  pickSignalScoreExtended,
  pickSignalConfidence,
  pickSignalWaveConf,
  pickSignalConflict,
} = require("../utils/signalFeaturePickers");

// ── (A) pickSignalScore — fallback chain ───────────────────────
(function testScore() {
  // First key wins.
  assert.strictEqual(pickSignalScore({ score: 0.7 }), 0.7, "(A1) score");
  assert.strictEqual(pickSignalScore({ score_norm: 0.5 }), 0.5, "(A2) score_norm");
  assert.strictEqual(pickSignalScore({ signal_strength: 0.3 }), 0.3, "(A3) signal_strength");
  assert.strictEqual(pickSignalScore({ strength: 0.1 }), 0.1, "(A4) strength");
  // Order: score wins over later keys.
  assert.strictEqual(
    pickSignalScore({ score: 0.7, score_norm: 0.5, strength: 0.1 }),
    0.7,
    "(A5) chain order: score wins"
  );
  // Skip non-finite.
  assert.strictEqual(
    pickSignalScore({ score: NaN, score_norm: 0.5 }),
    0.5,
    "(A6) NaN skipped, fallback used"
  );
  assert.strictEqual(
    pickSignalScore({ score: "garbage", strength: 0.1 }),
    0.1,
    "(A7) non-numeric skipped"
  );
  // Numeric strings parse.
  assert.strictEqual(pickSignalScore({ score: "0.42" }), 0.42, "(A8) numeric string");
  // Empty / null.
  assert.strictEqual(pickSignalScore({}), null, "(A9) empty");
  assert.strictEqual(pickSignalScore(null), null, "(A10) null");
  assert.strictEqual(pickSignalScore("notobj"), null, "(A11) string");
})();

// ── (B) pickSignalScoreExtended — regex fallback ───────────────
(function testScoreExtended() {
  // Structured chain still wins.
  assert.strictEqual(
    pickSignalScoreExtended({ score: 0.7, pro_score_line: "score 99.9" }),
    0.7,
    "(B1) structured score wins over regex"
  );
  // Regex extraction from pro_score_line.
  assert.strictEqual(
    pickSignalScoreExtended({ pro_score_line: "score: -0.42 something" }),
    -0.42,
    "(B2) extracts signed decimal from pro_score_line"
  );
  // score_line fallback.
  assert.strictEqual(
    pickSignalScoreExtended({ score_line: "12" }),
    12,
    "(B3) score_line fallback"
  );
  // score_text fallback.
  assert.strictEqual(
    pickSignalScoreExtended({ score_text: "value 0.5%" }),
    0.5,
    "(B4) score_text fallback (first match: 0.5)"
  );
  // No usable input.
  assert.strictEqual(pickSignalScoreExtended({}), null, "(B5) empty");
  assert.strictEqual(pickSignalScoreExtended({ pro_score_line: "no numbers here" }), null,
    "(B6) no number → null");
})();

// ── (C) pickSignalConfidence ───────────────────────────────────
(function testConfidence() {
  assert.strictEqual(pickSignalConfidence({ confidence: 0.85 }), 0.85, "(C1) confidence");
  assert.strictEqual(pickSignalConfidence({ signal_confidence: 0.5 }), 0.5, "(C2) signal_confidence");
  assert.strictEqual(pickSignalConfidence({ conf: 0.3 }), 0.3, "(C3) conf");
  // confidence wins over later.
  assert.strictEqual(
    pickSignalConfidence({ confidence: 0.85, conf: 0.1 }),
    0.85,
    "(C4) confidence wins"
  );
  assert.strictEqual(pickSignalConfidence({}), null, "(C5) empty");
  assert.strictEqual(pickSignalConfidence(null), null, "(C6) null");
  assert.strictEqual(pickSignalConfidence({ conf: "bad" }), null, "(C7) non-numeric → null");
})();

// ── (D) pickSignalWaveConf ─────────────────────────────────────
(function testWaveConf() {
  assert.strictEqual(pickSignalWaveConf({ zz_wave_conf: 0.7 }), 0.7, "(D1) zz_wave_conf");
  assert.strictEqual(pickSignalWaveConf({ wave_conf: 0.5 }), 0.5, "(D2) wave_conf");
  assert.strictEqual(pickSignalWaveConf({ wave_confidence: 0.3 }), 0.3, "(D3) wave_confidence");
  assert.strictEqual(
    pickSignalWaveConf({ zz_wave_conf: 0.9, wave_conf: 0.1 }),
    0.9,
    "(D4) zz_wave_conf wins"
  );
  assert.strictEqual(pickSignalWaveConf({}), null, "(D5) empty");
})();

// ── (E) pickSignalConflict ─────────────────────────────────────
(function testConflict() {
  // Boolean values pass through.
  assert.strictEqual(pickSignalConflict({ pro_conflict: true }), true, "(E1) true");
  assert.strictEqual(pickSignalConflict({ pro_conflict: false }), false, "(E2) false");
  // String "true"/"false".
  assert.strictEqual(pickSignalConflict({ pro_conflict: "true" }), true, "(E3) string true");
  assert.strictEqual(pickSignalConflict({ pro_conflict: "false" }), false, "(E4) string false");
  assert.strictEqual(pickSignalConflict({ pro_conflict: "1" }), true, "(E5) '1'");
  // pro_conflict wins over legacy conflict.
  assert.strictEqual(
    pickSignalConflict({ pro_conflict: false, conflict: true }),
    false,
    "(E6) pro_conflict wins over legacy"
  );
  // Legacy conflict fallback.
  assert.strictEqual(
    pickSignalConflict({ conflict: true }),
    true,
    "(E7) legacy conflict fallback"
  );
  // Non-bool-coercible → null (per fallback=null).
  assert.strictEqual(
    pickSignalConflict({ pro_conflict: "garbage" }),
    null,
    "(E8) non-bool-coercible → null"
  );
  // null/empty.
  assert.strictEqual(pickSignalConflict({}), null, "(E9) empty");
  assert.strictEqual(pickSignalConflict({ pro_conflict: null }), null, "(E10) null entry");
})();

// ── (F) paperBinanceRunner internal binding ───────────────────
(function testRunnerLoads() {
  delete require.cache[require.resolve("../engine/paperBinanceRunner")];
  const runner = require("../engine/paperBinanceRunner");
  assert.ok(runner && typeof runner === "object",
    "(F1) paperBinanceRunner still loads after signalFeaturePickers extraction");
})();

console.log("SIGNAL_FEATURE_PICKERS_TEST_OK");
