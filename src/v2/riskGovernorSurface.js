"use strict";

function toArray(value) {
  return Array.isArray(value) ? value.filter(Boolean) : [];
}

function normalizeRiskGovernorSurface(surface = null) {
  const source = surface && typeof surface === "object" ? surface : {};
  const blockers = toArray(source.blockers || source.blocker_codes);
  const warnings = toArray(source.warnings);
  const reason = String(source.reason || source.primary_reason || "").trim() || null;
  const ok = source.ok === true || (source.present === true && blockers.length === 0 && !reason);
  return {
    present: source.present !== false,
    ok,
    reason,
    blockers,
    blocker_codes: blockers,
    warnings,
    primary_code: String(source.primary_code || blockers[0] || "").trim() || null,
    primary_blocker: String(source.primary_blocker || blockers[0] || reason || "").trim() || null,
  };
}

function riskGovernorTelegramLine(surface = null) {
  const normalized = normalizeRiskGovernorSurface(surface);
  if (!normalized.present) return null;
  if (normalized.ok) return "리스크 거버너: 정상";
  const detail = normalized.primary_blocker || normalized.reason || "UNKNOWN";
  return `리스크 거버너: ${detail}`;
}

module.exports = Object.freeze({
  normalizeRiskGovernorSurface,
  riskGovernorTelegramLine,
});
