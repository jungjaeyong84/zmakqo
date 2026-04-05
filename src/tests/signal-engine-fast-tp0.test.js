"use strict";

const assert = require("assert");
const { generateSignals } = require("../engine/signalEngine");

function run() {
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
        external_leverage: 2,
        ev_gate_atr_pct: 0.012,
        tp_p0_done: false,
        tp_p1_done: false,
      },
    },
  });
  assert.strictEqual(tp0Signals.length, 1, "tp0 should emit one partial exit");
  assert.strictEqual(tp0Signals[0].event, "EXIT_TP_P0_0.96P");
  assert.strictEqual(tp0Signals[0].reason, "EXIT_TAKE_PROFIT_P0");
  assert.ok(Math.abs(tp0Signals[0].qty_pct - 0.25) < 1e-9);

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
        external_leverage: 2,
        tp_p0_done: true,
        tp_p1_done: false,
        openclaw_market_regime_cohort: "RESCUE",
      },
    },
  });
  assert.strictEqual(rescueTp1.length, 1, "rescue cohort should shorten tp1");
  assert.strictEqual(rescueTp1[0].event, "EXIT_TP_P1_1.65P");
}

try {
  run();
  console.log("SIGNAL_ENGINE_FAST_TP0_TEST_OK");
} catch (err) {
  console.error("SIGNAL_ENGINE_FAST_TP0_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
