"use strict";

const { buildSignalRegimeProfile } = require("./signalRegimeProfile");
const { buildExpectedEdgeModel } = require("./expectedEdgeModel");
const { buildSignalShadowFilters } = require("./signalShadowFilters");

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

const SIGNAL_CRITERIA_PROFILE_STRICT = "STRICT";
const SIGNAL_CRITERIA_PROFILE_V6_COMPAT_DISCOVERY = "V6_COMPAT_DISCOVERY";
const DEFAULT_SIGNAL_CRITERIA_PROFILE = SIGNAL_CRITERIA_PROFILE_V6_COMPAT_DISCOVERY;

const SIGNAL_CRITERIA_PROFILE_DEFAULTS = Object.freeze({
  [SIGNAL_CRITERIA_PROFILE_STRICT]: Object.freeze({
    max_spread_bps: 8,
    max_mark_index_gap_bps: 8,
    max_funding_penalty_bps: 2,
    min_htf_alignment_score: 0.6,
    min_setup_quality_score: 0.6,
    min_market_quality_score: 0.75,
    min_volume_zscore: 1,
    min_rsi_long: 55,
    max_rsi_short: 45,
    min_expected_gross_r: 1.8,
    min_expected_net_r_after_cost: 0.3,
    min_signal_score: 80,
    early_signal_score: 64,
    core_signal_score: 80,
  }),
  [SIGNAL_CRITERIA_PROFILE_V6_COMPAT_DISCOVERY]: Object.freeze({
    max_spread_bps: 14,
    max_mark_index_gap_bps: 15,
    max_funding_penalty_bps: 3,
    min_htf_alignment_score: 0.4,
    min_setup_quality_score: 0.29,
    min_market_quality_score: 0.7,
    min_volume_zscore: 0.3,
    min_rsi_long: 48,
    max_rsi_short: 52,
    min_expected_gross_r: 1.45,
    min_expected_net_r_after_cost: 0.25,
    min_signal_score: 50,
    early_signal_score: 50,
    core_signal_score: 78,
  }),
});

function normalizeSignalCriteriaProfile(value) {
  const token = upper(value);
  if (token === SIGNAL_CRITERIA_PROFILE_STRICT) return SIGNAL_CRITERIA_PROFILE_STRICT;
  if (token === "V6_COMPAT" || token === "V6_DISCOVERY" || token === SIGNAL_CRITERIA_PROFILE_V6_COMPAT_DISCOVERY) {
    return SIGNAL_CRITERIA_PROFILE_V6_COMPAT_DISCOVERY;
  }
  return DEFAULT_SIGNAL_CRITERIA_PROFILE;
}

function resolveSignalCriteriaThresholds({ profile, thresholds } = {}) {
  const criteriaProfile = normalizeSignalCriteriaProfile(profile);
  const defaults = SIGNAL_CRITERIA_PROFILE_DEFAULTS[criteriaProfile];
  const cfg = asObject(thresholds) || {};
  return Object.freeze({
    criteria_profile: criteriaProfile,
    max_spread_bps: toNumberOrNull(cfg.max_spread_bps) ?? defaults.max_spread_bps,
    max_mark_index_gap_bps: toNumberOrNull(cfg.max_mark_index_gap_bps) ?? defaults.max_mark_index_gap_bps,
    max_funding_penalty_bps: toNumberOrNull(cfg.max_funding_penalty_bps) ?? defaults.max_funding_penalty_bps,
    min_htf_alignment_score: toNumberOrNull(cfg.min_htf_alignment_score) ?? defaults.min_htf_alignment_score,
    min_setup_quality_score: toNumberOrNull(cfg.min_setup_quality_score) ?? defaults.min_setup_quality_score,
    min_market_quality_score: toNumberOrNull(cfg.min_market_quality_score) ?? defaults.min_market_quality_score,
    min_volume_zscore: toNumberOrNull(cfg.min_volume_zscore) ?? defaults.min_volume_zscore,
    min_rsi_long: toNumberOrNull(cfg.min_rsi_long) ?? defaults.min_rsi_long,
    max_rsi_short: toNumberOrNull(cfg.max_rsi_short) ?? defaults.max_rsi_short,
    min_expected_gross_r: toNumberOrNull(cfg.min_expected_gross_r) ?? defaults.min_expected_gross_r,
    min_expected_net_r_after_cost: toNumberOrNull(cfg.min_expected_net_r_after_cost) ?? defaults.min_expected_net_r_after_cost,
    min_signal_score: toNumberOrNull(cfg.min_signal_score) ?? defaults.min_signal_score,
    early_signal_score: toNumberOrNull(cfg.early_signal_score) ?? defaults.early_signal_score,
    core_signal_score: toNumberOrNull(cfg.core_signal_score) ?? defaults.core_signal_score,
  });
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
  if (token === "BREAKOUT" || token === "BREAKDOWN") return "BREAKOUT_RETEST";
  if (token === "RECLAIM" || token === "LOSS") return "PULLBACK_RECLAIM";
  if (token === "CONTINUATION") return "MOMENTUM_CONTINUATION";
  if (token === "PULLBACK_RECLAIM" || token === "PULLBACK_PROBE" || token === "BREAKOUT_RETEST" || token === "MOMENTUM_CONTINUATION" || token === "NONE") {
    return token;
  }
  return "NONE";
}

function normalizeTriggerType(value) {
  const token = upper(value);
  if (!token) return "NONE";
  if (token === "BREAKOUT" || token === "BREAKDOWN" || token === "BREAKOUT_RETEST") return "BREAKOUT";
  if (token === "RECLAIM" || token === "LOSS" || token === "PULLBACK_RECLAIM") return "RECLAIM";
  if (token === "CONTINUATION" || token === "MOMENTUM_CONTINUATION") return "CONTINUATION";
  return "NONE";
}

function normalizeRegime(value) {
  const token = upper(value);
  if (token === "LONG" || token === "SHORT" || token === "NEUTRAL") return token;
  if (token === "BULL") return "LONG";
  if (token === "BEAR") return "SHORT";
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

function resolveMarketMetric(marketDataQuality = null, ...keys) {
  const row = asObject(marketDataQuality);
  const metrics = resolveMarketMetrics(marketDataQuality);
  for (const source of [metrics, row]) {
    const obj = asObject(source);
    if (!obj) continue;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const n = toNumberOrNull(obj[key]);
        if (n !== null) return n;
      }
    }
  }
  return null;
}

function resolveMetricOrFeature({ features, marketDataQuality }, ...keys) {
  const fromFeatures = resolveFeatureValue(features, ...keys);
  const featureNumber = toNumberOrNull(fromFeatures);
  if (featureNumber !== null) return featureNumber;
  const fromMarket = resolveMarketMetric(marketDataQuality, ...keys);
  if (fromMarket !== null) return fromMarket;
  return null;
}

function resolveTextMetricOrFeature({ features, marketDataQuality }, ...keys) {
  const metrics = resolveMarketMetrics(marketDataQuality);
  for (const source of [features, metrics, asObject(marketDataQuality)]) {
    const obj = asObject(source);
    if (!obj) continue;
    for (const key of keys) {
      if (Object.prototype.hasOwnProperty.call(obj, key)) {
        const value = upper(obj[key]);
        if (value) return value;
      }
    }
  }
  return null;
}

function resolveDirectionalAlignment({ symbol, side, direction }) {
  const normalizedSymbol = upper(symbol);
  const normalizedSide = upper(side);
  const normalizedDirection = upper(direction);
  if (!normalizedDirection || normalizedDirection === "UNKNOWN" || normalizedDirection === "NONE") return "UNKNOWN";
  if (normalizedSymbol === "BTCUSDT") return "SELF";
  if (normalizedDirection === "NEUTRAL") return "NEUTRAL";
  if (normalizedSide !== "LONG" && normalizedSide !== "SHORT") return "UNKNOWN";
  return normalizedDirection === normalizedSide ? "ALIGNED" : "OPPOSED";
}

function isBooleanTrue(value) {
  return asBooleanOrNull(value) === true;
}

function evaluatePullbackReclaimContract({
  setupType,
  features,
  side,
  triggerConfirmed,
  htfAlignmentScore,
  setupQualityScore,
  volumeZScore,
  minVolumeZScore,
  btcAlignment,
  mtfAlignment,
} = {}) {
  if (setupType !== "PULLBACK_RECLAIM") {
    return Object.freeze({ setup_type: setupType, downgraded: false, blockers: Object.freeze([]) });
  }
  const normalizedSide = upper(side);
  const reclaimConfirmed = isBooleanTrue(resolveFeatureValue(features, "reclaim_confirmed", "pullback_reclaim_confirmed", "trigger_confirmed"))
    || triggerConfirmed === true;
  const holdConfirmed = isBooleanTrue(resolveFeatureValue(features, "hold_after_reclaim", "reclaim_hold_confirmed", "reclaim_level_held"));
  const stopDistanceSane = asBooleanOrNull(resolveFeatureValue(features, "stop_distance_sane", "sl_distance_sane", "trigger_stop_distance_sane"));
  const shortRecoveryEvidence = asBooleanOrNull(resolveFeatureValue(
    features,
    "pullback_reclaim_short_recovery_confirmed",
    "short_reclaim_recovery_confirmed",
    "short_reclaim_live_override"
  ));
  const shortRecoveryConfirmed = normalizedSide !== "SHORT"
    ? true
    : (shortRecoveryEvidence !== null ? shortRecoveryEvidence === true : true);
  const explicitStopDistance = stopDistanceSane === true;
  const implicitStopDistance = stopDistanceSane === null && (toNumberOrNull(setupQualityScore) ?? 0) >= 0.75;
  const requiredVolumeZScore = toNumberOrNull(minVolumeZScore) ?? 1;
  const volumeConfirmed = (toNumberOrNull(volumeZScore) ?? -Infinity) >= requiredVolumeZScore;
  const alignmentKnown = btcAlignment !== "UNKNOWN" && mtfAlignment !== "UNKNOWN";
  const alignmentNotOpposed = alignmentKnown && btcAlignment !== "OPPOSED" && mtfAlignment !== "OPPOSED";
  const htfStrong = (toNumberOrNull(htfAlignmentScore) ?? 0) >= 0.75;
  const setupStrong = (toNumberOrNull(setupQualityScore) ?? 0) >= 0.75;
  const blockers = [];
  if (normalizedSide === "SHORT" && shortRecoveryEvidence === false && !shortRecoveryConfirmed) blockers.push("PULLBACK_RECLAIM:SHORT_DISABLED_BY_REALIZED_DECAY");
  if (!reclaimConfirmed) blockers.push("PULLBACK_RECLAIM:RECLAIM_NOT_CONFIRMED");
  if (!holdConfirmed && !(htfStrong && setupStrong && volumeConfirmed)) blockers.push("PULLBACK_RECLAIM:HOLD_NOT_CONFIRMED");
  if (!(explicitStopDistance || implicitStopDistance)) blockers.push("PULLBACK_RECLAIM:STOP_DISTANCE_NOT_SANE");
  if (!volumeConfirmed) blockers.push("PULLBACK_RECLAIM:VOLUME_NOT_CONFIRMED");
  if (!alignmentKnown) blockers.push("PULLBACK_RECLAIM:BTC_MTF_ALIGNMENT_EVIDENCE_REQUIRED");
  if (!alignmentNotOpposed) blockers.push("PULLBACK_RECLAIM:BTC_OR_MTF_OPPOSED");
  return Object.freeze({
    setup_type: blockers.length ? "PULLBACK_PROBE" : "PULLBACK_RECLAIM",
    downgraded: blockers.length > 0,
    blockers: Object.freeze(blockers),
    side: normalizedSide,
    required_volume_zscore: requiredVolumeZScore,
  });
}

function computeAdverseSelectionPenaltyR({
  side,
  btcAlignment,
  mtfAlignment,
  openInterestDeltaPct,
  liquidationNotional5mQuote,
  orderbookImbalanceTop5,
  spreadBps,
} = {}) {
  const normalizedSide = upper(side);
  let penalty = 0;
  const reasons = [];
  if (btcAlignment === "OPPOSED") {
    penalty += 0.25;
    reasons.push("BTC_1H_OPPOSED");
  }
  if (mtfAlignment === "OPPOSED") {
    penalty += 0.2;
    reasons.push("MTF_1H_OPPOSED");
  }
  const oi = toNumberOrNull(openInterestDeltaPct);
  if (oi !== null && Math.abs(oi) >= 3) {
    penalty += 0.15;
    reasons.push("OPEN_INTEREST_SPIKE");
  }
  const liq = toNumberOrNull(liquidationNotional5mQuote);
  if (liq !== null && liq >= 10000000) {
    penalty += 0.15;
    reasons.push("LIQUIDATION_CHAOS_GTE10M");
  } else if (liq !== null && liq >= 5000000) {
    penalty += 0.1;
    reasons.push("LIQUIDATION_EXTREME_5M_10M");
  }
  const imbalance = toNumberOrNull(orderbookImbalanceTop5);
  if (imbalance !== null) {
    const opposed = (normalizedSide === "LONG" && imbalance < -0.15) || (normalizedSide === "SHORT" && imbalance > 0.15);
    if (opposed) {
      penalty += 0.1;
      reasons.push("ORDERBOOK_IMBALANCE_OPPOSED");
    }
  }
  const spread = toNumberOrNull(spreadBps);
  if (spread !== null && spread >= 8) {
    penalty += 0.1;
    reasons.push("SPREAD_TOO_WIDE_FOR_EDGE");
  }
  return Object.freeze({
    penalty_r: Number(Math.min(1, penalty).toFixed(4)),
    reasons: Object.freeze(reasons),
  });
}

function buildSignalCriteria({
  symbol = null,
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
  criteriaProfile = null,
  thresholds = null,
} = {}) {
  const side = upper(signalSide);
  if (side !== "LONG" && side !== "SHORT") {
    throw new Error("SIGNAL_SIDE_REQUIRED");
  }

  const seed = asObject(signalCriteria) || {};
  const seedFeatureSnapshot = asObject(seed.feature_snapshot_contract) || {};
  const features = asObject(featureValues) || {};
  const market = asObject(marketDataQuality) || {};
  const metrics = resolveMarketMetrics(marketDataQuality);
  const cfg = asObject(thresholds) || {};
  const resolvedCriteriaProfile = normalizeSignalCriteriaProfile(
    seed.criteria_profile
    ?? seed.signal_criteria_profile
    ?? criteriaProfile
    ?? cfg.criteria_profile
    ?? cfg.profile
  );
  const resolvedThresholds = resolveSignalCriteriaThresholds({
    profile: resolvedCriteriaProfile,
    thresholds: cfg,
  });

  const resolvedHtfRegime = normalizeRegime(
    (seed.htf_regime && seed.htf_regime.regime)
    ?? seed.htf_regime
    ?? htfRegime
    ?? resolveFeatureValue(features, "htf_regime", "htf_direction", "htf_bias", "signal_family")
  );
  const resolvedHtfAlignmentScore = clamp01OrNull(
    (seed.htf_regime && seed.htf_regime.alignment_score)
    ?? seed.htf_alignment_score
    ?? htfAlignmentScore
    ?? resolveFeatureValue(features, "htf_alignment_score", "htf_confidence", "structure_alignment", "canonical_engine_field_alignment")
    ?? qualityScore
  );
  const rawResolvedSetupType = normalizeSetupType(
    (seed.setup_gate && seed.setup_gate.setup_type)
    ?? seed.setup_type
    ?? setupType
    ?? resolveFeatureValue(features, "setup_type", "trigger_type")
    ?? "NONE"
  );
  const resolvedSetupQualityScore = clamp01OrNull(
    (seed.setup_gate && seed.setup_gate.setup_quality_score)
    ?? seed.setup_quality_score
    ?? setupQualityScore
    ?? resolveFeatureValue(features, "setup_quality_score", "pullback_quality", "opportunity_score")
    ?? null
  );
  const resolvedTriggerLevel = toNumberOrNull(
    (seed.trigger_gate && seed.trigger_gate.trigger_level)
    ?? seed.trigger_level
    ?? triggerLevel
    ?? resolveFeatureValue(features, "trigger_level")
  );
  const explicitTriggerConfirmed = (seed.trigger_gate && seed.trigger_gate.trigger_confirmed)
    ?? seed.trigger_confirmed
    ?? triggerConfirmed
    ?? resolveFeatureValue(features, "trigger_confirmed");
  const resolvedTriggerType = normalizeTriggerType(
    (seed.trigger_gate && seed.trigger_gate.trigger_type)
    ?? seed.trigger_type
    ?? resolveFeatureValue(features, "trigger_type")
  );
  const featureTriggerType = normalizeSetupType(resolveFeatureValue(features, "trigger_type"));
  const resolvedTriggerConfirmedRaw = asBooleanOrNull(explicitTriggerConfirmed) ?? (featureTriggerType !== "NONE" ? true : null);
  const resolvedTriggerConfirmed = resolvedTriggerConfirmedRaw === true;
  const resolvedVolumeZScore = toNumberOrNull(
    (seed.trigger_gate && seed.trigger_gate.volume_zscore)
    ?? seed.volume_zscore
    ?? volumeZScore
    ?? resolveFeatureValue(features, "volume_zscore", "volume_ratio", "participation")
  );
  const resolvedRsiEntryTf = toNumberOrNull(
    (seed.trigger_gate && seed.trigger_gate.rsi_entry_tf)
    ?? seed.rsi_entry_tf
    ?? rsiEntryTf
    ?? resolveFeatureValue(features, "rsi_entry_tf")
    ?? (toNumberOrNull(resolveFeatureValue(features, "directional_pressure")) !== null
      ? (side === "LONG"
        ? 45 + (25 * clamp01(resolveFeatureValue(features, "directional_pressure")))
        : 55 - (25 * clamp01(resolveFeatureValue(features, "directional_pressure"))))
      : null)
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
    ?? resolveMarketMetric(marketDataQuality, "spread_bps", "spreadBps")
  );
  const resolvedMarkIndexGapBps = toNumberOrNull(
    (seed.no_trade_gate && seed.no_trade_gate.mark_index_gap_bps)
    ?? seed.mark_index_gap_bps
    ?? markIndexGapBps
    ?? resolveFeatureValue(features, "mark_index_gap_bps")
    ?? resolveMarketMetric(marketDataQuality, "mark_index_gap_bps", "mark_index_divergence_bps", "markIndexGapBps", "markIndexDivergenceBps")
  );
  const resolvedExpectedGrossR = toNumberOrNull(
    (seed.expected_edge_gate && seed.expected_edge_gate.expected_gross_r)
    ?? seed.expected_gross_r
    ?? expectedGrossR
    ?? resolveFeatureValue(features, "expected_gross_r", "rr")
  );
  const resolvedExpectedNetRAfterCost = toNumberOrNull(
    (seed.expected_edge_gate && seed.expected_edge_gate.expected_net_r_after_cost)
    ?? seed.expected_net_r_after_cost
    ?? expectedNetRAfterCost
    ?? resolveFeatureValue(features, "expected_net_r_after_cost", "ev_gate_expected_exit_value_r")
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
  const resolvedBtc1hTrend = resolveTextMetricOrFeature(
    { features, marketDataQuality },
    "btc_1h_trend",
    "btc_1h_direction",
    "btc_htf_trend"
  )
    ?? upper(seed.btc_1h_trend ?? seed.btc_1h_direction ?? seed.btc_htf_trend)
    ?? upper(seedFeatureSnapshot.btc_1h_trend ?? seedFeatureSnapshot.btc_1h_direction ?? seedFeatureSnapshot.btc_htf_trend);
  const resolvedMtf1hDirection = resolveTextMetricOrFeature(
    { features, marketDataQuality },
    "mtf_1h_direction",
    "htf_1h_direction",
    "one_hour_direction"
  )
    ?? upper(seed.mtf_1h_direction ?? seed.htf_1h_direction ?? seed.one_hour_direction)
    ?? upper(seedFeatureSnapshot.mtf_1h_direction ?? seedFeatureSnapshot.htf_1h_direction ?? seedFeatureSnapshot.one_hour_direction);
  const resolvedBtc1hAlignment = resolveDirectionalAlignment({ symbol, side, direction: resolvedBtc1hTrend });
  const resolvedMtf1hAlignment = resolveDirectionalAlignment({ symbol, side, direction: resolvedMtf1hDirection });
  const resolvedOpenInterestDeltaPct = resolveMetricOrFeature(
    { features, marketDataQuality },
    "open_interest_delta_pct",
    "open_interest_change_pct"
  );
  const resolvedLiquidationNotional5mQuote = resolveMetricOrFeature(
    { features, marketDataQuality },
    "liquidation_notional_5m_quote",
    "liquidation_notional_5m"
  );
  const resolvedOrderbookImbalanceTop5 = resolveMetricOrFeature(
    { features, marketDataQuality },
    "orderbook_imbalance_top5",
    "order_book_imbalance_top5"
  );
  const pullbackContract = evaluatePullbackReclaimContract({
    setupType: rawResolvedSetupType,
    features,
    side,
    triggerConfirmed: resolvedTriggerConfirmedRaw === true,
    htfAlignmentScore: resolvedHtfAlignmentScore,
    setupQualityScore: resolvedSetupQualityScore,
    volumeZScore: resolvedVolumeZScore,
    minVolumeZScore: resolvedThresholds.min_volume_zscore,
    btcAlignment: resolvedBtc1hAlignment,
    mtfAlignment: resolvedMtf1hAlignment,
  });
  const resolvedSetupType = pullbackContract.setup_type;
  const adverseSelection = computeAdverseSelectionPenaltyR({
    side,
    btcAlignment: resolvedBtc1hAlignment,
    mtfAlignment: resolvedMtf1hAlignment,
    openInterestDeltaPct: resolvedOpenInterestDeltaPct,
    liquidationNotional5mQuote: resolvedLiquidationNotional5mQuote,
    orderbookImbalanceTop5: resolvedOrderbookImbalanceTop5,
    spreadBps: resolvedSpreadBps,
  });
  const effectiveExpectedNetRAfterCost = resolvedExpectedNetRAfterCost !== null
    ? Number(Math.max(0, resolvedExpectedNetRAfterCost - adverseSelection.penalty_r).toFixed(4))
    : null;
  const edgeCohortRollingExpectancy = toNumberOrNull(resolveFeatureValue(
    features,
    "edge_cohort_rolling_expectancy",
    "edge_cohort_rolling_expectancy_r",
    "rolling_edge_expectancy_r",
    "rolling_expectancy_r"
  ));

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
  if (
    resolvedCriteriaProfile === SIGNAL_CRITERIA_PROFILE_V6_COMPAT_DISCOVERY
    && rawResolvedSetupType === "PULLBACK_RECLAIM"
  ) {
    setupBlockers.push("PULLBACK_RECLAIM:EMPIRICAL_DECAY_BLOCKED");
  }
  if (
    resolvedCriteriaProfile === SIGNAL_CRITERIA_PROFILE_V6_COMPAT_DISCOVERY
    && side === "LONG"
    && rawResolvedSetupType === "BREAKOUT_RETEST"
    && upper(regimeProfile && regimeProfile.structural_regime) === "TRANSITION"
  ) {
    setupBlockers.push("BREAKOUT_RETEST:TRANSITION_LONG_EMPIRICAL_DECAY_BLOCKED");
  }
  if (pullbackContract.downgraded) setupBlockers.push(...pullbackContract.blockers);
  const setupPass = resolvedSetupType !== "NONE"
    && resolvedSetupType !== "PULLBACK_PROBE"
    && resolvedSetupQualityScore >= resolvedThresholds.min_setup_quality_score;
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
    && effectiveExpectedNetRAfterCost >= resolvedThresholds.min_expected_net_r_after_cost;
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
    effectiveExpectedNetRAfterCost,
    costEstimateBps: resolvedCostEstimateBps,
    costREquivalent: resolvedCostREquivalent,
    adverseSelectionPenaltyR: adverseSelection.penalty_r,
    edgeCohortRollingExpectancy,
    setupType: resolvedSetupType,
    regimeProfile,
  });
  const shadowFilterDecision = buildSignalShadowFilters({
    symbol,
    signalSide: side,
    featureValues: features,
    marketDataQuality,
    signalCriteria: {
      htf_regime: {
        regime: resolvedHtfRegime,
        alignment_score: resolvedHtfAlignmentScore,
      },
      expected_edge_gate: {
        expected_net_r_after_cost: effectiveExpectedNetRAfterCost,
        cost_estimate_bps: resolvedCostEstimateBps,
      },
    },
    thresholds: asObject(cfg.shadow_filters) || asObject(seed.shadow_filters && seed.shadow_filters.policy),
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
  const entryGrade = finalSignalScore >= resolvedThresholds.core_signal_score
    ? "CORE"
    : (finalSignalScore >= resolvedThresholds.early_signal_score ? "EARLY" : "NONE");

  const blockers = [];
  if (noTradeBlockers.length) blockers.push(...noTradeBlockers.map((code) => `NO_TRADE:${code}`));
  if (htfBlockers.length) blockers.push(...htfBlockers.map((code) => `HTF_REGIME:${code}`));
  if (!htfPass) blockers.push("HTF_REGIME:ALIGNMENT_REQUIRED");
  if (setupBlockers.length) blockers.push(...setupBlockers.map((code) => `SETUP:${code}`));
  if (!setupPass) {
    if (resolvedSetupType === "PULLBACK_PROBE") blockers.push("SETUP:PROBE_NOT_EXECUTABLE");
    else blockers.push("SETUP:QUALITY_REQUIRED");
  }
  if (triggerBlockers.length) blockers.push(...triggerBlockers.map((code) => `TRIGGER:${code}`));
  if (!triggerPass) blockers.push("TRIGGER:CONFIRMATION_REQUIRED");
  if (edgeBlockers.length) blockers.push(...edgeBlockers.map((code) => `EXPECTED_EDGE:${code}`));
  if (!fullyConsistentEdgePass) blockers.push("EXPECTED_EDGE:NET_R_REQUIRED");
  if (!(finalSignalScore >= resolvedThresholds.min_signal_score)) blockers.push("SIGNAL_SCORE:MIN_SCORE_REQUIRED");

  return Object.freeze({
    present: true,
    criteria_profile: resolvedCriteriaProfile,
    signal_profile: resolvedCriteriaProfile,
    verdict: blockers.length === 0 ? "PASS" : "BLOCK",
    blockers: Object.freeze(blockers),
    thresholds: resolvedThresholds,
    entry_grade: entryGrade,
    trigger_type: resolvedTriggerType,
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
      trigger_type: resolvedTriggerType,
      trigger_level: resolvedTriggerLevel,
      trigger_confirmed: resolvedTriggerConfirmed,
      volume_zscore: resolvedVolumeZScore,
      rsi_entry_tf: resolvedRsiEntryTf,
      ok: triggerPass,
    }),
    expected_edge_gate: Object.freeze({
      expected_gross_r: resolvedExpectedGrossR,
      expected_net_r_after_cost: resolvedExpectedNetRAfterCost,
      effective_expected_net_r_after_cost: effectiveExpectedNetRAfterCost,
      cost_estimate_bps: resolvedCostEstimateBps,
      cost_r_equivalent: resolvedCostREquivalent,
      accounting_delta_r: accountingDelta,
      adverse_selection_penalty_r: adverseSelection.penalty_r,
      adverse_selection_reasons: adverseSelection.reasons,
      edge_cohort: expectedEdgeModel.edge_cohort,
      raw_edge_cohort: expectedEdgeModel.raw_edge_cohort,
      edge_cohort_authority: expectedEdgeModel.edge_cohort_authority,
      edge_cohort_downgraded: expectedEdgeModel.edge_cohort_downgraded,
      edge_cohort_downgrade_reason: expectedEdgeModel.edge_cohort_downgrade_reason,
      edge_cohort_downgraded_by_realized_expectancy: expectedEdgeModel.edge_cohort_downgraded_by_realized_expectancy,
      edge_cohort_downgraded_by_empirical_cohort_risk: expectedEdgeModel.edge_cohort_downgraded_by_empirical_cohort_risk,
      tp1_reach_probability: expectedEdgeModel.tp1_reach_probability,
      continuation_probability: expectedEdgeModel.continuation_probability,
      stop_hit_probability: expectedEdgeModel.stop_hit_probability,
      ok: fullyConsistentEdgePass,
    }),
    regime_profile: regimeProfile,
    expected_edge_model: expectedEdgeModel,
    feature_snapshot_contract: Object.freeze({
      btc_1h_trend: resolvedBtc1hTrend,
      btc_1h_alignment: resolvedBtc1hAlignment,
      mtf_1h_direction: resolvedMtf1hDirection,
      mtf_1h_alignment: resolvedMtf1hAlignment,
      open_interest_delta_pct: resolvedOpenInterestDeltaPct,
      liquidation_notional_5m_quote: resolvedLiquidationNotional5mQuote,
      orderbook_imbalance_top5: resolvedOrderbookImbalanceTop5,
      raw_setup_type: rawResolvedSetupType,
      effective_setup_type: resolvedSetupType,
      pullback_reclaim_downgraded: pullbackContract.downgraded,
      pullback_reclaim_downgrade_reasons: pullbackContract.blockers,
    }),
    shadow_filter_decision: shadowFilterDecision,
  });
}

module.exports = {
  buildSignalCriteria,
  SIGNAL_CRITERIA_PROFILE_STRICT,
  SIGNAL_CRITERIA_PROFILE_V6_COMPAT_DISCOVERY,
  DEFAULT_SIGNAL_CRITERIA_PROFILE,
  normalizeSignalCriteriaProfile,
  resolveSignalCriteriaThresholds,
  normalizeTriggerType,
  __test: {
    evaluatePullbackReclaimContract,
    computeAdverseSelectionPenaltyR,
    resolveDirectionalAlignment,
  },
};
