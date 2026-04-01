"use strict";

const TRANSITION_CORE_QUALITY_RULE = Object.freeze({
  confidence_min: 0.45,
  posterior_min: 0.52,
  wave_conf_min: 0.55,
  transition_risk_max: 0.48,
  field_alignment_min: 0.55,
  coherence_min: 0.52,
});

function resolveTransitionCoreQuality(snapshot = {}) {
  const checks = [];
  if (Number.isFinite(snapshot.confidence)) checks.push(snapshot.confidence >= TRANSITION_CORE_QUALITY_RULE.confidence_min);
  if (Number.isFinite(snapshot.posterior)) checks.push(snapshot.posterior >= TRANSITION_CORE_QUALITY_RULE.posterior_min);
  if (Number.isFinite(snapshot.wave_conf)) checks.push(snapshot.wave_conf >= TRANSITION_CORE_QUALITY_RULE.wave_conf_min);
  if (Number.isFinite(snapshot.transition_risk)) checks.push(snapshot.transition_risk <= TRANSITION_CORE_QUALITY_RULE.transition_risk_max);
  if (Number.isFinite(snapshot.field_alignment)) checks.push(snapshot.field_alignment >= TRANSITION_CORE_QUALITY_RULE.field_alignment_min);
  if (Number.isFinite(snapshot.coherence)) checks.push(snapshot.coherence >= TRANSITION_CORE_QUALITY_RULE.coherence_min);
  if (!checks.length) return { observed: false, pass: true };
  return { observed: true, pass: checks.every(Boolean) };
}

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
    if (inTransition) {
      const transitionQuality = resolveTransitionCoreQuality(snap);
      if (transitionQuality.observed && !transitionQuality.pass) {
        return {
          applicable: true,
          observed: true,
          pass: false,
          reason: "TRANSITION_CORE_QUALITY_FAIL",
          reason_code: "DROP_CANONICAL_ENGINE_TRANSITION_CORE_QUALITY",
          min_score_abs: minScoreAbs,
          transition_core_quality_observed: true,
          transition_core_quality_pass: false,
        };
      }
      return {
        applicable: true,
        observed: true,
        pass: true,
        reason: "TRANSITION_CORE_SCORE_PASS",
        reason_code: null,
        min_score_abs: minScoreAbs,
        transition_core_quality_observed: transitionQuality.observed,
        transition_core_quality_pass: transitionQuality.pass,
      };
    }
    return {
      applicable: true,
      observed: true,
      pass: true,
      reason: "CORE_SCORE_PASS",
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
  TRANSITION_CORE_QUALITY_RULE,
  resolveCanonicalSignalClassification,
};
