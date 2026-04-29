"use strict";

const assert = require("assert");
const {
  generateSignals,
  resolveExitRulesForPosition,
  evaluateTp1LadderStage,
  applyTp1LadderPolicy,
  resolveTrailDelayState,
} = require("../engine/signalEngine");

const prevSimplifiedExitV2Env = process.env.SIMPLIFIED_EXIT_V2_ENABLED;

function run() {
  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "0";
  const tp0Signals = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    trading_mode: "EXIT_ONLY",
    leverage: 2,
    currentBarCloseMs: 1_800_000_900_000,
    bar: { close: 100.5, c: 100.5 },
    position: {
      state: "ACTIVE",
      size_pct: 1,
      avg_price: 100,
      position_side: "LONG",
      meta: {
        simplified_exit_v2_enabled: false,
        external_leverage: 2,
        ev_gate_atr_pct: 0.012,
        tp_p0_done: false,
        tp_p1_done: false,
      },
    },
  });
  assert.deepStrictEqual(tp0Signals, [], "tp0 retirement must suppress legacy partial exits even when env=false");

  delete process.env.SIMPLIFIED_EXIT_V2_ENABLED;
  const defaultNoTp0Signals = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    trading_mode: "EXIT_ONLY",
    leverage: 2,
    currentBarCloseMs: 1_800_000_900_000,
    bar: { close: 100.5, c: 100.5 },
    position: {
      state: "ACTIVE",
      size_pct: 1,
      avg_price: 100,
      position_side: "LONG",
      meta: {
        external_leverage: 2,
        ev_gate_atr_pct: 0.012,
        tp_p0_done: false,
        tp_p1_done: false,
      },
    },
  });
  assert.deepStrictEqual(defaultNoTp0Signals, [], "runtime default must fail closed to simplified exit v2 when env is omitted");

  process.env.SIMPLIFIED_EXIT_V2_ENABLED = "0";

  const simplifiedNoTp0Signals = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    trading_mode: "EXIT_ONLY",
    leverage: 2,
    currentBarCloseMs: 1_800_000_900_000,
    bar: { close: 100.5, c: 100.5 },
    position: {
      state: "ACTIVE",
      size_pct: 1,
      avg_price: 100,
      position_side: "LONG",
      meta: {
        simplified_exit_v2_enabled: true,
        external_leverage: 2,
        ev_gate_atr_pct: 0.012,
        tp_p0_done: false,
        tp_p1_done: false,
      },
    },
  });
  assert.deepStrictEqual(simplifiedNoTp0Signals, [], "simplified v2 must not emit tp0-only partial exits");

  const simplifiedTp1OnlySignals = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    trading_mode: "EXIT_ONLY",
    leverage: 2,
    currentBarCloseMs: 1_800_101_000_000,
    bar: { close: 100.9, c: 100.9 },
    position: {
      state: "ACTIVE",
      size_pct: 1,
      avg_price: 100,
      position_side: "LONG",
      meta: {
        simplified_exit_v2_enabled: true,
        external_leverage: 2,
        ev_gate_atr_pct: 0.012,
        tp_p0_done: false,
        tp_p1_done: false,
        openclaw_market_regime_cohort: "RESCUE",
      },
    },
  });
  assert.strictEqual(simplifiedTp1OnlySignals.length, 1, "simplified v2 must emit only tp1 when profit already crossed tp1");
  assert.strictEqual(simplifiedTp1OnlySignals[0].event, "EXIT_TP_P1_1.65P");
  assert.strictEqual(simplifiedTp1OnlySignals[0].qty_pct, 0.5);

  const staleTp0Signals = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    trading_mode: "EXIT_ONLY",
    leverage: 2,
    currentBarCloseMs: 1_800_010_900_000,
    bar: { close: 100.5, c: 100.5 },
    position: {
      state: "ACTIVE",
      size_pct: 1,
      avg_price: 100,
      position_side: "LONG",
      meta: {
        simplified_exit_v2_enabled: false,
        external_leverage: 2,
        ev_gate_atr_pct: 0.012,
        entry_exec_bar_ms: 1_800_010_000_000,
        entry_event_id: "ENTRY__CUR",
        tp_p0_done: true,
        tp_p0_at: new Date(1_800_000_000_000).toISOString(),
      },
    },
  });
  assert.deepStrictEqual(staleTp0Signals, [], "stale tp0 meta must not recreate retired tp0 exits");

  const pctPointAtrTp0Signals = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "BNBUSDT",
    trading_mode: "EXIT_ONLY",
    leverage: 2,
    currentBarCloseMs: 1_800_020_900_000,
    bar: { close: 99.59, c: 99.59 },
    position: {
      state: "ACTIVE",
      size_pct: 1,
      avg_price: 100,
      position_side: "SHORT",
      meta: {
        simplified_exit_v2_enabled: false,
        external_leverage: 2,
        ev_gate_atr_pct: 0.509,
        tp_p0_done: false,
        tp_p1_done: false,
      },
    },
  });
  assert.deepStrictEqual(pctPointAtrTp0Signals, [], "percentage-point atr input must not revive retired tp0 exits");

  const delayedTrail = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    trading_mode: "EXIT_ONLY",
    leverage: 2,
    currentBarCloseMs: 1_800_000_000_000 + (15 * 60 * 1000),
    bar: { close: 99.1, c: 99.1 },
    position: {
      state: "ACTIVE",
      size_pct: 0.5,
      avg_price: 100,
      position_side: "SHORT",
      meta: {
        external_leverage: 2,
        tp_p1_done: true,
        trail_active: false,
        tp_p1_price: 98.4,
        tp_p1_bar_ms: 1_800_000_000_000,
        entry_exec_tf_ms: 15 * 60 * 1000,
        trail_low: 98.0,
        entry_r_distance: 0.5,
        trail_delay_bars_required: 1,
        trail_delay_mfe_pct_required: 0.005,
      },
    },
  });
  assert.strictEqual(delayedTrail.length, 1, "one-bar delayed trail should arm after one bar");
  assert.strictEqual(delayedTrail[0].event, "EXIT_TRAIL");
  assert.strictEqual(delayedTrail[0].features.trail_delay_bars_ready, true);
  assert.strictEqual(delayedTrail[0].features.trail_delay_release_reason, "BAR_DELAY_RELEASE");

  // 2026-04-29 — Issue 3 fix: trail-delay mfeMove is now absolute (no
  // longer divided by leverage). closePx must clear tp1_target by
  // ≥ mfePctRequired (0.5 %) to release MFE_DELAY. For
  // tp1_target_price=99.175 (SHORT), that's closePx ≤ 98.679. Picking
  // 98.6 (≈ -0.58 %) keeps the test intent (MFE_DELAY_RELEASE arms)
  // robust to small re-tunings of mfePctRequired. The legacy
  // leverage-divided behaviour is covered by the
  // recent-entry-grace-and-trail-mfe-absolute test (case D, env-gated).
  const targetBasedTrailDelay = resolveTrailDelayState({
    meta: {
      tp_p1_done: true,
      trail_active: false,
      tp_p1_price: 98.8,
      tp_p1_target_price: 99.175,
      tp_p1_bar_ms: 1_800_000_000_000,
      entry_exec_tf_ms: 15 * 60 * 1000,
      trail_delay_bars_required: 0,
      trail_delay_mfe_pct_required: 0.005,
    },
    tpP1Done: true,
    currentBarMs: 1_800_000_100_000,
    closePx: 98.6,
    side: "SHORT",
    leverageEff: 2,
    rules: {},
  });
  assert.strictEqual(targetBasedTrailDelay.trailActive, true, "trail delay should arm from tp1 target price");
  assert.strictEqual(targetBasedTrailDelay.releaseReason, "MFE_DELAY_RELEASE");

  const rescueTp1 = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    trading_mode: "EXIT_ONLY",
    leverage: 2,
    currentBarCloseMs: 1_800_100_000_000,
    bar: { close: 101.45, c: 101.45 },
    position: {
      state: "ACTIVE",
      size_pct: 1,
      avg_price: 100,
      position_side: "LONG",
      meta: {
        simplified_exit_v2_enabled: false,
        external_leverage: 2,
        tp_p0_done: true,
        tp_p1_done: false,
        openclaw_market_regime_cohort: "RESCUE",
      },
    },
  });
  assert.strictEqual(rescueTp1.length, 1, "rescue cohort should shorten tp1");
  assert.strictEqual(rescueTp1[0].event, "EXIT_TP_P1_1.65P");
  assert.strictEqual(rescueTp1[0].qty_pct, 0.5, "TP1 contract must remain 50% of the original position");

  const tp0Tp1Cascade = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    trading_mode: "EXIT_ONLY",
    leverage: 2,
    currentBarCloseMs: 1_800_101_000_000,
    bar: { close: 100.9, c: 100.9 },
    position: {
      state: "ACTIVE",
      size_pct: 1,
      avg_price: 100,
      position_side: "LONG",
      meta: {
        simplified_exit_v2_enabled: false,
        external_leverage: 2,
        ev_gate_atr_pct: 0.012,
        tp_p0_done: false,
        tp_p1_done: false,
        openclaw_market_regime_cohort: "RESCUE",
      },
    },
  });
  assert.strictEqual(tp0Tp1Cascade.length, 1, "when pnl already crossed tp1, only tp1 must be emitted");
  assert.strictEqual(tp0Tp1Cascade[0].event, "EXIT_TP_P1_1.65P");
  assert.strictEqual(tp0Tp1Cascade[0].qty_pct, 0.5);

  const tp1AfterTp0Remaining = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    trading_mode: "EXIT_ONLY",
    leverage: 2,
    currentBarCloseMs: 1_800_100_000_000,
    bar: { close: 101.45, c: 101.45 },
    position: {
      state: "ACTIVE",
      size_pct: 0.75,
      avg_price: 100,
      position_side: "LONG",
      meta: {
        external_leverage: 2,
        tp_p0_done: true,
        tp_p1_done: false,
      },
    },
  });
  assert.strictEqual(tp1AfterTp0Remaining.length, 1, "TP1 should still fire after TP0");
  assert.strictEqual(tp1AfterTp0Remaining[0].qty_pct, 0.5, "TP1 qty must stay absolute even after TP0");

  const rescueRules = resolveExitRulesForPosition({
    exchange: "BINANCEFUT",
    position: {
      meta: {
        openclaw_market_regime_cohort: "RESCUE",
      },
    },
  });
  assert.strictEqual(rescueRules.TP_P1, 0.0165);
  assert.strictEqual(rescueRules.BE_PCT, 0.0015);
  assert.strictEqual(rescueRules.TRAIL_R_MULTIPLE, 0.6);
  assert.strictEqual(rescueRules.RUNNER_MIN_PROFIT_PCT, 0.0165);

  const mixedRules = resolveExitRulesForPosition({
    exchange: "BINANCEFUT",
    position: {
      meta: {
        openclaw_market_regime_cohort: "MIXED",
      },
    },
  });
  assert.strictEqual(mixedRules.TP_P1, 0.0165);
  assert.strictEqual(mixedRules.BE_PCT, 0.0015);
  assert.strictEqual(mixedRules.TRAIL_R_MULTIPLE, 0.6);
  assert.strictEqual(mixedRules.RUNNER_MIN_PROFIT_PCT, 0.0165);

  const promotedMixedRules = resolveExitRulesForPosition({
    exchange: "BINANCEFUT",
    position: {
      meta: {
        openclaw_market_regime_cohort: "MIXED",
        tp1_ladder_profile: "MIXED",
        tp1_ladder_stage: 1,
      },
    },
  });
  assert.strictEqual(promotedMixedRules.TP_P1, 0.025);
  assert.strictEqual(promotedMixedRules.BE_PCT, 0.002);
  assert.strictEqual(promotedMixedRules.TRAIL_R_MULTIPLE, 0.75);
  assert.strictEqual(promotedMixedRules.RUNNER_MIN_PROFIT_PCT, 0.0165);

  const promotedBaseRules = resolveExitRulesForPosition({
    exchange: "BINANCEFUT",
    position: {
      meta: {
        openclaw_market_regime_cohort: "RESCUE",
        tp1_ladder_profile: "BASE",
        tp1_ladder_stage: 2,
      },
    },
  });
  assert.strictEqual(promotedBaseRules.TP_P1, 0.025);

  const samplingStage = evaluateTp1LadderStage({
    cohort: "BASE",
    kpi: {
      realized_n: 24,
      tp0_hit_rate: 0.75,
      tp1_hit_rate: 0.375,
      tp0_to_tp1_conversion: 0,
      fee_adjusted_expectancy: -0.0011,
    },
  });
  assert.strictEqual(samplingStage.stage, 0);
  assert.strictEqual(samplingStage.profile, "RESCUE");
  assert.strictEqual(samplingStage.reason, "STAGE_0_SAMPLING");

  const promotedMixedStage = evaluateTp1LadderStage({
    cohort: "MIXED",
    kpi: {
      realized_n: 10,
      tp0_hit_rate: 0.62,
      tp1_hit_rate: 0.28,
      tp0_to_tp1_conversion: 0.24,
      fee_adjusted_expectancy: 0.0002,
    },
  });
  assert.strictEqual(promotedMixedStage.stage, 1);
  assert.strictEqual(promotedMixedStage.profile, "MIXED");

  const promotedRescueStage = evaluateTp1LadderStage({
    cohort: "RESCUE",
    kpi: {
      realized_n: 20,
      tp0_hit_rate: 0.67,
      tp1_hit_rate: 0.32,
      tp0_to_tp1_conversion: 0.4,
      fee_adjusted_expectancy: 0.0003,
    },
  });
  assert.strictEqual(promotedRescueStage.stage, 2);
  assert.strictEqual(promotedRescueStage.profile, "BASE");

  const promotedBaseStage = evaluateTp1LadderStage({
    cohort: "BASE",
    kpi: {
      realized_n: 20,
      tp0_hit_rate: 0.67,
      tp1_hit_rate: 0.32,
      tp0_to_tp1_conversion: 0.4,
      fee_adjusted_expectancy: 0.0003,
    },
  });
  assert.strictEqual(promotedBaseStage.stage, 2);
  assert.strictEqual(promotedBaseStage.profile, "BASE");

  const frozenStage = evaluateTp1LadderStage({
    cohort: "BASE",
    config: { enabled: true, freeze: true },
    kpi: {
      realized_n: 50,
      tp0_hit_rate: 0.9,
      tp1_hit_rate: 0.5,
      tp0_to_tp1_conversion: 0.5,
      fee_adjusted_expectancy: 0.01,
    },
  });
  assert.strictEqual(frozenStage.stage, 0);
  assert.strictEqual(frozenStage.profile, "RESCUE");
  assert.strictEqual(frozenStage.reason, "LADDER_FROZEN_STAGE_0");

  const ladderAppliedRules = applyTp1LadderPolicy({
    rules: resolveExitRulesForPosition({ exchange: "BINANCEFUT", position: { meta: {} } }),
    cohort: "BASE",
    ladderState: samplingStage,
  });
  assert.strictEqual(ladderAppliedRules.TP_P1, 0.0165);
  assert.strictEqual(ladderAppliedRules.BE_PCT, 0.0015);
  assert.strictEqual(ladderAppliedRules.TRAIL_R_MULTIPLE, 0.6);
}

try {
  run();
  console.log("SIGNAL_ENGINE_FAST_TP0_TEST_OK");
} catch (err) {
  console.error("SIGNAL_ENGINE_FAST_TP0_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
} finally {
  if (prevSimplifiedExitV2Env == null) delete process.env.SIMPLIFIED_EXIT_V2_ENABLED;
  else process.env.SIMPLIFIED_EXIT_V2_ENABLED = prevSimplifiedExitV2Env;
}
