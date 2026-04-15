#!/usr/bin/env node
"use strict";

const { runBinanceExitIntegrityCycle } = require("./run-binance-exit-integrity-cycle");

function toCount(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function buildFailureReasons(summary = {}) {
  const reasons = [];
  if (toCount(summary.script_failure_n) > 0) reasons.push("SCRIPT_FAILURE");
  if (summary.live_gate_blocked === true) reasons.push("LIVE_GATE_BLOCKED");
  if (String(summary.canonical_exit_stage_gate || "").trim().toUpperCase() === "BLOCK") reasons.push("CANONICAL_EXIT_STAGE_BLOCK");
  if (String(summary.stop_divergence_gate || "").trim().toUpperCase() === "BLOCK") reasons.push("STOP_DIVERGENCE_BLOCK");
  if (summary.canonical_transition_backfill_ok !== true) reasons.push("CANONICAL_TRANSITION_BACKFILL_FAIL");
  if (toCount(summary.native_gap_after) > 0) reasons.push("NATIVE_GAP_AFTER");
  if (toCount(summary.watchdog_issue_symbol_n) > 0) reasons.push("WATCHDOG_ISSUE_SYMBOL");
  if (toCount(summary.exit_qty_live_issue_chain_n) > 0) reasons.push("EXIT_QTY_LIVE_ISSUE_CHAIN");
  if (toCount(summary.trail_floor_live_violation_n) > 0) reasons.push("TRAIL_FLOOR_LIVE_VIOLATION");
  if (toCount(summary.fill_sync_duplicate_group_n) > 0) reasons.push("FILL_SYNC_DUPLICATE_GROUP");
  if (toCount(summary.fill_sync_alert_event_issue_n) > 0) reasons.push("FILL_SYNC_ALERT_EVENT_ISSUE");
  if (toCount(summary.trade_execution_alert_missing_fill_n) > 0) reasons.push("TRADE_EXECUTION_ALERT_MISSING_FILL");
  if (toCount(summary.duplication_live_group_n) > 0) reasons.push("DUPLICATION_LIVE_GROUP");
  if (toCount(summary.authority_actionable_live_issue_position_n) > 0) reasons.push("AUTHORITY_ACTIONABLE_LIVE_ISSUE_POSITION");
  if (toCount(summary.canonical_exit_stage_fail_n) > 0) reasons.push("CANONICAL_EXIT_STAGE_FAIL");
  if (toCount(summary.stop_divergence_symbol_n) > 0) reasons.push("STOP_DIVERGENCE_SYMBOL");
  return reasons;
}

async function main() {
  const result = await runBinanceExitIntegrityCycle({
    apply: false,
  });
  const summary = result && result.summary ? result.summary : {};
  const reasons = buildFailureReasons(summary);
  if (reasons.length > 0) {
    console.error(JSON.stringify({
      ok: false,
      reason: "EXIT_INTEGRITY_DEPLOY_GATE_BLOCKED",
      reasons,
      summary,
      output_json: result && result.output_json ? result.output_json : null,
      output_md: result && result.output_md ? result.output_md : null,
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
      buildFailureReasons,
    },
  };
}
