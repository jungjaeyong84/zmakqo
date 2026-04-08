"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperUpbitRunner");

function run() {
  assert.strictEqual(typeof __test.shouldBypassOppositeEntryCooldown, "function", "shouldBypassOppositeEntryCooldown export missing");
  assert.strictEqual(typeof __test.resolveOppositeCooldownWindow, "function", "resolveOppositeCooldownWindow export missing");
  assert.strictEqual(typeof __test.resolveOppositeCooldownWindowFromPosition, "function", "resolveOppositeCooldownWindowFromPosition export missing");

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

  const rescueCooldown = __test.resolveOppositeCooldownWindow({
    sysCfg: {},
    posMeta: {
      openclaw_market_regime_cohort: "RESCUE",
    },
  });
  assert.strictEqual(rescueCooldown.bars, 0);
  assert.strictEqual(rescueCooldown.timeMs, 0);

  const mixedCooldown = __test.resolveOppositeCooldownWindow({
    sysCfg: {},
    posMeta: {
      openclaw_market_regime_cohort: "MIXED",
    },
  });
  assert.strictEqual(mixedCooldown.bars, 0);
  assert.strictEqual(mixedCooldown.timeMs, 0);

  const promotedMixedCooldown = __test.resolveOppositeCooldownWindow({
    sysCfg: {},
    posMeta: {
      openclaw_market_regime_cohort: "MIXED",
      tp1_ladder_profile: "MIXED",
    },
  });
  assert.strictEqual(promotedMixedCooldown.bars, 1);
  assert.strictEqual(promotedMixedCooldown.timeMs, 60000);

  const rescueDefaultCooldown = __test.resolveOppositeCooldownWindow({
    sysCfg: {},
    posMeta: {
      openclaw_market_regime_cohort: "KEEP_DROP",
    },
  });
  assert.strictEqual(rescueDefaultCooldown.bars, 0);
  assert.strictEqual(rescueDefaultCooldown.timeMs, 0);

  const baseCooldown = __test.resolveOppositeCooldownWindow({
    sysCfg: {},
    posMeta: {
      openclaw_market_regime_cohort: "KEEP_DROP",
      tp1_ladder_profile: "BASE",
    },
  });
  assert.strictEqual(baseCooldown.bars, 3);
  assert.strictEqual(baseCooldown.timeMs, 300000);

  const mixedProfileCooldown = __test.resolveOppositeCooldownWindow({
    sysCfg: {},
    posMeta: {
      openclaw_market_regime_cohort: "KEEP_DROP",
      tp1_ladder_profile: "MIXED",
    },
  });
  assert.strictEqual(mixedProfileCooldown.bars, 1);
  assert.strictEqual(mixedProfileCooldown.timeMs, 60000);

  const fromPositionCooldown = __test.resolveOppositeCooldownWindowFromPosition({
    sysCfg: {},
    position: {
      meta: {
        openclaw_market_regime_cohort: "RESCUE",
      },
    },
  });
  assert.strictEqual(fromPositionCooldown.bars, 0);
  assert.strictEqual(fromPositionCooldown.timeMs, 0);
}

try {
  run();
  console.log("OPPOSITE_TRANSITION_IMMEDIATE_REENTRY_TEST_OK");
} catch (err) {
  console.error("OPPOSITE_TRANSITION_IMMEDIATE_REENTRY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
