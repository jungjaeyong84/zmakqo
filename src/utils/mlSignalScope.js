"use strict";

const ML_PRIMARY_SIGNAL_TIERS = Object.freeze(["EARLY", "CORE"]);

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function inferTierFromText(value) {
  const text = toUpper(value);
  if (!text) return null;
  if (/(^|[_|])EARLY($|[_|])/.test(text)) return "EARLY";
  if (/(^|[_|])CORE($|[_|])/.test(text)) return "CORE";
  return null;
}

function inferDirectionFromText(value) {
  const text = toUpper(value);
  if (!text) return null;
  if (/(^|[_|])LONG($|[_|])/.test(text) || text === "BUY") return "LONG";
  if (/(^|[_|])SHORT($|[_|])/.test(text) || text === "SELL") return "SHORT";
  return null;
}

function resolveMlPrimarySignalTier(row = null) {
  const scoped = row && typeof row === "object" ? row : {};
  const features = scoped.features && typeof scoped.features === "object" && !Array.isArray(scoped.features)
    ? scoped.features
    : (scoped.features_json && typeof scoped.features_json === "object" && !Array.isArray(scoped.features_json) ? scoped.features_json : {});
  const context = scoped.context && typeof scoped.context === "object" && !Array.isArray(scoped.context) ? scoped.context : {};
  const lineage = scoped.lineage && typeof scoped.lineage === "object" && !Array.isArray(scoped.lineage) ? scoped.lineage : {};
  const candidates = [
    scoped.entry_grade,
    features.entry_grade,
    features.entry_tier,
    context.entry_grade,
    context.event,
    scoped.event,
    lineage.signal_id,
    scoped.signal_id,
    lineage.entry_event_id,
    scoped.entry_event_id,
    scoped.row_id,
  ];
  for (const candidate of candidates) {
    const tier = inferTierFromText(candidate);
    if (tier) return tier;
  }
  return null;
}

function resolveMlPrimarySignalEvent(row = null) {
  const scoped = row && typeof row === "object" ? row : {};
  const context = scoped.context && typeof scoped.context === "object" && !Array.isArray(scoped.context) ? scoped.context : {};
  const lineage = scoped.lineage && typeof scoped.lineage === "object" && !Array.isArray(scoped.lineage) ? scoped.lineage : {};
  const tier = resolveMlPrimarySignalTier(scoped);
  if (!tier) return null;
  const candidates = [
    context.event,
    scoped.event,
    context.side,
    scoped.side,
    lineage.signal_id,
    scoped.signal_id,
    lineage.entry_event_id,
    scoped.entry_event_id,
    scoped.row_id,
  ];
  for (const candidate of candidates) {
    const direction = inferDirectionFromText(candidate);
    if (direction) return `${tier}_${direction}`;
  }
  return null;
}

function isMlPrimarySignalTierAllowed(row = null) {
  return ML_PRIMARY_SIGNAL_TIERS.includes(resolveMlPrimarySignalTier(row));
}

module.exports = {
  ML_PRIMARY_SIGNAL_TIERS,
  resolveMlPrimarySignalTier,
  resolveMlPrimarySignalEvent,
  isMlPrimarySignalTierAllowed,
  __test: {
    inferTierFromText,
    inferDirectionFromText,
  },
};
