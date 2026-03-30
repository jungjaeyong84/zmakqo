"use strict";

const assert = require("assert");
const {
  isEntryTierEvent,
  isActiveEntryTimingTier,
  isLegacyInactiveEntryTimingTier,
  resolveEntryTimingTier,
  resolveEntryQtyProfile,
  resolveEntrySide,
  canonicalExternalEntryEvent,
  resolveActiveEntryFamily,
  resolveLegacyEntryFamily,
  describeTimingTierForUser,
} = require("../utils/liveEntryTaxonomy");

assert.strictEqual(isEntryTierEvent("LONG"), true);
assert.strictEqual(isEntryTierEvent("SHORT"), true);
assert.strictEqual(isEntryTierEvent("EARLY_LONG"), true);
assert.strictEqual(isEntryTierEvent("CORE_SHORT"), true);
assert.strictEqual(isEntryTierEvent("EMO_LONG"), false);

assert.strictEqual(resolveEntryTimingTier("LONG"), "EARLY");
assert.strictEqual(resolveEntryTimingTier("SHORT"), "EARLY");
assert.strictEqual(resolveEntryTimingTier({ event: "LONG", features: { entry_grade: "CORE" } }), "CORE");
assert.strictEqual(resolveEntryTimingTier("PRE_REAL_LONG"), "PRE_REAL");
assert.strictEqual(resolveEntryTimingTier("REAL_SHORT"), "REAL");

assert.strictEqual(isActiveEntryTimingTier("EARLY"), true);
assert.strictEqual(isActiveEntryTimingTier("CORE"), true);
assert.strictEqual(isActiveEntryTimingTier("PRE_REAL"), false);
assert.strictEqual(isLegacyInactiveEntryTimingTier("REAL"), true);
assert.strictEqual(isLegacyInactiveEntryTimingTier("CORE"), false);

assert.strictEqual(resolveEntryQtyProfile("LONG"), "FIXED");
assert.strictEqual(resolveEntryQtyProfile("SHORT"), "FIXED");
assert.strictEqual(resolveEntryQtyProfile({ event: "LONG", features: { entry_qty_profile: "FIXED" } }), "FIXED");
assert.strictEqual(resolveEntryQtyProfile("CORE_LONG"), "CORE");

assert.strictEqual(resolveEntrySide("LONG", null), "LONG");
assert.strictEqual(resolveEntrySide("SHORT", null), "SHORT");
assert.strictEqual(resolveEntrySide("CORE_LONG", null), "LONG");
assert.strictEqual(resolveEntrySide(null, "BUY"), "LONG");
assert.strictEqual(resolveEntrySide(null, "SELL"), "SHORT");

assert.strictEqual(canonicalExternalEntryEvent("LONG", "BUY"), "LONG");
assert.strictEqual(canonicalExternalEntryEvent("SHORT", "SELL"), "SHORT");
assert.strictEqual(canonicalExternalEntryEvent("EARLY_LONG", null), "LONG");
assert.strictEqual(canonicalExternalEntryEvent("CORE_SHORT", null), "SHORT");
assert.strictEqual(canonicalExternalEntryEvent("PRE_REAL_LONG", "BUY"), "LONG");
assert.strictEqual(resolveActiveEntryFamily("EARLY_LONG", null, null), "EARLY_LONG");
assert.strictEqual(resolveActiveEntryFamily({ event: "LONG", features: { entry_grade: "CORE" }, side: "BUY" }), "CORE_LONG");
assert.strictEqual(resolveActiveEntryFamily("PRE_REAL_LONG", null, "BUY"), null);
assert.strictEqual(resolveLegacyEntryFamily("PRE_REAL_LONG", null, "BUY"), "PRE_REAL_LONG");
assert.strictEqual(resolveLegacyEntryFamily("CORE_SHORT", null, "SELL"), null);

assert.strictEqual(describeTimingTierForUser("EARLY"), "LONG/SHORT 기본 진입");
assert.strictEqual(describeTimingTierForUser("CORE"), "LONG/SHORT 확장 진입");
assert.strictEqual(describeTimingTierForUser("PRE_REAL"), "레거시 진단 B(비활성)");
assert.strictEqual(describeTimingTierForUser("REAL"), "레거시 진단 C(비활성)");

console.log("LIVE_ENTRY_TAXONOMY_TEST_OK");
