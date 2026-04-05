"use strict";

const assert = require("assert");
const { resolveMlPrimarySignalTier, resolveMlPrimarySignalEvent, isMlPrimarySignalTierAllowed, __test } = require("../utils/mlSignalScope");

assert.strictEqual(__test.inferTierFromText("EARLY_LONG"), "EARLY");
assert.strictEqual(__test.inferTierFromText("CORE_SHORT"), "CORE");
assert.strictEqual(__test.inferTierFromText("EMO_SHORT"), null);
assert.strictEqual(__test.inferDirectionFromText("BUY"), "LONG");
assert.strictEqual(__test.inferDirectionFromText("SHORT"), "SHORT");

assert.strictEqual(resolveMlPrimarySignalTier({
  context: { event: "LONG" },
  features: { entry_grade: "EARLY" },
}), "EARLY");

assert.strictEqual(resolveMlPrimarySignalTier({
  context: { event: "CORE_LONG" },
}), "CORE");

assert.strictEqual(resolveMlPrimarySignalTier({
  context: { event: "EXIT_TRAIL" },
  lineage: { signal_id: "SIG__BINANCEFUT__BNBUSDT__15m__1775379632380__EXIT_TRAIL" },
  features: { entry_grade: "EARLY" },
}), "EARLY");

assert.strictEqual(resolveMlPrimarySignalEvent({
  context: { event: "LONG" },
  side: "BUY",
  features: { entry_grade: "EARLY" },
}), "EARLY_LONG");

assert.strictEqual(resolveMlPrimarySignalEvent({
  event: "SHORT",
  side: "SELL",
  signal_id: "SIG__BINANCEFUT__ETHUSDT__15m__1000__SHORT",
  entry_grade: "CORE",
}), "CORE_SHORT");

assert.strictEqual(isMlPrimarySignalTierAllowed({
  context: { event: "EMO_SHORT" },
  features: {},
}), false);

assert.strictEqual(isMlPrimarySignalTierAllowed({
  context: { event: "REAL_LONG" },
  features: { entry_grade: "CORE" },
}), true);

console.log("ML_SIGNAL_SCOPE_TEST_OK");
