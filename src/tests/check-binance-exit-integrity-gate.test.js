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
  assert.deepStrictEqual(warnReasons, []);

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
    trade_execution_alert_missing_entry_fill_n: 1,
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
    "TRADE_EXECUTION_ENTRY_ALERT_MISSING_FILL",
    "DUPLICATION_LIVE_GROUP",
    "AUTHORITY_ACTIONABLE_LIVE_ISSUE_POSITION",
    "CANONICAL_EXIT_STAGE_FAIL",
    "SIMPLIFIED_EXIT_V2_LIVE_FLOW_ACTIONABLE_SYMBOL",
    "TP1_META_SYNC_GAP",
    "STOP_DIVERGENCE_SYMBOL",
  ]);

  const historicalQtyOnly = __test.buildFailureReasons({
    status: "WARN",
    exit_qty_live_issue_chain_n: 3,
    authority_actionable_live_issue_position_n: 0,
    live_gate_blocked: false,
    canonical_exit_stage_gate: "PASS",
    stop_divergence_gate: "PASS",
    canonical_transition_backfill_ok: true,
  });
  assert.deepStrictEqual(historicalQtyOnly, []);

  // 2026-04-20 senior-audit P1(b): "repair_request_emitted" must NOT be
  // treated as healed by the deploy gate. The authoritative signal is the
  // PRE-repair `watchdog_issue_symbol_n`. The heal chain (self_heal ->
  // repairLiveTrailingStageForSymbol -> requestBinanceNativeProtectionRefresh)
  // can legitimately return ok=true with only an EXIT_REPAIR_REQUEST emitted
  // to the authority layer (the actual STOP placement happens async in the
  // exit-worker). Prior-cycle "repaired_symbol_n" counts are observability
  // only — a symbol whose request was emitted but whose stop is still
  // missing on the exchange MUST keep the gate BLOCKED on this cycle's
  // snapshot until the authority layer actually places the stop, at which
  // point the next cycle's issue_symbol_n drops to zero.
  const repairEmittedButNotHealed = __test.buildFailureReasons({
    status: "WARN",
    live_gate_blocked: true,
    canonical_exit_stage_gate: "PASS",
    stop_divergence_gate: "PASS",
    canonical_transition_backfill_ok: true,
    // Snapshot at the START of the cycle: 2 active symbols with unhealed
    // native-protection issues. The watchdog's repair loop "succeeded"
    // (emitted repair requests to the authority layer) but the actual
    // exchange state still shows the issue, so issue_symbol_n is preserved.
    watchdog_issue_symbol_n: 2,
    watchdog_repaired_symbol_n: 2,
  });
  assert.ok(
    repairEmittedButNotHealed.includes("LIVE_GATE_BLOCKED"),
    "LIVE_GATE_BLOCKED must survive even when watchdog_repaired_symbol_n == watchdog_issue_symbol_n"
  );
  assert.ok(
    repairEmittedButNotHealed.includes("WATCHDOG_ISSUE_SYMBOL"),
    "WATCHDOG_ISSUE_SYMBOL must block regardless of the repaired_symbol_n observability count"
  );

  // 2026-04-20 senior-audit LOW: EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER=1
  // must surface as a deploy-gate block reason. The flag exists only for
  // test harnesses — leaving it on in a prod-bound deploy resurrects the
  // half-open-TCP silent-hang pattern that caused the 2026-04-19 ETHUSDT
  // blackout. The gate must fail-closed even when every per-family summary
  // count is zero.
  const dispatcherDisabled = __test.buildFailureReasons(
    {
      status: "OK",
      live_gate_blocked: false,
      canonical_exit_stage_gate: "PASS",
      stop_divergence_gate: "PASS",
      canonical_transition_backfill_ok: true,
    },
    { env: { EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER: "1" } }
  );
  assert.ok(
    dispatcherDisabled.includes("EGRESS_PROXY_CUSTOM_DISPATCHER_DISABLED"),
    "EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER=1 must block the deploy gate"
  );

  // And sanity: when the env is unset (or "0"), the gate does not flag it.
  const dispatcherEnabled = __test.buildFailureReasons(
    {
      status: "OK",
      live_gate_blocked: false,
      canonical_exit_stage_gate: "PASS",
      stop_divergence_gate: "PASS",
      canonical_transition_backfill_ok: true,
    },
    { env: { EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER: "0" } }
  );
  assert.ok(
    !dispatcherEnabled.includes("EGRESS_PROXY_CUSTOM_DISPATCHER_DISABLED"),
    "dispatcher enabled (env=0) must not be flagged"
  );
  const dispatcherUnset = __test.buildFailureReasons(
    {
      status: "OK",
      live_gate_blocked: false,
      canonical_exit_stage_gate: "PASS",
      stop_divergence_gate: "PASS",
      canonical_transition_backfill_ok: true,
    },
    { env: {} }
  );
  assert.ok(
    !dispatcherUnset.includes("EGRESS_PROXY_CUSTOM_DISPATCHER_DISABLED"),
    "dispatcher unset (env missing key) must default to allowed"
  );

  // Direct helper coverage — simple but locks the string-to-bool contract.
  assert.strictEqual(
    __test.egressDispatcherDisabledInEnv({ EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER: "1" }),
    true
  );
  assert.strictEqual(
    __test.egressDispatcherDisabledInEnv({ EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER: "true" }),
    false,
    'only literal "1" counts as disabled — "true" must not be treated as '
    + "enable-disable since our other env vars use 1/0 boolean style"
  );
  assert.strictEqual(
    __test.egressDispatcherDisabledInEnv({ EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER: " 1 " }),
    true,
    "leading/trailing whitespace must be stripped"
  );

  // 2026-04-20 senior-audit M1: the unprotected-window sub-gate must
  // also block on `available: false` (listPositions threw), not just
  // on a numeric `breach_count > 0`. A Firestore outage that empties
  // the rows must not collapse to a clean pass — that would silently
  // ship on a blind fleet.
  const unprotectedUnavailable = __test.buildFailureReasons(
    {
      status: "OK",
      live_gate_blocked: false,
      canonical_exit_stage_gate: "PASS",
      stop_divergence_gate: "PASS",
      canonical_transition_backfill_ok: true,
      unprotected_window_available: false,
      unprotected_window_unavailable_reason: "LIST_POSITIONS_FAILED",
      unprotected_window_breach_n: 0,
      unprotected_window_gate: "BLOCK",
    },
    { env: {} }
  );
  assert.ok(
    unprotectedUnavailable.some((r) => r.startsWith("NATIVE_PROTECTION_UNPROTECTED_WINDOW_UNAVAILABLE")),
    "unavailable-window must block with a distinct reason string (not re-using BREACH)"
  );
  assert.ok(
    !unprotectedUnavailable.includes("NATIVE_PROTECTION_UNPROTECTED_WINDOW_BREACH"),
    "when unavailable, the BREACH reason must NOT also be emitted — the two are mutually exclusive signals"
  );

  // Belt-and-suspenders: if the runtime forgot to set `available:false`
  // but set `unprotected_window_gate: BLOCK` explicitly, the gate still
  // emits a BREACH reason so on-call sees something.
  const unprotectedGateOnly = __test.buildFailureReasons(
    {
      status: "OK",
      live_gate_blocked: false,
      canonical_exit_stage_gate: "PASS",
      stop_divergence_gate: "PASS",
      canonical_transition_backfill_ok: true,
      unprotected_window_breach_n: 0,
      unprotected_window_gate: "BLOCK",
    },
    { env: {} }
  );
  assert.ok(
    unprotectedGateOnly.some((r) => r.startsWith("NATIVE_PROTECTION_UNPROTECTED_WINDOW_")),
    "unprotected_window_gate=BLOCK with no other signal must still surface SOME reason"
  );

  console.log("CHECK_BINANCE_EXIT_INTEGRITY_GATE_TEST_OK");
})().catch((err) => {
  console.error("CHECK_BINANCE_EXIT_INTEGRITY_GATE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
