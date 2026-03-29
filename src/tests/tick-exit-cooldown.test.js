"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceTickExit");

function run() {
  __test._symbolCooldownState.clear();
  const symbol = "BTCUSDT";
  const cooldownMs = 120000;
  const t0 = 1_700_000_000_000;

  const first = __test.shouldRunBySymbolCooldown({ symbol, now: t0, cooldownMs });
  assert.strictEqual(first.ok, true, "first execution must pass");

  const second = __test.shouldRunBySymbolCooldown({ symbol, now: t0 + 30000, cooldownMs });
  assert.strictEqual(second.ok, false, "second execution within cooldown must be blocked");
  assert.ok(second.remainingMs > 0 && second.remainingMs <= cooldownMs, "remainingMs should be valid");

  const third = __test.shouldRunBySymbolCooldown({ symbol, now: t0 + cooldownMs + 1, cooldownMs });
  assert.strictEqual(third.ok, true, "execution after cooldown must pass");
}

try {
  run();
  console.log("TICK_EXIT_COOLDOWN_TEST_OK");
} catch (err) {
  console.error("TICK_EXIT_COOLDOWN_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
