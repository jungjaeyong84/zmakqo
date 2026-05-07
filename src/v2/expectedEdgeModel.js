"use strict";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return trimOrNull(value) ? String(value).trim().toUpperCase() : null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function clamp01(value, fallback = 0) {
  const n = toNumberOrNull(value);
  if (n === null) return fallback;
  return Math.max(0, Math.min(1, n));
}

function normalizeTriggerStrength({ signalSide, volumeZScore = null, rsiEntryTf = null } = {}) {
  const side = upper(signalSide);
  const volumeComponent = Math.min(1, Math.max(0, ((toNumberOrNull(volumeZScore) ?? 0) - 1) / 2));
  const rsi = toNumberOrNull(rsiEntryTf);
  const rsiComponent = side === "SHORT"
    ? Math.min(1, Math.max(0, ((45 - (rsi ?? 45)) / 15)))
    : Math.min(1, Math.max(0, (((rsi ?? 55) - 55) / 15)));
  return Number(((0.6 * volumeComponent) + (0.4 * rsiComponent)).toFixed(4));
}

function normalizeFrictionPenalty({ costEstimateBps = null, spreadBps = null, fundingPenaltyBps = null, regimeProfile = null } = {}) {
  const costPenalty = Math.min(1, Math.max(0, (toNumberOrNull(costEstimateBps) ?? 0) / 25));
  const spreadPenalty = Math.min(1, Math.max(0, (toNumberOrNull(spreadBps) ?? 0) / 12));
  const fundingPenalty = Math.min(1, Math.max(0, (toNumberOrNull(fundingPenaltyBps) ?? 0) / 5));
  const thinPenalty = regimeProfile && regimeProfile.liquidity_regime === "THIN" ? 0.3 : 0;
  return Number(Math.min(1, (0.45 * costPenalty) + (0.35 * spreadPenalty) + (0.2 * fundingPenalty) + thinPenalty).toFixed(4));
}

function bucketEdgeCohort(score, expectedNetRAfterCost = null) {
  const net = toNumberOrNull(expectedNetRAfterCost);
  if (!(net > 0)) return "NEGATIVE_EDGE";
  if (score >= 0.75 && net >= 0.4) return "STRONG_EDGE";
  if (score >= 0.6 && net >= 0.25) return "BUILDABLE_EDGE";
  return "MARGINAL_EDGE";
}

function normalizeRollingExpectancy(value) {
  return toNumberOrNull(value);
}

function resolveEmpiricalCohortDowngrade({
  setupType = null,
  regimeProfile = null,
} = {}) {
  const normalizedSetupType = upper(setupType);
  const structuralRegime = upper(regimeProfile && regimeProfile.structural_regime);
  if (normalizedSetupType === "PULLBACK_RECLAIM" && structuralRegime === "TRANSITION") {
    return Object.freeze({
      apply: true,
      target_cohort: "MARGINAL_EDGE",
      authority: "ADVISORY_ONLY",
      reason: "EMPIRICAL_COHORT_DECAY_PULLBACK_RECLAIM_TRANSITION",
    });
  }
  return Object.freeze({
    apply: false,
    target_cohort: null,
    authority: null,
    reason: null,
  });
}

function maybeDowngradeEdgeCohortForRealizedExpectancy(cohort, rollingExpectancy) {
  const expectancy = normalizeRollingExpectancy(rollingExpectancy);
  if (expectancy === null || expectancy > 0) return cohort;
  if (cohort === "STRONG_EDGE" || cohort === "BUILDABLE_EDGE") return "MARGINAL_EDGE";
  return cohort;
}

function applyEdgeCohortAuthority({
  rawEdgeCohort,
  edgeCohortAfterRealizedExpectancy,
  rollingExpectancy,
  empiricalCohortDowngrade = null,
}) {
  const empirical = empiricalCohortDowngrade && empiricalCohortDowngrade.apply === true
    ? empiricalCohortDowngrade
    : null;
  if (empirical) {
    const downgraded = rawEdgeCohort !== empirical.target_cohort || edgeCohortAfterRealizedExpectancy !== empirical.target_cohort;
    return Object.freeze({
      edge_cohort: empirical.target_cohort,
      edge_cohort_authority: empirical.authority,
      edge_cohort_downgraded: downgraded,
      edge_cohort_downgrade_reason: empirical.reason,
      edge_cohort_downgraded_by_realized_expectancy: edgeCohortAfterRealizedExpectancy !== rawEdgeCohort,
      edge_cohort_downgraded_by_empirical_cohort_risk: true,
    });
  }
  // 2026-05-05: realized V2 outcomes showed BUILDABLE_EDGE is not
  // monotonic with realized PnL. Keep the raw label for diagnostics, but
  // remove its authority from live decisions until cohort-level recovery is
  // proven. STRONG_EDGE can still survive if realized expectancy is positive.
  if (rawEdgeCohort === "BUILDABLE_EDGE") {
    return Object.freeze({
      edge_cohort: "MARGINAL_EDGE",
      edge_cohort_authority: "ADVISORY_ONLY",
      edge_cohort_downgraded: true,
      edge_cohort_downgrade_reason: "BUILDABLE_EDGE_ADVISORY_ONLY",
      edge_cohort_downgraded_by_realized_expectancy: normalizeRollingExpectancy(rollingExpectancy) !== null
        && normalizeRollingExpectancy(rollingExpectancy) <= 0,
      edge_cohort_downgraded_by_empirical_cohort_risk: false,
    });
  }
  return Object.freeze({
    edge_cohort: edgeCohortAfterRealizedExpectancy,
    edge_cohort_authority: "AUTHORITATIVE",
    edge_cohort_downgraded: edgeCohortAfterRealizedExpectancy !== rawEdgeCohort,
    edge_cohort_downgrade_reason: edgeCohortAfterRealizedExpectancy !== rawEdgeCohort
      ? "REALIZED_EXPECTANCY_NON_POSITIVE"
      : null,
    edge_cohort_downgraded_by_realized_expectancy: edgeCohortAfterRealizedExpectancy !== rawEdgeCohort,
    edge_cohort_downgraded_by_empirical_cohort_risk: false,
  });
}

function buildExpectedEdgeModel({
  signalSide,
  htfAlignmentScore = null,
  setupQualityScore = null,
  volumeZScore = null,
  rsiEntryTf = null,
  marketQualityScore = null,
  spreadBps = null,
  fundingPenaltyBps = null,
  expectedGrossR = null,
  expectedNetRAfterCost = null,
  effectiveExpectedNetRAfterCost = null,
  costEstimateBps = null,
  costREquivalent = null,
  adverseSelectionPenaltyR = null,
  edgeCohortRollingExpectancy = null,
  setupType = null,
  regimeProfile = null,
} = {}) {
  const side = upper(signalSide);
  if (side !== "LONG" && side !== "SHORT") throw new Error("SIGNAL_SIDE_REQUIRED");

  const alignment = clamp01(htfAlignmentScore, 0);
  const setup = clamp01(setupQualityScore, 0);
  const market = clamp01(marketQualityScore, 0);
  const gross = Math.max(0, toNumberOrNull(expectedGrossR) ?? 0);
  const rawNet = Math.max(0, toNumberOrNull(expectedNetRAfterCost) ?? 0);
  const effectiveNet = Math.max(0, toNumberOrNull(effectiveExpectedNetRAfterCost) ?? rawNet);
  const triggerStrength = normalizeTriggerStrength({ signalSide: side, volumeZScore, rsiEntryTf });
  const frictionPenalty = normalizeFrictionPenalty({
    costEstimateBps,
    spreadBps,
    fundingPenaltyBps,
    regimeProfile,
  });
  const regimeScore = clamp01(regimeProfile && regimeProfile.regime_score, 0.5);
  const continuationProbability = Number(Math.max(0, Math.min(1,
    0.1 + (0.25 * alignment) + (0.2 * setup) + (0.15 * market) + (0.2 * regimeScore) + (0.1 * triggerStrength) - (0.15 * frictionPenalty)
  )).toFixed(4));
  const tp1ReachProbability = Number(Math.max(0, Math.min(1,
    0.15 + (0.2 * alignment) + (0.2 * setup) + (0.2 * triggerStrength) + (0.1 * market) + (0.1 * regimeScore) + (0.1 * Math.min(1, gross / 2.5)) - (0.15 * frictionPenalty)
  )).toFixed(4));
  const stopHitProbability = Number(Math.max(0, Math.min(1,
    0.75 - (0.2 * setup) - (0.15 * alignment) - (0.1 * triggerStrength) - (0.1 * market) - (0.1 * regimeScore) + (0.1 * frictionPenalty)
  )).toFixed(4));

  const netEdgeNormalized = Math.min(1, Math.max(0, effectiveNet / 0.6));
  const grossEdgeNormalized = Math.min(1, Math.max(0, (gross - 1.2) / 1.2));
  const costPenaltyNormalized = Math.min(1, Math.max(0, (toNumberOrNull(costEstimateBps) ?? 0) / 25));
  const edgeScore = Number(Math.max(0, Math.min(1,
    (0.3 * netEdgeNormalized)
    + (0.15 * grossEdgeNormalized)
    + (0.2 * tp1ReachProbability)
    + (0.15 * continuationProbability)
    + (0.15 * regimeScore)
    - (0.1 * stopHitProbability)
    - (0.05 * costPenaltyNormalized)
  )).toFixed(4));

  const rawEdgeCohort = bucketEdgeCohort(edgeScore, effectiveNet);
  const edgeCohortAfterRealizedExpectancy = maybeDowngradeEdgeCohortForRealizedExpectancy(rawEdgeCohort, edgeCohortRollingExpectancy);
  const empiricalCohortDowngrade = resolveEmpiricalCohortDowngrade({
    setupType,
    regimeProfile,
  });
  const edgeCohortAuthority = applyEdgeCohortAuthority({
    rawEdgeCohort,
    edgeCohortAfterRealizedExpectancy,
    rollingExpectancy: edgeCohortRollingExpectancy,
    empiricalCohortDowngrade,
  });

  return Object.freeze({
    present: true,
    tp1_reach_probability: tp1ReachProbability,
    continuation_probability: continuationProbability,
    stop_hit_probability: stopHitProbability,
    friction_penalty_score: frictionPenalty,
    gross_r_multiple: gross,
    net_r_multiple: rawNet,
    effective_net_r_multiple: effectiveNet,
    adverse_selection_penalty_r: toNumberOrNull(adverseSelectionPenaltyR) ?? 0,
    cost_estimate_bps: toNumberOrNull(costEstimateBps),
    cost_r_equivalent: toNumberOrNull(costREquivalent),
    edge_score: edgeScore,
    edge_score_out_of_20: Math.round(20 * edgeScore),
    raw_edge_cohort: rawEdgeCohort,
    edge_cohort: edgeCohortAuthority.edge_cohort,
    edge_cohort_authority: edgeCohortAuthority.edge_cohort_authority,
    edge_cohort_rolling_expectancy: normalizeRollingExpectancy(edgeCohortRollingExpectancy),
    edge_cohort_downgraded: edgeCohortAuthority.edge_cohort_downgraded,
    edge_cohort_downgrade_reason: edgeCohortAuthority.edge_cohort_downgrade_reason,
    edge_cohort_downgraded_by_realized_expectancy: edgeCohortAuthority.edge_cohort_downgraded_by_realized_expectancy,
    edge_cohort_downgraded_by_empirical_cohort_risk: edgeCohortAuthority.edge_cohort_downgraded_by_empirical_cohort_risk,
    trigger_strength_score: triggerStrength,
  });
}

module.exports = {
  buildExpectedEdgeModel,
  __test: {
    normalizeTriggerStrength,
    normalizeFrictionPenalty,
    bucketEdgeCohort,
    resolveEmpiricalCohortDowngrade,
    maybeDowngradeEdgeCohortForRealizedExpectancy,
    applyEdgeCohortAuthority,
  },
};
