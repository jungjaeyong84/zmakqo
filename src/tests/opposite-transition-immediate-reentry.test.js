"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperUpbitRunner");

function run() {
  assert.strictEqual(typeof __test.shouldBypassOppositeEntryCooldown, "function", "shouldBypassOppositeEntryCooldown export missing");
  assert.strictEqual(typeof __test.resolveOppositeCooldownWindow, "function", "resolveOppositeCooldownWindow export missing");
  assert.strictEqual(typeof __test.resolveOppositeCooldownWindowFromPosition, "function", "resolveOppositeCooldownWindowFromPosition export missing");
  assert.strictEqual(typeof __test.applyEntryExitRuleRuntimeAdjustments, "function", "applyEntryExitRuleRuntimeAdjustments export missing");

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

  const baseExitRules = {
    TP_P0: 0.008,
    TP_P0_QTY: 0.25,
    TP_P1: 0.0325,
    TP_P1_RESCUE_COHORT: 0.0165,
    TP_P1_MIXED_COHORT: 0.025,
    SL: -0.0165,
    BE_ENABLE: true,
    BE_PCT: 0.003,
    BE_PCT_RESCUE_COHORT: 0.0015,
    BE_PCT_MIXED_COHORT: 0.002,
    TRAIL_R_MULTIPLE: 0.9,
    TRAIL_R_MULTIPLE_RESCUE_COHORT: 0.6,
    TRAIL_R_MULTIPLE_MIXED_COHORT: 0.75,
    RUNNER_MIN_PROFIT_PCT: 0.022,
    RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT: 0.012,
    RUNNER_MIN_PROFIT_PCT_MIXED_COHORT: 0.0165,
  };

  const rescueAdjusted = __test.applyEntryExitRuleRuntimeAdjustments({
    rules: baseExitRules,
    sysCfg: {},
    cohort: "KEEP_DROP",
    features: {},
  });
  assert.strictEqual(rescueAdjusted.tp1LadderState.profile, "RESCUE");
  assert.strictEqual(rescueAdjusted.appliedExitRules.TP_P0, 0.008);
  assert.strictEqual(rescueAdjusted.appliedExitRules.TP_P1, 0.0165);
  assert.strictEqual(rescueAdjusted.appliedExitRules.BE_PCT, 0.0015);
  assert.strictEqual(rescueAdjusted.appliedExitRules.TRAIL_R_MULTIPLE, 0.6);

  const binanceDefaultAdjusted = __test.applyEntryExitRuleRuntimeAdjustments({
    rules: baseExitRules,
    sysCfg: {},
    cohort: "KEEP_DROP",
    features: {
      exit_policy_source: "BINANCE_DEFAULT",
    },
  });
  assert.strictEqual(binanceDefaultAdjusted.tp1LadderState.profile, "RESCUE");
  assert.strictEqual(binanceDefaultAdjusted.appliedExitRules.TP_P1, 0.0165);

  const explicitExitPolicyAdjusted = __test.applyEntryExitRuleRuntimeAdjustments({
    rules: baseExitRules,
    sysCfg: {},
    cohort: "KEEP_DROP",
    features: {
      exit_policy_source: "ATR_DYNAMIC",
      exit_policy_tp1_pct: 2.2,
      exit_policy_sl_pct: 1.1,
      exit_policy_be_pct: 0.2,
      exit_policy_trail_r_multiple: 0.7,
    },
  });
  assert.strictEqual(explicitExitPolicyAdjusted.tp1LadderState, null);
  assert.ok(Math.abs(explicitExitPolicyAdjusted.appliedExitRules.TP_P1 - 0.022) < 1e-12);
  assert.ok(Math.abs(explicitExitPolicyAdjusted.appliedExitRules.SL - (-0.011)) < 1e-12);
  assert.strictEqual(explicitExitPolicyAdjusted.appliedExitRules.BE_PCT, 0.002);
  assert.strictEqual(explicitExitPolicyAdjusted.appliedExitRules.TRAIL_R_MULTIPLE, 0.7);
}

try {
  run();
  console.log("OPPOSITE_TRANSITION_IMMEDIATE_REENTRY_TEST_OK");
} catch (err) {
  console.error("OPPOSITE_TRANSITION_IMMEDIATE_REENTRY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
