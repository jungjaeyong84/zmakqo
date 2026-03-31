"use strict";

const { resolveCanonicalFeatureSnapshot } = require("./featureSnapshot");
const { resolveFebtTimingSnapshot } = require("./febtTimingResolver");
const { resolveCanonicalSignalClassification } = require("./signalClassifier");
const {
  normalizeCanonicalEngineSourceMode,
  normalizeCanonicalEngineMarketOverrides,
  resolveCanonicalEngineConfig,
} = require("./thresholdResolver");
const { resolveCanonicalTimingBand } = require("./timingBandResolver");
const { evaluateCanonicalDecision } = require("./canonicalDecision");

module.exports = {
  resolveCanonicalFeatureSnapshot,
  resolveFebtTimingSnapshot,
  resolveCanonicalSignalClassification,
  normalizeCanonicalEngineSourceMode,
  normalizeCanonicalEngineMarketOverrides,
  resolveCanonicalEngineConfig,
  resolveCanonicalTimingBand,
  evaluateCanonicalDecision,
};
