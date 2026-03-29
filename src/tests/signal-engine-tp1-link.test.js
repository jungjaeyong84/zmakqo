"use strict";

const assert = require("assert");
const { generateSignals } = require("../engine/signalEngine");

function run() {
  const entryExecMs = 1_800_000_000_000;
  const common = {
    exchange: "BINANCEFUT",
    symbol: "XRPUSDT",
    trading_mode: "EXIT_ONLY",
    bar: { close: 100.1, c: 100.1 },
    position: {
      state: "ACTIVE",
      size_pct: 1,
      avg_price: 100,
      position_side: "SHORT",
      meta: {
        external_leverage: 2,
        tp_p1_done: true,
        trail_active: false,
        entry_exec_bar_ms: entryExecMs,
        entry_event_id: "ENTRY__CUR",
      },
    },
  };

  const stale = generateSignals({
    ...common,
    position: {
      ...common.position,
      meta: {
        ...common.position.meta,
        tp_p1_at: new Date(entryExecMs - (2 * 24 * 60 * 60 * 1000)).toISOString(),
      },
    },
  });
  assert.ok(Array.isArray(stale), "stale result must be an array");
  assert.strictEqual(stale.length, 0, "stale TP1 meta must not trigger BE");

  const linked = generateSignals({
    ...common,
    position: {
      ...common.position,
      meta: {
        ...common.position.meta,
        tp_p1_at: new Date(entryExecMs + 60_000).toISOString(),
        tp_p1_entry_event_id: "ENTRY__CUR",
        tp_p1_entry_exec_bar_ms: entryExecMs,
      },
    },
  });
  assert.ok(Array.isArray(linked) && linked.length > 0, "linked TP1 meta should produce exit signal");
  assert.strictEqual(linked[0].event, "EXIT_BE_0.25P", "linked TP1 meta should produce BE signal");
}

try {
  run();
  console.log("SIGNAL_ENGINE_TP1_LINK_TEST_OK");
} catch (err) {
  console.error("SIGNAL_ENGINE_TP1_LINK_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
