"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceTickExit");

function run() {
  const first = __test.shouldSendTickExitFailureAlert({
    symbol: "BTCUSDT",
    reason: "intentId is not defined",
  });
  const second = __test.shouldSendTickExitFailureAlert({
    symbol: "BTCUSDT",
    reason: "intentId is not defined",
  });

  assert.strictEqual(first, true, "first alert must pass");
  assert.strictEqual(second, false, "second alert within cooldown must be blocked");
}

try {
  run();
  console.log("TICK_EXIT_ALERT_COOLDOWN_TEST_OK");
} catch (err) {
  console.error("TICK_EXIT_ALERT_COOLDOWN_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
