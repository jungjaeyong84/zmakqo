"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceTickExit");

function run() {
  __test._symbolCooldownState.clear();
  assert.strictEqual(typeof __test.buildTickTrailObservationDocUpdate, "function", "trail observation update helper missing");
  assert.strictEqual(typeof __test.buildTickTrailReconcileRunId, "function", "trail reconcile run id helper missing");

  const obsPatch = __test.buildTickTrailObservationDocUpdate({ "meta.trail_high": 1.23 }, "2026-04-10T00:00:00.000Z");
  assert.deepStrictEqual(obsPatch, {
    "meta.trail_high": 1.23,
    updated_at: "2026-04-10T00:00:00.000Z",
  }, "tick exit should only write trail observation fields directly");
  assert.strictEqual(
    __test.buildTickTrailReconcileRunId("dogeusdt", 12345),
    "RUN__TRAIL_RECONCILE__BINANCEFUT__DOGEUSDT__12345",
    "trail reconcile run id must normalize symbol"
  );

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
