"use strict";

// 2026-04-29 P1-1.14 — fourteenth stateless-helper extraction from
// src/engine/paperBinanceRunner.js.
//
// Five "signal feature picker" helpers that read named fields out
// of a Pine signal's features object with multi-key fallback +
// graceful nullability:
//
//   pickSignalScore         features.score | score_norm |
//                           signal_strength | strength
//   pickSignalScoreExtended pickSignalScore + regex extraction
//                           from pro_score_line / score_line /
//                           score_text
//   pickSignalConfidence    features.confidence | signal_confidence
//                           | conf
//   pickSignalWaveConf      features.zz_wave_conf | wave_conf |
//                           wave_confidence
//   pickSignalConflict      bool-coerced features.pro_conflict |
//                           conflict; null when neither key
//
// Pure functions: object-property fallback chain + Number/bool
// coercion. No I/O, no async, no module-level state. The runner
// used to host them inline at lines 6468, 6478, 6488, 6494, 6500.
//
// Why this group is the next safe cohesive unit after P1-1.13:
//   - Tightest semantic cohesion remaining at this extraction
//     tier — all five answer "pull this signal-feature value out
//     of the Pine features blob, with a small tolerance for
//     vendor-side key drift".
//   - Self-contained call graph: pickSignalScoreExtended →
//     pickSignalScore; the others independent.
//   - Zero external callers (verified by grep on 2026-04-29).
//   - The fallback-key sets are a pre-existing operator-facing
//     contract: when Pine renames a field we add the new name to
//     the chain. Pinning the chains in a named module makes that
//     contract auditable at one read.

// Local normalizeBool — identical semantics to the runner's
// normalizeBool (~5947). Inlined rather than imported so this
// module stays a leaf with no internal-engine dependencies.
function normalizeBoolLocal(value, fallback) {
  if (value === undefined || value === null) return fallback;
  if (typeof value === "boolean") return value;
  const raw = String(value).trim().toLowerCase();
  if (raw === "1" || raw === "true" || raw === "yes" || raw === "on") return true;
  if (raw === "0" || raw === "false" || raw === "no" || raw === "off") return false;
  return fallback;
}

// pickSignalScore — first finite numeric match from the score-key
// fallback chain. Returns null when none of the four keys are
// numeric.
function pickSignalScore(features) {
  if (!features || typeof features !== "object") return null;
  const keys = ["score", "score_norm", "signal_strength", "strength"];
  for (const key of keys) {
    const v = Number(features[key]);
    if (Number.isFinite(v)) return v;
  }
  return null;
}

// pickSignalScoreExtended — first try the structured numeric
// chain (pickSignalScore); if that fails, try to extract the
// first signed decimal number from the human-readable score
// rendering fields (pro_score_line / score_line / score_text)
// that some legacy Pine variants emit.
function pickSignalScoreExtended(features) {
  const base = pickSignalScore(features);
  if (Number.isFinite(base)) return base;
  if (!features || typeof features !== "object") return null;
  const line = features.pro_score_line || features.score_line || features.score_text || null;
  if (!line) return null;
  const m = String(line).match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
}

// pickSignalConfidence — confidence ∈ [0,1] (caller's responsibility
// to clamp; this function just reads the first finite numeric
// value from confidence | signal_confidence | conf).
function pickSignalConfidence(features) {
  if (!features || typeof features !== "object") return null;
  const n = Number(features.confidence ?? features.signal_confidence ?? features.conf);
  return Number.isFinite(n) ? n : null;
}

// pickSignalWaveConf — sister of pickSignalConfidence for the
// zigzag-wave confidence axis (separate score from the main
// confidence). Pre-existing fallback chain: zz_wave_conf →
// wave_conf → wave_confidence.
function pickSignalWaveConf(features) {
  if (!features || typeof features !== "object") return null;
  const n = Number(features.zz_wave_conf ?? features.wave_conf ?? features.wave_confidence);
  return Number.isFinite(n) ? n : null;
}

// pickSignalConflict — bool-coerced "the strategy detected an
// internal conflict" flag. pro_conflict (the canonical Pine v6.1.1
// field) wins over the legacy `conflict` alias. Returns null
// when neither key is set OR when the value isn't bool-coercible.
function pickSignalConflict(features) {
  if (!features || typeof features !== "object") return null;
  if (features.pro_conflict != null) return normalizeBoolLocal(features.pro_conflict, null);
  if (features.conflict != null) return normalizeBoolLocal(features.conflict, null);
  return null;
}

module.exports = {
  pickSignalScore,
  pickSignalScoreExtended,
  pickSignalConfidence,
  pickSignalWaveConf,
  pickSignalConflict,
};
