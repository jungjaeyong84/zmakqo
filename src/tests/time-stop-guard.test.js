const assert = require("assert");
const { __test } = require("../engine/paperUpbitRunner");

function run() {
  const inferEntryMetaDirection = __test && __test.inferEntryMetaDirection;
  const buildTimeStopExitSignal = __test && __test.buildTimeStopExitSignal;

  assert.strictEqual(typeof inferEntryMetaDirection, "function", "inferEntryMetaDirection export missing");
  assert.strictEqual(typeof buildTimeStopExitSignal, "function", "buildTimeStopExitSignal export missing");

  assert.strictEqual(
    inferEntryMetaDirection({ entry_signal_type: "CORE_SHORT" }),
    "SHORT",
    "signal type should infer SHORT"
  );
  assert.strictEqual(
    inferEntryMetaDirection({ entry_event_id: "BINANCEFUT|BTCUSDT|60m|1773010800000|CORE_LONG|CORE_LONG" }),
    "LONG",
    "entry event id should infer LONG"
  );

  const common = {
    position: {
      state: "ACTIVE",
      size_pct: 1,
      avg_price: 100,
      position_side: "LONG",
    },
    bar: { close: 98 },
    barCloseMs: 19 * 60 * 60 * 1000,
    signalTfMs: 60 * 60 * 1000,
    maxHoldBars: 18,
  };

  const blocked = buildTimeStopExitSignal({
    ...common,
    posMeta: {
      entry_exec_bar_ms: 60 * 1000,
      entry_signal_type: "CORE_SHORT",
    },
  });
  assert.strictEqual(blocked, null, "stale opposite-side entry metadata must block time stop");

  const allowed = buildTimeStopExitSignal({
    ...common,
    posMeta: {
      entry_exec_bar_ms: 60 * 1000,
      entry_signal_type: "CORE_LONG",
    },
  });
  assert.ok(allowed, "matching entry metadata should allow time stop");
  assert.strictEqual(allowed.event, "EXIT_TIME_STOP_4B");
  assert.strictEqual(allowed.side, "SELL");
  assert.strictEqual(allowed.reason, "EXIT_TIME_STOP_PRE_TP1");
  assert.strictEqual(allowed.features.time_stop_scope, "PRE_TP1");
  assert.strictEqual(allowed.features.pre_tp1_time_stop_entry_grade, "EARLY");
}

try {
  run();
  console.log("TIME_STOP_GUARD_TEST_OK");
} catch (err) {
  console.error("TIME_STOP_GUARD_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
