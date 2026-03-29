"use strict";

const { resolveRegimeRecord } = require("./regime");
const { resolveStatPhysFeatures } = require("./statPhysFeatures");

function featuresOf(input) {
  if (input && input.features_json && typeof input.features_json === "object") return input.features_json;
  if (input && input.features && typeof input.features === "object") return input.features;
  if (input && typeof input === "object") return input;
  return {};
}

function resolveMarketStateSummary(input = {}) {
  const features = featuresOf(input);
  const regime = resolveRegimeRecord({ features_json: features }) || null;
  const statPhys = resolveStatPhysFeatures(features);
  const entropy = Number.isFinite(statPhys.entropy) ? statPhys.entropy : null;
  const coherence = Number.isFinite(statPhys.coherence) ? statPhys.coherence : null;
  const transitionRisk = Number.isFinite(statPhys.transitionRisk) ? statPhys.transitionRisk : null;
  const fieldAlignment = Number.isFinite(statPhys.fieldAlignment) ? statPhys.fieldAlignment : null;
  const domainWallDensity = Number.isFinite(statPhys.domainWallDensity) ? statPhys.domainWallDensity : null;
  const susceptibility = Number.isFinite(statPhys.susceptibility) ? statPhys.susceptibility : null;
  const freeEnergy = Number.isFinite(statPhys.freeEnergy) ? statPhys.freeEnergy : null;
  const state = statPhys.state || null;

  const structuralCritical = (
    (Number.isFinite(freeEnergy) && freeEnergy >= 0.72 && Number.isFinite(domainWallDensity) && domainWallDensity >= 0.48) ||
    (Number.isFinite(domainWallDensity) && domainWallDensity >= 0.56 && Number.isFinite(fieldAlignment) && fieldAlignment <= 0.42) ||
    state === "CRITICAL"
  );

  const physicsDrop = (
    state === "CRITICAL"
    || (
      Number.isFinite(freeEnergy) && freeEnergy >= 0.74
      && Number.isFinite(domainWallDensity) && domainWallDensity >= 0.50
    )
    || (
      Number.isFinite(transitionRisk) && transitionRisk >= 0.82
      && Number.isFinite(entropy) && entropy >= 0.70
      && (
        (Number.isFinite(coherence) && coherence <= 0.36) ||
        (Number.isFinite(fieldAlignment) && fieldAlignment <= 0.40)
      )
    )
  );

  const physicsReduceHard = (
    state === "DISORDERED"
    || (Number.isFinite(transitionRisk) && transitionRisk >= 0.76)
    || (Number.isFinite(entropy) && entropy >= 0.78)
    || (Number.isFinite(coherence) && coherence <= 0.32)
    || (Number.isFinite(domainWallDensity) && domainWallDensity >= 0.54)
    || (Number.isFinite(susceptibility) && susceptibility >= 0.68)
    || (Number.isFinite(freeEnergy) && freeEnergy >= 0.66)
  );

  const physicsReduceSoft = (
    (Number.isFinite(transitionRisk) && transitionRisk >= 0.68)
    || (Number.isFinite(entropy) && entropy >= 0.68)
    || (Number.isFinite(coherence) && coherence <= 0.40)
    || (Number.isFinite(fieldAlignment) && fieldAlignment <= 0.50)
    || (Number.isFinite(domainWallDensity) && domainWallDensity >= 0.45)
    || (Number.isFinite(susceptibility) && susceptibility >= 0.58)
    || (Number.isFinite(freeEnergy) && freeEnergy >= 0.56)
  );

  const waitAssist = (
    (Number.isFinite(entropy) && entropy >= 0.72) ||
    (Number.isFinite(transitionRisk) && transitionRisk >= 0.72) ||
    (Number.isFinite(coherence) && coherence <= 0.38) ||
    (Number.isFinite(fieldAlignment) && fieldAlignment <= 0.42) ||
    (Number.isFinite(domainWallDensity) && domainWallDensity >= 0.50) ||
    (Number.isFinite(susceptibility) && susceptibility >= 0.66) ||
    (Number.isFinite(freeEnergy) && freeEnergy >= 0.64)
  );

  const waitHard = (
    (
      Number.isFinite(transitionRisk)
      && transitionRisk >= 0.84
      && Number.isFinite(entropy)
      && entropy >= 0.74
      && Number.isFinite(coherence)
      && coherence <= 0.42
    ) || structuralCritical
  );

  let physicsAction = "ALLOW";
  let physicsQtyScale = 1;
  if (physicsDrop) {
    physicsAction = "DROP";
    physicsQtyScale = 0;
  } else if (physicsReduceHard) {
    physicsAction = "REDUCE";
    physicsQtyScale = 0.50;
  } else if (physicsReduceSoft) {
    physicsAction = "REDUCE";
    physicsQtyScale = 0.75;
  }

  return {
    regime,
    state,
    entropy,
    coherence,
    transitionRisk,
    fieldAlignment,
    domainWallDensity,
    susceptibility,
    freeEnergy,
    structuralCritical,
    physicsDrop,
    physicsReduceHard,
    physicsReduceSoft,
    physicsAction,
    physicsQtyScale,
    waitAssist,
    waitHard,
  };
}

module.exports = {
  resolveMarketStateSummary,
  __test: {
    featuresOf,
    resolveMarketStateSummary,
  },
};
