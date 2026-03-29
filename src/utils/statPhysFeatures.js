"use strict";

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function featuresOf(input) {
  if (input && input.features_json && typeof input.features_json === "object") return input.features_json;
  if (input && input.features && typeof input.features === "object") return input.features;
  if (input && typeof input === "object") return input;
  return {};
}

function entropyBucket(score) {
  const v = toNum(score);
  if (!Number.isFinite(v)) return "unknown";
  if (v < 0.35) return "<0.35";
  if (v < 0.55) return "0.35-0.54";
  if (v < 0.70) return "0.55-0.69";
  return "0.70+";
}

function coherenceBucket(score) {
  const v = toNum(score);
  if (!Number.isFinite(v)) return "unknown";
  if (v < 0.35) return "<0.35";
  if (v < 0.50) return "0.35-0.49";
  if (v < 0.65) return "0.50-0.64";
  return "0.65+";
}

function transitionRiskBucket(score) {
  const v = toNum(score);
  if (!Number.isFinite(v)) return "unknown";
  if (v < 0.30) return "<0.30";
  if (v < 0.50) return "0.30-0.49";
  if (v < 0.70) return "0.50-0.69";
  return "0.70+";
}

function fieldAlignmentBucket(score) {
  const v = toNum(score);
  if (!Number.isFinite(v)) return "unknown";
  if (v < 0.35) return "<0.35";
  if (v < 0.50) return "0.35-0.49";
  if (v < 0.65) return "0.50-0.64";
  return "0.65+";
}

function domainWallBucket(score) {
  const v = toNum(score);
  if (!Number.isFinite(v)) return "unknown";
  if (v < 0.25) return "<0.25";
  if (v < 0.45) return "0.25-0.44";
  if (v < 0.60) return "0.45-0.59";
  return "0.60+";
}

function susceptibilityBucket(score) {
  const v = toNum(score);
  if (!Number.isFinite(v)) return "unknown";
  if (v < 0.30) return "<0.30";
  if (v < 0.50) return "0.30-0.49";
  if (v < 0.65) return "0.50-0.64";
  return "0.65+";
}

function freeEnergyBucket(score) {
  const v = toNum(score);
  if (!Number.isFinite(v)) return "unknown";
  if (v < 0.35) return "<0.35";
  if (v < 0.55) return "0.35-0.54";
  if (v < 0.70) return "0.55-0.69";
  return "0.70+";
}

function deriveStatPhysState({
  entropy,
  coherence,
  transitionRisk,
  fieldAlignment,
  domainWallDensity,
  freeEnergy,
} = {}) {
  if (
    (Number.isFinite(transitionRisk) && transitionRisk >= 0.78) ||
    (Number.isFinite(freeEnergy) && freeEnergy >= 0.74)
  ) return "CRITICAL";
  if (
    (Number.isFinite(entropy) && entropy >= 0.68 && Number.isFinite(coherence) && coherence <= 0.42) ||
    (Number.isFinite(domainWallDensity) && domainWallDensity >= 0.55 && Number.isFinite(fieldAlignment) && fieldAlignment <= 0.45)
  ) return "DISORDERED";
  if (
    Number.isFinite(coherence) && coherence >= 0.68
    && Number.isFinite(entropy) && entropy <= 0.42
    && Number.isFinite(transitionRisk) && transitionRisk <= 0.42
    && Number.isFinite(freeEnergy) && freeEnergy <= 0.40
  ) return "ORDERED";
  if (
    Number.isFinite(entropy) ||
    Number.isFinite(coherence) ||
    Number.isFinite(transitionRisk) ||
    Number.isFinite(fieldAlignment) ||
    Number.isFinite(domainWallDensity) ||
    Number.isFinite(freeEnergy)
  ) return "MIXED";
  return null;
}

function displayStatPhysState(state) {
  const raw = String(state || "").trim().toUpperCase();
  if (raw === "ORDERED") return "질서 상태";
  if (raw === "DISORDERED") return "무질서 상태";
  if (raw === "CRITICAL") return "임계 전이 위험";
  if (raw === "MIXED") return "혼합 상태";
  return "정보 없음";
}

function resolveStatPhysFeatures(input) {
  const f = featuresOf(input);
  const entropy = toNum(
    f.sp_entropy_score ??
    f.stat_phys_entropy ??
    f.market_entropy_score
  );
  const coherence = toNum(
    f.sp_coherence_score ??
    f.stat_phys_coherence ??
    f.market_coherence_score
  );
  const transitionRisk = toNum(
    f.sp_transition_risk ??
    f.stat_phys_transition_risk ??
    f.critical_transition_risk
  );
  const fieldAlignment = toNum(
    f.sp_field_alignment ??
    f.stat_phys_field_alignment
  );
  const domainWallDensity = toNum(
    f.sp_domain_wall_density ??
    f.stat_phys_domain_wall_density
  );
  const susceptibility = toNum(
    f.sp_susceptibility ??
    f.stat_phys_susceptibility
  );
  const freeEnergy = toNum(
    f.sp_free_energy ??
    f.stat_phys_free_energy
  );
  const rawState = String(
    f.sp_state ??
    f.stat_phys_state ??
    ""
  ).trim().toUpperCase();
  const state = rawState || deriveStatPhysState({
    entropy,
    coherence,
    transitionRisk,
    fieldAlignment,
    domainWallDensity,
    freeEnergy,
  });
  return {
    entropy,
    coherence,
    transitionRisk,
    fieldAlignment,
    domainWallDensity,
    susceptibility,
    freeEnergy,
    state: state || null,
    display_state: displayStatPhysState(state),
    entropy_bucket: entropyBucket(entropy),
    coherence_bucket: coherenceBucket(coherence),
    transition_bucket: transitionRiskBucket(transitionRisk),
    field_alignment_bucket: fieldAlignmentBucket(fieldAlignment),
    domain_wall_bucket: domainWallBucket(domainWallDensity),
    susceptibility_bucket: susceptibilityBucket(susceptibility),
    free_energy_bucket: freeEnergyBucket(freeEnergy),
  };
}

module.exports = {
  resolveStatPhysFeatures,
  entropyBucket,
  coherenceBucket,
  transitionRiskBucket,
  fieldAlignmentBucket,
  domainWallBucket,
  susceptibilityBucket,
  freeEnergyBucket,
  displayStatPhysState,
  __test: {
    toNum,
    deriveStatPhysState,
  },
};
