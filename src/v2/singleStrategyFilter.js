"use strict";

const {
  V2_DECISION_MODES,
  V2_STRATEGY_FILTERS,
  V2_STRATEGY_FILTER_VERDICTS,
} = require("./constants");

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function validateEnum(name, value, allowed) {
  const normalized = upper(value);
  if (!allowed.includes(normalized)) {
    throw new Error(`${name}_INVALID`);
  }
  return normalized;
}

function buildVerdict(decisionMode, pass) {
  if (pass) return "PASS";
  return decisionMode === "SHADOW" ? "SHADOW" : "BLOCK";
}

function freezeResult({
  verdict,
  reason,
  signalSide,
  htfDirection,
  htfConfidence,
  minConfidence,
  evaluatedAt = null,
} = {}) {
  return Object.freeze({
    filter_name: V2_STRATEGY_FILTERS[0],
    verdict: validateEnum("verdict", verdict, V2_STRATEGY_FILTER_VERDICTS),
    reason: upper(reason),
    signal_side: validateEnum("signal_side", signalSide, ["LONG", "SHORT"]),
    htf_direction: validateEnum("htf_direction", htfDirection, ["LONG", "SHORT", "NEUTRAL"]),
    htf_confidence: htfConfidence,
    min_confidence: minConfidence,
    evaluated_at: String(evaluatedAt || "").trim() || new Date().toISOString(),
  });
}

function evaluateHtfDirectionAlignment({
  signalSide,
  htfDirection,
  htfConfidence,
  minConfidence = 0.6,
  decisionMode = "LIVE",
  evaluatedAt = null,
} = {}) {
  const side = validateEnum("signal_side", signalSide, ["LONG", "SHORT"]);
  const direction = validateEnum("htf_direction", htfDirection, ["LONG", "SHORT", "NEUTRAL"]);
  const mode = validateEnum("decision_mode", decisionMode, V2_DECISION_MODES);
  const confidence = toNumberOrNull(htfConfidence);
  const threshold = toNumberOrNull(minConfidence);
  if (threshold === null || threshold <= 0 || threshold > 1) {
    throw new Error("min_confidence_INVALID");
  }

  if (confidence === null) {
    return freezeResult({
      verdict: buildVerdict(mode, false),
      reason: "HTF_CONFIDENCE_MISSING",
      signalSide: side,
      htfDirection: direction,
      htfConfidence: confidence,
      minConfidence: threshold,
      evaluatedAt,
    });
  }

  if (direction === "NEUTRAL") {
    return freezeResult({
      verdict: buildVerdict(mode, false),
      reason: "HTF_DIRECTION_NEUTRAL",
      signalSide: side,
      htfDirection: direction,
      htfConfidence: confidence,
      minConfidence: threshold,
      evaluatedAt,
    });
  }

  if (direction !== side) {
    return freezeResult({
      verdict: buildVerdict(mode, false),
      reason: "HTF_DIRECTION_MISMATCH",
      signalSide: side,
      htfDirection: direction,
      htfConfidence: confidence,
      minConfidence: threshold,
      evaluatedAt,
    });
  }

  if (confidence < threshold) {
    return freezeResult({
      verdict: buildVerdict(mode, false),
      reason: "HTF_CONFIDENCE_TOO_LOW",
      signalSide: side,
      htfDirection: direction,
      htfConfidence: confidence,
      minConfidence: threshold,
      evaluatedAt,
    });
  }

  return freezeResult({
    verdict: "PASS",
    reason: "HTF_DIRECTION_CONFIRMED",
    signalSide: side,
    htfDirection: direction,
    htfConfidence: confidence,
    minConfidence: threshold,
    evaluatedAt,
  });
}

module.exports = {
  evaluateHtfDirectionAlignment,
};
