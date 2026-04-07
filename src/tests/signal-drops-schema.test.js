"use strict";

const assert = require("assert");
const { __test } = require("../storage/signalDrops");

(() => {
  assert.strictEqual(__test.deriveReasonFamily("EV_POLICY_LOW_CONF"), "EV_POLICY");
  assert.strictEqual(__test.deriveReasonFamily("cooldown_policy_block"), "COOLDOWN_POLICY");
  assert.strictEqual(__test.deriveReasonFamily(""), "UNKNOWN");
})();

console.log("SIGNAL_DROPS_SCHEMA_TEST_OK");
