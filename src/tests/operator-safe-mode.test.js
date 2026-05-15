"use strict";

const assert = require("assert");

const { __test } = require("../v2/operatorSafeMode");

(() => {
  const planned = __test.planOperatorSafeModeAction({ action: "V3_PAPER_ONLY", confirm: false });
  assert.strictEqual(planned.ok, true);
  assert.strictEqual(planned.applied, false);
  assert.strictEqual(planned.env_patch.OPENCLAW_PRIMARY_LEARNING_LANE, "V3_PAPER");
})();

(() => {
  const unsupported = __test.planOperatorSafeModeAction({ action: "UNKNOWN_ACTION" });
  assert.strictEqual(unsupported.ok, false);
})();

console.log("operator-safe-mode.test.js PASS");
