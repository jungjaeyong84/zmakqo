"use strict";

const crypto = require("crypto");

const { resolveCanonicalFeatureSnapshot } = require("./featureSnapshot");
const { resolveFebtTimingSnapshot } = require("./febtTimingResolver");
const { resolveCanonicalSignalClassification } = require("./signalClassifier");
const { resolveCanonicalEngineConfig } = require("./thresholdResolver");

function normalizeDecisionFlag(value, fallback = null) {
  const raw = String(value || "").trim().toUpperCase();
  if (raw === "PASS") return "PASS";
  if (raw === "DROP" || raw === "BLOCK") return "DROP";
  return fallback;
}

function buildCanonicalDecisionId({
  snapshot = {},
  resolvedConfig = {},
  classification = {},
  actualSourceDecision = null,
  actualSourceReason = null,
  pineShadowDecision = null,
  policyOrigin = null,
} = {}) {
  const payload = JSON.stringify({
    market: snapshot.market || null,
    tf: snapshot.tf || null,
    event: snapshot.event_upper || null,
    side: snapshot.side || null,
    tier: snapshot.tier || null,
    regime: snapshot.regime || null,
    score_abs: snapshot.score_abs,
    source_mode: resolvedConfig.sourceMode || null,
    bundle_version: resolvedConfig.bundleVersion || null,
    threshold_bundle_version: resolvedConfig.thresholdBundleVersion || null,
    classification_pass: classification.pass,
    classification_reason: classification.reason || null,
    actual_source_decision: actualSourceDecision,
    actual_source_reason: actualSourceReason,
    pine_shadow_decision: pineShadowDecision,
    policy_origin: policyOrigin,
  });
  return `ced_${crypto.createHash("sha1").update(payload).digest("hex").slice(0, 16)}`;
}

function evaluateCanonicalDecision({ features, event, side, market, tf, config, pineShadowDecision = "PASS" } = {}) {
  const snapshot = resolveCanonicalFeatureSnapshot({ features, event, side, market, tf });
  const resolvedConfig = config || resolveCanonicalEngineConfig({}, { market: snapshot.market });
  const classification = resolveCanonicalSignalClassification({ snapshot, config: resolvedConfig });
  const febt = resolveFebtTimingSnapshot({ features });
  const normalizedPineShadowDecision = normalizeDecisionFlag(pineShadowDecision, "PASS");
  const actualSourcePass = !(
    resolvedConfig.enforce === true
    && classification.applicable === true
    && classification.observed === true
    && classification.pass !== true
  );
  const actualSourceDecision = actualSourcePass ? "PASS" : "DROP";
  const actualSourceReason = actualSourcePass
    ? (classification.reason || "SOURCE_PASS")
    : (classification.reason_code || classification.reason || "DROP_CANONICAL_ENGINE");
  const pineShadowPass = normalizedPineShadowDecision === "PASS"
    ? true
    : (normalizedPineShadowDecision === "DROP" ? false : null);
  const pineShadowReason = pineShadowPass === true
    ? "PINE_ALERT_UPSTREAM_PASS"
    : (pineShadowPass === false ? "PINE_ALERT_UPSTREAM_DROP" : null);
  const pineShadowParityMatch = pineShadowPass === null ? null : pineShadowPass === actualSourcePass;
  const policyOrigin = resolvedConfig.marketOverrideActive === true ? "MARKET_OVERRIDE" : "GLOBAL_DEFAULT";
  const policyOriginDetail = resolvedConfig.marketOverrideActive === true
    ? (resolvedConfig.marketOverrideKey || null)
    : "ALL";
  const decisionId = buildCanonicalDecisionId({
    snapshot,
    resolvedConfig,
    classification,
    actualSourceDecision,
    actualSourceReason,
    pineShadowDecision: normalizedPineShadowDecision,
    policyOrigin,
  });
  const detail = {
    canonical_engine_enabled: resolvedConfig.enabled === true,
    canonical_engine_shadow_enabled: resolvedConfig.shadowEnabled === true,
    canonical_engine_source_mode: resolvedConfig.sourceMode || null,
    canonical_engine_source_mode_effective: resolvedConfig.sourceMode || null,
    canonical_engine_market_override_key: resolvedConfig.marketOverrideKey || null,
    canonical_engine_market_override_active: resolvedConfig.marketOverrideActive === true,
    canonical_engine_decision_id: decisionId,
    canonical_engine_bundle_version: resolvedConfig.bundleVersion || null,
    canonical_engine_threshold_bundle_version: resolvedConfig.thresholdBundleVersion || null,
    canonical_engine_threshold_bundle_signature: resolvedConfig.thresholdBundleSignature || null,
    canonical_engine_policy_origin: policyOrigin,
    canonical_engine_policy_origin_detail: policyOriginDetail,
    canonical_engine_tier: snapshot.tier || null,
    canonical_engine_regime: snapshot.regime || null,
    canonical_engine_score: snapshot.score,
    canonical_engine_score_abs: snapshot.score_abs,
    canonical_engine_confidence: snapshot.confidence,
    canonical_engine_wave_conf: snapshot.wave_conf,
    canonical_engine_posterior: snapshot.posterior,
    canonical_engine_transition_risk: snapshot.transition_risk,
    canonical_engine_coherence: snapshot.coherence,
    canonical_engine_entropy: snapshot.entropy,
    canonical_engine_field_alignment: snapshot.field_alignment,
    canonical_engine_domain_wall_density: snapshot.domain_wall_density,
    canonical_engine_susceptibility: snapshot.susceptibility,
    canonical_engine_free_energy: snapshot.free_energy,
    canonical_engine_strategy_id: snapshot.strategy_id,
    canonical_engine_entry_grade: snapshot.entry_grade,
    canonical_engine_core_score_abs_min: resolvedConfig.coreScoreAbs,
    canonical_engine_transition_core_score_abs_min: resolvedConfig.transitionCoreScoreAbs,
    canonical_engine_shadow_applicable: classification.applicable === true,
    canonical_engine_shadow_observed: classification.observed === true,
    canonical_engine_shadow_pass: classification.applicable ? classification.pass === true : null,
    canonical_engine_shadow_reason: classification.reason || null,
    canonical_engine_actual_source_decision: actualSourceDecision,
    canonical_engine_actual_source_pass: actualSourcePass,
    canonical_engine_actual_source_reason: actualSourceReason,
    canonical_engine_actual_source_evidence: "EVALUATED",
    pine_shadow_decision: normalizedPineShadowDecision,
    pine_shadow_pass: pineShadowPass,
    pine_shadow_reason: pineShadowReason,
    pine_shadow_parity_match: pineShadowParityMatch,
    pine_shadow_evidence: "UPSTREAM_ALERT",
    canonical_engine_febt_payload_present: febt.payload_present === true,
    canonical_engine_febt_calc_ok: febt.calc_ok,
    canonical_engine_febt_phase: febt.phase,
    canonical_engine_febt_verdict: febt.verdict,
  };

  if (resolvedConfig.enforce && classification.applicable && classification.observed && !classification.pass) {
    return {
      ok: false,
      reason: classification.reason_code || "DROP_CANONICAL_ENGINE",
      detail,
      snapshot,
      config: resolvedConfig,
      classification,
    };
  }
  return {
    ok: true,
    reason: null,
    detail,
    snapshot,
    config: resolvedConfig,
    classification,
  };
}

module.exports = {
  evaluateCanonicalDecision,
};
