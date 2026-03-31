"use strict";

function resolveCanonicalSignalClassification({ snapshot, config } = {}) {
  const snap = (snapshot && typeof snapshot === "object") ? snapshot : {};
  const cfg = (config && typeof config === "object") ? config : {};
  if (!snap.primary_long_short) {
    return { applicable: false, observed: false, pass: true, reason: "NON_PRIMARY_LONG_SHORT", reason_code: null };
  }
  if (!snap.core_tier) {
    return { applicable: false, observed: false, pass: true, reason: "NON_CORE_TIER", reason_code: null };
  }
  if (!Number.isFinite(snap.score_abs)) {
    return { applicable: true, observed: false, pass: true, reason: "CORE_SCORE_MISSING", reason_code: null };
  }
  const inTransition = snap.regime === "transition";
  const minScoreAbs = inTransition
    ? Number(cfg.transitionCoreScoreAbs)
    : Number(cfg.coreScoreAbs);
  if (!Number.isFinite(minScoreAbs)) {
    return { applicable: true, observed: false, pass: true, reason: "THRESHOLD_MISSING", reason_code: null };
  }
  if (snap.score_abs >= minScoreAbs) {
    return {
      applicable: true,
      observed: true,
      pass: true,
      reason: inTransition ? "TRANSITION_CORE_SCORE_PASS" : "CORE_SCORE_PASS",
      reason_code: null,
      min_score_abs: minScoreAbs,
    };
  }
  return {
    applicable: true,
    observed: true,
    pass: false,
    reason: inTransition ? "TRANSITION_CORE_SCORE_FAIL" : "CORE_SCORE_FAIL",
    reason_code: inTransition ? "DROP_CANONICAL_ENGINE_TRANSITION_CORE_SCORE" : "DROP_CANONICAL_ENGINE_CORE_SCORE",
    min_score_abs: minScoreAbs,
  };
}

module.exports = {
  resolveCanonicalSignalClassification,
};
