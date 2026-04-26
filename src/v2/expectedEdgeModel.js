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
  costEstimateBps = null,
  costREquivalent = null,
  regimeProfile = null,
} = {}) {
  const side = upper(signalSide);
  if (side !== "LONG" && side !== "SHORT") throw new Error("SIGNAL_SIDE_REQUIRED");

  const alignment = clamp01(htfAlignmentScore, 0);
  const setup = clamp01(setupQualityScore, 0);
  const market = clamp01(marketQualityScore, 0);
  const gross = Math.max(0, toNumberOrNull(expectedGrossR) ?? 0);
  const net = Math.max(0, toNumberOrNull(expectedNetRAfterCost) ?? 0);
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

  const netEdgeNormalized = Math.min(1, Math.max(0, net / 0.6));
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

  return Object.freeze({
    present: true,
    tp1_reach_probability: tp1ReachProbability,
    continuation_probability: continuationProbability,
    stop_hit_probability: stopHitProbability,
    friction_penalty_score: frictionPenalty,
    gross_r_multiple: gross,
    net_r_multiple: net,
    cost_estimate_bps: toNumberOrNull(costEstimateBps),
    cost_r_equivalent: toNumberOrNull(costREquivalent),
    edge_score: edgeScore,
    edge_score_out_of_20: Math.round(20 * edgeScore),
    edge_cohort: bucketEdgeCohort(edgeScore, net),
    trigger_strength_score: triggerStrength,
  });
}

module.exports = {
  buildExpectedEdgeModel,
  __test: {
    normalizeTriggerStrength,
    normalizeFrictionPenalty,
    bucketEdgeCohort,
  },
};
