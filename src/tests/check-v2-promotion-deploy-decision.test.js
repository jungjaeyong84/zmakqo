"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const deployDecision = require("../../scripts/check-v2-promotion-deploy-decision");

const LINEAGE_CONTRACT_FIXTURE = Object.freeze({
  version: "V2_PROMOTION_SELECTOR_LINEAGE_SHA256_V1",
  hash: "lineage-hash-fixture",
});
const REQUIRED_RUNTIME_CHAIN_CHECK_IDS = deployDecision.__test.REQUIRED_RUNTIME_CHAIN_CHECK_IDS;
const REQUIRED_PRODUCTION_LIVE_ENTRY_SIZING_CHECK_IDS = deployDecision.__test.REQUIRED_PRODUCTION_LIVE_ENTRY_SIZING_CHECK_IDS;

function buildProductionCutoverAuditFixture(overrides = {}) {
  return {
    ok: true,
    reason: "V2_PRODUCTION_CUTOVER_AUDIT_PASS",
    scope: "production_webhook_cutover",
    contract: {
      ok: true,
      reason: "V2_PRODUCTION_CUTOVER_CONTRACT_PASS",
      check_n: REQUIRED_PRODUCTION_LIVE_ENTRY_SIZING_CHECK_IDS.length,
      fail_n: 0,
      failed_check_ids: [],
      checks: REQUIRED_PRODUCTION_LIVE_ENTRY_SIZING_CHECK_IDS.map((id) => ({
        id,
        ok: true,
        reason: "fixture production live entry sizing contract passed",
        evidence: {},
      })),
    },
    ...overrides,
  };
}

function buildBoundedRuntimeSummaryFixture() {
  return {
    selector_query_budget: {
      query_limit: 25,
    },
    collector_query_budget: {
      limits: {
        transitionsLimit: 50,
      },
    },
    exporter_snapshot_size_bytes: 12345,
    manifest_counts: {
      episode_n: 1,
    },
    lineage_contract: LINEAGE_CONTRACT_FIXTURE,
    evidence_snapshot_summary: {
      ok: true,
      transition_n: 3,
      transition_evidence_n: 3,
      missing_transition_evidence_n: 0,
      terminal_transition_n: 1,
      terminal_full_exit_evidence_n: 1,
      missing_terminal_full_exit_evidence_n: 0,
      stop_terminal_transition_n: 1,
      stop_terminal_fill_evidence_n: 1,
      missing_stop_terminal_fill_evidence_n: 0,
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
      repair_request_n: 0,
      repair_execution_ledger_n: 0,
      completion_ledger_n: 0,
      completion_evidence_n: 0,
      completed_success_n: 0,
      completed_failed_n: 0,
      missing_completion_evidence_n: 0,
      runbook_refs: [],
      order_evidence_n: 0,
      latest_completion: null,
    },
    openclaw_execution_audit_ledger_write: {
      ok: true,
      skipped: false,
      reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN",
      collection_key: "OPENCLAW_EXECUTION_AUDITS",
      doc_id: "OCEAUV2__CANARY__01",
    },
    repair_firestore_canary_streak: {
      ok: true,
      reason: "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS",
      artifact_file: "/tmp/dbj-v2-artifacts/v2_repair_queue_firestore_canary_streak_latest.json",
      artifact_dir: "/tmp/dbj-v2-artifacts",
      artifact_filename: "v2_repair_queue_firestore_canary_streak_latest.json",
      artifact_current_dir_match: true,
      lookback_hours: 24,
      healthy_run_n: 13,
      min_run_count: 12,
      max_gap_minutes: 180,
      unhealthy_run_n: 0,
      invalid_line_n: 0,
      latest_age_minutes: 15,
      coverage_minutes: 1440,
      max_observed_gap_minutes: 120,
      blockers: [],
    },
    production_entry_route_canary_streak: {
      ok: true,
      reason: "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS",
      artifact_file: "/tmp/dbj-v2-artifacts/v2_production_entry_route_canary_streak_latest.json",
      artifact_dir: "/tmp/dbj-v2-artifacts",
      artifact_filename: "v2_production_entry_route_canary_streak_latest.json",
      artifact_current_dir_match: true,
      history_source: "FIRESTORE",
      history_file: "dbjv2__production_entry_route_canaries_v2",
      lookback_hours: 24,
      healthy_run_n: 13,
      min_run_count: 12,
      max_gap_minutes: 180,
      unhealthy_run_n: 0,
      invalid_line_n: 0,
      latest_age_minutes: 15,
      coverage_minutes: 1440,
      max_observed_gap_minutes: 120,
      blockers: [],
    },
    exit_runtime_canary_streak: {
      ok: true,
      reason: "V2_EXIT_RUNTIME_CANARY_STREAK_PASS",
      artifact_file: "/tmp/dbj-v2-artifacts/v2_exit_runtime_canary_streak_latest.json",
      artifact_dir: "/tmp/dbj-v2-artifacts",
      artifact_filename: "v2_exit_runtime_canary_streak_latest.json",
      artifact_current_dir_match: true,
      history_source: "FIRESTORE",
      history_file: "dbjv2__exit_runtime_canaries_v2",
      lookback_hours: 24,
      min_run_count: 12,
      max_gap_minutes: 180,
      firestore_read_limit: 200,
      row_n: 13,
      healthy_run_n: 13,
      unhealthy_run_n: 0,
      invalid_line_n: 0,
      latest_age_minutes: 15,
      coverage_minutes: 1440,
      max_observed_gap_minutes: 120,
      tp1_missing_n: 0,
      native_refresh_unhealthy_n: 0,
      unprotected_window_violation_n: 0,
      alert_silent_drop_n: 0,
      blockers: [],
    },
    production_entry_protected_canary: {
      ok: true,
      reason: "V2_PRODUCTION_ENTRY_PROTECTED_CANARY_PASS",
      scope: "production_entry_protected_canary",
      canary_mode: "PROTECTED_ENTRY_NO_EXCHANGE_PROOF",
      artifact_file: "/tmp/dbj-v2-artifacts/v2_production_entry_protected_canary_latest.json",
      artifact_dir: "/tmp/dbj-v2-artifacts",
      artifact_filename: "v2_production_entry_protected_canary_latest.json",
      artifact_current_dir_match: true,
      exchange_write_performed: false,
      route_called: true,
      kernel_called: true,
      entry_transport_called: true,
      initial_sl_transport_called: true,
      initial_tp1_transport_called: true,
      memory_firestore_batch_commit_n: 2,
      memory_firestore_write_n: 4,
      fail_n: 0,
      check_ids: [
        "V2_PROTECTED_ENTRY_CANARY_REQUEST_SIZING_APPROVED",
        "V2_PROTECTED_ENTRY_CANARY_ACTIVE_PROTECTED",
        "V2_PROTECTED_ENTRY_CANARY_SL_ORDER_PRESENT",
        "V2_PROTECTED_ENTRY_CANARY_TP1_ORDER_PRESENT",
        "V2_PROTECTED_ENTRY_CANARY_BATCH_WRITES_PRESENT",
        "V2_PROTECTED_ENTRY_CANARY_NO_EXCHANGE_WRITE",
      ],
      failed_check_ids: [],
      route_result_summary: {
        ok: true,
        reason: "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED",
        position_cycle_id: "PCY__PROTECTED_CANARY__01",
        entry_event_id: "ENTRY__PROTECTED_CANARY__01",
        protection_runtime_id: "PRTV2__PROTECTED_CANARY__01",
        runtime_health_status: "HEALTHY",
        sl_order_id: "SL__PROTECTED_CANARY__01",
        tp1_order_id: "TP1__PROTECTED_CANARY__01",
      },
    },
    alert_retry_summary: {
      outbox_n: 3,
      failed_n: 1,
      sent_n: 2,
      pending_n: 0,
      retryable_failed_n: 1,
      terminal_failed_n: 0,
      family_counts: { TRANSPORT: 1 },
      retry_policy_counts: { ALERT_RETRY_TRANSPORT: 1 },
      runbook_ref_counts: { ALERT_RBK_04: 1 },
      latest_failed: {
        alert_outbox_id: "TAOV2__CANARY__01",
        last_reason: "ALERT_DELIVERY_FAILED",
        last_reason_family: "TRANSPORT",
        retry_policy_code: "ALERT_RETRY_TRANSPORT",
        runbook_refs: ["ALERT_RBK_04"],
        last_attempt_at: "2026-04-21T00:00:00.000Z",
      },
    },
  };
}

function buildCandidateSelectionSummaryFixture(overrides = {}) {
  return {
    ok: true,
    selection_status: "READY",
    selected_position_cycle_id: "PCY__CANARY__01",
    selected_preflight: {
      ok: true,
      position_cycle_id: "PCY__CANARY__01",
      snapshot_counts: {
        episode_n: 1,
        shadow_live_pair_n: 1,
        source_mode_pair_n: 1,
      },
      blocker_n: 0,
    },
    selection_contract: {
      ok: true,
      scan_limit_respected: true,
      recent_window_enforced: true,
      selected_candidate_present: true,
      selected_preflight_ok: true,
      selected_runtime_chain_ok: true,
      selected_cycle_matches_preflight: true,
      selected_cycle_matches_collector_env: true,
      selected_snapshot_counts_exact: true,
    },
    ...overrides,
  };
}

(function shadowModeIsNeverDeployApproved() {
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "SHADOW",
    position_cycle_id: null,
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.strictEqual(decision.decision, "HOLD");
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:SHADOW_MODE_NOT_DEPLOYABLE"));
})();

(function canaryPassApprovesDeploy() {
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__01",
    bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    candidate_selection_summary: buildCandidateSelectionSummaryFixture(),
    blockers: [],
    warnings: [],
  }, {
    productionCutoverAudit: buildProductionCutoverAuditFixture(),
  });
  assert.strictEqual(decision.approved, true);
  assert.strictEqual(decision.decision, "APPROVE_DEPLOY");
  assert.strictEqual(decision.bounded_runtime_summary.selector_query_budget.query_limit, 25);
  assert.strictEqual(decision.bounded_runtime_summary.lineage_contract.hash, "lineage-hash-fixture");
  assert.strictEqual(deployDecision.__test.hasEvidenceSnapshotCoverage(decision.bounded_runtime_summary), true);
  assert.strictEqual(deployDecision.__test.hasOpenClawExecutionSeparationCoverage(decision.bounded_runtime_summary), true);
  assert.strictEqual(deployDecision.__test.hasRuntimeChainAuditCoverage(decision.bounded_runtime_summary), true);
  assert.strictEqual(deployDecision.__test.hasRepairEvidenceSummary(decision.bounded_runtime_summary), true);
  assert.strictEqual(deployDecision.__test.hasOpenClawExecutionAuditLedgerWrite(decision.bounded_runtime_summary), true);
  assert.strictEqual(deployDecision.__test.hasRepairFirestoreCanaryStreak(decision.bounded_runtime_summary), true);
  assert.strictEqual(deployDecision.__test.hasFreshLongRunStreakCoverage(decision.bounded_runtime_summary.repair_firestore_canary_streak), true);
  assert.strictEqual(deployDecision.__test.hasExitRuntimeCanaryStreak(decision.bounded_runtime_summary), true);
  assert.strictEqual(deployDecision.__test.hasProductionEntryProtectedCanary(decision.bounded_runtime_summary), true);
  assert.strictEqual(deployDecision.__test.hasEntryBoundaryAudit(decision.entry_boundary_audit), true);
  assert.strictEqual(deployDecision.__test.hasFillSyncCanonicalBoundaryAudit(decision.fill_sync_canonical_boundary_audit), true);
  assert.strictEqual(deployDecision.__test.hasProductionCutoverAudit(decision.production_cutover_audit), true);
  assert.strictEqual(deployDecision.__test.hasProductionLiveEntrySizingContract(decision.production_cutover_audit), true);
  assert.strictEqual(decision.alert_retry_attention_required, true);
  assert.strictEqual(decision.alert_retry_summary.failed_n, 1);
  assert.strictEqual(decision.alert_retry_summary.latest_failed.retry_policy_code, "ALERT_RETRY_TRANSPORT");
  assert.strictEqual(decision.candidate_selection_summary.selection_status, "READY");
})();

(function canaryWithoutProductionLiveEntrySizingContractFailsClosed() {
  const productionCutoverAudit = buildProductionCutoverAuditFixture();
  productionCutoverAudit.contract.checks = productionCutoverAudit.contract.checks.filter((row) => (
    row.id !== "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_REQUIRE_APPROVED_SIZING"
  ));
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__BAD_LIVE_SIZING",
    bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__CANARY__BAD_LIVE_SIZING",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__CANARY__BAD_LIVE_SIZING",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: [],
    warnings: [],
  }, {
    productionCutoverAudit,
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:V2_PRODUCTION_LIVE_ENTRY_SIZING_CONTRACT_REQUIRED"));
})();

(function canaryWithoutEntryBoundaryAuditFailsClosed() {
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__BAD_BOUNDARY",
    bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__CANARY__BAD_BOUNDARY",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__CANARY__BAD_BOUNDARY",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: [],
    warnings: [],
  }, {
    entryBoundaryAudit: {
      ok: false,
      reason: "V2_ENTRY_BOUNDARY_AUDIT_BLOCKED",
      scope: "src/v2",
      checked_file_n: 12,
      violation_n: 1,
      violations: [{ code: "V2_ENTRY_RAW_MARKET_ORDER_WRITER_FORBIDDEN", file: "src/v2/bad.js" }],
    },
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:V2_ENTRY_BOUNDARY_AUDIT_REQUIRED"));
})();

(function canaryWithoutFillSyncCanonicalBoundaryAuditFailsClosed() {
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__BAD_FILL_BOUNDARY",
    bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__CANARY__BAD_FILL_BOUNDARY",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__CANARY__BAD_FILL_BOUNDARY",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: [],
    warnings: [],
  }, {
    fillSyncCanonicalBoundaryAudit: {
      ok: false,
      reason: "V2_FILL_SYNC_CANONICAL_BOUNDARY_AUDIT_BLOCKED",
      scope: "binance_fills_sync_canonical_boundary",
      contract: {
        ok: false,
        fail_n: 1,
        failed_check_ids: ["V2_FILL_SYNC_TP1_LEGACY_GATE_REQUIRES_BATCH_EVIDENCE"],
      },
    },
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:V2_FILL_SYNC_CANONICAL_BOUNDARY_AUDIT_REQUIRED"));
})();

(function canaryWithoutProductionCutoverAuditFailsClosed() {
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__BAD_CUTOVER",
    bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__CANARY__BAD_CUTOVER",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__CANARY__BAD_CUTOVER",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: [],
    warnings: [],
  }, {
    productionCutoverAudit: {
      ok: false,
      reason: "V2_PRODUCTION_CUTOVER_AUDIT_BLOCKED",
      scope: "production_webhook_cutover",
      contract: {
        ok: false,
        fail_n: 1,
        failed_check_ids: ["V2_WEBHOOK_SIGNAL_ROUTE_APPLIES_CUTOVER_GUARD"],
      },
    },
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:V2_PRODUCTION_CUTOVER_AUDIT_REQUIRED"));
})();

(function canaryWithoutRepairFirestoreStreakWarnsButDoesNotBlock() {
  const bounded = buildBoundedRuntimeSummaryFixture();
  delete bounded.repair_firestore_canary_streak;
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__NO_STREAK",
    bounded_runtime_summary: bounded,
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__CANARY__NO_STREAK",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__CANARY__NO_STREAK",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, true);
  assert.ok(decision.warnings.includes("DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"));
})();

(function liveWithoutRepairFirestoreStreakFailsClosed() {
  const bounded = buildBoundedRuntimeSummaryFixture();
  bounded.repair_firestore_canary_streak = {
    ok: false,
    reason: "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_BLOCKED",
    healthy_run_n: 3,
    min_run_count: 12,
    unhealthy_run_n: 0,
    invalid_line_n: 0,
    blockers: ["FIRESTORE_CANARY_STREAK:MIN_RUN_COUNT"],
  };
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "LIVE",
    position_cycle_id: "PCY__LIVE__NO_STREAK",
    bounded_runtime_summary: bounded,
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__LIVE__NO_STREAK",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__LIVE__NO_STREAK",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_REQUIRED"));
})();

(function liveWithStaleRepairFirestoreStreakFailsClosed() {
  const bounded = buildBoundedRuntimeSummaryFixture();
  bounded.repair_firestore_canary_streak = {
    ...bounded.repair_firestore_canary_streak,
    artifact_file: "/tmp/ops/daily/v2_repair_queue_firestore_canary_streak_latest.json",
    artifact_dir: "/tmp/dbj-v2-artifacts",
    artifact_current_dir_match: false,
  };
  assert.strictEqual(deployDecision.__test.hasRepairFirestoreCanaryStreak(bounded), false);
  assert.deepStrictEqual(deployDecision.__test.collectStaleArtifactProvenanceBlockers(bounded, { mode: "LIVE" }), [
    "DEPLOY_DECISION:STALE_ARTIFACT_PROVENANCE:REPAIR_FIRESTORE_CANARY_STREAK",
  ]);
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "LIVE",
    position_cycle_id: "PCY__LIVE__STALE_REPAIR_STREAK",
    bounded_runtime_summary: bounded,
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__LIVE__STALE_REPAIR_STREAK",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__LIVE__STALE_REPAIR_STREAK",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:STALE_ARTIFACT_PROVENANCE:REPAIR_FIRESTORE_CANARY_STREAK"));
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_REQUIRED"));
})();

(function canaryWithoutProductionEntryProtectedCanaryFailsClosed() {
  const bounded = buildBoundedRuntimeSummaryFixture();
  delete bounded.production_entry_protected_canary;
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__NO_PROTECTED_CANARY",
    bounded_runtime_summary: bounded,
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__CANARY__NO_PROTECTED_CANARY",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__CANARY__NO_PROTECTED_CANARY",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: [],
    warnings: [],
  }, {
    productionCutoverAudit: buildProductionCutoverAuditFixture(),
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:PRODUCTION_ENTRY_PROTECTED_CANARY_REQUIRED"));
})();

(function canaryWithStaleProductionEntryProtectedCanaryFailsClosed() {
  const bounded = buildBoundedRuntimeSummaryFixture();
  bounded.production_entry_protected_canary = {
    ...bounded.production_entry_protected_canary,
    artifact_file: "/tmp/ops/daily/v2_production_entry_protected_canary_latest.json",
    artifact_dir: "/tmp/dbj-v2-artifacts",
    artifact_current_dir_match: false,
  };
  assert.strictEqual(deployDecision.__test.hasProductionEntryProtectedCanary(bounded), false);
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__STALE_PROTECTED_CANARY",
    bounded_runtime_summary: bounded,
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__CANARY__STALE_PROTECTED_CANARY",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__CANARY__STALE_PROTECTED_CANARY",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: [],
    warnings: [],
  }, {
    productionCutoverAudit: buildProductionCutoverAuditFixture(),
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:PRODUCTION_ENTRY_PROTECTED_CANARY_REQUIRED"));
})();

(function canaryWithoutProductionEntryRouteStreakWarnsButDoesNotBlock() {
  const bounded = buildBoundedRuntimeSummaryFixture();
  delete bounded.production_entry_route_canary_streak;
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__NO_ROUTE_STREAK",
    bounded_runtime_summary: bounded,
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__CANARY__NO_ROUTE_STREAK",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__CANARY__NO_ROUTE_STREAK",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, true);
  assert.ok(decision.warnings.includes("DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"));
})();

(function liveWithoutProductionEntryRouteStreakFailsClosed() {
  const bounded = buildBoundedRuntimeSummaryFixture();
  bounded.production_entry_route_canary_streak = {
    ok: false,
    reason: "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_BLOCKED",
    history_source: "FIRESTORE",
    history_file: "dbjv2__production_entry_route_canaries_v2",
    healthy_run_n: 3,
    min_run_count: 12,
    unhealthy_run_n: 0,
    invalid_line_n: 0,
    blockers: ["PRODUCTION_ENTRY_ROUTE_CANARY_STREAK:MIN_RUN_COUNT"],
  };
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "LIVE",
    position_cycle_id: "PCY__LIVE__NO_ROUTE_STREAK",
    bounded_runtime_summary: bounded,
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__LIVE__NO_ROUTE_STREAK",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__LIVE__NO_ROUTE_STREAK",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRED"));
})();

(function liveWithStaleProductionEntryRouteStreakFailsClosed() {
  const bounded = buildBoundedRuntimeSummaryFixture();
  bounded.production_entry_route_canary_streak = {
    ...bounded.production_entry_route_canary_streak,
    artifact_file: "/tmp/ops/daily/v2_production_entry_route_canary_streak_latest.json",
    artifact_dir: "/tmp/dbj-v2-artifacts",
    artifact_current_dir_match: false,
  };
  assert.strictEqual(deployDecision.__test.hasProductionEntryRouteCanaryStreak(bounded), false);
  assert.deepStrictEqual(deployDecision.__test.collectStaleArtifactProvenanceBlockers(bounded, { mode: "LIVE" }), [
    "DEPLOY_DECISION:STALE_ARTIFACT_PROVENANCE:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK",
  ]);
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "LIVE",
    position_cycle_id: "PCY__LIVE__STALE_ROUTE_STREAK",
    bounded_runtime_summary: bounded,
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__LIVE__STALE_ROUTE_STREAK",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__LIVE__STALE_ROUTE_STREAK",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:STALE_ARTIFACT_PROVENANCE:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK"));
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRED"));
})();

(function liveWithJsonlProductionEntryRouteStreakStillFailsClosed() {
  const bounded = buildBoundedRuntimeSummaryFixture();
  bounded.production_entry_route_canary_streak = {
    ok: true,
    reason: "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS",
    history_source: "JSONL",
    history_file: "/tmp/v2_production_entry_route_canary_history.jsonl",
    healthy_run_n: 13,
    min_run_count: 12,
    unhealthy_run_n: 0,
    invalid_line_n: 0,
    blockers: [],
  };
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "LIVE",
    position_cycle_id: "PCY__LIVE__JSONL_ROUTE_STREAK",
    bounded_runtime_summary: bounded,
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__LIVE__JSONL_ROUTE_STREAK",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__LIVE__JSONL_ROUTE_STREAK",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRED"));
})();

(function liveWithoutExitRuntimeStreakFailsClosed() {
  const bounded = buildBoundedRuntimeSummaryFixture();
  bounded.exit_runtime_canary_streak = {
    ok: false,
    reason: "V2_EXIT_RUNTIME_CANARY_STREAK_BLOCKED",
    history_source: "FIRESTORE",
    history_file: "dbjv2__exit_runtime_canaries_v2",
    lookback_hours: 24,
    healthy_run_n: 11,
    min_run_count: 12,
    max_gap_minutes: 180,
    unhealthy_run_n: 0,
    invalid_line_n: 0,
    latest_age_minutes: 15,
    coverage_minutes: 1440,
    max_observed_gap_minutes: 120,
    tp1_missing_n: 0,
    native_refresh_unhealthy_n: 0,
    unprotected_window_violation_n: 0,
    alert_silent_drop_n: 0,
    blockers: ["EXIT_RUNTIME_CANARY_STREAK:MIN_RUN_COUNT"],
  };
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "LIVE",
    position_cycle_id: "PCY__LIVE__NO_EXIT_STREAK",
    bounded_runtime_summary: bounded,
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__LIVE__NO_EXIT_STREAK",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__LIVE__NO_EXIT_STREAK",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:EXIT_RUNTIME_CANARY_STREAK_REQUIRED"));
})();

(function liveWithShortRepairStreakCoverageFailsClosed() {
  const bounded = buildBoundedRuntimeSummaryFixture();
  bounded.repair_firestore_canary_streak.coverage_minutes = 720;
  assert.strictEqual(deployDecision.__test.hasRepairFirestoreCanaryStreak(bounded), false);
  assert.strictEqual(deployDecision.__test.hasFreshLongRunStreakCoverage(bounded.repair_firestore_canary_streak), false);
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "LIVE",
    position_cycle_id: "PCY__LIVE__SHORT_REPAIR_STREAK",
    bounded_runtime_summary: bounded,
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__LIVE__SHORT_REPAIR_STREAK",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__LIVE__SHORT_REPAIR_STREAK",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_REQUIRED"));
})();

(function canaryWithoutOpenClawExecutionSeparationFailsClosed() {
  const bounded = buildBoundedRuntimeSummaryFixture();
  delete bounded.openclaw_execution_separation_summary;
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__01",
    bounded_runtime_summary: bounded,
    candidate_selection_summary: buildCandidateSelectionSummaryFixture(),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:OPENCLAW_EXECUTION_SEPARATION_REQUIRED"));
})();

(function canaryWithoutRuntimeChainAuditFailsClosed() {
  const bounded = buildBoundedRuntimeSummaryFixture();
  delete bounded.runtime_chain_audit_summary;
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__NO_RUNTIME_CHAIN",
    bounded_runtime_summary: bounded,
    candidate_selection_summary: buildCandidateSelectionSummaryFixture(),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:RUNTIME_CHAIN_AUDIT_REQUIRED"));
})();

(function canaryWithIncompleteRuntimeChainAuditFailsClosed() {
  const bounded = buildBoundedRuntimeSummaryFixture();
  bounded.runtime_chain_audit_summary = {
    ok: true,
    check_n: 1,
    fail_n: 0,
    check_ids: ["REPLAY_GATE_EPISODE_VALID"],
    passed_check_ids: ["REPLAY_GATE_EPISODE_VALID"],
    failed_check_ids: [],
  };
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__INCOMPLETE_RUNTIME_CHAIN",
    bounded_runtime_summary: bounded,
    candidate_selection_summary: buildCandidateSelectionSummaryFixture(),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:RUNTIME_CHAIN_AUDIT_REQUIRED"));
})();

(function canaryWithoutRepairEvidenceSummaryFailsClosed() {
  const bounded = buildBoundedRuntimeSummaryFixture();
  delete bounded.repair_evidence_summary;
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__NO_REPAIR_EVIDENCE",
    bounded_runtime_summary: bounded,
    candidate_selection_summary: buildCandidateSelectionSummaryFixture(),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:REPAIR_EVIDENCE_SUMMARY_REQUIRED"));
})();

(function canaryWithRepairRequestButNoCompletionEvidenceFailsClosed() {
  const bounded = buildBoundedRuntimeSummaryFixture();
  bounded.repair_evidence_summary = {
    ok: false,
    repair_request_n: 1,
    repair_execution_ledger_n: 1,
    completion_ledger_n: 1,
    completion_evidence_n: 0,
    completed_success_n: 0,
    completed_failed_n: 1,
    missing_completion_evidence_n: 1,
    runbook_refs: [],
    order_evidence_n: 0,
    latest_completion: null,
  };
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__BAD_REPAIR_EVIDENCE",
    bounded_runtime_summary: bounded,
    candidate_selection_summary: buildCandidateSelectionSummaryFixture(),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:REPAIR_EVIDENCE_SUMMARY_REQUIRED"));
})();

(function canaryWithoutOpenClawExecutionAuditLedgerWriteFailsClosed() {
  const bounded = buildBoundedRuntimeSummaryFixture();
  bounded.openclaw_execution_audit_ledger_write = {
    ok: true,
    skipped: true,
    reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_DISABLED",
    collection_key: null,
    doc_id: "OCEAUV2__CANARY__01",
  };
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__01",
    bounded_runtime_summary: bounded,
    candidate_selection_summary: buildCandidateSelectionSummaryFixture(),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_REQUIRED"));
})();

(function canaryWithoutPositionCycleFailsClosed() {
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: null,
    bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:POSITION_CYCLE_ID_REQUIRED"));
})();

(function canaryWithoutBoundedRuntimeEvidenceFailsClosed() {
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__03",
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:BOUNDED_RUNTIME_SUMMARY_REQUIRED"));
})();

(function canaryWithCandidateSelectionMismatchFailsClosed() {
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__04",
    bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__CANARY__99",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__CANARY__99",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:CANDIDATE_SELECTION_POSITION_CYCLE_MISMATCH"));
})();

(function canaryWithoutEvidenceSnapshotCoverageFailsClosed() {
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__NO_EVIDENCE",
    bounded_runtime_summary: {
      selector_query_budget: {
        query_limit: 25,
      },
      collector_query_budget: {
        limits: {
          transitionsLimit: 50,
        },
      },
      exporter_snapshot_size_bytes: 12345,
      manifest_counts: {
        episode_n: 1,
      },
    },
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__CANARY__NO_EVIDENCE",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__CANARY__NO_EVIDENCE",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:EVIDENCE_SNAPSHOT_SUMMARY_REQUIRED"));
})();

(function canaryWithStaleEvidenceSnapshotSummaryFailsClosed() {
  const bounded = buildBoundedRuntimeSummaryFixture();
  delete bounded.evidence_snapshot_summary.terminal_transition_n;
  delete bounded.evidence_snapshot_summary.terminal_full_exit_evidence_n;
  delete bounded.evidence_snapshot_summary.missing_terminal_full_exit_evidence_n;
  delete bounded.evidence_snapshot_summary.stop_terminal_transition_n;
  delete bounded.evidence_snapshot_summary.stop_terminal_fill_evidence_n;
  delete bounded.evidence_snapshot_summary.missing_stop_terminal_fill_evidence_n;
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__STALE_EVIDENCE",
    bounded_runtime_summary: bounded,
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__CANARY__STALE_EVIDENCE",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__CANARY__STALE_EVIDENCE",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:EVIDENCE_SNAPSHOT_SUMMARY_REQUIRED"));
})();

(function canaryWithReplayEvidenceGapFailsClosed() {
  const decision = deployDecision.__test.buildDeployDecision({
    pass: false,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__EVIDENCE",
    bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__CANARY__EVIDENCE",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__CANARY__EVIDENCE",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
    }),
    blockers: ["REPLAY:MISSING_TRANSITION_EVIDENCE:TRANSITION_EXCHANGE_EVIDENCE_MISSING:1"],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("REPLAY:MISSING_TRANSITION_EVIDENCE:TRANSITION_EXCHANGE_EVIDENCE_MISSING:1"));
})();

(function canaryWithoutCandidateSelectionContractFailsClosed() {
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__NO_CONTRACT",
    bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__CANARY__NO_CONTRACT",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__CANARY__NO_CONTRACT",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
      selection_contract: null,
    }),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:CANDIDATE_SELECTION_CONTRACT_REQUIRED"));
})();

(function canaryWithoutCandidatePreflightCountsFailsClosed() {
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__BAD_PREFLIGHT",
    bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__CANARY__BAD_PREFLIGHT",
      selected_preflight: {
        ok: true,
        position_cycle_id: "PCY__CANARY__BAD_PREFLIGHT",
        snapshot_counts: {
          episode_n: 2,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 0,
      },
      selection_contract: {
        ok: false,
        scan_limit_respected: true,
        recent_window_enforced: true,
        selected_candidate_present: true,
        selected_preflight_ok: true,
        selected_runtime_chain_ok: true,
        selected_cycle_matches_preflight: true,
        selected_cycle_matches_collector_env: true,
        selected_snapshot_counts_exact: false,
      },
    }),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:CANDIDATE_SELECTION_PREFLIGHT_COUNTS_REQUIRED"));
})();

(function canaryWithoutCandidateRuntimeChainFailsClosed() {
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__BAD_RUNTIME_CHAIN",
    bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    candidate_selection_summary: buildCandidateSelectionSummaryFixture({
      selected_position_cycle_id: "PCY__CANARY__BAD_RUNTIME_CHAIN",
      selected_preflight: {
        ok: false,
        position_cycle_id: "PCY__CANARY__BAD_RUNTIME_CHAIN",
        snapshot_counts: {
          episode_n: 1,
          shadow_live_pair_n: 1,
          source_mode_pair_n: 1,
        },
        blocker_n: 1,
      },
      selection_contract: {
        ok: false,
        scan_limit_respected: true,
        recent_window_enforced: true,
        selected_candidate_present: true,
        selected_preflight_ok: true,
        selected_runtime_chain_ok: false,
        selected_cycle_matches_preflight: true,
        selected_cycle_matches_collector_env: true,
        selected_snapshot_counts_exact: true,
      },
    }),
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:CANDIDATE_SELECTION_CONTRACT_REQUIRED"));
})();

(function criticalTerminalWatchdogIssuesAlwaysBlockDeploy() {
  const decision = deployDecision.__test.buildDeployDecision({
    pass: false,
    mode: "CANARY",
    position_cycle_id: "PCY__CANARY__02",
    critical_watchdog_issue_codes: ["TERMINAL_PROJECTION_MISMATCH"],
    blockers: [],
    warnings: [],
  });
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:CRITICAL_WATCHDOG_ISSUES_PRESENT:TERMINAL_PROJECTION_MISMATCH"));
})();

(async function artifactIsWrittenFromArtifactDirInput() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-deploy-decision-"));
  try {
    fs.writeFileSync(path.join(dir, "promotion-preflight.json"), JSON.stringify({
      ok: true,
      position_cycle_id: "PCY__LIVE__01",
      lineage_contract: LINEAGE_CONTRACT_FIXTURE,
    }, null, 2), "utf8");
    fs.writeFileSync(path.join(dir, "unified-promotion-report.json"), JSON.stringify({
      pass: true,
      mode: "LIVE",
      position_cycle_id: "PCY__LIVE__01",
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      candidate_selection_summary: buildCandidateSelectionSummaryFixture({
        selected_position_cycle_id: "PCY__LIVE__01",
        selected_preflight: {
          ok: true,
          position_cycle_id: "PCY__LIVE__01",
          snapshot_counts: {
            episode_n: 1,
            shadow_live_pair_n: 1,
            source_mode_pair_n: 1,
          },
          blocker_n: 0,
        },
      }),
      blockers: [],
      warnings: [],
      report: {
        pass: true,
      },
    }, null, 2), "utf8");
    const result = deployDecision.writeDeployDecisionArtifact({
      V2_PROMOTION_ARTIFACT_DIR: dir,
    });
    assert.strictEqual(result.decision.approved, true);
    const file = path.join(dir, "promotion-deploy-decision.json");
    assert.ok(fs.existsSync(file));
    const stored = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.strictEqual(stored.decision, "APPROVE_DEPLOY");
    assert.strictEqual(stored.position_cycle_id, "PCY__LIVE__01");
    assert.strictEqual(stored.bounded_runtime_summary.collector_query_budget.limits.transitionsLimit, 50);
    assert.strictEqual(stored.bounded_runtime_summary.exporter_snapshot_size_bytes, 12345);
    assert.strictEqual(stored.bounded_runtime_summary.lineage_contract.hash, "lineage-hash-fixture");
    assert.strictEqual(stored.bounded_runtime_summary.evidence_snapshot_summary.ok, true);
    assert.strictEqual(stored.entry_boundary_audit.reason, "V2_ENTRY_BOUNDARY_AUDIT_PASS");
    assert.strictEqual(stored.fill_sync_canonical_boundary_audit.reason, "V2_FILL_SYNC_CANONICAL_BOUNDARY_AUDIT_PASS");
    assert.strictEqual(stored.production_cutover_audit.reason, "V2_PRODUCTION_CUTOVER_AUDIT_PASS");
    assert.strictEqual(stored.candidate_selection_summary.selection_status, "READY");
    assert.strictEqual(stored.candidate_selection_summary.selection_contract.ok, true);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function preflightLineageMismatchFailsClosed() {
  const decision = deployDecision.__test.applyPreflightLineageChecks(
    deployDecision.__test.buildDeployDecision({
      pass: true,
      mode: "CANARY",
      position_cycle_id: "PCY__CANARY__LINEAGE",
      bounded_runtime_summary: {
        ...buildBoundedRuntimeSummaryFixture(),
        lineage_contract: {
          version: "V2_PROMOTION_SELECTOR_LINEAGE_SHA256_V1",
          hash: "runtime-lineage-hash",
        },
      },
      candidate_selection_summary: buildCandidateSelectionSummaryFixture({
        selected_position_cycle_id: "PCY__CANARY__LINEAGE",
        selected_preflight: {
          ok: true,
          position_cycle_id: "PCY__CANARY__LINEAGE",
          snapshot_counts: {
            episode_n: 1,
            shadow_live_pair_n: 1,
            source_mode_pair_n: 1,
          },
          blocker_n: 0,
        },
      }),
      blockers: [],
      warnings: [],
    }),
    {
      preflightReport: {
        ok: true,
        position_cycle_id: "PCY__CANARY__LINEAGE",
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
    }
  );
  assert.strictEqual(decision.approved, false);
  assert.ok(decision.blockers.includes("DEPLOY_DECISION:LINEAGE_CONTRACT_MISMATCH"));
})();

console.log("CHECK_V2_PROMOTION_DEPLOY_DECISION_TEST_OK");
