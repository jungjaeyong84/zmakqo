"use strict";

const crypto = require("crypto");

function normalizeBool(value, fallback = false) {
  if (value === true || value === false) return value;
  if (value === null || value === undefined || value === "") return fallback;
  const raw = String(value).trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return fallback;
}

function toNum(value, fallback = null) {
  if (value === null || value === undefined || value === "") return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function clampNumber(value, min, max, fallback = null) {
  const n = toNum(value, fallback);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function normalizeMarketKey(value) {
  return String(value || "").trim().toUpperCase().replace(/\.P$/, "");
}

function parseMaybeJson(raw) {
  if (!raw || typeof raw !== "string") return raw;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch (_err) {
    return null;
  }
}

function normalizeCanonicalEngineSourceMode(raw, fallback = "PINE_PRIMARY") {
  const value = String(raw || "").trim().toUpperCase();
  if (value === "PINE_PRIMARY" || value === "SERVER_SHADOW" || value === "SERVER_PRIMARY") return value;
  return fallback;
}

function normalizeCanonicalEngineMarketOverrides(raw = null) {
  const source = parseMaybeJson(raw);
  if (!source || typeof source !== "object" || Array.isArray(source)) return {};
  const out = {};
  for (const [market, value] of Object.entries(source)) {
    const key = normalizeMarketKey(market);
    if (!key) continue;
    const row = value && typeof value === "object" && !Array.isArray(value)
      ? { ...value }
      : { core_score_abs: value };
    const normalized = {};
    if (row.enabled !== undefined) normalized.enabled = normalizeBool(row.enabled, true);
    if (row.shadow_enabled !== undefined) normalized.shadow_enabled = normalizeBool(row.shadow_enabled, true);
    if (row.source_mode !== undefined) normalized.source_mode = normalizeCanonicalEngineSourceMode(row.source_mode, "PINE_PRIMARY");
    const coreScoreAbs = clampNumber(row.core_score_abs, 0, 100, null);
    const transitionCoreScoreAbs = clampNumber(row.transition_core_score_abs, 0, 100, null);
    if (coreScoreAbs != null) normalized.core_score_abs = coreScoreAbs;
    if (transitionCoreScoreAbs != null) normalized.transition_core_score_abs = transitionCoreScoreAbs;
    if (Object.keys(normalized).length) out[key] = normalized;
  }
  return out;
}

function buildCanonicalThresholdBundlePayload({
  enabled,
  shadowEnabled,
  sourceMode,
  coreScoreAbs,
  transitionCoreScoreAbs,
  marketOverrides,
} = {}) {
  const normalizedOverrides = normalizeCanonicalEngineMarketOverrides(marketOverrides);
  const orderedOverrides = Object.keys(normalizedOverrides)
    .sort((a, b) => a.localeCompare(b))
    .reduce((acc, key) => {
      const row = normalizedOverrides[key] || {};
      acc[key] = {};
      if (row.enabled !== undefined) acc[key].enabled = normalizeBool(row.enabled, true);
      if (row.shadow_enabled !== undefined) acc[key].shadow_enabled = normalizeBool(row.shadow_enabled, true);
      if (row.source_mode !== undefined) acc[key].source_mode = normalizeCanonicalEngineSourceMode(row.source_mode, "PINE_PRIMARY");
      if (row.core_score_abs != null) acc[key].core_score_abs = clampNumber(row.core_score_abs, 0, 100, 33);
      if (row.transition_core_score_abs != null) acc[key].transition_core_score_abs = clampNumber(row.transition_core_score_abs, 0, 100, 29);
      return acc;
    }, {});
  return {
    enabled: normalizeBool(enabled, true),
    shadow_enabled: normalizeBool(shadowEnabled, true),
    source_mode: normalizeCanonicalEngineSourceMode(sourceMode, "PINE_PRIMARY"),
    core_score_abs: clampNumber(coreScoreAbs, 0, 100, 33),
    transition_core_score_abs: clampNumber(transitionCoreScoreAbs, 0, 100, 29),
    market_overrides: orderedOverrides,
  };
}

function hashCanonicalThresholdBundle(payload = {}) {
  const json = JSON.stringify(payload);
  return crypto.createHash("sha1").update(json).digest("hex").slice(0, 12);
}

function resolveCanonicalEngineConfig(sysCfg = {}, { market } = {}) {
  const cfg = (sysCfg && typeof sysCfg === "object") ? sysCfg : {};
  const marketOverrides = normalizeCanonicalEngineMarketOverrides(
    cfg.canonical_engine_market_overrides != null
      ? cfg.canonical_engine_market_overrides
      : cfg.marketOverrides
  );
  const marketKey = normalizeMarketKey(market);
  const marketOverride = marketKey ? (marketOverrides[marketKey] || null) : null;
  const sourceMode = marketOverride && marketOverride.source_mode != null
    ? normalizeCanonicalEngineSourceMode(marketOverride.source_mode, "PINE_PRIMARY")
    : normalizeCanonicalEngineSourceMode(
      cfg.canonical_engine_source_mode != null ? cfg.canonical_engine_source_mode : cfg.sourceMode,
      "PINE_PRIMARY"
    );
  const enabled = marketOverride && marketOverride.enabled !== undefined
    ? normalizeBool(marketOverride.enabled, true)
    : normalizeBool(cfg.canonical_engine_enabled != null ? cfg.canonical_engine_enabled : cfg.enabled, true);
  const shadowEnabled = marketOverride && marketOverride.shadow_enabled !== undefined
    ? normalizeBool(marketOverride.shadow_enabled, true)
    : normalizeBool(cfg.canonical_engine_shadow_enabled != null ? cfg.canonical_engine_shadow_enabled : cfg.shadowEnabled, true);
  const coreScoreAbs = marketOverride && marketOverride.core_score_abs != null
    ? clampNumber(marketOverride.core_score_abs, 0, 100, 33)
    : clampNumber(cfg.canonical_engine_core_score_abs != null ? cfg.canonical_engine_core_score_abs : cfg.coreScoreAbs, 0, 100, 33);
  const transitionCoreScoreAbs = marketOverride && marketOverride.transition_core_score_abs != null
    ? clampNumber(marketOverride.transition_core_score_abs, 0, 100, 29)
    : clampNumber(cfg.canonical_engine_transition_core_score_abs != null ? cfg.canonical_engine_transition_core_score_abs : cfg.transitionCoreScoreAbs, 0, 100, 29);
  const thresholdBundlePayload = buildCanonicalThresholdBundlePayload({
    enabled,
    shadowEnabled,
    sourceMode,
    coreScoreAbs,
    transitionCoreScoreAbs,
    marketOverrides,
  });
  const thresholdBundleHash = hashCanonicalThresholdBundle(thresholdBundlePayload);
  const thresholdBundleSignature = JSON.stringify(thresholdBundlePayload);
  const bundleVersion = String(
    cfg.canonical_engine_bundle_version
    || cfg.bundleVersion
    || process.env.CANONICAL_ENGINE_BUNDLE_VERSION
    || "canonical_engine_v0.1.0"
  ).trim() || "canonical_engine_v0.1.0";
  return {
    enabled,
    shadowEnabled,
    sourceMode,
    enforce: enabled === true && sourceMode === "SERVER_PRIMARY",
    coreScoreAbs: Number.isFinite(coreScoreAbs) ? coreScoreAbs : 33,
    transitionCoreScoreAbs: Number.isFinite(transitionCoreScoreAbs) ? transitionCoreScoreAbs : 29,
    marketOverrideKey: marketKey || null,
    marketOverrideActive: !!marketOverride,
    marketOverride: marketOverride || null,
    marketOverrides,
    bundleVersion,
    thresholdBundlePayload,
    thresholdBundleHash,
    thresholdBundleSignature,
    thresholdBundleVersion: `canonical_threshold_${thresholdBundleHash}`,
  };
}

module.exports = {
  normalizeCanonicalEngineSourceMode,
  normalizeCanonicalEngineMarketOverrides,
  resolveCanonicalEngineConfig,
};
