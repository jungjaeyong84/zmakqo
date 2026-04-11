"use strict";

const assert = require("assert");
const { validatePositionSnapshotTransition } = require("../services/positionStateMachine");

function run() {
  const valid = validatePositionSnapshotTransition({
    prev: {
      state: "COMMIT",
      position_state: "COMMIT",
      size_pct: 1,
      qty_base: 2,
      meta: { tp_p1_done: false, trail_active: false },
    },
    next: {
      state: "ACTIVE",
      position_state: "SCALE_OUT",
      size_pct: 0.49,
      qty_base: 0.98,
      meta: { tp_p1_done: true, trail_active: true },
    },
  });
  assert.strictEqual(valid.ok, true);
  assert.deepStrictEqual(valid.issues, []);

  const invalid = validatePositionSnapshotTransition({
    prev: {
      state: "ACTIVE",
      position_state: "COMMIT",
      size_pct: 1,
      qty_base: 1,
      meta: { tp_p1_done: false, trail_active: false },
    },
    next: {
      state: "ACTIVE",
      position_state: "COMMIT",
      size_pct: 0.5,
      qty_base: 0.5,
      meta: { tp_p1_done: false, trail_active: true },
    },
  });
  assert.strictEqual(invalid.ok, false);
  assert.ok(invalid.issues.some((issue) => issue.code === "TRAIL_WITHOUT_TP1"));

  console.log("POSITION_STATE_MACHINE_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("POSITION_STATE_MACHINE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
