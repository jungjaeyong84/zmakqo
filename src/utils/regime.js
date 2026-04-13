"use strict";

const CANONICAL_REGIMES = ["trend", "range", "transition"];

function toStringSafe(raw) {
  return String(raw == null ? "" : raw);
}

function cleanRawToken(raw) {
  return toStringSafe(raw)
    .normalize("NFKC")
    .replace(/[\u0000-\u001f\u007f]+/g, "")
    .trim()
    .toLowerCase();
}

function lettersOnly(raw) {
  return cleanRawToken(raw).replace(/[^a-z가-힣]+/g, "");
}

function levenshtein(a, b) {
  const aa = String(a || "");
  const bb = String(b || "");
  if (!aa) return bb.length;
  if (!bb) return aa.length;
  const prev = new Array(bb.length + 1);
  const curr = new Array(bb.length + 1);
  for (let j = 0; j <= bb.length; j += 1) prev[j] = j;
  for (let i = 1; i <= aa.length; i += 1) {
    curr[0] = i;
    for (let j = 1; j <= bb.length; j += 1) {
      const cost = aa[i - 1] === bb[j - 1] ? 0 : 1;
      curr[j] = Math.min(
        prev[j] + 1,
        curr[j - 1] + 1,
        prev[j - 1] + cost,
      );
    }
    for (let j = 0; j <= bb.length; j += 1) prev[j] = curr[j];
  }
  return prev[bb.length];
}

function fuzzyCanonicalRegime(rawLetters) {
  const token = String(rawLetters || "").trim().toLowerCase();
  if (!token) return null;
  let best = null;
  for (const candidate of CANONICAL_REGIMES) {
    const dist = levenshtein(token, candidate);
    const maxDist = candidate.length >= 9 ? 2 : 1;
    if (dist > maxDist) continue;
    if (!best || dist < best.dist) best = { value: candidate, dist };
  }
  return best ? best.value : null;
}

function normalizeSignalStateToken(raw) {
  const cleaned = cleanRawToken(raw);
  if (!cleaned) return "";
  if (cleaned.includes("추세") || cleaned.includes("trend")) return "trend";
  if (cleaned.includes("횡보") || cleaned.includes("range")) return "range";
  if (cleaned.includes("전환") || cleaned.includes("transition")) return "transition";
  const compact = lettersOnly(cleaned);
  const fuzzy = fuzzyCanonicalRegime(compact);
  return fuzzy || compact || cleaned;
}

function featuresOf(row) {
  if (row && row.features_json && typeof row.features_json === "object") return row.features_json;
  if (row && row.features && typeof row.features === "object") return row.features;
  return {};
}

function detailFromToken(raw, source) {
  const normalized = normalizeSignalStateToken(raw);
  if (CANONICAL_REGIMES.includes(normalized)) {
    return {
      regime: normalized,
      source,
      raw: toStringSafe(raw),
    };
  }
  return null;
}

function resolveRegimeDetail(row) {
  const f = featuresOf(row);
  const candidates = [
    { value: row && row.regime, source: "row.regime" },
    { value: row && row.market_regime, source: "row.market_regime" },
    { value: row && row.market_state, source: "row.market_state" },
    { value: f.regime, source: "features.regime" },
    { value: f.market_regime, source: "features.market_regime" },
    { value: f.market_state, source: "features.market_state" },
    { value: f.market_state_label, source: "features.market_state_label" },
    { value: f.regime_label, source: "features.regime_label" },
    { value: f.zz_regime, source: "features.zz_regime" },
    { value: f.pro_regime_state, source: "features.pro_regime_state" },
    { value: f.regime_state, source: "features.regime_state" },
    { value: f._openclaw_executor_regime, source: "features._openclaw_executor_regime" },
    { value: f.openclaw_executor_regime, source: "features.openclaw_executor_regime" },
  ];
  for (const candidate of candidates) {
    const detail = detailFromToken(candidate.value, candidate.source);
    if (detail) return detail;
  }

  const envCandidates = [
    { value: f.pro_env_txt, source: "features.pro_env_txt" },
    { value: f.env_txt, source: "features.env_txt" },
  ];
  for (const candidate of envCandidates) {
    const detail = detailFromToken(candidate.value, candidate.source);
    if (detail) return detail;
  }
  return { regime: null, source: null, raw: null };
}

function resolveRegimeRecord(row) {
  return resolveRegimeDetail(row).regime;
}

function enrichFeaturesWithRegime(features, extras = {}) {
  const extraFeatures = featuresOf(extras);
  const featureObj = {
    ...(extraFeatures && typeof extraFeatures === "object" ? extraFeatures : {}),
    ...(features && typeof features === "object" ? features : {}),
  };
  const detail = resolveRegimeDetail({ ...extras, features_json: featureObj });
  if (!detail.regime) {
    return {
      features: featureObj,
      regime: null,
      market_regime: null,
      regime_source: null,
    };
  }
  featureObj.regime = detail.regime;
  featureObj.market_regime = detail.regime;
  if (featureObj.pro_regime_state != null) featureObj.pro_regime_state = detail.regime;
  if (featureObj.regime_state != null) featureObj.regime_state = detail.regime;
  if (featureObj.regime_label != null) featureObj.regime_label = detail.regime;
  if (featureObj.zz_regime != null) featureObj.zz_regime = detail.regime;
  return {
    features: featureObj,
    regime: detail.regime,
    market_regime: detail.regime,
    regime_source: detail.source,
  };
}

module.exports = {
  CANONICAL_REGIMES,
  normalizeSignalStateToken,
  resolveRegimeDetail,
  resolveRegimeRecord,
  enrichFeaturesWithRegime,
  __test: {
    cleanRawToken,
    lettersOnly,
    levenshtein,
    fuzzyCanonicalRegime,
  },
};
