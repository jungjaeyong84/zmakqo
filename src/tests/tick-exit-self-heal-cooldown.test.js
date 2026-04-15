"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceTickExit");

async function run() {
  const oldEnv = {
    BINANCE_LIVE_STATE_SELF_HEAL_ENABLED: process.env.BINANCE_LIVE_STATE_SELF_HEAL_ENABLED,
    BINANCE_LIVE_STATE_SELF_HEAL_COOLDOWN_MS: process.env.BINANCE_LIVE_STATE_SELF_HEAL_COOLDOWN_MS,
  };

  process.env.BINANCE_LIVE_STATE_SELF_HEAL_ENABLED = "1";
  process.env.BINANCE_LIVE_STATE_SELF_HEAL_COOLDOWN_MS = "300000";
  __test.clearSelfHealCooldown();

  let runCount = 0;
  const runSelfHeal = async () => {
    runCount += 1;
    return { ok: true, repaired: 0 };
  };

  try {
    const first = await __test.runTickExitSelfHealPhase({
      cooldownMs: 300000,
      runSelfHeal,
    });
    assert.strictEqual(first.ok, true);
    assert.strictEqual(runCount, 1);

    const second = await __test.runTickExitSelfHealPhase({
      cooldownMs: 300000,
      runSelfHeal,
    });
    assert.strictEqual(second.ok, true);
    assert.strictEqual(second.skipped, true);
    assert.strictEqual(second.reason, "COOLDOWN");
    assert.strictEqual(runCount, 1);
  } finally {
    __test.clearSelfHealCooldown();
    for (const [key, value] of Object.entries(oldEnv)) {
      if (typeof value === "undefined") delete process.env[key];
      else process.env[key] = value;
    }
  }
}

run()
  .then(() => console.log("TICK_EXIT_SELF_HEAL_COOLDOWN_TEST_OK"))
  .catch((err) => {
    console.error("TICK_EXIT_SELF_HEAL_COOLDOWN_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
