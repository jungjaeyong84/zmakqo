"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/check-binance-exit-integrity-gate");

(async () => {
  const blocked = __test.buildFailureReasons({
    live_gate_blocked: true,
    canonical_exit_stage_gate: "BLOCK",
    stop_divergence_gate: "PASS",
    canonical_transition_backfill_ok: false,
  });
  assert.deepStrictEqual(blocked, [
    "LIVE_GATE_BLOCKED",
    "CANONICAL_EXIT_STAGE_BLOCK",
    "CANONICAL_TRANSITION_BACKFILL_FAIL",
  ]);

  const passed = __test.buildFailureReasons({
    status: "OK",
    live_gate_blocked: false,
    canonical_exit_stage_gate: "PASS",
    stop_divergence_gate: "PASS",
    canonical_transition_backfill_ok: true,
  });
  assert.deepStrictEqual(passed, []);

  const skipReasons = __test.buildFailureReasons(
    {
      status: "SKIP",
      skip_reason: "NO_ACTIVE_POSITIONS",
      live_gate_blocked: false,
      canonical_exit_stage_gate: "PASS",
      stop_divergence_gate: "PASS",
      canonical_transition_backfill_ok: true,
    },
    { cycleResult: { skipped: true } }
  );
  assert.ok(
    skipReasons.includes("CYCLE_SKIPPED:NO_ACTIVE_POSITIONS"),
    `expected CYCLE_SKIPPED reason, got ${JSON.stringify(skipReasons)}`
  );
  assert.ok(skipReasons.includes("STATUS_NOT_OK:SKIP"));

  const warnReasons = __test.buildFailureReasons({
    status: "WARN",
    live_gate_blocked: false,
    canonical_exit_stage_gate: "PASS",
    stop_divergence_gate: "PASS",
    canonical_transition_backfill_ok: true,
  });
  assert.ok(warnReasons.includes("STATUS_NOT_OK:WARN"));

  const missingStatusReasons = __test.buildFailureReasons({
    live_gate_blocked: false,
    canonical_exit_stage_gate: "PASS",
    stop_divergence_gate: "PASS",
    canonical_transition_backfill_ok: true,
  });
  assert.deepStrictEqual(
    missingStatusReasons,
    [],
    "absent status (legacy summary shape) should not be flagged"
  );

  const detailed = __test.buildFailureReasons({
    script_failure_n: 1,
    live_gate_blocked: false,
    canonical_exit_stage_gate: "PASS",
    stop_divergence_gate: "PASS",
    canonical_transition_backfill_ok: true,
    native_gap_after: 1,
    watchdog_issue_symbol_n: 2,
    exit_qty_live_issue_chain_n: 3,
    trail_floor_live_violation_n: 4,
    fill_sync_duplicate_group_n: 5,
    fill_sync_alert_event_issue_n: 6,
    trade_execution_alert_missing_fill_n: 7,
    duplication_live_group_n: 8,
    authority_actionable_live_issue_position_n: 9,
    canonical_exit_stage_fail_n: 10,
    simplified_exit_v2_live_flow_actionable_symbol_n: 13,
    tp1_meta_sync_gap_n: 12,
    stop_divergence_symbol_n: 11,
  });
  assert.deepStrictEqual(detailed, [
    "SCRIPT_FAILURE",
    "NATIVE_GAP_AFTER",
    "WATCHDOG_ISSUE_SYMBOL",
    "EXIT_QTY_LIVE_ISSUE_CHAIN",
    "TRAIL_FLOOR_LIVE_VIOLATION",
    "FILL_SYNC_DUPLICATE_GROUP",
    "FILL_SYNC_ALERT_EVENT_ISSUE",
    "TRADE_EXECUTION_ALERT_MISSING_FILL",
    "DUPLICATION_LIVE_GROUP",
    "AUTHORITY_ACTIONABLE_LIVE_ISSUE_POSITION",
    "CANONICAL_EXIT_STAGE_FAIL",
    "SIMPLIFIED_EXIT_V2_LIVE_FLOW_ACTIONABLE_SYMBOL",
    "TP1_META_SYNC_GAP",
    "STOP_DIVERGENCE_SYMBOL",
  ]);

  console.log("CHECK_BINANCE_EXIT_INTEGRITY_GATE_TEST_OK");
})().catch((err) => {
  console.error("CHECK_BINANCE_EXIT_INTEGRITY_GATE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
