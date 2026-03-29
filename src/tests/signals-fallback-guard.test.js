"use strict";

const assert = require("assert");
const { __test } = require("../storage/signalsQuery");

function run() {
  process.env.SIGNALS_FALLBACK_ALERT_DISABLE = "1";
  __test.resetFallbackGuardStateForTest();

  const cfg = {
    scanLimit: 500,
    maxCallsPerMin: 30,
    cooldownMs: 900000,
    alertMinIntervalMs: 300000,
    forceOpen: false,
    forceOpenUntilMs: NaN,
  };
  const ctx = { exchange: "BINANCEFUT", symbol: "BTCUSDT", tf: "60m", caller: "unit-test" };
  const t0 = 1_700_000_000_000;

  for (let i = 0; i < 30; i += 1) {
    const permit = __test.consumeFallbackPermit({ nowMs: t0 + i, cfg, context: ctx });
    assert.strictEqual(permit.ok, true, `permit should be granted at #${i + 1}`);
  }

  const over = __test.consumeFallbackPermit({ nowMs: t0 + 30, cfg, context: ctx });
  assert.strictEqual(over.ok, false, "permit should be blocked after limit");
  assert.strictEqual(over.reason, "RATE_LIMIT_OPENED");
  assert.ok(__test.fallbackGuardState.openUntilMs > (t0 + 30), "circuit must be opened");

  const blocked = __test.consumeFallbackPermit({ nowMs: t0 + 60, cfg, context: ctx });
  assert.strictEqual(blocked.ok, false, "permit must stay blocked while circuit open");
  assert.strictEqual(blocked.reason, "CIRCUIT_OPEN");

  const reopened = __test.consumeFallbackPermit({
    nowMs: __test.fallbackGuardState.openUntilMs + 1,
    cfg,
    context: ctx,
  });
  assert.strictEqual(reopened.ok, true, "permit should reopen after cooldown");
}

try {
  run();
  console.log("SIGNALS_FALLBACK_GUARD_TEST_OK");
} catch (err) {
  console.error("SIGNALS_FALLBACK_GUARD_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
