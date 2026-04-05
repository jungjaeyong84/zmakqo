"use strict";

const assert = require("assert");
const { labelOutcome } = require("../services/outcomeLabeler");

function run() {
  const realized = labelOutcome({
    outcome_state: "REALIZED",
    source_row_type: "EXECUTED",
    tp0_hit: true,
    tp0_first: true,
    tp0_to_tp1_converted: true,
    tp1_first: true,
    sl_first: false,
    time_stop_hit: false,
    time_stop_first: false,
    pre_tp1_time_stop: false,
    realized_ret_net: 0.031,
    realized_pnl_quote: 1200,
    hold_minutes: 42,
    time_to_tp0_minutes: 5,
    time_to_tp1_minutes: 12,
    mfe_pct: 0.04,
    mae_pct: -0.01,
  });
  assert.strictEqual(realized.is_realized, true);
  assert.strictEqual(realized.is_executed, true);
  assert.strictEqual(realized.realized_direction, "POSITIVE");
  assert.strictEqual(realized.tp0_hit, true);
  assert.strictEqual(realized.tp0_first, true);
  assert.strictEqual(realized.tp0_to_tp1_converted, true);
  assert.strictEqual(realized.tp1_first, true);
  assert.strictEqual(realized.time_to_tp0_minutes, 5);
  assert.strictEqual(realized.time_to_tp1_minutes, 12);
  assert.strictEqual(realized.mfe_pct, 0.04);
  assert.strictEqual(realized.mae_pct, -0.01);

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
    pre_tp1_time_stop: true,
    realized_ret_net: -0.01,
  });
  assert.strictEqual(timeStop.time_stop_hit, true);
  assert.strictEqual(timeStop.time_stop_first, true);
  assert.strictEqual(timeStop.pre_tp1_time_stop, true);
  assert.strictEqual(timeStop.realized_direction, "NEGATIVE");

  console.log("OUTCOME_LABELER_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("OUTCOME_LABELER_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
