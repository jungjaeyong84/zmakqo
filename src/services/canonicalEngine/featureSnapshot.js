"use strict";

const { resolveRegimeRecord } = require("../../utils/regime");
const { resolveCanonicalTimingBand } = require("./timingBandResolver");

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pickFirstNumber(features, keys = []) {
  const f = (features && typeof features === "object") ? features : {};
  for (const key of keys) {
    const n = toNum(f[key]);
    if (Number.isFinite(n)) return n;
  }
  return null;
}

function pickScoreExtended(features) {
  const direct = pickFirstNumber(features, ["score", "score_norm", "signal_strength", "strength"]);
  if (Number.isFinite(direct)) return direct;
  const f = (features && typeof features === "object") ? features : {};
  const line = String(f.pro_score_line || f.score_line || f.score_text || "").trim();
  if (!line) return null;
  const match = line.match(/-?\d+(?:\.\d+)?/);
  return match ? toNum(match[0]) : null;
}

function normalizeMarket(value) {
  return String(value || "").trim().toUpperCase().replace(/\.P$/, "");
}

function pickPosterior(features, side) {
  const f = (features && typeof features === "object") ? features : {};
  const dir = String(side || "").trim().toUpperCase();
  const longKeys = ["zz_post_prob_long", "post_prob_long", "posterior_long", "posterior_long_prob"];
  const shortKeys = ["zz_post_prob_short", "post_prob_short", "posterior_short", "posterior_short_prob"];
  const genericKeys = ["posterior", "post_prob", "posterior_prob"];
  const keys = dir === "SHORT" ? shortKeys : longKeys;
  for (const key of [...keys, ...genericKeys]) {
    const n = toNum(f[key]);
    if (!Number.isFinite(n)) continue;
    if (n >= 0 && n <= 1) return n;
    if (n >= 0 && n <= 100) return n / 100;
  }
  return null;
}

function resolveCanonicalFeatureSnapshot({ features, event, side, market, tf } = {}) {
  const featureObj = (features && typeof features === "object") ? features : {};
  const timing = resolveCanonicalTimingBand({ event, features: featureObj, side });
  const score = pickScoreExtended(featureObj);
  const confidence = pickFirstNumber(featureObj, ["confidence", "signal_confidence", "conf"]);
  const waveConf = pickFirstNumber(featureObj, ["zz_wave_conf", "wave_conf", "wave_confidence"]);
  const transitionRisk = pickFirstNumber(featureObj, ["sp_transition_risk", "transition_risk"]);
  const coherence = pickFirstNumber(featureObj, ["sp_coherence_score", "coherence_score", "coherence"]);
  const entropy = pickFirstNumber(featureObj, ["sp_entropy_score", "entropy_score", "entropy"]);
  const fieldAlignment = pickFirstNumber(featureObj, ["sp_field_alignment", "field_alignment"]);
  const domainWallDensity = pickFirstNumber(featureObj, ["sp_domain_wall_density", "domain_wall_density"]);
  const susceptibility = pickFirstNumber(featureObj, ["sp_susceptibility", "susceptibility"]);
  const freeEnergy = pickFirstNumber(featureObj, ["sp_free_energy", "free_energy"]);
  const regime = resolveRegimeRecord({ features_json: featureObj }) || String(featureObj.market_regime || featureObj.regime || "").trim().toLowerCase() || null;
  const marketKey = normalizeMarket(market || featureObj.symbol_or_pair_id || featureObj.symbol || featureObj.market);
  const strategyId = String(featureObj.strategy_id || "").trim() || null;
  const entryGrade = String(featureObj.entry_grade || featureObj.entry_timing_tier || featureObj.entry_tier || "").trim().toUpperCase() || null;
  return {
    market: marketKey || null,
    tf: String(tf || featureObj.tf || "").trim() || null,
    event_upper: timing.event_upper,
    side: timing.side,
    tier: timing.tier,
    primary_long_short: timing.primary_long_short,
    active_tier: timing.active_tier,
    core_tier: timing.core_tier,
    early_tier: timing.early_tier,
    regime,
    score,
    score_abs: Number.isFinite(score) ? Math.abs(score) : null,
    confidence,
    wave_conf: waveConf,
    posterior: pickPosterior(featureObj, timing.side),
    transition_risk: transitionRisk,
    coherence,
    entropy,
    field_alignment: fieldAlignment,
    domain_wall_density: domainWallDensity,
    susceptibility,
    free_energy: freeEnergy,
    entry_grade: entryGrade,
    strategy_id: strategyId,
    raw_features_present: Object.keys(featureObj).length > 0,
  };
}

module.exports = {
  resolveCanonicalFeatureSnapshot,
};
