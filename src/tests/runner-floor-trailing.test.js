"use strict";

const assert = require("assert");
const { generateSignals } = require("../engine/signalEngine");
const { __test: tickExitTest } = require("../services/binanceTickExit");
const { buildExitStageView } = require("../utils/exitStageView");

function run() {
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
  assert.strictEqual(shortSignals[0].event, "EXIT_TRAIL_1P");
  assert.strictEqual(shortSignals[0].reason, "EXIT_TRAIL_STOP_RUNNER_FLOOR");
  assert.ok(Math.abs(shortSignals[0].features.runner_stop_px - 99) < 1e-9);
  assert.strictEqual(shortSignals[0].features.runner_stop_source, "RUNNER_FLOOR");

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
  assert.strictEqual(longSignals[0].reason, "EXIT_TRAIL_STOP_RUNNER_FLOOR");
  assert.ok(Math.abs(longSignals[0].features.runner_stop_px - 101) < 1e-9);

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
      TP_P1: 0.0325,
      TP_P1_QTY: 0.5,
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
          TP_P1: 0.0325,
          TP_P1_QTY: 0.5,
          TRAIL_PCT: 0.01,
          RUNNER_MIN_PROFIT_PCT: 0.02,
          BE_PCT: 0.0025,
          BE_ENABLE: true,
        },
      },
    },
  });
  assert(stage, "exit stage view should be built");
  assert.strictEqual(stage.runner_stop_source, "RUNNER_FLOOR");
  assert.strictEqual(stage.compact_headline.left_label, "Runner");
  assert.ok(Math.abs(stage.trail_stop - 99) < 1e-9, "displayed runner stop should reflect the floor");
  assert.ok(Math.abs(stage.trail_stop_raw - 99.283) < 1e-9, "raw trail stop should remain visible for debugging");
}

try {
  run();
  console.log("RUNNER_FLOOR_TRAILING_TEST_OK");
} catch (err) {
  console.error("RUNNER_FLOOR_TRAILING_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
