"use strict";

const assert = require("assert");
const { resolveMlPrimarySignalTier, isMlPrimarySignalTierAllowed, __test } = require("../utils/mlSignalScope");

assert.strictEqual(__test.inferTierFromText("EARLY_LONG"), "EARLY");
assert.strictEqual(__test.inferTierFromText("CORE_SHORT"), "CORE");
assert.strictEqual(__test.inferTierFromText("EMO_SHORT"), null);

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

assert.strictEqual(isMlPrimarySignalTierAllowed({
  context: { event: "EMO_SHORT" },
  features: {},
}), false);

assert.strictEqual(isMlPrimarySignalTierAllowed({
  context: { event: "REAL_LONG" },
  features: { entry_grade: "CORE" },
}), true);

console.log("ML_SIGNAL_SCOPE_TEST_OK");
