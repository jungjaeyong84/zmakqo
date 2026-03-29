"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperUpbitRunner");

function run() {
  assert.strictEqual(typeof __test.isCoreOrRealEvent, "function", "isCoreOrRealEvent export missing");

  assert.strictEqual(__test.isCoreOrRealEvent("LONG"), true, "LONG must participate in opposite transition confirm flow");
  assert.strictEqual(__test.isCoreOrRealEvent("SHORT"), true, "SHORT must participate in opposite transition confirm flow");
  assert.strictEqual(__test.isCoreOrRealEvent("CORE_LONG"), true);
  assert.strictEqual(__test.isCoreOrRealEvent("PRE_REAL_SHORT"), true);
  assert.strictEqual(__test.isCoreOrRealEvent("REAL_LONG"), true);
  assert.strictEqual(__test.isCoreOrRealEvent("EARLY_LONG"), false, "legacy early-only signals should stay outside core/real-only confirm flow");
}

try {
  run();
  console.log("OPPOSITE_TRANSITION_ENTRY_SCOPE_TEST_OK");
} catch (err) {
  console.error("OPPOSITE_TRANSITION_ENTRY_SCOPE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
