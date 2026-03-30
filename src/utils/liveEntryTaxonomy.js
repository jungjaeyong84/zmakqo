"use strict";

function normalizeUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function resolveEventToken(eventOrRow) {
  if (eventOrRow && typeof eventOrRow === "object" && !Array.isArray(eventOrRow)) {
    return normalizeUpper(eventOrRow.event);
  }
  return normalizeUpper(eventOrRow);
}

function resolveFeatureObject(eventOrRow, featuresMaybe) {
  if (featuresMaybe && typeof featuresMaybe === "object" && !Array.isArray(featuresMaybe)) {
    return featuresMaybe;
  }
  if (eventOrRow && typeof eventOrRow === "object" && !Array.isArray(eventOrRow)) {
    if (eventOrRow.features_json && typeof eventOrRow.features_json === "object") return eventOrRow.features_json;
    if (eventOrRow.features && typeof eventOrRow.features === "object") return eventOrRow.features;
  }
  return {};
}

function normalizeTierToken(value) {
  const tier = normalizeUpper(value);
  if (tier === "EARLY" || tier === "CORE" || tier === "PRE_REAL" || tier === "REAL") return tier;
  return null;
}

function normalizeQtyProfileToken(value) {
  const profile = normalizeUpper(value);
  if (profile === "FIXED" || profile === "EARLY" || profile === "CORE" || profile === "PRE_REAL" || profile === "REAL") {
    return profile;
  }
  return null;
}

function isActiveEntryTimingTier(tierRaw) {
  const tier = normalizeUpper(tierRaw);
  return tier === "EARLY" || tier === "CORE";
}

function isLegacyInactiveEntryTimingTier(tierRaw) {
  const tier = normalizeUpper(tierRaw);
  return tier === "PRE_REAL" || tier === "REAL";
}

function isPrimaryLongShortEvent(eventRaw) {
  const ev = resolveEventToken(eventRaw);
  return ev === "LONG" || ev === "SHORT";
}

function isLegacyTierEntryEvent(eventRaw) {
  const ev = resolveEventToken(eventRaw);
  return (
    ev.startsWith("EARLY_")
    || ev.startsWith("CORE_")
    || ev.startsWith("PRE_REAL_")
    || ev.startsWith("REAL_")
  );
}

function isEntryTierEvent(eventRaw) {
  return isPrimaryLongShortEvent(eventRaw) || isLegacyTierEntryEvent(eventRaw);
}

function resolveEntryTimingTier(eventRaw, featuresMaybe) {
  const ev = resolveEventToken(eventRaw);
  const features = resolveFeatureObject(eventRaw, featuresMaybe);
  if (!ev) return null;
  if (isPrimaryLongShortEvent(ev)) {
    const hinted = normalizeTierToken(features.entry_grade || features.entry_timing_tier || features.entry_tier);
    return hinted === "CORE" ? "CORE" : "EARLY";
  }
  if (ev.startsWith("EARLY_")) return "EARLY";
  if (ev.startsWith("CORE_")) return "CORE";
  if (ev.startsWith("PRE_REAL_")) return "PRE_REAL";
  if (ev.startsWith("REAL_")) return "REAL";
  return null;
}

function resolveEntryQtyProfile(eventRaw, featuresMaybe) {
  const ev = resolveEventToken(eventRaw);
  if (!ev) return null;
  if (isPrimaryLongShortEvent(ev)) {
    return "FIXED";
  }
  if (ev.startsWith("PRE_REAL_")) return "PRE_REAL";
  if (ev.startsWith("REAL_")) return "REAL";
  if (ev.startsWith("CORE_")) return "CORE";
  if (ev.startsWith("EARLY_")) return "EARLY";
  return null;
}

function resolveEntrySide(eventRaw, sideRaw) {
  const side = normalizeUpper(
    sideRaw === undefined && eventRaw && typeof eventRaw === "object" && !Array.isArray(eventRaw)
      ? (eventRaw.side || eventRaw.action)
      : sideRaw
  );
  if (side === "BUY" || side === "LONG") return "LONG";
  if (side === "SELL" || side === "SHORT") return "SHORT";
  const ev = resolveEventToken(eventRaw);
  if (ev === "LONG" || ev.endsWith("_LONG")) return "LONG";
  if (ev === "SHORT" || ev.endsWith("_SHORT")) return "SHORT";
  return null;
}

function canonicalExternalEntryEvent(eventRaw, sideRaw) {
  const ev = resolveEventToken(eventRaw);
  if (!ev) return null;
  if (ev === "LONG" || ev === "SHORT") return ev;
  if (!isLegacyTierEntryEvent(ev)) return null;
  const side = resolveEntrySide(ev, sideRaw);
  if (side === "LONG") return "LONG";
  if (side === "SHORT") return "SHORT";
  return null;
}

function resolveActiveEntryFamily(eventRaw, featuresMaybe, sideRaw) {
  const tier = resolveEntryTimingTier(eventRaw, featuresMaybe);
  const side = resolveEntrySide(eventRaw, sideRaw);
  if (!side || !isActiveEntryTimingTier(tier)) return null;
  return `${tier}_${side}`;
}

function hasActiveEntryFamily(eventRaw, featuresMaybe, sideRaw) {
  return !!resolveActiveEntryFamily(eventRaw, featuresMaybe, sideRaw);
}

function resolveLegacyEntryFamily(eventRaw, featuresMaybe, sideRaw) {
  const tier = resolveEntryTimingTier(eventRaw, featuresMaybe);
  const side = resolveEntrySide(eventRaw, sideRaw);
  if (!side || !isLegacyInactiveEntryTimingTier(tier)) return null;
  return `${tier}_${side}`;
}

function describeTimingTierForUser(tierRaw) {
  const tier = normalizeUpper(tierRaw);
  if (!tier) return "N/A";
  if (tier === "EARLY") return "LONG/SHORT 기본 진입";
  if (tier === "CORE") return "LONG/SHORT 확장 진입";
  if (tier === "PRE_REAL") return "레거시 진단 B(비활성)";
  if (tier === "REAL") return "레거시 진단 C(비활성)";
  return tier;
}

function describeQtyProfileForUser(profileRaw) {
  const profile = normalizeUpper(profileRaw);
  if (!profile) return "N/A";
  if (profile === "FIXED") return "LONG/SHORT 고정 수량";
  if (profile === "EARLY") return "LONG/SHORT 기본 진입 수량";
  if (profile === "CORE") return "LONG/SHORT 확장 진입 수량";
  if (profile === "PRE_REAL") return "레거시 진단 B 수량(비활성)";
  if (profile === "REAL") return "레거시 진단 C 수량(비활성)";
  return profile;
}

function describeEntryEventForUser(eventRaw, sideRaw) {
  const external = canonicalExternalEntryEvent(eventRaw, sideRaw);
  const side = resolveEntrySide(eventRaw, sideRaw);
  const tier = resolveEntryTimingTier(eventRaw);
  if (external) return external;
  if (side && tier) return `${side} / ${describeTimingTierForUser(tier)}`;
  if (tier) return describeTimingTierForUser(tier);
  return normalizeUpper(eventRaw) || "N/A";
}

module.exports = {
  normalizeUpper,
  isActiveEntryTimingTier,
  isLegacyInactiveEntryTimingTier,
  isPrimaryLongShortEvent,
  isLegacyTierEntryEvent,
  isEntryTierEvent,
  resolveEntryTimingTier,
  resolveEntryQtyProfile,
  resolveEntrySide,
  canonicalExternalEntryEvent,
  resolveActiveEntryFamily,
  hasActiveEntryFamily,
  resolveLegacyEntryFamily,
  describeTimingTierForUser,
  describeQtyProfileForUser,
  describeEntryEventForUser,
};
