"use strict";

const assert = require("assert");
const { __test: replayTest } = require("../services/positionEventReplay");
const { __test: eventTest } = require("../storage/positionEvents");

function run() {
  const rows = [
    {
      sequence_ms: 200,
      after_snapshot: { state: "ACTIVE", position_state: "COMMIT", size_pct: 1 },
    },
    {
      sequence_ms: 300,
      after_snapshot: { state: "ACTIVE", position_state: "SCALE_OUT", size_pct: 0.49, meta: { tp_p1_done: true } },
    },
    {
      sequence_ms: 100,
      after_snapshot: { state: "FLAT", position_state: "FLAT", size_pct: 0 },
    },
  ];
  const replayed = replayTest.replayPositionEventsFromRows(rows);
  assert.strictEqual(replayed.replayed_n, 3);
  assert.strictEqual(replayed.latest_snapshot.position_state, "SCALE_OUT");
  assert.strictEqual(replayed.latest_event.sequence_ms, 300);

  const summary = eventTest.summarizeSnapshot({
    state: "ACTIVE",
    position_state: "SCALE_OUT",
    position_side: "LONG",
    size_pct: 0.49,
    qty_base: 120,
    avg_price: 0.095,
    meta: {
      tp_p0_done: true,
      tp_p1_done: true,
      trail_active: true,
      native_protection_refresh_status: "OK",
    },
  });
  assert.strictEqual(summary.tp_p1_done, true);
  assert.strictEqual(summary.trail_active, true);
  assert.strictEqual(summary.native_refresh_status, "OK");

  console.log("POSITION_EVENT_REPLAY_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("POSITION_EVENT_REPLAY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
