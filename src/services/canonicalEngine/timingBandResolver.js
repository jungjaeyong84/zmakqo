"use strict";

const { resolveEntrySide, resolveEntryTimingTier } = require("../../utils/liveEntryTaxonomy");

function normalizeUpper(value) {
  return String(value || "").trim().toUpperCase();
}

function resolveCanonicalTimingBand({ event, features, side } = {}) {
  const eventUpper = normalizeUpper(event);
  const tier = resolveEntryTimingTier(eventUpper, features);
  const signalSide = resolveEntrySide(eventUpper, side);
  const primaryLongShort = eventUpper === "LONG" || eventUpper === "SHORT";
  return {
    event_upper: eventUpper || null,
    tier: tier || null,
    side: signalSide || null,
    primary_long_short: primaryLongShort,
    active_tier: tier === "EARLY" || tier === "CORE",
    core_tier: tier === "CORE",
    early_tier: tier === "EARLY",
  };
}

module.exports = {
  resolveCanonicalTimingBand,
};
