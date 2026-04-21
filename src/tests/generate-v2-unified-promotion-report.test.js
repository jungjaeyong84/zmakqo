"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const unifiedReport = require("../../scripts/generate-v2-unified-promotion-report");
const deployDecisionCheck = require("../../scripts/check-v2-promotion-deploy-decision");
const mockArtifacts = require("../../scripts/generate-v2-promotion-artifacts-mock");
const { buildUnifiedPromotionReport } = require("../v2/unifiedPromotionReport");

const LINEAGE_CONTRACT_FIXTURE = Object.freeze({
  version: "V2_PROMOTION_SELECTOR_LINEAGE_SHA256_V1",
  hash: "lineage-hash-fixture",
});
const REQUIRED_RUNTIME_CHAIN_CHECK_IDS = deployDecisionCheck.__test.REQUIRED_RUNTIME_CHAIN_CHECK_IDS;

(async function unifiedReportScriptWritesSingleDecisionArtifact() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-unified-report-"));
  try {
    await mockArtifacts.main({
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_MOCK_PROFILE: "CLEAN",
      V2_PROMOTION_ARTIFACT_DIR: dir,
    });
    fs.writeFileSync(path.join(dir, "promotion-canary-candidate-selection.json"), JSON.stringify({
      ok: true,
      selection_status: "READY",
      candidate_limit: 10,
      recent_window_hours: 168,
      recent_cutoff_at: "2026-04-13T00:00:00.000Z",
      active_position_cycle_n: 2,
      recent_active_position_cycle_n: 1,
      selected_position_cycle_id: "PCY__MOCK__CLEAN",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__MOCK__CLEAN",
        snapshot_counts: {
          episode_n: 4,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blockers: [],
      },
      selection_contract: {
        ok: true,
        scan_limit_respected: true,
        recent_window_enforced: true,
        selected_candidate_present: true,
        selected_preflight_ok: true,
        selected_cycle_matches_preflight: true,
        selected_cycle_matches_collector_env: true,
        selected_snapshot_counts_exact: true,
      },
    }, null, 2), "utf8");
    fs.writeFileSync(path.join(dir, "v2_repair_queue_firestore_canary_streak_latest.json"), JSON.stringify({
      ok: true,
      reason: "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS",
      history_file: "/tmp/v2_repair_queue_firestore_canary_history.jsonl",
      lookback_hours: 24,
      min_run_count: 12,
      max_gap_minutes: 180,
      row_n: 13,
      healthy_run_n: 13,
      unhealthy_run_n: 0,
      invalid_line_n: 0,
      latest_age_minutes: 15,
      coverage_minutes: 1440,
      max_observed_gap_minutes: 120,
      blockers: [],
    }, null, 2), "utf8");
    fs.writeFileSync(path.join(dir, "v2_production_entry_route_canary_streak_latest.json"), JSON.stringify({
      ok: true,
      reason: "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS",
      history_file: "/tmp/v2_production_entry_route_canary_history.jsonl",
      lookback_hours: 24,
      min_run_count: 12,
      max_gap_minutes: 180,
      row_n: 13,
      healthy_run_n: 13,
      unhealthy_run_n: 0,
      invalid_line_n: 0,
      latest_age_minutes: 15,
      coverage_minutes: 1440,
      max_observed_gap_minutes: 120,
      blockers: [],
    }, null, 2), "utf8");
    fs.writeFileSync(path.join(dir, "promotion-runtime-manifest.json"), JSON.stringify({
      snapshot_size_bytes: 12345,
      snapshot_meta: {
        query_budget: {
          limits: {
            transitionsLimit: 50,
            outboxesLimit: 50,
          },
          counts: {
            transitions: 3,
            outboxes: 1,
          },
        },
        selector_meta: {
          position_cycle_id: "PCY__MOCK__CLEAN",
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
          query_budget: {
            query_limit: 25,
            recent_window_hours: 168,
            recent_cutoff_at: "2026-04-13T00:00:00.000Z",
          },
          alignment_checks: {
            symbol_match: true,
            side_match: true,
            timeframe_match: true,
            policy_scope_match: true,
          },
        },
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        evidence_snapshot_summary: {
          ok: true,
          transition_n: 3,
          transition_evidence_n: 3,
          missing_transition_evidence_n: 0,
          protection_runtime_n: 1,
          protection_runtime_evidence_n: 1,
          missing_protection_runtime_evidence_n: 0,
        },
        openclaw_execution_separation_summary: {
          ok: true,
          audit_n: 1,
          fail_n: 0,
          failed_check_ids: [],
        },
        runtime_chain_audit_summary: {
          ok: true,
          check_n: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.length,
          fail_n: 0,
          check_ids: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.slice(),
          passed_check_ids: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.slice(),
          failed_check_ids: [],
        },
        repair_evidence_summary: {
          ok: true,
          repair_request_n: 1,
          repair_execution_ledger_n: 2,
          completion_ledger_n: 1,
          completion_evidence_n: 1,
          completed_success_n: 1,
          completed_failed_n: 0,
          missing_completion_evidence_n: 0,
          runbook_refs: ["RQ_RBK_01"],
          order_evidence_n: 1,
          latest_completion: {
            repair_execution_ledger_id: "RQLEDGERV2__TEST",
            execution_status: "COMPLETED_SUCCESS",
            issue_code: "TP1_ORDER_MISSING",
            command_type: "PLACE_OR_REPLACE_TP1",
            recorded_at: "2026-04-21T00:00:00.000Z",
          },
        },
        openclaw_execution_audit_ledger_write: {
          ok: true,
          skipped: false,
          reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN",
          collection_key: "OPENCLAW_EXECUTION_AUDITS",
          doc_id: "OCEXSEPAUDV2__TEST",
        },
        alert_retry_summary: {
          outbox_n: 3,
          failed_n: 1,
          sent_n: 2,
          pending_n: 0,
          retryable_failed_n: 1,
          terminal_failed_n: 0,
          family_counts: {
            TRANSPORT: 1,
          },
          retry_policy_counts: {
            ALERT_RETRY_TRANSPORT: 1,
          },
          runbook_ref_counts: {
            ALERT_RBK_04: 1,
          },
          latest_failed: {
            alert_outbox_id: "TAOV2__MOCK__1",
            last_reason: "ALERT_DELIVERY_FAILED",
            last_reason_family: "TRANSPORT",
            retry_policy_code: "ALERT_RETRY_TRANSPORT",
            runbook_refs: ["ALERT_RBK_04"],
            last_attempt_at: "2026-04-20T00:00:00.000Z",
          },
        },
      },
      counts: {
        episode_n: 4,
        shadow_live_pair_n: 1,
        source_mode_pair_n: 1,
      },
    }, null, 2), "utf8");
    const payload = await unifiedReport.main({
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_ARTIFACT_DIR: dir,
    });
    const outputFile = path.join(dir, unifiedReport.__test.OUTPUT_FILENAME);
    assert.ok(fs.existsSync(outputFile));
    const stored = JSON.parse(fs.readFileSync(outputFile, "utf8"));
    assert.strictEqual(payload.pass, true);
    assert.strictEqual(stored.pass, true);
    assert.strictEqual(stored.position_cycle_id, "PCY__MOCK__CLEAN");
    assert.strictEqual(stored.selector_meta.position_cycle_id, "PCY__MOCK__CLEAN");
    assert.strictEqual(stored.bounded_runtime_summary.selector_query_budget.query_limit, 25);
    assert.strictEqual(stored.bounded_runtime_summary.collector_query_budget.limits.transitionsLimit, 50);
    assert.strictEqual(stored.bounded_runtime_summary.exporter_snapshot_size_bytes, 12345);
    assert.strictEqual(stored.bounded_runtime_summary.lineage_contract.hash, "lineage-hash-fixture");
    assert.strictEqual(stored.bounded_runtime_summary.evidence_snapshot_summary.ok, true);
    assert.strictEqual(stored.bounded_runtime_summary.evidence_snapshot_summary.transition_evidence_n, 3);
    assert.strictEqual(stored.bounded_runtime_summary.openclaw_execution_separation_summary.ok, true);
    assert.strictEqual(stored.bounded_runtime_summary.openclaw_execution_separation_summary.audit_n, 1);
    assert.strictEqual(stored.bounded_runtime_summary.runtime_chain_audit_summary.ok, true);
    assert.strictEqual(stored.bounded_runtime_summary.runtime_chain_audit_summary.check_n, REQUIRED_RUNTIME_CHAIN_CHECK_IDS.length);
    assert.deepStrictEqual(stored.bounded_runtime_summary.runtime_chain_audit_summary.passed_check_ids, REQUIRED_RUNTIME_CHAIN_CHECK_IDS);
    assert.strictEqual(stored.bounded_runtime_summary.repair_evidence_summary.ok, true);
    assert.deepStrictEqual(stored.bounded_runtime_summary.repair_evidence_summary.runbook_refs, ["RQ_RBK_01"]);
    assert.strictEqual(stored.bounded_runtime_summary.repair_evidence_summary.latest_completion.issue_code, "TP1_ORDER_MISSING");
    assert.strictEqual(stored.bounded_runtime_summary.openclaw_execution_audit_ledger_write.collection_key, "OPENCLAW_EXECUTION_AUDITS");
    assert.strictEqual(stored.bounded_runtime_summary.repair_firestore_canary_streak.reason, "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS");
    assert.strictEqual(stored.bounded_runtime_summary.repair_firestore_canary_streak.healthy_run_n, 13);
    assert.strictEqual(stored.bounded_runtime_summary.production_entry_route_canary_streak.reason, "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS");
    assert.strictEqual(stored.bounded_runtime_summary.production_entry_route_canary_streak.healthy_run_n, 13);
    assert.strictEqual(stored.bounded_runtime_summary.alert_retry_summary.failed_n, 1);
    assert.strictEqual(stored.alert_retry_summary.latest_failed.last_reason_family, "TRANSPORT");
    assert.strictEqual(stored.candidate_selection_summary.selection_status, "READY");
    assert.strictEqual(stored.candidate_selection_summary.recent_active_position_cycle_n, 1);
    assert.strictEqual(stored.candidate_selection_summary.selection_contract.ok, true);
    assert.strictEqual(stored.candidate_selection_summary.selection_contract.selected_snapshot_counts_exact, true);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function unifiedReportExtractsCriticalTerminalWatchdogIssues() {
  const payload = buildUnifiedPromotionReport({
    mode: "CANARY",
    policy: {},
    replayReport: {
      pass: false,
      blockers: [
        "WATCHDOG_FAIL:WATCHDOG_ISSUES_PRESENT:TERMINAL_PROJECTION_MISMATCH|TRAIL_STOP_MISSING",
      ],
    },
    shadowLiveComparisonReport: {
      pass: true,
      blockers: [],
      warnings: [],
    },
    sourceModeComparisonReport: {
      pass: true,
      blockers: [],
      warnings: [],
    },
  });
  assert.ok(payload.critical_watchdog_issue_codes.includes("TERMINAL_PROJECTION_MISMATCH"));
  assert.ok(!payload.critical_watchdog_issue_codes.includes("TRAIL_STOP_MISSING"));
})();

console.log("GENERATE_V2_UNIFIED_PROMOTION_REPORT_TEST_OK");
