"use strict";

const assert = require("assert");
const { generateSignals, resolveExitRulesForPosition } = require("../engine/signalEngine");
const { __test: tickExitTest } = require("../services/binanceTickExit");
const { buildExitStageView } = require("../utils/exitStageView");

function run() {
  const rescueRules = resolveExitRulesForPosition({
    exchange: "BINANCEFUT",
    position: {
      meta: {
        openclaw_market_regime_cohort: "RESCUE",
        exit_policy_source: "BINANCE_DEFAULT",
      },
    },
  });
  assert.strictEqual(rescueRules.RUNNER_MIN_PROFIT_PCT, 0.0165, "binance trailing floor must guarantee at least 1.65%");

  const rescueFloorSignals = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    trading_mode: "EXIT_ONLY",
    leverage: 2,
    bar: { close: 99.2, c: 99.2 },
    position: {
      state: "ACTIVE",
      size_pct: 0.5,
      avg_price: 100,
      position_side: "SHORT",
      meta: {
        external_leverage: 2,
        tp_p1_done: true,
        trail_active: true,
        trail_low: 99.2,
        openclaw_market_regime_cohort: "RESCUE",
        exit_policy_source: "BINANCE_DEFAULT",
      },
    },
  });
  assert.strictEqual(rescueFloorSignals.length, 1, "rescue cohort should still emit trailing exit");
  assert.strictEqual(rescueFloorSignals[0].event, "EXIT_TRAIL");
  assert.strictEqual(rescueFloorSignals[0].reason, "EXIT_TRAIL_STOP_RUNNER_FLOOR");
  assert.strictEqual(rescueFloorSignals[0].features.runner_floor_pct, 0.0165);
  assert.strictEqual(rescueFloorSignals[0].features.runner_stop_source, "RUNNER_FLOOR");
  assert.ok(Math.abs(rescueFloorSignals[0].features.runner_stop_px - 99.175) < 1e-9);

  const shortSignals = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    trading_mode: "EXIT_ONLY",
    leverage: 2,
    bar: { close: 99.05, c: 99.05 },
    position: {
      state: "ACTIVE",
      size_pct: 0.5,
      avg_price: 100,
      position_side: "SHORT",
      meta: {
        external_leverage: 2,
        tp_p1_done: true,
        trail_active: true,
        trail_low: 98.3,
      },
    },
  });
  assert.strictEqual(shortSignals.length, 1, "short runner floor should emit one trailing exit");
  assert.strictEqual(shortSignals[0].event, "EXIT_TRAIL");
  assert.strictEqual(shortSignals[0].reason, "EXIT_TRAIL_STOP");
  assert.ok(Math.abs(shortSignals[0].features.runner_stop_px - 98.795) < 1e-9);
  assert.strictEqual(shortSignals[0].features.runner_stop_source, "TRAIL");
  assert.strictEqual(shortSignals[0].features.trail_r_multiple, 0.6);

  const longSignals = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    trading_mode: "EXIT_ONLY",
    leverage: 2,
    bar: { close: 100.95, c: 100.95 },
    position: {
      state: "ACTIVE",
      size_pct: 0.5,
      avg_price: 100,
      position_side: "LONG",
      meta: {
        external_leverage: 2,
        tp_p1_done: true,
        trail_active: true,
        trail_high: 101.7,
      },
    },
  });
  assert.strictEqual(longSignals.length, 1, "long runner floor should emit one trailing exit");
  assert.strictEqual(longSignals[0].reason, "EXIT_TRAIL_STOP");
  assert.ok(Math.abs(longSignals[0].features.runner_stop_px - 101.205) < 1e-9);

  const triggers = tickExitTest.computeExitTriggers({
    pos: {
      exchange: "BINANCEFUT",
      avg_price: 100,
      position_side: "SHORT",
      meta: {
        tp_p1_done: true,
        trail_active: true,
        trail_low: 98.3,
      },
    },
    rules: {
      SL: -0.0165,
      TP_P1: 0.025,
      TP_P1_QTY: 0.5,
      TRAIL_R_MULTIPLE: 0.9,
      TRAIL_PCT: 0.01,
      RUNNER_MIN_PROFIT_PCT: 0.02,
      BE_ENABLE: true,
      BE_PCT: 0.0025,
    },
    leverageEff: 2,
  });
  const trailTrigger = triggers.find((x) => String(x.kind || "").toUpperCase() === "TRAIL");
  assert(trailTrigger, "tick exit must expose a trailing trigger");
  assert.ok(Math.abs(trailTrigger.price - 99) < 1e-9, "tick exit must use runner floor price when it is more protective");

  const stage = buildExitStageView({
    exchange: "BINANCEFUT",
    closePrice: 99.05,
    leverageFallback: 2,
    position: {
      state: "ACTIVE",
      size_pct: 0.5,
      avg_price: 100,
      position_side: "SHORT",
      meta: {
        leverage: 2,
        tp_p1_done: true,
        trail_active: true,
        trail_low: 98.3,
        exit_rules_override: {
          SL: -0.0165,
          TP_P1: 0.025,
          TP_P1_QTY: 0.5,
          TRAIL_R_MULTIPLE: 0.9,
          TRAIL_PCT: 0.01,
          RUNNER_MIN_PROFIT_PCT: 0.02,
          BE_PCT: 0.0025,
          BE_ENABLE: true,
        },
      },
    },
  });
  assert(stage, "exit stage view should be built");
  assert.strictEqual(stage.runner_stop_source, "TRAIL");
  assert.strictEqual(stage.trail_r_multiple, 0.6);
  assert.strictEqual(stage.compact_headline.left_label, "Trail");
  assert.ok(Math.abs(stage.trail_stop - 98.795) < 1e-9, "displayed trail stop should reflect current trail rule");
  assert.ok(Math.abs(stage.trail_stop_raw - 98.795) < 1e-9, "raw trail stop should remain visible for debugging");
  assert.strictEqual(stage.canonical_exit_stage, "TRAIL");
  assert.strictEqual(stage.canonical_exit_stage_source, "POSITION_STATE_MACHINE_TRAIL_ACTIVE");
  assert.strictEqual(stage.chosen_stop_source, "TRAIL");
  assert.ok(Math.abs(stage.chosen_stop_price - 98.795) < 1e-9);
  assert.deepStrictEqual(stage.stop_divergence_codes, []);

  const breachedHardExit = tickExitTest.shouldTriggerTrailHardExit({
    position: {
      avg_price: 100,
      position_side: "SHORT",
      meta: {
        external_leverage: 2,
        tp_p1_done: true,
        trail_active: true,
        trail_low: 99.2,
        openclaw_market_regime_cohort: "RESCUE",
        exit_policy_source: "BINANCE_DEFAULT",
      },
    },
    price: 99.21,
    side: "SHORT",
    rules: rescueRules,
  });
  assert.strictEqual(breachedHardExit.trigger, true, "runner floor breach must trigger hard exit");
  assert.ok(Math.abs(breachedHardExit.stopPrice - 99.175) < 1e-9);

  const safeHardExit = tickExitTest.shouldTriggerTrailHardExit({
    position: {
      avg_price: 100,
      position_side: "SHORT",
      meta: {
        external_leverage: 2,
        tp_p1_done: true,
        trail_active: true,
        trail_low: 99.2,
        openclaw_market_regime_cohort: "RESCUE",
        exit_policy_source: "BINANCE_DEFAULT",
      },
    },
    price: 99.15,
    side: "SHORT",
    rules: rescueRules,
  });
  assert.strictEqual(safeHardExit.trigger, false, "price above floor only after breach should force exit");
}

try {
  run();
  console.log("RUNNER_FLOOR_TRAILING_TEST_OK");
} catch (err) {
  console.error("RUNNER_FLOOR_TRAILING_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
