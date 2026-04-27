"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

async function run() {
  const prevSimplifiedExitV2Env = process.env.SIMPLIFIED_EXIT_V2_ENABLED;
  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "0";
  assert.strictEqual(typeof __test.shouldBypassOppositeEntryCooldown, "function", "shouldBypassOppositeEntryCooldown export missing");
  assert.strictEqual(typeof __test.shouldBlockSignalOverlap, "function", "shouldBlockSignalOverlap export missing");
  assert.strictEqual(typeof __test.resolveOppositeCooldownWindow, "function", "resolveOppositeCooldownWindow export missing");
  assert.strictEqual(typeof __test.resolveOppositeCooldownWindowFromPosition, "function", "resolveOppositeCooldownWindowFromPosition export missing");
  assert.strictEqual(typeof __test.resolveLiveMarketRegimeCohort, "function", "resolveLiveMarketRegimeCohort export missing");
  assert.strictEqual(typeof __test.applyEntryExitRuleRuntimeAdjustments, "function", "applyEntryExitRuleRuntimeAdjustments export missing");
  assert.strictEqual(typeof __test.repairActivePositionExitRuntimeState, "function", "repairActivePositionExitRuntimeState export missing");
  assert.strictEqual(typeof __test.collectCriticalExitRuleViolations, "function", "collectCriticalExitRuleViolations export missing");
  assert.strictEqual(typeof __test.resolveNativeProtectionStageState, "function", "resolveNativeProtectionStageState export missing");

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

  const flatOverlapBlocked = __test.shouldBlockSignalOverlap({
    pos: { position_state: "FLAT" },
    lastBarMs: 1775632500000,
    effectiveBarMs: 1775633400000,
    signalTfMs: 15 * 60 * 1000,
    signalOverlapBars: 2,
    allowOverlapUpgrade: false,
  });
  assert.strictEqual(flatOverlapBlocked, false, "flat position should not be overlap-blocked");

  const activeOverlapBlocked = __test.shouldBlockSignalOverlap({
    pos: { position_state: "ACTIVE" },
    lastBarMs: 1775632500000,
    effectiveBarMs: 1775633400000,
    signalTfMs: 15 * 60 * 1000,
    signalOverlapBars: 2,
    allowOverlapUpgrade: false,
  });
  assert.strictEqual(activeOverlapBlocked, true, "active position within overlap window should remain blocked");

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
  assert.strictEqual(mixedCooldown.bars, 1);
  assert.strictEqual(mixedCooldown.timeMs, 60000);

  const promotedMixedCooldown = __test.resolveOppositeCooldownWindow({
    sysCfg: {},
    posMeta: {
      openclaw_market_regime_cohort: "MIXED",
      tp1_ladder_profile: "MIXED",
    },
  });
  assert.strictEqual(promotedMixedCooldown.bars, 1);
  assert.strictEqual(promotedMixedCooldown.timeMs, 60000);

  const keepDropDefaultCooldown = __test.resolveOppositeCooldownWindow({
    sysCfg: {},
    posMeta: {
      openclaw_market_regime_cohort: "KEEP_DROP",
    },
  });
  assert.strictEqual(keepDropDefaultCooldown.bars, 3);
  assert.strictEqual(keepDropDefaultCooldown.timeMs, 300000);

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
  assert.strictEqual(mixedProfileCooldown.bars, 3);
  assert.strictEqual(mixedProfileCooldown.timeMs, 300000);

  const holdSampleCooldown = __test.resolveOppositeCooldownWindow({
    sysCfg: {},
    posMeta: {
      openclaw_market_regime_cohort: "HOLD_SAMPLE",
    },
  });
  assert.strictEqual(holdSampleCooldown.bars, 3);
  assert.strictEqual(holdSampleCooldown.timeMs, 300000);

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

  const liveCohortFromMeta = __test.resolveLiveMarketRegimeCohort({
    symbol: "UNKNOWN_MARKET",
    posMeta: {
      openclaw_market_regime_cohort: "MIXED",
    },
  });
  assert.strictEqual(liveCohortFromMeta, "MIXED");

  const liveCohortFallback = __test.resolveLiveMarketRegimeCohort({
    symbol: "UNKNOWN_MARKET",
    posMeta: {
      market_regime_cohort: "RESCUE",
    },
  });
  assert.strictEqual(liveCohortFallback, "RESCUE");

  const baseExitRules = {
    TP_P0: 0.008,
    TP_P0_QTY: 0.25,
    TP_P1: 0.025,
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
    exchange: "BINANCEFUT",
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
  assert.strictEqual(rescueAdjusted.appliedExitRules.RUNNER_MIN_PROFIT_PCT, 0.0165);
  assert.strictEqual(rescueAdjusted.appliedExitRules.RUNNER_MIN_PROFIT_PCT_RESCUE_COHORT, 0.0165);

  const binanceDefaultAdjusted = __test.applyEntryExitRuleRuntimeAdjustments({
    exchange: "BINANCEFUT",
    rules: baseExitRules,
    sysCfg: {},
    cohort: "KEEP_DROP",
    features: {
      exit_policy_source: "BINANCE_DEFAULT",
    },
  });
  assert.strictEqual(binanceDefaultAdjusted.tp1LadderState.profile, "RESCUE");
  assert.strictEqual(binanceDefaultAdjusted.appliedExitRules.TP_P1, 0.0165);
  assert.strictEqual(binanceDefaultAdjusted.appliedExitRules.RUNNER_MIN_PROFIT_PCT, 0.0165);

  const explicitExitPolicyAdjusted = __test.applyEntryExitRuleRuntimeAdjustments({
    exchange: "BINANCEFUT",
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
  assert.strictEqual(explicitExitPolicyAdjusted.appliedExitRules.RUNNER_MIN_PROFIT_PCT, 0.022);
  assert.strictEqual(explicitExitPolicyAdjusted.appliedExitRules.TRAIL_R_MULTIPLE, 0.7);

  assert.strictEqual(
    __test.shouldRepairActiveExitRuntimeState({
      positionSide: "LONG",
      entryPrice: 1.3738,
      posMeta: {
        native_protection_side: "LONG",
        native_protection_entry_price: 1.3738,
        exit_rules_override: {
          TP_P0: 0.008,
          TP_P0_QTY: 0.25,
          TP_P1: 0.0165,
          TP_P1_QTY: 0.5,
          SL: -0.0165,
          BE_ENABLE: true,
          BE_PCT: 0.0015,
          TRAIL_R_MULTIPLE: 0.6,
        },
      },
    }),
    false,
    "coherent active position must not trigger runtime repair"
  );

  assert.strictEqual(
    __test.shouldRepairActiveExitRuntimeState({
      positionSide: "LONG",
      entryPrice: 1.3738,
      posMeta: {
        native_protection_side: "SHORT",
        native_protection_entry_price: 1.3029,
        exit_rules_override: null,
      },
    }),
    true,
    "stale side/entry/native protection state must trigger runtime repair"
  );

  const repairedMeta = await __test.repairActivePositionExitRuntimeState({
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    positionSide: "LONG",
    entryPrice: 1.3738,
    leverage: 2,
    liveCfg: null,
    cohort: "KEEP_DROP",
    posMeta: {
      openclaw_market_regime_cohort: "KEEP_DROP",
      exit_profile: "BASE",
      exit_profile_reason: "MANUAL_BASE_PROFILE",
      exit_rules_override: {
        TP_P1: 0.025,
        TP_P1_QTY: 0.5,
        SL: -0.0165,
        BE_ENABLE: true,
        BE_PCT: 0.0025,
        TRAIL_PCT: 0.01,
      },
      tp1_ladder_profile: "RESCUE",
      tp1_ladder_stage: 0,
    },
  });
  assert.strictEqual(repairedMeta.runtime_exit_repair_applied, true);
  assert.strictEqual(repairedMeta.exit_profile_reason, "ACTIVE_POSITION_RUNTIME_REPAIR");
  assert.strictEqual(repairedMeta.exit_rules_override.TP_P0, 0, "runtime repair must keep TP0 retired");
  assert.strictEqual(repairedMeta.exit_rules_override.TP_P0_QTY, 0);
  assert.strictEqual(repairedMeta.exit_rules_override.TP_P1, 0.0165);

  const invalidViolations = __test.collectCriticalExitRuleViolations({
    rules: {
      TP_P0: 0,
      TP_P0_QTY: 0,
      TP_P1: null,
      TP_P1_QTY: 2,
      SL: 0.01,
      BE_ENABLE: true,
      BE_PCT: undefined,
      TRAIL_PCT: null,
      TRAIL_R_MULTIPLE: null,
    },
  });
  assert.ok(invalidViolations.includes("TP1_MISSING"));
  assert.ok(invalidViolations.includes("SL_INVALID"));
  assert.ok(invalidViolations.includes("BE_INVALID"));
  assert.ok(invalidViolations.includes("TRAIL_INVALID"));

  const simplifiedInvalidViolations = __test.collectCriticalExitRuleViolations({
    posMeta: {
      simplified_exit_v2_enabled: true,
    },
    rules: {
      TP_P0: 0,
      TP_P0_QTY: 0,
      TP_P1: 0.025,
      TP_P1_QTY: 0.5,
      SL: -0.0165,
      BE_ENABLE: true,
      BE_PCT: 0.0025,
      TRAIL_PCT: 0.01,
      TRAIL_R_MULTIPLE: null,
    },
  });
  assert.ok(!simplifiedInvalidViolations.includes("TP0_MISSING"));
  assert.ok(!simplifiedInvalidViolations.includes("TP0_QTY_INVALID"));

  const fullyRepairedMeta = await __test.repairActivePositionExitRuntimeState({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    positionSide: "LONG",
    entryPrice: 0.09482,
    leverage: 2,
    liveCfg: null,
    cohort: "HOLD_SAMPLE",
    posMeta: {
      openclaw_market_regime_cohort: "HOLD_SAMPLE",
      exit_profile: "BASE",
      exit_profile_reason: "MANUAL_BASE_PROFILE",
      exit_rules_override: {
        TP_P0: 0,
        TP_P0_QTY: 0,
        TP_P1: null,
        TP_P1_QTY: 2,
        SL: 0.01,
        BE_ENABLE: true,
        BE_PCT: undefined,
        TRAIL_PCT: null,
        TRAIL_R_MULTIPLE: null,
      },
      tp1_ladder_profile: "RESCUE",
      tp1_ladder_stage: 0,
    },
  });
  assert.strictEqual(fullyRepairedMeta.exit_rules_override.TP_P0, 0, "repair must keep TP0 retired");
  assert.strictEqual(fullyRepairedMeta.exit_rules_override.TP_P0_QTY, 0, "repair must keep TP0 qty retired");
  assert.ok(fullyRepairedMeta.exit_rules_override.TP_P1 > 0, "repair must restore TP1");
  assert.ok(fullyRepairedMeta.exit_rules_override.SL < 0, "repair must restore negative SL");
  assert.ok(fullyRepairedMeta.exit_rules_override.BE_PCT >= 0, "repair must restore BE");
  assert.ok(
    fullyRepairedMeta.exit_rules_override.TRAIL_PCT > 0 || fullyRepairedMeta.exit_rules_override.TRAIL_R_MULTIPLE > 0,
    "repair must restore trailing rule"
  );

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "1";
  const simplifiedFullyRepairedMeta = await __test.repairActivePositionExitRuntimeState({
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    positionSide: "LONG",
    entryPrice: 2.1,
    leverage: 2,
    liveCfg: null,
    cohort: "HOLD_SAMPLE",
    posMeta: {
      simplified_exit_v2_enabled: true,
      openclaw_market_regime_cohort: "HOLD_SAMPLE",
      exit_profile: "BASE",
      exit_profile_reason: "MANUAL_BASE_PROFILE",
      exit_rules_override: {
        TP_P0: 0,
        TP_P0_QTY: 0,
        TP_P1: null,
        TP_P1_QTY: 2,
        SL: 0.01,
        BE_ENABLE: true,
        BE_PCT: undefined,
        TRAIL_PCT: null,
        TRAIL_R_MULTIPLE: null,
      },
      tp1_ladder_profile: "RESCUE",
      tp1_ladder_stage: 0,
    },
  });
  assert.strictEqual(simplifiedFullyRepairedMeta.exit_rules_override.TP_P0, 0, "simplified V2 repair must keep TP0 disabled");
  assert.strictEqual(simplifiedFullyRepairedMeta.exit_rules_override.TP_P0_QTY, 0, "simplified V2 repair must keep TP0 qty disabled");
  assert.ok(simplifiedFullyRepairedMeta.exit_rules_override.TP_P1 > 0, "simplified V2 repair must restore TP1");
  assert.ok(simplifiedFullyRepairedMeta.exit_rules_override.SL < 0, "simplified V2 repair must restore negative SL");

  const tp0DoneStage = __test.resolveNativeProtectionStageState({
    tp_p0_done: true,
    tp_p1_done: false,
    trail_active: false,
  });
  assert.strictEqual(tp0DoneStage.tp0Eligible, false, "completed TP0 must not be re-armed");
  assert.strictEqual(tp0DoneStage.tp1Eligible, true, "TP1 should remain eligible after TP0");

  const tp1DoneStage = __test.resolveNativeProtectionStageState({
    tp_p0_done: true,
    tp_p1_done: true,
    trail_active: true,
  });
  assert.strictEqual(tp1DoneStage.tp0Eligible, false, "TP0 must stay disabled after TP1");
  assert.strictEqual(tp1DoneStage.tp1Eligible, false, "TP1 must stay disabled after TP1/trail");

  const simplifiedV2Stage = __test.resolveNativeProtectionStageState({
    simplified_exit_v2_enabled: true,
    tp_p0_done: false,
    tp_p1_done: false,
    trail_active: false,
  });
  assert.strictEqual(simplifiedV2Stage.tp0Eligible, false, "simplified V2 must never arm TP0");
  assert.strictEqual(simplifiedV2Stage.tp1Eligible, true, "simplified V2 should arm only TP1 before runner");

  const missingFlagStage = __test.resolveNativeProtectionStageState({
    tp_p0_done: false,
    tp_p1_done: false,
    trail_active: false,
  });
  assert.strictEqual(missingFlagStage.tp0Eligible, false, "missing simplified-exit flag must fail closed for TP0");
  assert.strictEqual(missingFlagStage.tp1Eligible, true, "missing simplified-exit flag must keep TP1 eligible");

  if (prevSimplifiedExitV2Env == null) delete process.env.SIMPLIFIED_EXIT_V2_ENABLED;
  else process.env.SIMPLIFIED_EXIT_V2_ENABLED = prevSimplifiedExitV2Env;
}

try {
  run()
    .then(() => {
      console.log("OPPOSITE_TRANSITION_IMMEDIATE_REENTRY_TEST_OK");
    })
    .catch((err) => {
      console.error("OPPOSITE_TRANSITION_IMMEDIATE_REENTRY_TEST_FAIL", err && err.stack ? err.stack : err);
      process.exit(1);
    });
} catch (err) {
  console.error("OPPOSITE_TRANSITION_IMMEDIATE_REENTRY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
