"use strict";

const { resolveRegimeRecord } = require("../utils/regime");

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

function clamp01(value, fallback = 0) {
  const n = toNumberOrNull(value);
  if (n === null) return fallback;
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

function normalizeStructuralRegime(value) {
  const token = upper(value);
  if (["TREND", "RANGE", "TRANSITION"].includes(token)) return token;
  return "UNKNOWN";
}

function normalizeVolatilityRegime(value) {
  const token = upper(value);
  if (["HIGH_VOL", "NORMAL_VOL", "LOW_VOL"].includes(token)) return token;
  return "UNKNOWN";
}

function normalizeLiquidityRegime(value) {
  const token = upper(value);
  if (["ADEQUATE", "THIN"].includes(token)) return token;
  return "UNKNOWN";
}

function structuralWeight(regime) {
  if (regime === "TREND") return 1;
  if (regime === "TRANSITION") return 0.7;
  if (regime === "RANGE") return 0.35;
  return 0;
}

function volatilityWeight(regime) {
  if (regime === "NORMAL_VOL") return 1;
  if (regime === "LOW_VOL") return 0.8;
  if (regime === "HIGH_VOL") return 0.65;
  return 0.5;
}

function liquidityWeight(regime) {
  if (regime === "ADEQUATE") return 1;
  if (regime === "THIN") return 0.2;
  return 0.5;
}

function deriveStructuralRegime({
  featureValues = null,
  marketRegime = null,
  htfAlignmentScore = null,
  setupType = null,
} = {}) {
  const features = asObject(featureValues) || {};
  const explicitHint = resolveRegimeRecord({ features_json: features, market_regime: marketRegime });
  const normalizedExplicit = normalizeStructuralRegime(explicitHint);
  if (normalizedExplicit !== "UNKNOWN") return normalizedExplicit;

  const trendStrength = clamp01(
    resolveFeatureValue(features, "trend_strength_score", "trend_score", "executor_trend_score")
      ?? htfAlignmentScore,
    0
  );
  const compressionScore = clamp01(
    resolveFeatureValue(features, "compression_score", "range_compression_score", "range_score"),
    0
  );
  const normalizedSetupType = upper(setupType);

  if (compressionScore >= 0.75 && trendStrength < 0.55) return "RANGE";
  if (trendStrength >= 0.72) return "TREND";
  if (normalizedSetupType === "BREAKOUT_RETEST" && trendStrength >= 0.6) return "TREND";
  if (trendStrength >= 0.55 || compressionScore >= 0.45) return "TRANSITION";
  return "UNKNOWN";
}

function deriveVolatilityRegime({ featureValues = null } = {}) {
  const features = asObject(featureValues) || {};
  const explicit = normalizeVolatilityRegime(resolveFeatureValue(features, "volatility_regime", "executor_volatility_regime"));
  if (explicit !== "UNKNOWN") return explicit;
  const volatilityZScore = toNumberOrNull(
    resolveFeatureValue(features, "volatility_zscore", "atr_zscore", "realized_volatility_zscore", "range_expansion_zscore")
  );
  if (volatilityZScore === null) return "UNKNOWN";
  if (volatilityZScore >= 1.5) return "HIGH_VOL";
  if (volatilityZScore <= -0.5) return "LOW_VOL";
  return "NORMAL_VOL";
}

function deriveLiquidityRegime({
  featureValues = null,
  marketDataQuality = null,
  marketQualityScore = null,
  spreadBps = null,
  maxTradableSpreadBps = 8,
  minVolumeQuote24h = 1000000,
} = {}) {
  const features = asObject(featureValues) || {};
  const explicit = normalizeLiquidityRegime(resolveFeatureValue(features, "liquidity_regime", "executor_liquidity_regime"));
  if (explicit !== "UNKNOWN") return explicit;
  const metrics = asObject(asObject(marketDataQuality) && marketDataQuality.metrics) || {};
  const resolvedMarketQualityScore = clamp01(
    resolveFeatureValue(features, "liquidity_score", "market_quality_score")
      ?? marketQualityScore,
    null
  );
  const resolvedSpreadBps = toNumberOrNull(
    resolveFeatureValue(features, "spread_bps")
      ?? spreadBps
      ?? metrics.spread_bps
  );
  const volumeQuote24h = toNumberOrNull(
    resolveFeatureValue(features, "volume_quote_24h", "quote_volume_24h")
      ?? metrics.volume_quote_24h
  );

  const hasEvidence = resolvedMarketQualityScore !== null || resolvedSpreadBps !== null || volumeQuote24h !== null;
  if (!hasEvidence) return "UNKNOWN";
  if ((resolvedMarketQualityScore !== null && resolvedMarketQualityScore < 0.65)
    || (resolvedSpreadBps !== null && resolvedSpreadBps > maxTradableSpreadBps)
    || (volumeQuote24h !== null && volumeQuote24h < minVolumeQuote24h)) {
    return "THIN";
  }
  return "ADEQUATE";
}

function buildSignalRegimeProfile({
  signalSide,
  featureValues = null,
  marketDataQuality = null,
  marketRegime = null,
  htfRegime = null,
  htfAlignmentScore = null,
  setupType = null,
  marketQualityScore = null,
  spreadBps = null,
  thresholds = null,
} = {}) {
  const side = upper(signalSide);
  if (side !== "LONG" && side !== "SHORT") throw new Error("SIGNAL_SIDE_REQUIRED");
  const cfg = asObject(thresholds) || {};
  const structuralRegime = deriveStructuralRegime({
    featureValues,
    marketRegime,
    htfAlignmentScore,
    setupType,
  });
  const volatilityRegime = deriveVolatilityRegime({ featureValues });
  const liquidityRegime = deriveLiquidityRegime({
    featureValues,
    marketDataQuality,
    marketQualityScore,
    spreadBps,
    maxTradableSpreadBps: toNumberOrNull(cfg.max_tradable_spread_bps) ?? 8,
    minVolumeQuote24h: toNumberOrNull(cfg.min_volume_quote_24h) ?? 1000000,
  });
  const directionalRegime = upper(htfRegime);
  const sideBias = directionalRegime === side
    ? "ALIGNED"
    : (directionalRegime === "LONG" || directionalRegime === "SHORT" ? "COUNTERTREND" : "NEUTRAL");

  const regimeScore = Number((
    (0.4 * structuralWeight(structuralRegime))
    + (0.2 * volatilityWeight(volatilityRegime))
    + (0.25 * liquidityWeight(liquidityRegime))
    + (0.15 * (sideBias === "ALIGNED" ? 1 : (sideBias === "NEUTRAL" ? 0.5 : 0.1)))
  ).toFixed(4));

  const regimeCohort = `${structuralRegime}__${volatilityRegime}__${liquidityRegime}`;
  const actionBias = structuralRegime === "TREND" && sideBias === "ALIGNED" && liquidityRegime === "ADEQUATE"
    ? "TREND_CONTINUATION"
    : (structuralRegime === "TRANSITION" && sideBias === "ALIGNED" && liquidityRegime !== "THIN"
      ? "TRANSITION_SELECTIVE"
      : "DEFENSIVE_OR_NO_TRADE");

  return Object.freeze({
    present: true,
    structural_regime: structuralRegime,
    volatility_regime: volatilityRegime,
    liquidity_regime: liquidityRegime,
    directional_bias: sideBias,
    regime_cohort: regimeCohort,
    action_bias: actionBias,
    regime_score: regimeScore,
  });
}

module.exports = {
  buildSignalRegimeProfile,
  __test: {
    deriveStructuralRegime,
    deriveVolatilityRegime,
    deriveLiquidityRegime,
    normalizeStructuralRegime,
    normalizeVolatilityRegime,
    normalizeLiquidityRegime,
  },
};
