#!/usr/bin/env node
"use strict";

const { runBinanceExitIntegrityCycle } = require("./run-binance-exit-integrity-cycle");

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

const ALLOWED_GATE_STATUSES = new Set(["OK"]);

function shouldAllowSkippedValidationFamilies(summary = {}) {
  if (String(process.env.EXIT_INTEGRITY_CI_NO_EXCHANGE_IO || "").trim() !== "1") {
    return false;
  }
  const families = Array.isArray(summary.skipped_validation_families)
    ? summary.skipped_validation_families
      .map((f) => String(f && f.family || "").trim().toUpperCase())
      .filter(Boolean)
    : [];
  if (families.length === 0) return false;
  return families.every((family) => family === "EXCHANGE_IO");
}

// 2026-04-20 senior-audit LOW: custom undici dispatcher runtime guard.
//
// `EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER=1` is an explicit escape hatch for
// test harnesses — in production it must be unset (or "0") so the
// half-open-TCP mitigation in `src/utils/egressProxy.js` is active. If a
// deploy inadvertently ships with this flag set (via Cloud Run service env
// or a Cloud Build substitution leaking into prod), the exit-worker would
// revert to the global fetch() pool and resurrect the 20s silent-hang
// pattern that caused the 2026-04-19 ETHUSDT blackout. The gate blocks on
// this invariant so regressions surface in CI rather than during an
// incident. Accept `env` as a parameter so the invariant is unit-testable
// without mutating process.env across assertions.
function egressDispatcherDisabledInEnv(env = process.env) {
  const raw = env && env.EGRESS_PROXY_DISABLE_CUSTOM_DISPATCHER;
  return String(raw == null ? "" : raw).trim() === "1";
}

function buildFailureReasons(summary = {}, { cycleResult = null, env = process.env } = {}) {
  const reasons = [];
  if (cycleResult && cycleResult.skipped === true) {
    reasons.push(`CYCLE_SKIPPED:${String(summary.skip_reason || "UNKNOWN").toUpperCase()}`);
  }
  const statusUpper = String(summary.status || "").trim().toUpperCase();
  if (egressDispatcherDisabledInEnv(env)) {
    // Block early — this is a configuration smell that invalidates the
    // entire deploy, regardless of the per-family summary counts.
    reasons.push("EGRESS_PROXY_CUSTOM_DISPATCHER_DISABLED");
  }
  if (toCount(summary.script_failure_n) > 0) reasons.push("SCRIPT_FAILURE");
  if (toCount(summary.skipped_validation_family_n) > 0 && !shouldAllowSkippedValidationFamilies(summary)) {
    // P3-09: when the cycle runs with EXIT_INTEGRITY_CI_NO_EXCHANGE_IO=1 a
    // subset of validation families is silently skipped. The deploy gate must
    // not treat that as pass, except for the explicit CI no-exchange-IO mode
    // where only EXCHANGE_IO families are intentionally disabled.
    const fams = Array.isArray(summary.skipped_validation_families)
      ? summary.skipped_validation_families.map((f) => String(f && f.family || "UNKNOWN").toUpperCase()).join(",")
      : "UNKNOWN";
    reasons.push(`SKIPPED_VALIDATION_FAMILY:${fams}`);
  }
  if (summary.live_gate_blocked === true) reasons.push("LIVE_GATE_BLOCKED");
  if (String(summary.canonical_exit_stage_gate || "").trim().toUpperCase() === "BLOCK") reasons.push("CANONICAL_EXIT_STAGE_BLOCK");
  if (String(summary.stop_divergence_gate || "").trim().toUpperCase() === "BLOCK") reasons.push("STOP_DIVERGENCE_BLOCK");
  if (summary.canonical_transition_backfill_ok !== true) reasons.push("CANONICAL_TRANSITION_BACKFILL_FAIL");
  if (toCount(summary.native_gap_after) > 0) reasons.push("NATIVE_GAP_AFTER");
  if (toCount(summary.watchdog_issue_symbol_n) > 0) reasons.push("WATCHDOG_ISSUE_SYMBOL");
  // Historical live issue chains are valuable audit signals, but they should
  // not block deploys once the current active-board authority check is clean.
  // We only fail-closed on qty-chain issues when the active authority board is
  // also reporting at least one actionable live position.
  if (toCount(summary.exit_qty_live_issue_chain_n) > 0 && toCount(summary.authority_actionable_live_issue_position_n) > 0) {
    reasons.push("EXIT_QTY_LIVE_ISSUE_CHAIN");
  }
  if (toCount(summary.trail_floor_live_violation_n) > 0) reasons.push("TRAIL_FLOOR_LIVE_VIOLATION");
  if (toCount(summary.fill_sync_duplicate_group_n) > 0) reasons.push("FILL_SYNC_DUPLICATE_GROUP");
  if (toCount(summary.fill_sync_alert_event_issue_n) > 0) reasons.push("FILL_SYNC_ALERT_EVENT_ISSUE");
  if (toCount(summary.trade_execution_alert_missing_fill_n) > 0) reasons.push("TRADE_EXECUTION_ALERT_MISSING_FILL");
  if (toCount(summary.duplication_live_group_n) > 0) reasons.push("DUPLICATION_LIVE_GROUP");
  if (toCount(summary.authority_actionable_live_issue_position_n) > 0) reasons.push("AUTHORITY_ACTIONABLE_LIVE_ISSUE_POSITION");
  if (toCount(summary.canonical_exit_stage_fail_n) > 0) reasons.push("CANONICAL_EXIT_STAGE_FAIL");
  if (toCount(summary.simplified_exit_v2_live_flow_actionable_symbol_n) > 0) reasons.push("SIMPLIFIED_EXIT_V2_LIVE_FLOW_ACTIONABLE_SYMBOL");
  if (toCount(summary.tp1_meta_sync_gap_n) > 0) reasons.push("TP1_META_SYNC_GAP");
  if (toCount(summary.stop_divergence_symbol_n) > 0) reasons.push("STOP_DIVERGENCE_SYMBOL");
  // 2026-04-20 senior-audit P2: unprotected-window sub-gate. Block on the
  // aggregate breach count (both WINDOW_BREACH and CANCEL_WITHOUT_ACK) so
  // either mode — "refresh is too slow" or "refresh never closed the
  // window" — fails the deploy. We also block on the explicit gate string
  // for belt-and-suspenders in case the raw count migrates.
  if (toCount(summary.unprotected_window_breach_n) > 0) reasons.push("NATIVE_PROTECTION_UNPROTECTED_WINDOW_BREACH");
  if (String(summary.unprotected_window_gate || "").trim().toUpperCase() === "BLOCK") {
    if (!reasons.includes("NATIVE_PROTECTION_UNPROTECTED_WINDOW_BREACH")) {
      reasons.push("NATIVE_PROTECTION_UNPROTECTED_WINDOW_BREACH");
    }
  }
  if (statusUpper && !ALLOWED_GATE_STATUSES.has(statusUpper)) {
    const shouldBlockWarnStatus = statusUpper !== "WARN" || reasons.length > 0;
    if (shouldBlockWarnStatus) {
      reasons.unshift(`STATUS_NOT_OK:${statusUpper}`);
    }
  }
  return reasons;
}

async function main() {
  let result = null;
  let runError = null;
  try {
    result = await runBinanceExitIntegrityCycle({
      apply: false,
      profile: "gate",
    });
  } catch (err) {
    runError = err;
  }
  const summary = result && result.summary ? result.summary : {};
  const reasons = runError
    ? [`CYCLE_THROWN:${String(runError.code || runError.message || "UNKNOWN").toUpperCase()}`]
    : buildFailureReasons(summary, { cycleResult: result });
  if (reasons.length > 0) {
    console.error(JSON.stringify({
      ok: false,
      reason: "EXIT_INTEGRITY_DEPLOY_GATE_BLOCKED",
      reasons,
      summary,
      skipped: result && result.skipped === true,
      output_json: result && result.output_json ? result.output_json : null,
      output_md: result && result.output_md ? result.output_md : null,
      error: runError ? { message: runError.message, stack: runError.stack } : null,
    }));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    reason: "EXIT_INTEGRITY_DEPLOY_GATE_PASS",
    summary,
    output_json: result && result.output_json ? result.output_json : null,
    output_md: result && result.output_md ? result.output_md : null,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("CHECK_BINANCE_EXIT_INTEGRITY_GATE_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    __test: {
      toCount,
      shouldAllowSkippedValidationFamilies,
      buildFailureReasons,
      egressDispatcherDisabledInEnv,
    },
  };
}
