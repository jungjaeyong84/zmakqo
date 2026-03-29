const assert = require("assert");
const { generateSignals } = require("../engine/signalEngine");
const { __test } = require("../engine/paperUpbitRunner");

function run() {
  const canEvaluateInternalExitSignalsForBar = __test && __test.canEvaluateInternalExitSignalsForBar;
  const finalizeInternalSignals = __test && __test.finalizeInternalSignals;

  assert.strictEqual(
    typeof canEvaluateInternalExitSignalsForBar,
    "function",
    "canEvaluateInternalExitSignalsForBar export missing"
  );
  assert.strictEqual(
    typeof finalizeInternalSignals,
    "function",
    "finalizeInternalSignals export missing"
  );

  assert.strictEqual(
    canEvaluateInternalExitSignalsForBar({
      posMeta: { entry_exec_bar_ms: 1_000 },
      barCloseMs: 1_000,
    }),
    false,
    "entry bar itself must not generate internal exits"
  );

  const sameBarSignals = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    bar: { close: 98 },
    position: {
      state: "ACTIVE",
      size_pct: 1,
      avg_price: 100,
      position_side: "LONG",
      meta: { entry_exec_bar_ms: 1_000, external_leverage: 2 },
    },
    trading_mode: "RUN",
    leverage: 2,
    currentBarCloseMs: 1_000,
  });
  assert.deepStrictEqual(
    sameBarSignals,
    [],
    "same-bar exit generation must be blocked even if SL condition is met"
  );

  const laterSignals = generateSignals({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    bar: { close: 98 },
    position: {
      state: "ACTIVE",
      size_pct: 1,
      avg_price: 100,
      position_side: "LONG",
      meta: { entry_exec_bar_ms: 1_000, external_leverage: 2 },
    },
    trading_mode: "RUN",
    leverage: 2,
    currentBarCloseMs: 2_000,
  });
  assert.strictEqual(laterSignals.length, 1, "later bar should allow SL generation");
  assert.strictEqual(laterSignals[0].event, "EXIT_SL_1.65P");

  const dropped = finalizeInternalSignals({
    signals: [{ event: "EXIT_SL_1.65P", side: "SELL", qty_pct: 1, features: {} }],
    posMeta: { entry_exec_bar_ms: 1_000 },
    barCloseMs: 1_000,
    fallbackUtc: "2026-03-10T02:00:00.000Z",
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
  });
  assert.deepStrictEqual(dropped, [], "same-bar internal exit must be removed before intent creation");

  const stamped = finalizeInternalSignals({
    signals: [{ event: "EXIT_SL_1.65P", side: "SELL", qty_pct: 1, features: {} }],
    posMeta: { entry_exec_bar_ms: 1_000 },
    barCloseMs: 2_000,
    fallbackUtc: "2026-03-10T02:00:00.000Z",
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
  });
  assert.strictEqual(stamped.length, 1, "later-bar internal exit should remain");
  assert.strictEqual(stamped[0].signal_bar_close_time_utc_ms, 2_000, "internal exit must use the actual execution bar time");
}

try {
  run();
  console.log("STALE_BAR_EXIT_GUARD_TEST_OK");
} catch (err) {
  console.error("STALE_BAR_EXIT_GUARD_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
