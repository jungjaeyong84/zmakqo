"use strict";

const assert = require("assert");
const { labelOutcome } = require("../services/outcomeLabeler");

function run() {
  const realized = labelOutcome({
    outcome_state: "REALIZED",
    source_row_type: "EXECUTED",
    tp0_hit: true,
    tp0_first: true,
    tp1_first: true,
    sl_first: false,
    time_stop_hit: false,
    time_stop_first: false,
    realized_ret_net: 0.031,
    realized_pnl_quote: 1200,
    hold_minutes: 42,
  });
  assert.strictEqual(realized.is_realized, true);
  assert.strictEqual(realized.is_executed, true);
  assert.strictEqual(realized.realized_direction, "POSITIVE");
  assert.strictEqual(realized.tp0_hit, true);
  assert.strictEqual(realized.tp0_first, true);
  assert.strictEqual(realized.tp1_first, true);

  const openPending = labelOutcome({
    outcome_state: "OPEN_PENDING",
    source_row_type: "EXECUTED",
  });
  assert.strictEqual(openPending.is_open, true);
  assert.strictEqual(openPending.is_realized, false);

  const dropped = labelOutcome({
    outcome_state: "DROP",
    source_row_type: "DROP",
  });
  assert.strictEqual(dropped.is_drop, true);
  assert.strictEqual(dropped.is_executed, false);

  const timeStop = labelOutcome({
    outcome_state: "REALIZED",
    source_row_type: "EXECUTED",
    time_stop_hit: true,
    time_stop_first: true,
    realized_ret_net: -0.01,
  });
  assert.strictEqual(timeStop.time_stop_hit, true);
  assert.strictEqual(timeStop.time_stop_first, true);
  assert.strictEqual(timeStop.realized_direction, "NEGATIVE");

  console.log("OUTCOME_LABELER_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("OUTCOME_LABELER_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
