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
  assert.ok(Array.isArray(linked), "linked TP1 meta should return a signal array");
  assert.strictEqual(linked.length, 0, "linked TP1 meta must not produce BE after V2 full-TP simplification");

  const snapshotMerged = generateSignals({
    ...common,
    bar: { close: 99.7, c: 99.7 },
    currentBarCloseMs: entryExecMs + (2 * 60_000),
    position: {
      ...common.position,
      size_pct: 0.5,
      meta: {
        ...common.position.meta,
        tp_p1_at: new Date(entryExecMs + 60_000).toISOString(),
        tp_p1_entry_event_id: "ENTRY__CUR",
        tp_p1_entry_exec_bar_ms: entryExecMs,
        trail_active: true,
        trail_low: null,
        trail_observation_snapshot: {
          trail_low: 99.4,
          trail_low_at_ms: entryExecMs + 90_000,
          trail_active: true,
        },
      },
    },
  });
  assert.ok(Array.isArray(snapshotMerged), "embedded trail snapshot should return a signal array");
  assert.strictEqual(snapshotMerged.length, 0, "embedded trail snapshot must not produce trail after V2 full-TP simplification");
}

try {
  run();
  console.log("SIGNAL_ENGINE_TP1_LINK_TEST_OK");
} catch (err) {
  console.error("SIGNAL_ENGINE_TP1_LINK_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
