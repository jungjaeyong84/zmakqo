"use strict";

function hasAnyFebtField(features = {}) {
  return Object.keys(features).some((key) => String(key || "").toLowerCase().startsWith("febt_"));
}

function normalizeBool(value) {
  if (value === true || value === false) return value;
  if (value === null || value === undefined || value === "") return null;
  const raw = String(value).trim().toLowerCase();
  if (raw === "true" || raw === "1" || raw === "yes") return true;
  if (raw === "false" || raw === "0" || raw === "no") return false;
  return null;
}

function resolveFebtTimingSnapshot({ features } = {}) {
  const featureObj = (features && typeof features === "object") ? features : {};
  return {
    payload_present: hasAnyFebtField(featureObj),
    calc_ok: normalizeBool(featureObj.febt_calc_ok),
    phase: String(featureObj.febt_phase || "").trim().toUpperCase() || null,
    verdict: String(
      featureObj.febt_timing_verdict
      || featureObj.febt_shadow_verdict
      || featureObj.febt_phase_verdict
      || ""
    ).trim().toUpperCase() || null,
  };
}

module.exports = {
  resolveFebtTimingSnapshot,
};
