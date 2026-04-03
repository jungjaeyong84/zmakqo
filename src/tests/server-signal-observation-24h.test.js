"use strict";

const assert = require("assert");
const { deriveServerSignalObservation24h } = require("../utils/serverSignalObservation24h");

(() => {
  const report = deriveServerSignalObservation24h({
    runtime: {
      summary: {
        runtime_status: "READY",
        watchdog_verdict: "PASS",
        live_execution_policy_mode: "ENFORCING",
      },
    },
    quality: {
      summary: {
        authoritative_entry_signal_24h_n: 6,
        order_intent_24h_n: 6,
        fill_24h_n: 18,
        trade_24h_n: 6,
        parity_mismatch_n: 15,
        final_downstream_mismatch_n: 15,
        quality_status: "WATCH_PARITY_DRIFT",
      },
      rows: {
        final_downstream_family_actions: [
          { family: "EV_POLICY", mismatch_n: 10, recommended_action: "RELAX_EV_POLICY_REVIEW" },
          { family: "OTHER_SERVER_POLICY", mismatch_n: 3, recommended_action: "WATCH_ONLY_REVIEW" },
        ],
        other_server_policy_reason_actions: [
          { reason: "LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED", mismatch_n: 2, recommended_action: "WATCH_ONLY_REVIEW", top_markets: [{ market: "ETHUSDT", mismatch_n: 2 }] },
          { reason: "LIVE_RESCUE_ADD_POST_TP1_BLOCKED", mismatch_n: 1, recommended_action: "MONITOR_POST_TP1_GUARD", top_markets: [{ market: "BNBUSDT", mismatch_n: 1 }] },
        ],
      },
    },
    cutover: {
      summary: {
        readiness_status: "SERVER_PRIMARY_ACTIVE",
        blocker_n: 0,
        blocker_actions: [{ family: "FINAL_DOWNSTREAM_MISMATCH", action: "MONITOR_ON_SERVER_PRIMARY" }],
      },
    },
    policyPlan: {
      summary: {
        status: "HOLD",
        mode: "ADVISORY_ONLY",
        execution_quality_status: "EXECUTION_QUALITY_REVIEW",
        top_other_server_policy_watch_only_markets: ["ETHUSDT"],
      },
    },
    remediationApply: {
      applied: true,
      last_applied_at_kst: "2026-04-03 09:23:41 KST",
      ev_policy_patch_requested_n: 1,
      ev_policy_patch_applied: true,
      effective: {
        other_server_policy_watch_only_markets: ["ETHUSDT"],
      },
    },
  });

  assert.strictEqual(report.summary.status, "DRIFT_MONITORING");
  assert.strictEqual(report.summary.authoritative_entry_signal_24h_n, 6);
  assert.strictEqual(report.summary.ev_policy_patch_requested_n, 1);
  assert.strictEqual(report.summary.ev_policy_patch_applied, true);
  assert.strictEqual(report.summary.other_server_policy_watch_only_market_n, 1);
  assert.strictEqual(report.summary.top_other_server_policy_watch_only_markets[0], "ETHUSDT");
  assert.strictEqual(report.summary.top_final_downstream_family_action.family, "EV_POLICY");
  assert.strictEqual(report.summary.top_other_server_policy_reason_action.reason, "LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED");
  assert.strictEqual(report.rows.watch_only_review_markets[0].source, "DRIFT_REMEDIATION_EFFECTIVE");
  assert.ok(report.rows.next_actions.some((line) => line.includes("EV_POLICY")));
  assert.ok(report.rows.next_actions.some((line) => line.includes("LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED")));

  console.log("SERVER_SIGNAL_OBSERVATION_24H_TEST_OK");
})();

(() => {
  const report = deriveServerSignalObservation24h({
    runtime: {
      summary: {
        runtime_status: "READY",
        watchdog_verdict: "PASS",
        live_execution_policy_mode: "ENFORCING",
      },
    },
    quality: {
      summary: {
        authoritative_entry_signal_24h_n: 6,
        order_intent_24h_n: 6,
        fill_24h_n: 18,
        trade_24h_n: 6,
        parity_mismatch_n: 15,
        final_downstream_mismatch_n: 15,
        quality_status: "WATCH_PARITY_DRIFT",
      },
      rows: {
        final_downstream_family_actions: [
          { family: "EV_POLICY", mismatch_n: 10, recommended_action: "RELAX_EV_POLICY_REVIEW" },
        ],
        other_server_policy_reason_actions: [
          { reason: "LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED", mismatch_n: 2, recommended_action: "WATCH_ONLY_REVIEW", top_markets: [{ market: "ETHUSDT", mismatch_n: 2 }] },
        ],
      },
    },
    cutover: {
      summary: {
        readiness_status: "SERVER_PRIMARY_ACTIVE",
        blocker_n: 0,
      },
    },
    policyPlan: {
      summary: {
        status: "HOLD",
        mode: "ADVISORY_ONLY",
        execution_quality_status: "EXECUTION_QUALITY_REVIEW",
        top_other_server_policy_watch_only_markets: ["ETHUSDT"],
      },
    },
    remediationApply: {
      applied: true,
      last_applied_at_kst: "2026-04-03 10:23:39 KST",
      ev_policy_patch_requested_n: 2,
      ev_policy_patch_applied: false,
      ev_policy_patch_report_only_applied: true,
      inputs: {
        learning_epoch_exception_release: true,
      },
      effective: {
        other_server_policy_watch_only_markets: [],
      },
    },
  });

  assert.strictEqual(report.summary.learning_epoch_exception_release, true);
  assert.strictEqual(report.summary.ev_policy_patch_requested_n, 2);
  assert.strictEqual(report.summary.ev_policy_patch_report_only_applied, true);
  assert.strictEqual(report.summary.other_server_policy_watch_only_market_n, 0);
  assert.ok(report.rows.next_actions.some((line) => line.includes("Historical market exceptions are released")));
  assert.ok(report.rows.next_actions.some((line) => line.includes("REPORT_ONLY")));
})();
