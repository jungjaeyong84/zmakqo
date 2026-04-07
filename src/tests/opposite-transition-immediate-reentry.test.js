"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperUpbitRunner");

function run() {
  assert.strictEqual(typeof __test.shouldBypassOppositeEntryCooldown, "function", "shouldBypassOppositeEntryCooldown export missing");

  const bypassed = __test.shouldBypassOppositeEntryCooldown({
    features: {
      _allow_opposite_after_exit: true,
      _flip_confirmed: true,
      _flip_stage: 2,
      opposite_transition: "CONFIRM_EXIT",
    },
    intentDir: "SHORT",
    posMeta: {
      last_exit_dir: "LONG",
    },
  });
  assert.strictEqual(bypassed, true, "confirmed opposite flip should bypass immediate reentry cooldown");

  const sameDir = __test.shouldBypassOppositeEntryCooldown({
    features: {
      _allow_opposite_after_exit: true,
      _flip_confirmed: true,
    },
    intentDir: "LONG",
    posMeta: {
      last_exit_dir: "LONG",
    },
  });
  assert.strictEqual(sameDir, false, "same-direction entry must not bypass opposite cooldown");

  const missingAllow = __test.shouldBypassOppositeEntryCooldown({
    features: {
      _flip_confirmed: true,
      _flip_stage: 2,
    },
    intentDir: "SHORT",
    posMeta: {
      last_exit_dir: "LONG",
    },
  });
  assert.strictEqual(missingAllow, false, "missing explicit allow flag must not bypass cooldown");
}

try {
  run();
  console.log("OPPOSITE_TRANSITION_IMMEDIATE_REENTRY_TEST_OK");
} catch (err) {
  console.error("OPPOSITE_TRANSITION_IMMEDIATE_REENTRY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
