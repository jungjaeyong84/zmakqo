"use strict";

const { buildSignalRegimeProfile } = require("./signalRegimeProfile");
const { buildExpectedEdgeModel } = require("./expectedEdgeModel");

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

function asObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function asBooleanOrNull(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "boolean") return value;
  const token = String(value).trim().toLowerCase();
  if (!token) return null;
  if (["1", "true", "yes", "on"].includes(token)) return true;
  if (["0", "false", "no", "off"].includes(token)) return false;
  return null;
}

function clamp01(value, fallback = 0) {
  const n = toNumberOrNull(value);
  if (n === null) return fallback;
  return Math.max(0, Math.min(1, n));
}

function clamp01OrNull(value) {
  const n = toNumberOrNull(value);
  if (n === null) return null;
  return Math.max(0, Math.min(1, n));
}

function resolveFeatureValue(featureValues, ...keys) {
  const features = asObject(featureValues);
  if (!features) return null;
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(features, key)) {
      return features[key];
    }
  }
  return null;
}

function normalizeSetupType(value) {
  const token = upper(value);
  if (!token) return "NONE";
  if (token === "PULLBACK_RECLAIM" || token === "BREAKOUT_RETEST" || token === "NONE") {
    return token;
  }
  return "NONE";
}

function normalizeRegime(value) {
  const token = upper(value);
  if (token === "LONG" || token === "SHORT" || token === "NEUTRAL") return token;
  return "NEUTRAL";
}

function pushMissingEvidence(blockers, field, value) {
  if (value === null || value === undefined || value === "NONE") {
    blockers.push(`NO_EVIDENCE:${field}`);
    return true;
  }
  return false;
}

function resolveMarketMetrics(marketDataQuality = null) {
  const row = asObject(marketDataQuality);
  const metrics = asObject(row && row.metrics);
  return metrics || {};
}

function buildSignalCriteria({
  signalSide,
  signalCriteria = null,
  qualityScore = null,
  featureValues = null,
  marketDataQuality = null,
  htfRegime = null,
  htfAlignmentScore = null,
  setupType = null,
  setupQualityScore = null,
  triggerLevel = null,
  triggerConfirmed = null,
  volumeZScore = null,
  rsiEntryTf = null,
  marketQualityScore = null,
  spreadBps = null,
  markIndexGapBps = null,
  expectedGrossR = null,
  expectedNetRAfterCost = null,
  costEstimateBps = null,
  costREquivalent = null,
  fundingPenaltyBps = null,
  signalScore = null,
  thresholds = null,
} = {}) {
  const side = upper(signalSide);
  if (side !== "LONG" && side !== "SHORT") {
    throw new Error("SIGNAL_SIDE_REQUIRED");
  }

  const seed = asObject(signalCriteria) || {};
  const features = asObject(featureValues) || {};
  const market = asObject(marketDataQuality) || {};
  const metrics = resolveMarketMetrics(marketDataQuality);
  const cfg = asObject(thresholds) || {};

  const resolvedThresholds = Object.freeze({
    max_spread_bps: toNumberOrNull(cfg.max_spread_bps) ?? 8,
    max_mark_index_gap_bps: toNumberOrNull(cfg.max_mark_index_gap_bps) ?? 10,
    max_funding_penalty_bps: toNumberOrNull(cfg.max_funding_penalty_bps) ?? 3,
    min_htf_alignment_score: toNumberOrNull(cfg.min_htf_alignment_score) ?? 0.6,
    min_setup_quality_score: toNumberOrNull(cfg.min_setup_quality_score) ?? 0.6,
    min_market_quality_score: toNumberOrNull(cfg.min_market_quality_score) ?? 0.7,
    min_volume_zscore: toNumberOrNull(cfg.min_volume_zscore) ?? 1,
    min_rsi_long: toNumberOrNull(cfg.min_rsi_long) ?? 55,
    max_rsi_short: toNumberOrNull(cfg.max_rsi_short) ?? 45,
    min_expected_gross_r: toNumberOrNull(cfg.min_expected_gross_r) ?? 1.8,
    min_expected_net_r_after_cost: toNumberOrNull(cfg.min_expected_net_r_after_cost) ?? 0.25,
    min_signal_score: toNumberOrNull(cfg.min_signal_score) ?? 80,
  });

  const resolvedHtfRegime = normalizeRegime(
    (seed.htf_regime && seed.htf_regime.regime)
    ?? seed.htf_regime
    ?? htfRegime
    ?? resolveFeatureValue(features, "htf_regime", "htf_direction")
  );
  const resolvedHtfAlignmentScore = clamp01OrNull(
    (seed.htf_regime && seed.htf_regime.alignment_score)
    ?? seed.htf_alignment_score
    ?? htfAlignmentScore
    ?? resolveFeatureValue(features, "htf_alignment_score", "htf_confidence")
    ?? qualityScore
  );
  const resolvedSetupType = normalizeSetupType(
    (seed.setup_gate && seed.setup_gate.setup_type)
    ?? seed.setup_type
    ?? setupType
    ?? resolveFeatureValue(features, "setup_type")
    ?? "NONE"
  );
  const resolvedSetupQualityScore = clamp01OrNull(
    (seed.setup_gate && seed.setup_gate.setup_quality_score)
    ?? seed.setup_quality_score
    ?? setupQualityScore
    ?? resolveFeatureValue(features, "setup_quality_score")
    ?? null
  );
  const resolvedTriggerLevel = toNumberOrNull(
    (seed.trigger_gate && seed.trigger_gate.trigger_level)
    ?? seed.trigger_level
    ?? triggerLevel
    ?? resolveFeatureValue(features, "trigger_level")
  );
  const resolvedTriggerConfirmedRaw = asBooleanOrNull(
    (seed.trigger_gate && seed.trigger_gate.trigger_confirmed)
    ?? seed.trigger_confirmed
    ?? triggerConfirmed
    ?? resolveFeatureValue(features, "trigger_confirmed")
  );
  const resolvedTriggerConfirmed = resolvedTriggerConfirmedRaw === true;
  const resolvedVolumeZScore = toNumberOrNull(
    (seed.trigger_gate && seed.trigger_gate.volume_zscore)
    ?? seed.volume_zscore
    ?? volumeZScore
    ?? resolveFeatureValue(features, "volume_zscore")
  );
  const resolvedRsiEntryTf = toNumberOrNull(
    (seed.trigger_gate && seed.trigger_gate.rsi_entry_tf)
    ?? seed.rsi_entry_tf
    ?? rsiEntryTf
    ?? resolveFeatureValue(features, "rsi_entry_tf")
  );
  const resolvedMarketQualityScore = clamp01OrNull(
    (seed.no_trade_gate && seed.no_trade_gate.market_quality_score)
    ?? seed.market_quality_score
    ?? marketQualityScore
    ?? resolveFeatureValue(features, "market_quality_score")
    ?? null
  );
  const resolvedSpreadBps = toNumberOrNull(
    (seed.no_trade_gate && seed.no_trade_gate.spread_bps)
    ?? seed.spread_bps
    ?? spreadBps
    ?? resolveFeatureValue(features, "spread_bps")
    ?? metrics.spread_bps
  );
  const resolvedMarkIndexGapBps = toNumberOrNull(
    (seed.no_trade_gate && seed.no_trade_gate.mark_index_gap_bps)
    ?? seed.mark_index_gap_bps
    ?? markIndexGapBps
    ?? resolveFeatureValue(features, "mark_index_gap_bps")
    ?? metrics.mark_index_gap_bps
  );
  const resolvedExpectedGrossR = toNumberOrNull(
    (seed.expected_edge_gate && seed.expected_edge_gate.expected_gross_r)
    ?? seed.expected_gross_r
    ?? expectedGrossR
    ?? resolveFeatureValue(features, "expected_gross_r")
  );
  const resolvedExpectedNetRAfterCost = toNumberOrNull(
    (seed.expected_edge_gate && seed.expected_edge_gate.expected_net_r_after_cost)
    ?? seed.expected_net_r_after_cost
    ?? expectedNetRAfterCost
    ?? resolveFeatureValue(features, "expected_net_r_after_cost")
  );
  const resolvedCostEstimateBps = toNumberOrNull(
    (seed.expected_edge_gate && seed.expected_edge_gate.cost_estimate_bps)
    ?? seed.cost_estimate_bps
    ?? costEstimateBps
    ?? resolveFeatureValue(features, "cost_estimate_bps")
  );
  const resolvedCostREquivalent = toNumberOrNull(
    (seed.expected_edge_gate && seed.expected_edge_gate.cost_r_equivalent)
    ?? seed.cost_r_equivalent
    ?? costREquivalent
    ?? resolveFeatureValue(features, "cost_r_equivalent")
  );
  const resolvedFundingPenaltyBps = toNumberOrNull(
    (seed.no_trade_gate && seed.no_trade_gate.funding_penalty_bps)
    ?? seed.funding_penalty_bps
    ?? fundingPenaltyBps
    ?? resolveFeatureValue(features, "funding_penalty_bps")
  );

  const regimeProfile = buildSignalRegimeProfile({
    signalSide: side,
    featureValues: features,
    marketDataQuality: marketDataQuality,
    marketRegime: resolveFeatureValue(features, "market_regime", "regime"),
    htfRegime: resolvedHtfRegime,
    htfAlignmentScore: resolvedHtfAlignmentScore,
    setupType: resolvedSetupType,
    marketQualityScore: resolvedMarketQualityScore,
    spreadBps: resolvedSpreadBps,
  });

  const noTradeBlockers = [];
  pushMissingEvidence(noTradeBlockers, "MARKET_QUALITY_SCORE", resolvedMarketQualityScore);
  pushMissingEvidence(noTradeBlockers, "SPREAD_BPS", resolvedSpreadBps);
  pushMissingEvidence(noTradeBlockers, "MARK_INDEX_GAP_BPS", resolvedMarkIndexGapBps);
  pushMissingEvidence(noTradeBlockers, "FUNDING_PENALTY_BPS", resolvedFundingPenaltyBps);
  if (market.ok !== true) noTradeBlockers.push("MARKET_DATA_QUALITY_NOT_OK");
  if (!(resolvedMarketQualityScore >= resolvedThresholds.min_market_quality_score)) noTradeBlockers.push("MARKET_QUALITY_TOO_LOW");
  if (!(resolvedSpreadBps <= resolvedThresholds.max_spread_bps)) noTradeBlockers.push("SPREAD_TOO_WIDE");
  if (!(resolvedMarkIndexGapBps <= resolvedThresholds.max_mark_index_gap_bps)) noTradeBlockers.push("MARK_INDEX_GAP_TOO_WIDE");
  if (!(resolvedFundingPenaltyBps <= resolvedThresholds.max_funding_penalty_bps)) noTradeBlockers.push("FUNDING_PENALTY_TOO_HIGH");

  const htfBlockers = [];
  pushMissingEvidence(htfBlockers, "HTF_REGIME", resolvedHtfRegime === "NEUTRAL" ? null : resolvedHtfRegime);
  pushMissingEvidence(htfBlockers, "HTF_ALIGNMENT_SCORE", toNumberOrNull(resolvedHtfAlignmentScore));
  const htfPass = resolvedHtfRegime === side && resolvedHtfAlignmentScore >= resolvedThresholds.min_htf_alignment_score;
  const setupBlockers = [];
  pushMissingEvidence(setupBlockers, "SETUP_TYPE", resolvedSetupType === "NONE" ? null : resolvedSetupType);
  pushMissingEvidence(setupBlockers, "SETUP_QUALITY_SCORE", toNumberOrNull(resolvedSetupQualityScore));
  const setupPass = resolvedSetupType !== "NONE" && resolvedSetupQualityScore >= resolvedThresholds.min_setup_quality_score;
  const rsiPass = side === "LONG"
    ? resolvedRsiEntryTf >= resolvedThresholds.min_rsi_long
    : resolvedRsiEntryTf <= resolvedThresholds.max_rsi_short;
  const triggerBlockers = [];
  pushMissingEvidence(triggerBlockers, "TRIGGER_CONFIRMED", resolvedTriggerConfirmedRaw);
  pushMissingEvidence(triggerBlockers, "VOLUME_ZSCORE", resolvedVolumeZScore);
  pushMissingEvidence(triggerBlockers, "RSI_ENTRY_TF", resolvedRsiEntryTf);
  const triggerPass = resolvedTriggerConfirmed === true
    && resolvedVolumeZScore >= resolvedThresholds.min_volume_zscore
    && rsiPass;
  const edgeBlockers = [];
  pushMissingEvidence(edgeBlockers, "EXPECTED_GROSS_R", resolvedExpectedGrossR);
  pushMissingEvidence(edgeBlockers, "EXPECTED_NET_R_AFTER_COST", resolvedExpectedNetRAfterCost);
  pushMissingEvidence(edgeBlockers, "COST_ESTIMATE_BPS", resolvedCostEstimateBps);
  pushMissingEvidence(edgeBlockers, "COST_R_EQUIVALENT", resolvedCostREquivalent);
  const accountingDelta = (
    Number.isFinite(resolvedExpectedGrossR)
    && Number.isFinite(resolvedExpectedNetRAfterCost)
    && Number.isFinite(resolvedCostREquivalent)
  )
    ? Math.abs((resolvedExpectedGrossR - resolvedCostREquivalent) - resolvedExpectedNetRAfterCost)
    : null;
  const accountingConsistent = accountingDelta !== null && accountingDelta <= 0.05;
  if (accountingDelta !== null && !accountingConsistent) edgeBlockers.push("ACCOUNTING_INCONSISTENT");
  const edgePass = resolvedExpectedGrossR >= resolvedThresholds.min_expected_gross_r
    && resolvedExpectedNetRAfterCost >= resolvedThresholds.min_expected_net_r_after_cost;
  const fullyConsistentEdgePass = edgePass && accountingConsistent;
  const expectedEdgeModel = buildExpectedEdgeModel({
    signalSide: side,
    htfAlignmentScore: resolvedHtfAlignmentScore,
    setupQualityScore: resolvedSetupQualityScore,
    volumeZScore: resolvedVolumeZScore,
    rsiEntryTf: resolvedRsiEntryTf,
    marketQualityScore: resolvedMarketQualityScore,
    spreadBps: resolvedSpreadBps,
    fundingPenaltyBps: resolvedFundingPenaltyBps,
    expectedGrossR: resolvedExpectedGrossR,
    expectedNetRAfterCost: resolvedExpectedNetRAfterCost,
    costEstimateBps: resolvedCostEstimateBps,
    costREquivalent: resolvedCostREquivalent,
    regimeProfile,
  });

  const componentScores = Object.freeze({
    htf_regime: htfPass ? Math.round(25 * resolvedHtfAlignmentScore) : 0,
    setup_quality: setupPass ? Math.round(20 * resolvedSetupQualityScore) : 0,
    trigger_quality: triggerPass
      ? Math.round(8 + (6 * Math.min(1, Math.max(0, resolvedVolumeZScore - resolvedThresholds.min_volume_zscore))) + (6 * Math.min(1, Math.max(0, side === "LONG"
        ? (resolvedRsiEntryTf - resolvedThresholds.min_rsi_long) / 10
        : (resolvedThresholds.max_rsi_short - resolvedRsiEntryTf) / 10))))
      : 0,
    market_quality: noTradeBlockers.length === 0 ? Math.round(15 * resolvedMarketQualityScore) : 0,
    expected_edge: fullyConsistentEdgePass ? expectedEdgeModel.edge_score_out_of_20 : 0,
  });

  const computedSignalScore = Object.values(componentScores).reduce((sum, value) => sum + value, 0);
  const finalSignalScore = computedSignalScore;

  const blockers = [];
  if (noTradeBlockers.length) blockers.push(...noTradeBlockers.map((code) => `NO_TRADE:${code}`));
  if (htfBlockers.length) blockers.push(...htfBlockers.map((code) => `HTF_REGIME:${code}`));
  if (!htfPass) blockers.push("HTF_REGIME:ALIGNMENT_REQUIRED");
  if (setupBlockers.length) blockers.push(...setupBlockers.map((code) => `SETUP:${code}`));
  if (!setupPass) blockers.push("SETUP:QUALITY_REQUIRED");
  if (triggerBlockers.length) blockers.push(...triggerBlockers.map((code) => `TRIGGER:${code}`));
  if (!triggerPass) blockers.push("TRIGGER:CONFIRMATION_REQUIRED");
  if (edgeBlockers.length) blockers.push(...edgeBlockers.map((code) => `EXPECTED_EDGE:${code}`));
  if (!fullyConsistentEdgePass) blockers.push("EXPECTED_EDGE:NET_R_REQUIRED");
  if (!(finalSignalScore >= resolvedThresholds.min_signal_score)) blockers.push("SIGNAL_SCORE:MIN_SCORE_REQUIRED");

  return Object.freeze({
    present: true,
    verdict: blockers.length === 0 ? "PASS" : "BLOCK",
    blockers: Object.freeze(blockers),
    thresholds: resolvedThresholds,
    signal_score: finalSignalScore,
    signal_score_components: componentScores,
    no_trade_gate: Object.freeze({
      ok: noTradeBlockers.length === 0,
      blockers: Object.freeze(noTradeBlockers),
      spread_bps: resolvedSpreadBps,
      mark_index_gap_bps: resolvedMarkIndexGapBps,
      funding_penalty_bps: resolvedFundingPenaltyBps,
      market_quality_score: resolvedMarketQualityScore,
    }),
    htf_regime: Object.freeze({
      regime: resolvedHtfRegime,
      alignment_score: resolvedHtfAlignmentScore,
      ok: htfPass,
    }),
    setup_gate: Object.freeze({
      setup_type: resolvedSetupType,
      setup_quality_score: resolvedSetupQualityScore,
      ok: setupPass,
    }),
    trigger_gate: Object.freeze({
      trigger_level: resolvedTriggerLevel,
      trigger_confirmed: resolvedTriggerConfirmed,
      volume_zscore: resolvedVolumeZScore,
      rsi_entry_tf: resolvedRsiEntryTf,
      ok: triggerPass,
    }),
    expected_edge_gate: Object.freeze({
      expected_gross_r: resolvedExpectedGrossR,
      expected_net_r_after_cost: resolvedExpectedNetRAfterCost,
      cost_estimate_bps: resolvedCostEstimateBps,
      cost_r_equivalent: resolvedCostREquivalent,
      accounting_delta_r: accountingDelta,
      edge_cohort: expectedEdgeModel.edge_cohort,
      tp1_reach_probability: expectedEdgeModel.tp1_reach_probability,
      continuation_probability: expectedEdgeModel.continuation_probability,
      stop_hit_probability: expectedEdgeModel.stop_hit_probability,
      ok: fullyConsistentEdgePass,
    }),
    regime_profile: regimeProfile,
    expected_edge_model: expectedEdgeModel,
  });
}

module.exports = {
  buildSignalCriteria,
};
