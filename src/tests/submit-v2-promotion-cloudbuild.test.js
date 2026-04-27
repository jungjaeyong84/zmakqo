"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const submit = require("../../scripts/submit-v2-promotion-cloudbuild");
const renderer = require("../../scripts/render-v2-promotion-submit-operator-alert");
const deployDecisionCheck = require("../../scripts/check-v2-promotion-deploy-decision");
const productionRuntimeConfigAudit = require("../v2/productionRuntimeConfigAudit");

const LINEAGE_CONTRACT_FIXTURE = Object.freeze({
  version: "V2_PROMOTION_SELECTOR_LINEAGE_SHA256_V1",
  hash: "lineage-hash-fixture",
});
const REQUIRED_RUNTIME_CHAIN_CHECK_IDS = deployDecisionCheck.__test.REQUIRED_RUNTIME_CHAIN_CHECK_IDS;
const REQUIRED_PRODUCTION_LIVE_ENTRY_SIZING_CHECK_IDS = deployDecisionCheck.__test.REQUIRED_PRODUCTION_LIVE_ENTRY_SIZING_CHECK_IDS;

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function withReadinessArtifactProvenance(filePath, expectedFilename) {
  if (!filePath) return {};
  return {
    artifact_file: filePath,
    artifact_dir: path.dirname(filePath),
    artifact_filename: expectedFilename,
    artifact_current_dir_match: path.basename(filePath) === expectedFilename,
    generated_at: "2026-04-22T12:00:00.000Z",
    artifact_generated_at: "2026-04-22T12:00:00.000Z",
    artifact_generated_age_minutes: 15,
  };
}

function buildArtifactDirCoherenceFixture(dir, cycleId, overrides = {}) {
  return {
    ok: true,
    reason: "ARTIFACT_DIR_COHERENT",
    requested_artifact_dir: dir,
    resolved_artifact_dir: dir,
    artifact_dir: dir,
    position_cycle_id: cycleId,
    deploy_decision_position_cycle_id: cycleId,
    position_cycle_required: true,
    artifact_dir_matches_resolved_artifact_dir: true,
    artifact_dir_contains_position_cycle_id: true,
    resolved_artifact_dir_contains_position_cycle_id: true,
    context_cycle_matches_deploy_decision: true,
    ...overrides,
  };
}

function buildProductionCutoverAuditFixture() {
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
  };
}

function buildFillSyncCanonicalBoundaryAuditFixture() {
  return {
    ok: true,
    reason: "V2_FILL_SYNC_CANONICAL_BOUNDARY_AUDIT_PASS",
    scope: "binance_fills_sync_canonical_boundary",
    contract: {
      ok: true,
      reason: "V2_FILL_SYNC_CANONICAL_BOUNDARY_PASS",
      check_n: 8,
      fail_n: 0,
      failed_check_ids: [],
    },
  };
}

function buildProductionRuntimeChainAuditFixture() {
  return {
    ok: true,
    reason: "V2_PRODUCTION_RUNTIME_CHAIN_AUDIT_PASS",
    scope: "production_runtime_chain",
    contract: {
      ok: true,
      reason: "V2_PRODUCTION_RUNTIME_CHAIN_PASS",
      check_n: 12,
      fail_n: 0,
      failed_check_ids: [],
    },
  };
}

function seedBoundedSubmitArtifacts(
  dir,
  cycleId,
  {
    autoSelect = false,
    contextLineageHash = null,
    alertRetrySummary = null,
    deployWarnings = [],
    liveCutoverReadinessSummary = null,
    liveEvidenceReadinessSummary,
    productionCutoverReadinessSummary = null,
    schedulerTrafficCollectorPreflightSummary = null,
    schedulerTrafficCutoverReadinessSummary = null,
  } = {}
) {
  const liveEvidenceReadiness = liveEvidenceReadinessSummary === undefined
    ? buildLiveEvidenceReadinessSummaryFixture(path.join(dir, "v2_live_evidence_readiness_latest.json"), cycleId)
    : liveEvidenceReadinessSummary;
  writeJson(path.join(dir, "promotion-preflight.json"), {
    ok: true,
    position_cycle_id: cycleId,
    lineage_contract: LINEAGE_CONTRACT_FIXTURE,
  });
  writeJson(path.join(dir, "promotion-runtime-manifest.json"), {
    snapshot_meta: {
      selector_meta: {
        position_cycle_id: cycleId,
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
      lineage_contract: LINEAGE_CONTRACT_FIXTURE,
    },
  });
  writeJson(path.join(dir, "promotion-deploy-decision.json"), {
    approved: true,
    decision: "APPROVE_DEPLOY",
    position_cycle_id: cycleId,
    blockers: [],
    warnings: deployWarnings,
    entry_boundary_audit: {
      ok: true,
      reason: "V2_ENTRY_BOUNDARY_AUDIT_PASS",
      scope: "src/v2",
      checked_file_n: 12,
      violation_n: 0,
      violations: [],
    },
    fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
    production_runtime_chain_audit: buildProductionRuntimeChainAuditFixture(),
    production_cutover_audit: buildProductionCutoverAuditFixture(),
    ...(alertRetrySummary ? { alert_retry_summary: alertRetrySummary } : {}),
    bounded_runtime_summary: {
      selector_query_budget: { query_limit: 25 },
      collector_query_budget: { limits: { transitionsLimit: 50 } },
      exporter_snapshot_size_bytes: 12345,
      manifest_counts: { episode_n: 1 },
      lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      ...(alertRetrySummary ? { alert_retry_summary: alertRetrySummary } : {}),
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
        doc_id: "OCEXSEPAUDV2__SUBMIT",
      },
      openclaw_supreme_control_plane_summary: {
        ok: true,
        world_state_n: 1,
        latest_world_state_hash: "b7a32c82d3b6c5aa5e4f1c8d2a9b6f7e9c0d1a2b3c4d5e6f708192a3b4c5d6e7",
        openclaw_decision_bundle_n: 1,
        latest_openclaw_decision_bundle_hash: "decision-bundle-hash-submit",
        execution_permit_n: 1,
        permit_validation_pass_n: 1,
        permit_validation_fail_n: 0,
        outcome_adjudication_n: 1,
        outcome_unadjudicated_n: 0,
        blockers: [],
        learner_shadow_summary: {
          ok: true,
          evaluation_n: 1,
          shadow_only_n: 1,
          live_applied_n: 0,
          stale_evaluation_n: 0,
          model_win_n: 1,
          expected_blocked_loss_n: 0,
          model_ok_n: 1,
          model_error_n: 0,
          decisive_outcome_n: 1,
          model_error_rate: 0,
          max_model_error_rate: 0.5,
          max_evaluation_age_minutes: 1440,
          max_observed_evaluation_age_minutes: 1,
          latest_evaluated_at: "2026-04-22T00:01:00.000Z",
          blockers: [],
        },
        collector_execution_summary: {
          status: "PASS",
          producer_script: "collect-v2-promotion-runtime-snapshot",
          producer_scope: "openclaw_supreme_control_plane",
          source: "V2_FIRESTORE_COLLECTOR",
          position_cycle_id: "PCY__SUBMIT",
          openclaw_decision_id: "OCDV2__SUBMIT",
          openclaw_decision_bundle_ids: ["OCDBV2__SUBMIT"],
          openclaw_decision_bundle_hashes: ["decision-bundle-hash-submit"],
          openclaw_execution_permit_ids: ["OCEPV2__SUBMIT"],
          openclaw_outcome_adjudication_ids: ["OCOAV2__SUBMIT"],
          collected_at: "2026-04-22T00:02:00.000Z",
        artifact_file: "/tmp/dbj-v2-artifacts/promotion-runtime-snapshot.json",
        artifact_dir: "/tmp/dbj-v2-artifacts",
        artifact_filename: "promotion-runtime-snapshot.json",
        artifact_current_dir_match: true,
        generated_at: "2026-04-22T12:00:00.000Z",
        artifact_generated_at: "2026-04-22T12:00:00.000Z",
        artifact_generated_age_minutes: 15,
          exchange_write_performed: false,
          blockers: [],
        },
        lineage_consistency_summary: {
          ok: true,
          expected_openclaw_decision_id: "OCDV2__SUBMIT",
          expected_position_cycle_id: "PCY__SUBMIT",
          expected_world_state_hash: "b7a32c82d3b6c5aa5e4f1c8d2a9b6f7e9c0d1a2b3c4d5e6f708192a3b4c5d6e7",
          expected_openclaw_decision_bundle_hash: "decision-bundle-hash-submit",
          expected_openclaw_decision_bundle_ids: ["OCDBV2__SUBMIT"],
          expected_openclaw_execution_permit_ids: ["OCEPV2__SUBMIT"],
          expected_openclaw_outcome_adjudication_ids: ["OCOAV2__SUBMIT"],
          decision_bundle_lineage_match_n: 1,
          decision_bundle_lineage_mismatch_n: 0,
          permit_lineage_match_n: 1,
          permit_lineage_mismatch_n: 0,
          outcome_lineage_match_n: 1,
          outcome_lineage_mismatch_n: 0,
          learner_lineage_match_n: 1,
          learner_lineage_mismatch_n: 0,
          blockers: [],
        },
      },
      repair_firestore_canary_streak: {
        ok: true,
        reason: "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS",
        artifact_file: "/tmp/dbj-v2-artifacts/v2_repair_queue_firestore_canary_streak_latest.json",
        artifact_dir: "/tmp/dbj-v2-artifacts",
        artifact_filename: "v2_repair_queue_firestore_canary_streak_latest.json",
        artifact_current_dir_match: true,
        generated_at: "2026-04-22T12:00:00.000Z",
        artifact_generated_at: "2026-04-22T12:00:00.000Z",
        artifact_generated_age_minutes: 15,
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
        generated_at: "2026-04-22T12:00:00.000Z",
        artifact_generated_at: "2026-04-22T12:00:00.000Z",
        artifact_generated_age_minutes: 15,
        history_source: "FIRESTORE",
        firestore_source_required: true,
        history_file: "dbjv2__production_entry_route_canaries_v2",
        lookback_hours: 24,
        row_n: 13,
        healthy_run_n: 13,
        min_run_count: 12,
        max_gap_minutes: 180,
        unhealthy_run_n: 0,
        invalid_line_n: 0,
        latest_age_minutes: 15,
        coverage_minutes: 1440,
        max_observed_gap_minutes: 120,
        collector_execution_summary: {
          status: "PASS",
          scheduler_job_id: "v2_production_entry_route_canary",
          expected_scheduler_job_id: "v2_production_entry_route_canary",
          producer_script: "run-v2-production-entry-route-canary",
          producer_scope: "production_entry_route_canary",
          canary_mode: "NO_EXCHANGE_ROUTE_PROOF",
          exchange_write_performed: false,
          history_source: "FIRESTORE",
          firestore_source_required: true,
          row_n: 13,
          healthy_run_n: 13,
          latest_age_minutes: 15,
          coverage_minutes: 1440,
          max_observed_gap_minutes: 120,
          blockers: [],
        },
        blockers: [],
      },
      exit_runtime_canary_streak: {
        ok: true,
        reason: "V2_EXIT_RUNTIME_CANARY_STREAK_PASS",
        artifact_file: "/tmp/dbj-v2-artifacts/v2_exit_runtime_canary_streak_latest.json",
        artifact_dir: "/tmp/dbj-v2-artifacts",
        artifact_filename: "v2_exit_runtime_canary_streak_latest.json",
        artifact_current_dir_match: true,
        generated_at: "2026-04-22T12:00:00.000Z",
        artifact_generated_at: "2026-04-22T12:00:00.000Z",
        artifact_generated_age_minutes: 15,
        history_source: "FIRESTORE",
        firestore_source_required: true,
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
        active_position_n: 5,
        tp1_missing_n: 0,
        native_refresh_unhealthy_n: 0,
        unprotected_window_violation_n: 0,
        alert_silent_drop_n: 0,
        alert_retry_unresolved_n: 0,
        alert_outbox_integrity_gap_n: 0,
        trail_activation_evidence_gap_n: 0,
        collector_execution_summary: {
          status: "PASS",
          scheduler_job_id: "v2_exit_runtime_canary",
          expected_scheduler_job_id: "v2_exit_runtime_canary",
          producer_script: "run-v2-exit-runtime-canary",
          producer_scope: "exit_runtime_canary",
          canary_mode: "LIVE_EXIT_RUNTIME_OBSERVATION",
          exchange_write_performed: false,
          history_source: "FIRESTORE",
          firestore_source_required: true,
          row_n: 13,
          healthy_run_n: 13,
          latest_age_minutes: 15,
          coverage_minutes: 1440,
          max_observed_gap_minutes: 120,
          active_position_evidence_required: true,
          active_position_n: 5,
          blockers: [],
        },
        long_run_quality_summary: {
          status: "PASS",
          history_source: "FIRESTORE",
          firestore_source_required: true,
          active_position_evidence_required: true,
          coverage_minutes: 1440,
          latest_age_minutes: 15,
          max_observed_gap_minutes: 120,
          defect_counts: {
            active_position_n: 5,
            tp1_missing_n: 0,
            native_refresh_unhealthy_n: 0,
            unprotected_window_violation_n: 0,
            alert_silent_drop_n: 0,
            alert_retry_unresolved_n: 0,
            alert_outbox_integrity_gap_n: 0,
            trail_activation_evidence_gap_n: 0,
          },
          blockers: [],
        },
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
        generated_at: "2026-04-22T12:00:00.000Z",
        artifact_generated_at: "2026-04-22T12:00:00.000Z",
        artifact_generated_age_minutes: 15,
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
          "V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_PROBE_OK",
          "V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_ROUTE_CALLED",
          "V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_TRANSPORTS_READY",
          "V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_NO_EXCHANGE_WRITE",
        ],
        failed_check_ids: [],
        live_endpoint_probe_summary: {
          ok: true,
          reason: "V2_PRODUCTION_ENTRY_LIVE_EXECUTED_AND_PROTECTED",
          endpoint_enabled: true,
          route_called: true,
          transport_resolution_ok: true,
          transport_reason: "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_READY",
          exchange_write_performed: false,
          decision_mode: "LIVE",
          runtime_enabled: true,
          runtime_dry_run: false,
          runtime_canary_only: false,
        },
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
    },
    ...(autoSelect ? {
      candidate_selection_summary: {
        ok: true,
        selected_position_cycle_id: cycleId,
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
      },
    } : {}),
  });
  writeJson(path.join(dir, "promotion-cloudbuild-context.json"), {
    position_cycle_id: cycleId,
    artifact_dir: dir,
    resolved_artifact_dir: dir,
    artifact_dir_coherence: buildArtifactDirCoherenceFixture(dir, cycleId),
    lineage_contract_hash: contextLineageHash || LINEAGE_CONTRACT_FIXTURE.hash,
    final_status_line: `APPROVE_DEPLOY ; cycle=${cycleId} ; blockers=0 ; warnings=0`,
    recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
    recommended_next_action_reason: "deploy decision approved with no blocking families",
    ...(liveCutoverReadinessSummary ? {
      live_cutover_readiness_file: path.join(dir, "v2_repair_live_cutover_readiness_latest.json"),
      live_cutover_readiness_summary: liveCutoverReadinessSummary,
    } : {}),
    ...(liveEvidenceReadiness ? {
      live_evidence_readiness_file: path.join(dir, "v2_live_evidence_readiness_latest.json"),
      live_evidence_readiness_summary: liveEvidenceReadiness,
    } : {}),
    ...(productionCutoverReadinessSummary ? {
      production_cutover_readiness_file: path.join(dir, "v2_production_cutover_readiness_latest.json"),
      production_cutover_readiness_summary: productionCutoverReadinessSummary,
    } : {}),
    ...(schedulerTrafficCollectorPreflightSummary ? {
      scheduler_traffic_collector_preflight_file: path.join(dir, "v2_scheduler_traffic_collector_preflight_latest.json"),
      scheduler_traffic_collector_preflight_summary: schedulerTrafficCollectorPreflightSummary,
    } : {}),
    ...(schedulerTrafficCutoverReadinessSummary ? {
      scheduler_traffic_cutover_readiness_file: path.join(dir, "v2_scheduler_traffic_cutover_readiness_latest.json"),
      scheduler_traffic_cutover_readiness_summary: schedulerTrafficCutoverReadinessSummary,
    } : {}),
    deploy_decision_summary: {
      approved: true,
      decision: "APPROVE_DEPLOY",
      position_cycle_id: cycleId,
      lineage_contract_hash: contextLineageHash || LINEAGE_CONTRACT_FIXTURE.hash,
      blocker_n: 0,
      warning_n: deployWarnings.length,
      ...(alertRetrySummary ? { alert_retry_summary: alertRetrySummary } : {}),
      warning_summary: {
        warning_n: deployWarnings.length,
        top_warnings: deployWarnings.slice(0, 3),
        has_live_readiness_warning: deployWarnings.some((value) => (
          String(value).includes("REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY")
          || String(value).includes("PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY")
        )),
        has_repair_firestore_canary_streak_warning: deployWarnings.some((value) => String(value).includes("REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY")),
        has_production_entry_route_canary_streak_warning: deployWarnings.some((value) => String(value).includes("PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY")),
      },
      blocker_summary: {
        blocker_n: 0,
        top_blockers: [],
        has_provenance_blocker: false,
        has_stale_artifact_provenance_blocker: false,
        has_live_evidence_cycle_blocker: false,
        has_watchdog_blocker: false,
        has_candidate_selection_blocker: false,
        has_bounded_runtime_blocker: false,
        has_production_entry_protected_canary_blocker: false,
        has_openclaw_supreme_control_plane_blocker: false,
        has_entry_boundary_blocker: false,
        has_production_cutover_blocker: false,
      },
    },
  });
  if (liveCutoverReadinessSummary) {
    writeJson(path.join(dir, "v2_repair_live_cutover_readiness_latest.json"), {
      ...liveCutoverReadinessSummary,
      required_env_changes: [
        { name: "DONBEOLJA_V2_REPAIR_LIVE_ENABLE_REQUESTED", value: "1" },
        { name: "DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_REQUIRED", value: "1" },
        { name: "DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_REQUIRED", value: "1" },
        { name: "DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_REQUIRED", value: "1" },
      ],
    });
  }
  if (liveEvidenceReadiness) {
    writeJson(path.join(dir, "v2_live_evidence_readiness_latest.json"), liveEvidenceReadiness);
  }
  if (productionCutoverReadinessSummary) {
    writeJson(path.join(dir, "v2_production_cutover_readiness_latest.json"), {
      ...productionCutoverReadinessSummary,
      fail_n: 0,
      failed_check_ids: [],
      guard: {
        allowed: false,
        reason: "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED",
        context: {
          v2_enabled: true,
          v2_dry_run: false,
          v2_canary_only: false,
          require_production_cutover: true,
          block_legacy_webhook_signal: true,
          allow_legacy_webhook_signal: false,
        },
      },
    });
  }
  if (schedulerTrafficCollectorPreflightSummary) {
    writeJson(path.join(dir, "v2_scheduler_traffic_collector_preflight_latest.json"), {
      ...schedulerTrafficCollectorPreflightSummary,
      fail_n: 0,
      failed_check_ids: [],
    });
  }
  if (schedulerTrafficCutoverReadinessSummary) {
    writeJson(path.join(dir, "v2_scheduler_traffic_cutover_readiness_latest.json"), {
      ...schedulerTrafficCutoverReadinessSummary,
      fail_n: 0,
      failed_check_ids: [],
    });
  }
  writeJson(path.join(dir, "promotion-runbook-review.json"), {
    overall_status: "PASS",
    expected_position_cycle_id: cycleId,
    fail_n: 0,
    skip_n: autoSelect ? 0 : 2,
  });
}

function buildLiveCutoverReadinessSummaryFixture(filePath = null) {
  return {
    ok: true,
    reason: "V2_REPAIR_FIRESTORE_CANARY_READY_FOR_LIVE_PREFLIGHT",
    auto_apply: false,
    mutates_environment: false,
    recommended_next_action: "ENABLE_LIVE_REPAIR_PREFLIGHT_ENV_EXPLICITLY",
    blocker_n: 0,
    required_env_change_n: 4,
    submit_check_ids: ["SUBMIT_CHK_11"],
    runbook_checklist: ["19"],
    ...(filePath ? { file: filePath } : {}),
    ...withReadinessArtifactProvenance(filePath, "v2_repair_live_cutover_readiness_latest.json"),
  };
}

function buildLiveEvidenceReadinessSummaryFixture(filePath = null, cycleId = "PCY__LIVE__EVIDENCE") {
  return {
    ok: true,
    reason: "V2_LIVE_EVIDENCE_READY",
    mode: "LIVE",
    position_cycle_id: cycleId,
    deploy_decision_approved: true,
    evidence_ready: true,
    deploy_ready: true,
    blocker_n: 0,
    blockers: [],
    failed_axis_ids: [],
    submit_check_ids: [],
    runbook_refs: [],
    temporal_coherence: {
      ok: true,
      blockers: [],
    },
    ...(filePath ? { file: filePath } : {}),
    ...withReadinessArtifactProvenance(filePath, "v2_live_evidence_readiness_latest.json"),
  };
}

function buildProductionCutoverReadinessSummaryFixture(filePath = null) {
  return {
    ok: true,
    reason: "V2_PRODUCTION_CUTOVER_READINESS_PASS",
    blocker_n: 0,
    guard_reason: "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED",
    legacy_webhook_blocked: true,
    v2_enabled: true,
    v2_dry_run: false,
    v2_canary_only: false,
    production_entry_live_endpoint_enabled: true,
    require_production_cutover: true,
    block_legacy_webhook_signal: true,
    allow_legacy_webhook_signal: false,
    ...(filePath ? { file: filePath } : {}),
    ...withReadinessArtifactProvenance(filePath, "v2_production_cutover_readiness_latest.json"),
  };
}

function buildSchedulerTrafficCutoverReadinessSummaryFixture(filePath = null) {
  return {
    ok: true,
    reason: "V2_SCHEDULER_TRAFFIC_CUTOVER_READINESS_PASS",
    blocker_n: 0,
    scheduler_sot: "OPENCLAW_CRON",
    required_openclaw_job_ids: [
      "binance_exit_integrity_cycle",
      "openclaw_daily_cycle",
      "openclaw_hourly_cycle",
      "v2_repair_queue_service",
      "openclaw_server_primary_tick",
    ],
    missing_openclaw_job_ids: [],
    active_legacy_scheduler_job_n: 0,
    openclaw_cloud_scheduler_jobs: [
      { job_id: "openclaw_server_primary_tick", enabled: true, path_match: true, schedule_match: true, time_zone_match: true },
      { job_id: "v2_production_entry_route_canary", enabled: true, path_match: true, schedule_match: true, time_zone_match: true },
      { job_id: "v2_exit_runtime_canary", enabled: true, path_match: true, schedule_match: true, time_zone_match: true },
    ],
    cloud_run_services: [
      {
        name: "donbeolja",
        scheduler_autostart: "0",
        scheduler_cutover_mode: "OPENCLAW_CRON",
        traffic_percent: 100,
        latest_revision_ready: true,
      },
      {
        name: "donbeolja-exit-worker",
        scheduler_autostart: "0",
        scheduler_cutover_mode: "OPENCLAW_CRON",
        traffic_percent: 100,
        latest_revision_ready: true,
      },
    ],
    ...(filePath ? { file: filePath } : {}),
    ...withReadinessArtifactProvenance(filePath, "v2_scheduler_traffic_cutover_readiness_latest.json"),
  };
}

function buildSchedulerTrafficCollectorPreflightSummaryFixture(filePath = null) {
  return {
    ok: true,
    reason: "V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_PASS",
    blocker_n: 0,
    failed_check_ids: [],
    project_id: "donbeolja-dev",
    region: "asia-northeast3",
    service_names: ["donbeolja", "donbeolja-exit-worker"],
    scheduler_job_n: 0,
    ...(filePath ? { file: filePath } : {}),
    ...withReadinessArtifactProvenance(filePath, "v2_scheduler_traffic_collector_preflight_latest.json"),
  };
}

(function submitRequestRequiresMode() {
  let err = null;
  try {
    submit.__test.buildSubmitRequest({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_CLOUDBUILD_SUBMIT_MODE_REQUIRED");
})();

(function canaryFlowSubmitRequestCapturesDeterministicSubstitutions() {
  const request = submit.__test.buildSubmitRequest({
    GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
    V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
    V2_PROMOTION_MODE: "CANARY",
    V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__CANARY__01",
  });
  assert.strictEqual(request.project_id, "donbeolja-dev");
  assert.strictEqual(request.mode, "CANARY_FLOW");
  assert.strictEqual(request.position_cycle_id, "PCY__CANARY__01");
  assert.strictEqual(request.runbook_review_policy.required, true);
  assert.strictEqual(request.runbook_review_policy.strategy, "AUTO_BOUNDED_EXPLICIT");
  assert.strictEqual(request.approval_contract.required, true);
  assert.strictEqual(request.approval_contract.deploy_decision_approved_required, true);
  assert.strictEqual(request.approval_contract.bounded_runtime_summary_required, true);
  assert.strictEqual(request.approval_contract.lineage_contract_required, true);
  assert.strictEqual(request.approval_contract.lineage_hash_match_required, true);
  assert.strictEqual(request.approval_contract.evidence_snapshot_summary_required, true);
  assert.strictEqual(request.approval_contract.runtime_chain_audit_summary_required, true);
  assert.strictEqual(request.approval_contract.entry_boundary_audit_required, true);
  assert.strictEqual(request.approval_contract.fill_sync_canonical_boundary_audit_required, true);
  assert.strictEqual(request.approval_contract.production_runtime_chain_audit_required, true);
  assert.strictEqual(request.approval_contract.production_cutover_audit_required, true);
  assert.strictEqual(request.approval_contract.production_runtime_config_contract_required, true);
  assert.strictEqual(request.approval_contract.production_live_entry_sizing_contract_required, true);
  assert.strictEqual(request.approval_contract.openclaw_supreme_control_plane_closed_loop_required, false);
  assert.strictEqual(request.approval_contract.production_cutover_readiness_summary_required, false);
  assert.strictEqual(request.approval_contract.openclaw_execution_audit_ledger_write_required, true);
  assert.strictEqual(request.approval_contract.repair_firestore_canary_streak_required, false);
  assert.strictEqual(request.approval_contract.production_entry_route_canary_streak_required, false);
  assert.strictEqual(request.approval_contract.exit_runtime_canary_streak_required, false);
  assert.strictEqual(request.approval_contract.production_entry_protected_canary_required, true);
  assert.strictEqual(request.approval_contract.live_cutover_readiness_summary_required, false);
  assert.strictEqual(request.approval_contract.live_evidence_readiness_summary_required, false);
  assert.strictEqual(request.approval_contract.runbook_review_pass_required, true);
  assert.strictEqual(request.approval_contract.candidate_selection_ready_required, false);
  assert.strictEqual(request.approval_contract.selected_preflight_required, false);
  assert.strictEqual(request.approval_contract.blocker_free_required, true);
  assert.strictEqual(request.approval_contract.recommended_next_action_required, "PROCEED_WITH_SUBMIT_WRAPPER");
  assert.strictEqual(request.approval_evidence_sources.required, true);
  assert.strictEqual(request.approval_evidence_sources.deploy_decision.file, "promotion-deploy-decision.json");
  assert.strictEqual(request.approval_evidence_sources.runtime_chain_audit_summary.field, "bounded_runtime_summary.runtime_chain_audit_summary");
  assert.strictEqual(request.approval_evidence_sources.entry_boundary_audit.field, "entry_boundary_audit");
  assert.strictEqual(request.approval_evidence_sources.fill_sync_canonical_boundary_audit.field, "fill_sync_canonical_boundary_audit");
  assert.strictEqual(request.approval_evidence_sources.production_runtime_chain_audit.field, "production_runtime_chain_audit");
  assert.strictEqual(request.approval_evidence_sources.production_cutover_audit.field, "production_cutover_audit");
  assert.strictEqual(request.approval_evidence_sources.production_runtime_config_contract.field, "auditWorkspaceV2ProductionRuntimeConfigContract");
  assert.strictEqual(request.approval_evidence_sources.production_live_entry_sizing_contract.field, "production_cutover_audit.contract.checks");
  assert.strictEqual(request.approval_evidence_sources.openclaw_supreme_control_plane_closed_loop, null);
  assert.strictEqual(request.approval_evidence_sources.openclaw_execution_audit_ledger_write.field, "bounded_runtime_summary.openclaw_execution_audit_ledger_write");
  assert.strictEqual(request.approval_evidence_sources.repair_firestore_canary_streak, null);
  assert.strictEqual(request.approval_evidence_sources.production_entry_route_canary_streak, null);
  assert.strictEqual(request.approval_evidence_sources.exit_runtime_canary_streak, null);
  assert.strictEqual(request.approval_evidence_sources.production_entry_protected_canary.field, "bounded_runtime_summary.production_entry_protected_canary");
  assert.strictEqual(request.approval_evidence_sources.runbook_review.expected_value, "PASS");
  assert.strictEqual(request.approval_evidence_sources.resolved_artifact_dir.file, "promotion-cloudbuild-context.json");
  assert.strictEqual(request.approval_evidence_sources.resolved_artifact_dir.field, "artifact_dir,resolved_artifact_dir,artifact_dir_coherence,position_cycle_id");
  assert.strictEqual(request.approval_evidence_sources.lineage_hash_sources.length, 4);
  assert.strictEqual(request.approval_evidence_sources.lineage_hash_sources[3].field, "lineage_contract_hash");
  assert.strictEqual(request.substitutions._V2_PROMOTION_CANARY_FLOW_ENABLED, "1");
  assert.strictEqual(request.substitutions._V2_PROMOTION_SELECT_POSITION_CYCLE_ID, "PCY__CANARY__01");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_ENABLED, "0");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_DRY_RUN, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_CANARY_ONLY, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER, "0");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL, "0");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_COLLECTION_PREFIX, "v2__");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE, "OPENCLAW_CRON");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE, "FIRESTORE");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE, "FIRESTORE");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE, "1");
  assert.ok(request.command.includes("--substitutions"));
})();

(function autoSelectSubmitRequestCarriesAutoSelectAndExchangeStateSubstitutions() {
  const request = submit.__test.buildSubmitRequest({
    GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
    V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
    V2_PROMOTION_CANARY_AUTO_SELECT_ENABLED: "1",
    V2_PROMOTION_MODE: "CANARY",
    V2_PROMOTION_ARTIFACT_DIR: "tmp/v2-promotion-artifacts/canary_flow/auto-select-submit",
    V2_PROMOTION_CANDIDATE_EXCHANGE_STATE_JSON: "{\"has_active_position\":false}",
  });
  assert.strictEqual(request.mode, "CANARY_FLOW");
  assert.strictEqual(request.position_cycle_id, null);
  assert.strictEqual(request.runbook_review_policy.required, true);
  assert.strictEqual(request.runbook_review_policy.strategy, "AUTO_SELECT_RUNTIME_FINALIZE");
  assert.strictEqual(request.approval_contract.required, true);
  assert.strictEqual(request.approval_contract.resolved_artifact_dir_required, true);
  assert.strictEqual(request.approval_contract.lineage_contract_required, true);
  assert.strictEqual(request.approval_contract.lineage_hash_match_required, true);
  assert.strictEqual(request.approval_contract.runtime_chain_audit_summary_required, true);
  assert.strictEqual(request.approval_contract.runbook_review_pass_required, true);
  assert.strictEqual(request.approval_contract.entry_boundary_audit_required, true);
  assert.strictEqual(request.approval_contract.fill_sync_canonical_boundary_audit_required, true);
  assert.strictEqual(request.approval_contract.production_runtime_chain_audit_required, true);
  assert.strictEqual(request.approval_contract.production_cutover_audit_required, true);
  assert.strictEqual(request.approval_contract.production_runtime_config_contract_required, true);
  assert.strictEqual(request.approval_contract.production_live_entry_sizing_contract_required, true);
  assert.strictEqual(request.approval_contract.openclaw_supreme_control_plane_closed_loop_required, false);
  assert.strictEqual(request.approval_contract.production_cutover_readiness_summary_required, false);
  assert.strictEqual(request.approval_contract.openclaw_execution_audit_ledger_write_required, true);
  assert.strictEqual(request.approval_contract.repair_firestore_canary_streak_required, false);
  assert.strictEqual(request.approval_contract.production_entry_route_canary_streak_required, false);
  assert.strictEqual(request.approval_contract.production_entry_protected_canary_required, true);
  assert.strictEqual(request.approval_contract.live_cutover_readiness_summary_required, false);
  assert.strictEqual(request.approval_contract.candidate_selection_ready_required, true);
  assert.strictEqual(request.approval_contract.selected_preflight_required, true);
  assert.strictEqual(request.approval_evidence_sources.required, true);
  assert.strictEqual(request.approval_evidence_sources.candidate_selection.file, "promotion-deploy-decision.json");
  assert.strictEqual(request.approval_evidence_sources.candidate_selection.field, "candidate_selection_summary.selection_contract");
  assert.strictEqual(request.substitutions._V2_PROMOTION_CANARY_AUTO_SELECT_ENABLED, "1");
  assert.ok(typeof request.substitutions._COMMIT_SHA === "string");
  assert.ok(request.substitutions._COMMIT_SHA.length >= 7);
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_ENABLED, "0");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_DRY_RUN, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_CANARY_ONLY, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER, "0");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL, "0");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE, "FIRESTORE");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE, "FIRESTORE");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE, "1");
  assert.strictEqual(
    request.substitutions._V2_PROMOTION_CANDIDATE_EXCHANGE_STATE_JSON,
    "{\"has_active_position\":false}"
  );
})();

(function approvalVerificationRejectsIncompleteAutoSelectContractFlags() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-contract-incomplete-"));
  try {
    const artifactDir = path.join(dir, "PCY__AUTO__CONTRACT");
    fs.mkdirSync(artifactDir, { recursive: true });
    seedBoundedSubmitArtifacts(artifactDir, "PCY__AUTO__CONTRACT", { autoSelect: true });
    const request = submit.__test.buildSubmitRequest({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_CANARY_AUTO_SELECT_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
    });
    const brokenRequest = {
      ...request,
      approval_contract: {
        ...request.approval_contract,
        candidate_selection_ready_required: undefined,
      },
    };
    const verification = submit.__test.buildApprovalVerification(brokenRequest);
    assert.strictEqual(verification.ok, false);
    const contractCheck = verification.checks.find((row) => row.id === "SUBMIT_CHK_01");
    assert.ok(contractCheck);
    assert.strictEqual(contractCheck.ok, false);
    assert.ok(contractCheck.doc_refs.artifact_contract.includes("approval_contract.candidate_selection_ready_required"));
    assert.ok(contractCheck.doc_refs.artifact_contract.includes("approval_contract.selected_preflight_required"));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function approvalVerificationRejectsFalseArtifactDirSelfCheck() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-dir-self-check-"));
  try {
    const artifactDir = path.join(dir, "PCY__DIR__SELF_CHECK");
    fs.mkdirSync(artifactDir, { recursive: true });
    seedBoundedSubmitArtifacts(artifactDir, "PCY__DIR__SELF_CHECK");
    const contextFile = path.join(artifactDir, "promotion-cloudbuild-context.json");
    const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
    writeJson(contextFile, {
      ...context,
      artifact_dir_coherence: buildArtifactDirCoherenceFixture(artifactDir, "PCY__DIR__SELF_CHECK", {
        ok: false,
        reason: "ARTIFACT_DIR_RESOLVED_DIR_MISMATCH",
        artifact_dir_matches_resolved_artifact_dir: false,
      }),
    });
    const request = submit.__test.buildSubmitRequest({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__DIR__SELF_CHECK",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
    });
    const verification = submit.__test.buildApprovalVerification(request);
    assert.strictEqual(verification.ok, false);
    const dirCheck = verification.checks.find((row) => row.id === "SUBMIT_CHK_01A");
    assert.ok(dirCheck);
    assert.strictEqual(dirCheck.ok, false);
    assert.strictEqual(dirCheck.field, "artifact_dir,resolved_artifact_dir,artifact_dir_coherence,position_cycle_id");
    assert.strictEqual(dirCheck.reason, "request artifact dir, context self-check, resolved dir, or selected cycle is inconsistent");
    assert.ok(verification.blocker_summary.has_provenance_blocker);
    assert.strictEqual(verification.artifact_dir_coherence_summary.ok, false);
    assert.strictEqual(verification.artifact_dir_coherence_summary.reason, "ARTIFACT_DIR_RESOLVED_DIR_MISMATCH");
    assert.strictEqual(verification.artifact_dir_coherence_summary.artifact_dir_matches_resolved_artifact_dir, false);
    assert.strictEqual(verification.artifact_dir_coherence_summary.file, contextFile);
    const trace = submit.__test.buildSubmitTraceSummary(verification);
    assert.deepStrictEqual(trace.failed_submit_check_ids, ["SUBMIT_CHK_01A"]);
    assert.deepStrictEqual(trace.failed_runbook_checklist, ["1", "5", "9"]);
    assert.strictEqual(trace.primary_blocker_family, "PROVENANCE");
    assert.strictEqual(trace.artifact_dir_coherence_summary.ok, false);
    assert.strictEqual(trace.artifact_dir_coherence_summary.reason, "ARTIFACT_DIR_RESOLVED_DIR_MISMATCH");
    const summary = submit.__test.buildOperatorSummary({
      ok: false,
      output_file: path.join(artifactDir, "promotion-cloudbuild-submit-request.json"),
      request: {
        artifact_dir: artifactDir,
        submit_trace_summary: trace,
      },
    });
    assert.ok(summary.lines.includes("failed_submit_checks=SUBMIT_CHK_01A"));
    assert.ok(summary.lines.includes("runbook_checklist=1,5,9"));
    assert.ok(summary.lines.includes("artifact_dir_coherence=FAIL"));
    assert.ok(summary.lines.includes("artifact_dir_coherence_reason=ARTIFACT_DIR_RESOLVED_DIR_MISMATCH"));
    assert.ok(summary.lines.includes("artifact_dir_coherence_flags=dir_resolved:NO|dir_cycle:YES|resolved_cycle:YES|context_cycle:YES"));
    assert.ok(summary.lines.includes(`artifact_dir_coherence_file=${contextFile}`));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function approvalVerificationRejectsResolvedArtifactDirDrift() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-dir-drift-"));
  try {
    const artifactDir = path.join(dir, "PCY__DIR__DRIFT");
    fs.mkdirSync(artifactDir, { recursive: true });
    seedBoundedSubmitArtifacts(artifactDir, "PCY__DIR__DRIFT");
    const contextFile = path.join(artifactDir, "promotion-cloudbuild-context.json");
    const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
    writeJson(contextFile, {
      ...context,
      resolved_artifact_dir: path.join(dir, "PCY__OTHER__DRIFT"),
    });
    const request = submit.__test.buildSubmitRequest({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__DIR__DRIFT",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
    });
    const verification = submit.__test.buildApprovalVerification(request);
    assert.strictEqual(verification.ok, false);
    const dirCheck = verification.checks.find((row) => row.id === "SUBMIT_CHK_01A");
    assert.ok(dirCheck);
    assert.strictEqual(dirCheck.ok, false);
    assert.deepStrictEqual(dirCheck.doc_refs.runbook_checklist, ["1", "5", "9"]);
    assert.ok(verification.blocker_summary.has_provenance_blocker);
    assert.strictEqual(
      submit.__test.buildVerificationRecommendedAction(verification.blocker_summary),
      "DISCARD_ARTIFACT_DIR_AND_RERUN_FROM_PREFLIGHT"
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function approvalVerificationRejectsCloudbuildContextDeployDecisionSummaryDrift() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-context-deploy-drift-"));
  try {
    const artifactDir = path.join(dir, "PCY__CONTEXT_DEPLOY_DRIFT");
    fs.mkdirSync(artifactDir, { recursive: true });
    seedBoundedSubmitArtifacts(artifactDir, "PCY__CONTEXT_DEPLOY_DRIFT");
    const deployDecisionFile = path.join(artifactDir, "promotion-deploy-decision.json");
    const deployDecision = JSON.parse(fs.readFileSync(deployDecisionFile, "utf8"));
    writeJson(deployDecisionFile, {
      ...deployDecision,
      approved: false,
      decision: "HOLD",
      blockers: ["DEPLOY_DECISION:LIVE_STREAK_TEMPORAL_WINDOW_MISMATCH"],
    });
    const request = submit.__test.buildSubmitRequest({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__CONTEXT_DEPLOY_DRIFT",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
    });
    const verification = submit.__test.buildApprovalVerification(request);
    assert.strictEqual(verification.ok, false);
    const contextCheck = verification.checks.find((row) => row.id === "SUBMIT_CHK_07");
    assert.ok(contextCheck);
    assert.strictEqual(contextCheck.ok, false);
    assert.ok(contextCheck.reason.includes("cloudbuild deploy decision summary drifted from current deploy decision"));
    assert.ok(contextCheck.reason.includes("DEPLOY_DECISION:LIVE_STREAK_TEMPORAL_WINDOW_MISMATCH"));
    assert.strictEqual(verification.blocker_summary.has_live_evidence_cycle_blocker, true);
    const trace = submit.__test.buildSubmitTraceSummary(verification);
    assert.ok(trace.failed_submit_check_ids.includes("SUBMIT_CHK_07"));
    assert.ok(trace.blocker_families.includes("LIVE_EVIDENCE_CYCLE"));
    assert.strictEqual(trace.primary_blocker_family, "LIVE_EVIDENCE_CYCLE");
    assert.strictEqual(trace.recommended_next_action, "DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE");
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function liveSubmitRequestRequiresRepairFirestoreCanaryStreak() {
  const request = submit.__test.buildSubmitRequest({
    GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
    V2_PROMOTION_PIPELINE_ENABLED: "1",
    V2_PROMOTION_MODE: "LIVE",
    V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__LIVE__01",
    V2_PROMOTION_ARTIFACT_DIR: "tmp/v2-promotion-artifacts/live/PCY__LIVE__01",
  });
  assert.strictEqual(request.mode, "PIPELINE");
  assert.strictEqual(request.promotion_mode, "LIVE");
  assert.strictEqual(request.approval_contract.repair_firestore_canary_streak_required, true);
  assert.strictEqual(request.approval_contract.production_entry_route_canary_streak_required, true);
  assert.strictEqual(request.approval_contract.exit_runtime_canary_streak_required, true);
  assert.strictEqual(request.approval_contract.production_entry_protected_canary_required, true);
  assert.strictEqual(request.approval_contract.production_runtime_chain_audit_required, true);
  assert.strictEqual(request.approval_contract.openclaw_supreme_control_plane_closed_loop_required, true);
  assert.strictEqual(request.approval_contract.production_cutover_readiness_summary_required, true);
  assert.strictEqual(request.approval_contract.scheduler_traffic_cutover_readiness_summary_required, true);
  assert.strictEqual(request.approval_contract.production_runtime_config_contract_required, true);
  assert.strictEqual(request.approval_contract.live_cutover_readiness_summary_required, true);
  assert.strictEqual(request.approval_contract.live_evidence_readiness_summary_required, true);
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_ENABLED, "1");
  assert.ok(typeof request.substitutions._COMMIT_SHA === "string");
  assert.ok(request.substitutions._COMMIT_SHA.length >= 7);
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_DRY_RUN, "0");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_CANARY_ONLY, "0");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL, "0");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_COLLECTION_PREFIX, "v2__");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE, "OPENCLAW_CRON");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE, "FIRESTORE");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE, "FIRESTORE");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED, "1");
  assert.strictEqual(request.substitutions._V2_FIRESTORE_COST_GUARD_REQUIRE_BILLING_METRIC, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED, "0");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT, "8");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE, "6");
  assert.strictEqual(
    request.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP,
    "BTCUSDT:155|ETHUSDT:120|LINKUSDT:120|BNBUSDT:120|XRPUSDT:120|SOLUSDT:120|AXSUSDT:120|DOGEUSDT:120"
  );
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT, "5");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY, "UNLIMITED");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_RISK_MAX_TRADES_PER_DAY, "UNLIMITED");
  assert.strictEqual(
    request.approval_evidence_sources.repair_firestore_canary_streak.field,
    "bounded_runtime_summary.repair_firestore_canary_streak"
  );
  assert.strictEqual(
    request.approval_evidence_sources.production_entry_route_canary_streak.field,
    "bounded_runtime_summary.production_entry_route_canary_streak"
  );
  assert.strictEqual(
    request.approval_evidence_sources.exit_runtime_canary_streak.field,
    "bounded_runtime_summary.exit_runtime_canary_streak"
  );
  assert.strictEqual(
    request.approval_evidence_sources.openclaw_supreme_control_plane_closed_loop.field,
    "bounded_runtime_summary.openclaw_supreme_control_plane_summary"
  );
  assert.strictEqual(
    request.approval_evidence_sources.production_entry_protected_canary.field,
    "bounded_runtime_summary.production_entry_protected_canary"
  );
  assert.strictEqual(
    request.approval_evidence_sources.production_runtime_chain_audit.field,
    "production_runtime_chain_audit"
  );
  assert.strictEqual(
    request.approval_evidence_sources.production_runtime_config_contract.field,
    "auditWorkspaceV2ProductionRuntimeConfigContract"
  );
  assert.strictEqual(
    request.approval_evidence_sources.live_cutover_readiness_summary.field,
    "live_cutover_readiness_summary"
  );
  assert.strictEqual(
    request.approval_evidence_sources.live_evidence_readiness_summary.field,
    "live_evidence_readiness_summary"
  );
  assert.strictEqual(
    request.approval_evidence_sources.production_cutover_readiness_summary.field,
    "production_cutover_readiness_summary"
  );
  assert.strictEqual(
    request.approval_evidence_sources.scheduler_traffic_cutover_readiness_summary.field,
    "scheduler_traffic_cutover_readiness_summary"
  );
})();

(function liveSubmitForcesProductionCutoverSubstitutionsEvenWhenEnvIsUnsafe() {
  const request = submit.__test.buildSubmitRequest({
    GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
    V2_PROMOTION_PIPELINE_ENABLED: "1",
    V2_PROMOTION_MODE: "LIVE",
    V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__LIVE__UNSAFE_ENV",
    V2_PROMOTION_ARTIFACT_DIR: "tmp/v2-promotion-artifacts/live/PCY__LIVE__UNSAFE_ENV",
    DONBEOLJA_V2_ENABLED: "0",
    DONBEOLJA_V2_DRY_RUN: "1",
    DONBEOLJA_V2_CANARY_ONLY: "1",
    DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER: "0",
    DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL: "1",
    DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE: "LEGACY_CLOUD_SCHEDULER",
    DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "0",
    DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED: "0",
    DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED: "0",
    DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE: "JSONL",
    DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE: "0",
    DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED: "0",
    DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED: "0",
    DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE: "JSONL",
    DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE: "0",
  });
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_DRY_RUN, "0");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_CANARY_ONLY, "0");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL, "0");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE, "OPENCLAW_CRON");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE, "FIRESTORE");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE, "FIRESTORE");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED, "1");
})();

(function gateModeSubmitRequestDoesNotRequireBoundedApprovalContract() {
  const request = submit.__test.buildSubmitRequest({
    GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
    V2_PROMOTION_GATE_ENABLED: "1",
    V2_PROMOTION_MODE: "SHADOW",
    V2_PROMOTION_ARTIFACT_DIR: "tmp/v2-promotion-artifacts/gate/shadow-smoke",
  });
  assert.strictEqual(request.mode, "GATE");
  assert.strictEqual(request.approval_contract.required, false);
  assert.strictEqual(request.approval_contract.deploy_decision_approved_required, false);
  assert.strictEqual(request.approval_contract.lineage_contract_required, false);
  assert.strictEqual(request.approval_contract.lineage_hash_match_required, false);
  assert.strictEqual(request.approval_contract.evidence_snapshot_summary_required, false);
  assert.strictEqual(request.approval_contract.runtime_chain_audit_summary_required, false);
  assert.strictEqual(request.approval_contract.entry_boundary_audit_required, false);
  assert.strictEqual(request.approval_contract.fill_sync_canonical_boundary_audit_required, false);
  assert.strictEqual(request.approval_contract.production_runtime_chain_audit_required, false);
  assert.strictEqual(request.approval_contract.production_cutover_audit_required, false);
  assert.strictEqual(request.approval_contract.production_runtime_config_contract_required, false);
  assert.strictEqual(request.approval_contract.production_live_entry_sizing_contract_required, false);
  assert.strictEqual(request.approval_contract.openclaw_supreme_control_plane_closed_loop_required, false);
  assert.strictEqual(request.approval_contract.production_cutover_readiness_summary_required, false);
  assert.strictEqual(request.approval_contract.runbook_review_pass_required, false);
  assert.strictEqual(request.approval_evidence_sources.required, false);
})();

(function verificationSummaryMapsFailureFamiliesToActions() {
  const summary = submit.__test.buildVerificationSummary([
    { id: "SUBMIT_CHK_08", ok: false, reason: "lineage hashes are missing or mismatched" },
  ]);
  assert.strictEqual(summary.blocker_n, 1);
  assert.strictEqual(summary.has_provenance_blocker, true);
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedAction(summary),
    "DISCARD_ARTIFACT_DIR_AND_RERUN_FROM_PREFLIGHT"
  );
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedActionReason(summary),
    "bounded lineage or approval contract integrity failed"
  );
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedActionReasonCode(summary),
    "PROVENANCE_OR_CONTRACT_BLOCKER"
  );
})();

(function verificationSummaryMapsEntryBoundaryFailureToAction() {
  const summary = submit.__test.buildVerificationSummary([
    { id: "SUBMIT_CHK_13", ok: false, reason: "V2 entry boundary audit is missing or failed" },
  ]);
  assert.strictEqual(summary.blocker_n, 1);
  assert.strictEqual(summary.has_entry_boundary_blocker, true);
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedAction(summary),
    "FIX_V2_ENTRY_BOUNDARY_AND_RECHECK_DEPLOY_DECISION"
  );
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedActionReasonCode(summary),
    "ENTRY_BOUNDARY_BLOCKER"
  );
})();

(function verificationSummaryMapsFillSyncCanonicalBoundaryFailureToAction() {
  const summary = submit.__test.buildVerificationSummary([
    { id: "SUBMIT_CHK_18", ok: false, reason: "V2 fill sync canonical boundary audit is missing or failed" },
  ]);
  assert.strictEqual(summary.blocker_n, 1);
  assert.strictEqual(summary.has_fill_sync_canonical_boundary_blocker, true);
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedAction(summary),
    "FIX_V2_FILL_SYNC_CANONICAL_BOUNDARY_AND_RECHECK_DEPLOY_DECISION"
  );
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedActionReasonCode(summary),
    "FILL_SYNC_CANONICAL_BOUNDARY_BLOCKER"
  );
})();

(function verificationSummaryMapsProductionCutoverFailureToAction() {
  const summary = submit.__test.buildVerificationSummary([
    { id: "SUBMIT_CHK_14", ok: false, reason: "V2 production cutover audit is missing or failed" },
  ]);
  assert.strictEqual(summary.blocker_n, 1);
  assert.strictEqual(summary.has_production_cutover_blocker, true);
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedAction(summary),
    "FIX_V2_PRODUCTION_CUTOVER_AND_RECHECK_DEPLOY_DECISION"
  );
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedActionReasonCode(summary),
    "PRODUCTION_CUTOVER_BLOCKER"
  );
})();

(function verificationSummaryMapsProductionRuntimeConfigFailureToAction() {
  const summary = submit.__test.buildVerificationSummary([
    { id: "SUBMIT_CHK_22", ok: false, reason: "V2 production runtime config contract is missing or failed" },
  ]);
  assert.strictEqual(summary.blocker_n, 1);
  assert.strictEqual(summary.has_production_runtime_config_blocker, true);
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedAction(summary),
    "FIX_V2_PRODUCTION_RUNTIME_CONFIG_AND_RECHECK_SUBMIT"
  );
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedActionReasonCode(summary),
    "PRODUCTION_RUNTIME_CONFIG_BLOCKER"
  );
  assert.deepStrictEqual(submit.__test.buildSubmitTraceFamilies(summary), ["PRODUCTION_RUNTIME_CONFIG"]);
})();

(function verificationSummaryMapsProductionLiveEntrySizingFailureToAction() {
  const summary = submit.__test.buildVerificationSummary([
    { id: "SUBMIT_CHK_20", ok: false, reason: "V2 production live entry sizing contract is missing or failed" },
  ]);
  assert.strictEqual(summary.blocker_n, 1);
  assert.strictEqual(summary.has_production_live_entry_sizing_blocker, true);
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedAction(summary),
    "FIX_V2_PRODUCTION_LIVE_ENTRY_SIZING_CONTRACT_AND_RECHECK_DEPLOY_DECISION"
  );
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedActionReasonCode(summary),
    "PRODUCTION_LIVE_ENTRY_SIZING_CONTRACT_BLOCKER"
  );
  assert.deepStrictEqual(submit.__test.buildSubmitTraceFamilies(summary), ["ENTRY_SIZING"]);
})();

(function verificationSummaryMapsProtectedEntryCanaryFailureToAction() {
  const summary = submit.__test.buildVerificationSummary([
    { id: "SUBMIT_CHK_20A", ok: false, reason: "V2 production protected entry canary is missing or failed" },
  ]);
  assert.strictEqual(summary.blocker_n, 1);
  assert.strictEqual(summary.has_production_entry_protected_canary_blocker, true);
  assert.strictEqual(summary.has_bounded_runtime_blocker, true);
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedAction(summary),
    "FIX_V2_PROTECTED_ENTRY_CANARY_AND_RECHECK_DEPLOY_DECISION"
  );
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedActionReasonCode(summary),
    "PROTECTED_ENTRY_CANARY_BLOCKER"
  );
  assert.deepStrictEqual(submit.__test.buildSubmitTraceFamilies(summary), ["PROTECTED_ENTRY_CANARY", "BOUNDED_RUNTIME"]);
})();

(function verificationSummaryMapsStaleArtifactProvenanceFailureToAction() {
  const summary = submit.__test.buildVerificationSummary([
    { id: "SUBMIT_CHK_11", ok: false, reason: "LIVE repair Firestore canary streak evidence has stale artifact provenance" },
  ]);
  assert.strictEqual(summary.blocker_n, 1);
  assert.strictEqual(summary.has_stale_artifact_provenance_blocker, true);
  assert.strictEqual(summary.has_bounded_runtime_blocker, true);
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedAction(summary),
    "DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE"
  );
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedActionReasonCode(summary),
    "STALE_ARTIFACT_PROVENANCE_BLOCKER"
  );
  assert.deepStrictEqual(submit.__test.buildSubmitTraceFamilies(summary), ["STALE_ARTIFACT_PROVENANCE", "BOUNDED_RUNTIME"]);
})();

(function verificationSummarySeparatesSchedulerCollectorAndTrafficFailures() {
  const collectorSummary = submit.__test.buildVerificationSummary([
    { id: "SUBMIT_CHK_17", ok: false, reason: "collector preflight missing" },
  ]);
  assert.strictEqual(collectorSummary.blocker_n, 1);
  assert.strictEqual(collectorSummary.has_scheduler_collector_blocker, true);
  assert.strictEqual(collectorSummary.has_production_cutover_blocker, false);
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedAction(collectorSummary),
    "FIX_V2_SCHEDULER_COLLECTOR_IAM_AND_RERUN_LIVE_CLOUDBUILD_WRAPPER"
  );
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedActionReasonCode(collectorSummary),
    "SCHEDULER_COLLECTOR_BLOCKER"
  );
  assert.deepStrictEqual(submit.__test.buildSubmitTraceFamilies(collectorSummary), ["SCHEDULER_COLLECTOR"]);

  const trafficSummary = submit.__test.buildVerificationSummary([
    { id: "SUBMIT_CHK_16", ok: false, reason: "scheduler traffic readiness missing" },
  ]);
  assert.strictEqual(trafficSummary.has_scheduler_traffic_blocker, true);
  assert.strictEqual(trafficSummary.has_production_cutover_blocker, false);
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedAction(trafficSummary),
    "FIX_V2_SCHEDULER_TRAFFIC_CUTOVER_AND_RERUN_LIVE_CLOUDBUILD_WRAPPER"
  );
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedActionReasonCode(trafficSummary),
    "SCHEDULER_TRAFFIC_BLOCKER"
  );
  assert.deepStrictEqual(submit.__test.buildSubmitTraceFamilies(trafficSummary), ["SCHEDULER_TRAFFIC"]);
})();

(function submitTraceSummaryCompressesFailedChecksAndRunbookNumbers() {
  const summary = submit.__test.buildSubmitTraceSummary({
    required: true,
    ok: false,
    checks: [
      { id: "SUBMIT_CHK_03", ok: false, reason: "bounded runtime summary incomplete", file: "/tmp/deploy.json", field: "bounded_runtime_summary" },
      { id: "SUBMIT_CHK_08", ok: false, reason: "lineage consistency failed", file: "/tmp/context.json", field: "lineage_consistency_summary" },
    ],
    blocker_summary: {
      blocker_n: 2,
      has_provenance_blocker: true,
      has_bounded_runtime_blocker: true,
      has_runbook_blocker: false,
      has_context_blocker: false,
      has_candidate_selection_blocker: false,
    },
    recommended_next_action: "DISCARD_ARTIFACT_DIR_AND_RERUN_FROM_PREFLIGHT",
    recommended_next_action_reason: "bounded lineage or approval contract integrity failed",
  });
  assert.strictEqual(summary.required, true);
  assert.strictEqual(summary.ok, false);
  assert.deepStrictEqual(summary.failed_submit_check_ids, ["SUBMIT_CHK_03", "SUBMIT_CHK_08"]);
  assert.strictEqual(summary.failed_submit_check_details.length, 2);
  assert.deepStrictEqual(summary.failed_submit_check_details[0], {
    id: "SUBMIT_CHK_03",
    summary: "bounded runtime summary complete",
    runbook_checklist: ["8"],
    reason: "bounded runtime summary incomplete",
    file: "/tmp/deploy.json",
    field: "bounded_runtime_summary",
  });
  assert.deepStrictEqual(summary.failed_submit_check_details[1].runbook_checklist, ["16", "17"]);
  assert.strictEqual(summary.failed_submit_check_details[1].reason, "lineage consistency failed");
  assert.deepStrictEqual(summary.failed_runbook_checklist, ["8", "16", "17"]);
  assert.deepStrictEqual(summary.blocker_families, ["PROVENANCE", "BOUNDED_RUNTIME"]);
  assert.strictEqual(summary.primary_blocker_family, "PROVENANCE");
})();

(function submitTraceSummaryExpandsRunbookAggregateFailures() {
  const summary = submit.__test.buildSubmitTraceSummary({
    required: true,
    ok: false,
    checks: [
      { id: "SUBMIT_CHK_05", ok: false, reason: "runbook review must be PASS", file: "/tmp/promotion-runbook-review.json", field: "overall_status" },
    ],
    blocker_summary: {
      blocker_n: 1,
      has_runbook_blocker: true,
    },
    runbook_review_summary: {
      ok: false,
      overall_status: "FAIL",
      fail_n: 2,
      failed_check_ids: ["CHK_24B", "CHK_13E", "CHK_RUNBOOK_REVIEW_THROWN"],
      top_failed_checks: [
        { id: "CHK_24B", field: "artifact_generated_age_minutes" },
        { id: "CHK_13E", field: "submit_trace.blocker_families" },
      ],
    },
    recommended_next_action: "REVIEW_V2_CANARY_RUNBOOK_FAILURES",
    recommended_next_action_reason: "runbook review failed",
  });
  assert.deepStrictEqual(summary.failed_submit_check_ids, ["SUBMIT_CHK_05"]);
  assert.deepStrictEqual(summary.failed_runbook_checklist, ["13E", "24B"]);
  assert.strictEqual(summary.failed_submit_check_details.length, 1);
  assert.deepStrictEqual(summary.failed_submit_check_details[0].runbook_checklist, ["13E", "24B"]);
  assert.deepStrictEqual(submit.__test.collectRunbookReviewChecklist(summary.runbook_review_summary), ["13E", "24B"]);
})();

(function repairEvidenceSummaryRequiredIsBoundedRuntimeSubmitBlocker() {
  const summary = submit.__test.buildVerificationSummary([
    {
      id: "SUBMIT_CHK_07",
      ok: false,
      reason: "cloudbuild blocker count must be zero: DEPLOY_DECISION:REPAIR_EVIDENCE_SUMMARY_REQUIRED",
    },
  ]);
  assert.strictEqual(summary.has_bounded_runtime_blocker, true);
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedAction(summary),
    "REGENERATE_BOUNDED_RUNTIME_ARTIFACTS_AND_RECHECK_DEPLOY_DECISION"
  );
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedActionReasonCode(summary),
    "BOUNDED_RUNTIME_BLOCKER"
  );
  assert.deepStrictEqual(submit.__test.buildSubmitTraceFamilies(summary), ["BOUNDED_RUNTIME", "CONTEXT"]);
})();

(function lineageContractMismatchIsProvenanceSubmitBlocker() {
  const summary = submit.__test.buildVerificationSummary([
    {
      id: "SUBMIT_CHK_07",
      ok: false,
      reason: "cloudbuild blocker count must be zero: DEPLOY_DECISION:LINEAGE_CONTRACT_MISMATCH",
    },
  ]);
  assert.strictEqual(summary.has_provenance_blocker, true);
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedAction(summary),
    "DISCARD_ARTIFACT_DIR_AND_RERUN_FROM_PREFLIGHT"
  );
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedActionReasonCode(summary),
    "PROVENANCE_OR_CONTRACT_BLOCKER"
  );
  assert.deepStrictEqual(submit.__test.buildSubmitTraceFamilies(summary), ["PROVENANCE", "CONTEXT"]);
})();

(function runtimeChainAuditRequiredIsBoundedRuntimeSubmitBlocker() {
  const summary = submit.__test.buildVerificationSummary([
    {
      id: "SUBMIT_CHK_07",
      ok: false,
      reason: "cloudbuild blocker count must be zero: DEPLOY_DECISION:RUNTIME_CHAIN_AUDIT_REQUIRED",
    },
  ]);
  assert.strictEqual(summary.has_bounded_runtime_blocker, true);
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedAction(summary),
    "REGENERATE_BOUNDED_RUNTIME_ARTIFACTS_AND_RECHECK_DEPLOY_DECISION"
  );
  assert.strictEqual(
    submit.__test.buildVerificationRecommendedActionReasonCode(summary),
    "BOUNDED_RUNTIME_BLOCKER"
  );
  assert.deepStrictEqual(submit.__test.buildSubmitTraceFamilies(summary), ["BOUNDED_RUNTIME", "CONTEXT"]);
})();

(function cliResultPayloadExposesTopLevelSubmitTrace() {
  const payload = submit.__test.buildCliResultPayload({
    ok: false,
    reason: "V2_PROMOTION_CLOUDBUILD_SUBMIT_BLOCKED",
    output_file: "/tmp/fake-submit-request.json",
    request: {
      project_id: "donbeolja-dev",
      mode: "CANARY_FLOW",
      promotion_mode: "CANARY",
      position_cycle_id: "PCY__CLI__01",
      artifact_dir: "/tmp/v2/PCY__CLI__01",
      submit_enabled: false,
      operator_summary: {
        status: "BLOCKED",
        headline: "SUBMIT_BLOCKED | PROVENANCE | SUBMIT_CHK_08 | RUNBOOK:16,17",
        lines: [
          "SUBMIT_BLOCKED | PROVENANCE | SUBMIT_CHK_08 | RUNBOOK:16,17",
          "status=BLOCKED",
          "primary_blocker_family=PROVENANCE",
        ],
        text: [
          "SUBMIT_BLOCKED | PROVENANCE | SUBMIT_CHK_08 | RUNBOOK:16,17",
          "status=BLOCKED",
          "primary_blocker_family=PROVENANCE",
        ].join("\n"),
      },
      submit_trace_summary: {
        failed_submit_check_ids: ["SUBMIT_CHK_08"],
        failed_runbook_checklist: ["16", "17"],
        primary_blocker_family: "PROVENANCE",
        recommended_next_action_reason_code: "PROVENANCE_OR_CONTRACT_BLOCKER",
      },
      operator_delivery_summary: {
        status: "NOT_ATTEMPTED",
        send_enabled: false,
        transport_state: "NONE",
        lines: [
          "delivery_status=NOT_ATTEMPTED",
          "delivery_send_enabled=NO",
          "delivery_transport_state=NONE",
        ],
        text: [
          "delivery_status=NOT_ATTEMPTED",
          "delivery_send_enabled=NO",
          "delivery_transport_state=NONE",
        ].join("\n"),
      },
      approval_verification: {
        ok: false,
      },
    },
  });
  assert.strictEqual(payload.ok, false);
  assert.strictEqual(payload.reason, "V2_PROMOTION_CLOUDBUILD_SUBMIT_BLOCKED");
  assert.strictEqual(payload.operator_summary.status, "BLOCKED");
  assert.ok(payload.operator_summary.headline.includes("SUBMIT_BLOCKED"));
  assert.strictEqual(payload.operator_alert_preview.title, "V2 Promotion Submit Blocked");
  assert.strictEqual(payload.operator_alert_preview.summary_text, payload.operator_summary.text);
  assert.deepStrictEqual(payload.operator_alert_preview.sections[0].lines, payload.operator_summary.lines);
  assert.strictEqual(payload.operator_alert_delivery, null);
  assert.strictEqual(payload.operator_delivery_summary.status, "NOT_ATTEMPTED");
  assert.strictEqual(payload.operator_delivery_summary.send_enabled, false);
  assert.strictEqual(payload.operator_delivery_summary.transport_state, "NONE");
  assert.deepStrictEqual(payload.submit_trace_summary.failed_submit_check_ids, ["SUBMIT_CHK_08"]);
  assert.deepStrictEqual(payload.submit_trace_summary.failed_runbook_checklist, ["16", "17"]);
  assert.strictEqual(payload.submit_trace_summary.primary_blocker_family, "PROVENANCE");
  assert.strictEqual(payload.submit_trace_summary.recommended_next_action_reason_code, "PROVENANCE_OR_CONTRACT_BLOCKER");
  assert.strictEqual(payload.approval_verification.ok, false);
})();

(function operatorSummaryCompressesAlertFacingHeadline() {
  const summary = submit.__test.buildOperatorSummary({
    ok: false,
    reason: "V2_PROMOTION_CLOUDBUILD_SUBMIT_BLOCKED",
    output_file: "/tmp/fake-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__OPS__01",
      submit_trace_summary: {
        ok: false,
        primary_blocker_family: "PROVENANCE",
        failed_submit_check_ids: ["SUBMIT_CHK_08"],
        failed_submit_check_details: [{
          id: "SUBMIT_CHK_08",
          summary: "lineage hashes consistent across bounded artifacts",
          runbook_checklist: ["16", "17"],
          reason: "lineage consistency failed",
          file: "/tmp/v2/PCY__OPS__01/promotion-cloudbuild-context.json",
          field: "lineage_consistency_summary",
        }],
        failed_runbook_checklist: ["16", "17"],
        recommended_next_action: "DISCARD_ARTIFACT_DIR_AND_RERUN_FROM_PREFLIGHT",
        recommended_next_action_reason: "bounded lineage or approval contract integrity failed",
        recommended_next_action_reason_code: "PROVENANCE_OR_CONTRACT_BLOCKER",
      },
    },
  });
  assert.strictEqual(summary.status, "BLOCKED");
  assert.strictEqual(summary.primary_blocker_family, "PROVENANCE");
  assert.deepStrictEqual(summary.failed_submit_check_ids, ["SUBMIT_CHK_08"]);
  assert.deepStrictEqual(summary.failed_runbook_checklist, ["16", "17"]);
  assert.strictEqual(summary.recommended_next_action_reason_code, "PROVENANCE_OR_CONTRACT_BLOCKER");
  assert.ok(summary.headline.includes("SUBMIT_BLOCKED"));
  assert.ok(summary.headline.includes("RUNBOOK:16,17"));
  assert.ok(Array.isArray(summary.lines));
  assert.strictEqual(summary.text, summary.lines.join("\n"));
  assert.strictEqual(submit.__test.buildOperatorSummaryText(summary), summary.text);
  assert.ok(summary.lines.includes("status=BLOCKED"));
  assert.ok(summary.lines.includes("alert_retry_attention=NO"));
  assert.ok(summary.lines.includes("alert_runbook_refs=NONE"));
  assert.ok(summary.lines.includes("alert_failed=0"));
  assert.ok(summary.lines.includes("alert_pending=0"));
  assert.ok(summary.lines.includes("failed_submit_checks=SUBMIT_CHK_08"));
  assert.ok(summary.lines.includes("failed_submit_check_details=SUBMIT_CHK_08[lineage hashes consistent across bounded artifacts;RUNBOOK:16,17;reason:lineage consistency failed;file:/tmp/v2/PCY__OPS__01/promotion-cloudbuild-context.json;field:lineage_consistency_summary]"));
  assert.ok(summary.lines.includes("runbook_checklist=16,17"));
})();

(function operatorSummarySurfacesReadyWithAlertAttentionWithoutInventingBlocker() {
  const summary = submit.__test.buildOperatorSummary({
    ok: true,
    reason: "V2_PROMOTION_CLOUDBUILD_SUBMIT_REQUEST_READY",
    output_file: "/tmp/fake-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__OPS__ALERT",
      submit_trace_summary: {
        ok: true,
        primary_blocker_family: null,
        failed_submit_check_ids: [],
        failed_runbook_checklist: [],
        alert_retry_attention_required: true,
        alert_runbook_refs: ["ALERT_RBK_04"],
        alert_retry_summary: {
          failed_n: 1,
          pending_n: 2,
        },
        recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
        recommended_next_action_reason: "all bounded submit verification checks passed",
        recommended_next_action_reason_code: "ALL_CHECKS_PASSED",
      },
    },
  });
  assert.strictEqual(summary.status, "READY_WITH_ALERT_ATTENTION");
  assert.strictEqual(summary.primary_blocker_family, null);
  assert.strictEqual(summary.alert_retry_attention_required, true);
  assert.deepStrictEqual(summary.alert_runbook_refs, ["ALERT_RBK_04"]);
  assert.strictEqual(summary.alert_failed_n, 1);
  assert.strictEqual(summary.alert_pending_n, 2);
  assert.ok(summary.headline.includes("SUBMIT_READY_WITH_ALERT_ATTENTION"));
  assert.ok(summary.headline.includes("ALERT_ATTENTION"));
  assert.ok(summary.headline.includes("RUNBOOK:ALERT_RBK_04"));
  assert.ok(summary.lines.includes("status=READY_WITH_ALERT_ATTENTION"));
  assert.ok(summary.lines.includes("primary_blocker_family=NONE"));
  assert.ok(summary.lines.includes("alert_retry_attention=YES"));
  assert.ok(summary.lines.includes("alert_runbook_refs=ALERT_RBK_04"));
  assert.ok(summary.lines.includes("alert_failed=1"));
  assert.ok(summary.lines.includes("alert_pending=2"));
})();

(function verificationCheckCarriesRunbookAndContractRefs() {
  const check = submit.__test.withDocRefs(
    submit.__test.buildVerificationCheck({
      id: "SUBMIT_CHK_08",
      label: "lineage hashes consistent across bounded artifacts",
      ok: false,
      reason: "lineage hashes are missing or mismatched",
      file: "promotion-cloudbuild-context.json",
      field: "lineage_contract_hash",
    }),
    {
      runbookChecklist: ["16", "17"],
      artifactContract: [
        "approval_contract.lineage_hash_match_required",
        "approval_evidence_sources.lineage_hash_sources",
      ],
    }
  );
  assert.deepStrictEqual(check.doc_refs.runbook_checklist, ["16", "17"]);
  assert.deepStrictEqual(check.doc_refs.artifact_contract, [
    "approval_contract.lineage_hash_match_required",
    "approval_evidence_sources.lineage_hash_sources",
  ]);
})();

(function serializedSubstitutionsAreStable() {
  const text = submit.__test.serializeSubstitutions({
    _B: "2",
    _A: "1",
  });
  assert.strictEqual(text, "_A=1,_B=2");
})();

(function submitRequestArtifactIsWrittenInArtifactDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-request-"));
  try {
    const artifactDir = path.join(dir, "PCY__CANARY__ART");
    fs.mkdirSync(artifactDir, { recursive: true });
    seedBoundedSubmitArtifacts(artifactDir, "PCY__CANARY__ART");
    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__CANARY__ART",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
    });
    assert.strictEqual(result.reason, "V2_PROMOTION_CLOUDBUILD_SUBMIT_REQUEST_READY");
    assert.ok(fs.existsSync(result.output_file));
    const payload = JSON.parse(fs.readFileSync(result.output_file, "utf8"));
    assert.strictEqual(payload.project_id, "donbeolja-dev");
    assert.strictEqual(payload.position_cycle_id, "PCY__CANARY__ART");
    assert.strictEqual(payload.runbook_review_policy.strategy, "AUTO_BOUNDED_EXPLICIT");
    assert.strictEqual(payload.approval_contract.required, true);
    assert.strictEqual(payload.approval_contract.lineage_contract_required, true);
    assert.strictEqual(payload.approval_contract.lineage_hash_match_required, true);
    assert.strictEqual(payload.approval_contract.evidence_snapshot_summary_required, true);
    assert.strictEqual(payload.approval_contract.runtime_chain_audit_summary_required, true);
    assert.strictEqual(payload.approval_contract.entry_boundary_audit_required, true);
    assert.strictEqual(payload.approval_contract.fill_sync_canonical_boundary_audit_required, true);
    assert.strictEqual(payload.approval_contract.production_runtime_chain_audit_required, true);
    assert.strictEqual(payload.approval_contract.runbook_review_pass_required, true);
    assert.strictEqual(payload.approval_contract.production_runtime_config_contract_required, true);
    assert.strictEqual(payload.approval_evidence_sources.required, true);
    assert.strictEqual(payload.approval_evidence_sources.runtime_chain_audit_summary.field, "bounded_runtime_summary.runtime_chain_audit_summary");
    assert.strictEqual(payload.approval_evidence_sources.entry_boundary_audit.field, "entry_boundary_audit");
    assert.strictEqual(payload.approval_evidence_sources.fill_sync_canonical_boundary_audit.field, "fill_sync_canonical_boundary_audit");
    assert.strictEqual(payload.approval_evidence_sources.production_runtime_chain_audit.field, "production_runtime_chain_audit");
    assert.strictEqual(payload.approval_evidence_sources.production_runtime_config_contract.field, "auditWorkspaceV2ProductionRuntimeConfigContract");
    assert.strictEqual(payload.approval_evidence_sources.recommended_next_action.expected_value, "PROCEED_WITH_SUBMIT_WRAPPER");
    assert.strictEqual(payload.approval_verification.required, true);
    assert.strictEqual(payload.approval_verification.ok, true);
    assert.strictEqual(payload.approval_verification.fail_n, 0);
    assert.strictEqual(payload.approval_verification.blocker_summary.blocker_n, 0);
    assert.strictEqual(payload.approval_verification.recommended_next_action, "PROCEED_WITH_SUBMIT_WRAPPER");
    assert.strictEqual(payload.approval_verification.recommended_next_action_reason, "all bounded submit verification checks passed");
    assert.strictEqual(payload.approval_verification.recommended_next_action_reason_code, "ALL_CHECKS_PASSED");
    assert.strictEqual(payload.submit_trace_summary.required, true);
    assert.strictEqual(payload.submit_trace_summary.ok, true);
    assert.strictEqual(payload.submit_trace_summary.alert_retry_attention_required, false);
    assert.deepStrictEqual(payload.submit_trace_summary.alert_runbook_refs, []);
    assert.strictEqual(payload.submit_trace_summary.alert_retry_summary, null);
    assert.strictEqual(payload.operator_summary.status, "READY");
    assert.strictEqual(payload.operator_alert_preview.title, "V2 Promotion Submit Ready");
    assert.strictEqual(payload.operator_alert_preview.summary_text, payload.operator_summary.text);
    assert.deepStrictEqual(payload.operator_alert_preview.sections[0].lines, payload.operator_summary.lines);
    assert.strictEqual(payload.operator_alert_delivery.required, true);
    assert.strictEqual(payload.operator_alert_delivery.send_enabled, false);
    assert.strictEqual(payload.operator_alert_delivery.ok, true);
    assert.strictEqual(payload.operator_alert_delivery.reason, "V2_PROMOTION_OPERATOR_ALERT_READY");
    assert.strictEqual(payload.operator_alert_delivery.transport_result, null);
    assert.strictEqual(payload.operator_delivery_summary.status, "READY_NOT_SENT");
    assert.strictEqual(payload.operator_delivery_summary.send_enabled, false);
    assert.strictEqual(payload.operator_delivery_summary.transport_state, "NONE");
    assert.ok(payload.operator_delivery_summary.lines.includes("delivery_status=READY_NOT_SENT"));
    assert.ok(payload.operator_delivery_summary.lines.includes("delivery_send_enabled=NO"));
    assert.ok(payload.operator_delivery_summary.lines.includes(`output_file=${result.output_file}`));
    assert.ok(payload.operator_summary.headline.includes("SUBMIT_READY"));
    assert.strictEqual(payload.operator_summary.text, payload.operator_summary.lines.join("\n"));
    assert.ok(payload.operator_summary.lines.includes("status=READY"));
    assert.ok(payload.operator_summary.lines.includes("alert_retry_attention=NO"));
    assert.ok(payload.operator_summary.lines.includes("alert_runbook_refs=NONE"));
    assert.ok(payload.operator_summary.lines.includes("alert_failed=0"));
    assert.ok(payload.operator_summary.lines.includes("alert_pending=0"));
    assert.deepStrictEqual(payload.submit_trace_summary.failed_submit_check_ids, []);
    assert.deepStrictEqual(payload.submit_trace_summary.failed_runbook_checklist, []);
    assert.deepStrictEqual(payload.submit_trace_summary.blocker_families, []);
    assert.strictEqual(payload.submit_trace_summary.recommended_next_action_reason_code, "ALL_CHECKS_PASSED");
    const lineageCheck = payload.approval_verification.checks.find((row) => row.id === "SUBMIT_CHK_08");
    assert.ok(lineageCheck);
    assert.deepStrictEqual(lineageCheck.doc_refs.runbook_checklist, ["16", "17"]);
    const runtimeChainCheck = payload.approval_verification.checks.find((row) => row.id === "SUBMIT_CHK_04B");
    assert.ok(runtimeChainCheck);
    assert.strictEqual(runtimeChainCheck.ok, true);
    assert.deepStrictEqual(runtimeChainCheck.doc_refs.runbook_checklist, ["14A"]);
    const runtimeConfigCheck = payload.approval_verification.checks.find((row) => row.id === "SUBMIT_CHK_22");
    assert.ok(runtimeConfigCheck);
    assert.strictEqual(runtimeConfigCheck.ok, true);
    assert.deepStrictEqual(runtimeConfigCheck.doc_refs.runbook_checklist, ["29"]);
    assert.strictEqual(payload.approval_verification.production_runtime_config_summary.ok, true);
    assert.strictEqual(payload.submit_trace_summary.production_runtime_config_summary.ok, true);
    assert.strictEqual(payload.submit_enabled, false);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function submitRequestBlocksWhenProductionRuntimeConfigContractFails() {
  const originalAudit = productionRuntimeConfigAudit.auditWorkspaceV2ProductionRuntimeConfigContract;
  productionRuntimeConfigAudit.auditWorkspaceV2ProductionRuntimeConfigContract = () => ({
    ok: false,
    reason: "V2_PRODUCTION_RUNTIME_CONFIG_CONTRACT_BLOCKED",
    check_n: 2,
    fail_n: 1,
    failed_check_ids: ["CLOUDBUILD_PROMOTION_RUNTIME_FORWARDS_V2_CUTOVER_ENV"],
    checks: [
      { id: "CLOUDBUILD_PROMOTION_RUNTIME_FORWARDS_V2_CUTOVER_ENV", ok: false },
    ],
  });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-request-runtime-config-blocked-"));
  try {
    const artifactDir = path.join(dir, "PCY__CANARY__RUNTIME_CONFIG_BLOCKED");
    fs.mkdirSync(artifactDir, { recursive: true });
    seedBoundedSubmitArtifacts(artifactDir, "PCY__CANARY__RUNTIME_CONFIG_BLOCKED");

    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__CANARY__RUNTIME_CONFIG_BLOCKED",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "V2_PROMOTION_CLOUDBUILD_SUBMIT_BLOCKED");
    const runtimeConfigCheck = result.request.approval_verification.checks.find((row) => row.id === "SUBMIT_CHK_22");
    assert.ok(runtimeConfigCheck);
    assert.strictEqual(runtimeConfigCheck.ok, false);
    assert.deepStrictEqual(runtimeConfigCheck.doc_refs.runbook_checklist, ["29"]);
    assert.strictEqual(result.request.approval_verification.production_runtime_config_summary.ok, false);
    assert.deepStrictEqual(
      result.request.approval_verification.production_runtime_config_summary.failed_check_ids,
      ["CLOUDBUILD_PROMOTION_RUNTIME_FORWARDS_V2_CUTOVER_ENV"]
    );
    assert.strictEqual(result.request.approval_verification.blocker_summary.has_production_runtime_config_blocker, true);
    assert.deepStrictEqual(result.request.submit_trace_summary.failed_submit_check_ids, ["SUBMIT_CHK_22"]);
    assert.deepStrictEqual(result.request.submit_trace_summary.failed_runbook_checklist, ["29"]);
    assert.deepStrictEqual(result.request.submit_trace_summary.blocker_families, ["PRODUCTION_RUNTIME_CONFIG"]);
    assert.strictEqual(result.request.submit_trace_summary.primary_blocker_family, "PRODUCTION_RUNTIME_CONFIG");
    assert.strictEqual(
      result.request.approval_verification.recommended_next_action,
      "FIX_V2_PRODUCTION_RUNTIME_CONFIG_AND_RECHECK_SUBMIT"
    );
    assert.strictEqual(
      result.request.approval_verification.recommended_next_action_reason_code,
      "PRODUCTION_RUNTIME_CONFIG_BLOCKER"
    );
  } finally {
    productionRuntimeConfigAudit.auditWorkspaceV2ProductionRuntimeConfigContract = originalAudit;
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function submitRequestBlocksWhenRuntimeChainAuditIsMissing() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-request-runtime-chain-blocked-"));
  try {
    const artifactDir = path.join(dir, "PCY__CANARY__RUNTIME_CHAIN_BLOCKED");
    fs.mkdirSync(artifactDir, { recursive: true });
    seedBoundedSubmitArtifacts(artifactDir, "PCY__CANARY__RUNTIME_CHAIN_BLOCKED");
    const deployDecisionPath = path.join(artifactDir, "promotion-deploy-decision.json");
    const deployDecision = JSON.parse(fs.readFileSync(deployDecisionPath, "utf8"));
    delete deployDecision.bounded_runtime_summary.runtime_chain_audit_summary;
    writeJson(deployDecisionPath, deployDecision);

    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__CANARY__RUNTIME_CHAIN_BLOCKED",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "V2_PROMOTION_CLOUDBUILD_SUBMIT_BLOCKED");
    const runtimeChainCheck = result.request.approval_verification.checks.find((row) => row.id === "SUBMIT_CHK_04B");
    assert.ok(runtimeChainCheck);
    assert.strictEqual(runtimeChainCheck.ok, false);
    assert.deepStrictEqual(runtimeChainCheck.doc_refs.runbook_checklist, ["14A"]);
    assert.strictEqual(result.request.approval_verification.blocker_summary.has_bounded_runtime_blocker, true);
    assert.deepStrictEqual(result.request.submit_trace_summary.failed_submit_check_ids, ["SUBMIT_CHK_04B"]);
    assert.deepStrictEqual(result.request.submit_trace_summary.failed_runbook_checklist, ["14A"]);
    assert.strictEqual(
      result.request.approval_verification.recommended_next_action,
      "REGENERATE_BOUNDED_RUNTIME_ARTIFACTS_AND_RECHECK_DEPLOY_DECISION"
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function submitRequestBlocksWhenProductionLiveEntrySizingContractIsMissing() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-request-live-sizing-blocked-"));
  try {
    const artifactDir = path.join(dir, "PCY__CANARY__LIVE_SIZING_BLOCKED");
    fs.mkdirSync(artifactDir, { recursive: true });
    seedBoundedSubmitArtifacts(artifactDir, "PCY__CANARY__LIVE_SIZING_BLOCKED");
    const deployDecisionPath = path.join(artifactDir, "promotion-deploy-decision.json");
    const deployDecision = JSON.parse(fs.readFileSync(deployDecisionPath, "utf8"));
    deployDecision.production_cutover_audit.contract.checks =
      deployDecision.production_cutover_audit.contract.checks.filter((row) => (
        row.id !== "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_REQUIRE_APPROVED_SIZING"
      ));
    writeJson(deployDecisionPath, deployDecision);

    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__CANARY__LIVE_SIZING_BLOCKED",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
    });
    assert.strictEqual(result.ok, false);
    const sizingCheck = result.request.approval_verification.checks.find((row) => row.id === "SUBMIT_CHK_20");
    assert.ok(sizingCheck);
    assert.strictEqual(sizingCheck.ok, false);
    assert.deepStrictEqual(sizingCheck.doc_refs.runbook_checklist, ["27"]);
    assert.strictEqual(result.request.approval_verification.blocker_summary.has_production_live_entry_sizing_blocker, true);
    assert.deepStrictEqual(result.request.submit_trace_summary.failed_submit_check_ids, ["SUBMIT_CHK_20"]);
    assert.deepStrictEqual(result.request.submit_trace_summary.failed_runbook_checklist, ["27"]);
    assert.deepStrictEqual(result.request.submit_trace_summary.blocker_families, ["ENTRY_SIZING"]);
    assert.strictEqual(
      result.request.approval_verification.recommended_next_action,
      "FIX_V2_PRODUCTION_LIVE_ENTRY_SIZING_CONTRACT_AND_RECHECK_DEPLOY_DECISION"
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function submitRequestBlocksWhenProtectedEntryCanaryIsMissing() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-request-protected-canary-blocked-"));
  try {
    const artifactDir = path.join(dir, "PCY__CANARY__PROTECTED_CANARY_BLOCKED");
    fs.mkdirSync(artifactDir, { recursive: true });
    seedBoundedSubmitArtifacts(artifactDir, "PCY__CANARY__PROTECTED_CANARY_BLOCKED");
    const deployDecisionPath = path.join(artifactDir, "promotion-deploy-decision.json");
    const deployDecision = JSON.parse(fs.readFileSync(deployDecisionPath, "utf8"));
    delete deployDecision.bounded_runtime_summary.production_entry_protected_canary;
    writeJson(deployDecisionPath, deployDecision);

    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__CANARY__PROTECTED_CANARY_BLOCKED",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
    });
    assert.strictEqual(result.ok, false);
    const protectedCanaryCheck = result.request.approval_verification.checks.find((row) => row.id === "SUBMIT_CHK_20A");
    assert.ok(protectedCanaryCheck);
    assert.strictEqual(protectedCanaryCheck.ok, false);
    assert.deepStrictEqual(protectedCanaryCheck.doc_refs.runbook_checklist, ["27A"]);
    assert.strictEqual(result.request.approval_verification.blocker_summary.has_production_entry_protected_canary_blocker, true);
    assert.deepStrictEqual(result.request.submit_trace_summary.failed_submit_check_ids, ["SUBMIT_CHK_20A"]);
    assert.deepStrictEqual(result.request.submit_trace_summary.failed_runbook_checklist, ["27A"]);
    assert.deepStrictEqual(result.request.submit_trace_summary.blocker_families, ["PROTECTED_ENTRY_CANARY", "BOUNDED_RUNTIME"]);
    assert.strictEqual(result.request.submit_trace_summary.primary_blocker_family, "PROTECTED_ENTRY_CANARY");
    assert.strictEqual(result.request.operator_summary.primary_blocker_family, "PROTECTED_ENTRY_CANARY");
    assert.ok(result.request.operator_summary.lines.includes("protected_entry_canary_blocker=YES"));
    assert.strictEqual(
      result.request.approval_verification.recommended_next_action,
      "FIX_V2_PROTECTED_ENTRY_CANARY_AND_RECHECK_DEPLOY_DECISION"
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function submitRequestClassifiesStaleProtectedEntryCanaryFreshnessAsStaleArtifact() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-request-protected-canary-stale-freshness-"));
  try {
    const artifactDir = path.join(dir, "PCY__CANARY__PROTECTED_CANARY_STALE_FRESHNESS");
    fs.mkdirSync(artifactDir, { recursive: true });
    seedBoundedSubmitArtifacts(artifactDir, "PCY__CANARY__PROTECTED_CANARY_STALE_FRESHNESS");
    const deployDecisionPath = path.join(artifactDir, "promotion-deploy-decision.json");
    const deployDecision = JSON.parse(fs.readFileSync(deployDecisionPath, "utf8"));
    deployDecision.mode = "CANARY";
    deployDecision.bounded_runtime_summary.production_entry_protected_canary.artifact_generated_age_minutes =
      deployDecisionCheck.__test.MAX_PROTECTED_CANARY_ARTIFACT_AGE_MINUTES + 1;
    writeJson(deployDecisionPath, deployDecision);

    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__CANARY__PROTECTED_CANARY_STALE_FRESHNESS",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
    });
    assert.strictEqual(result.ok, false);
    const protectedCanaryCheck = result.request.approval_verification.checks.find((row) => row.id === "SUBMIT_CHK_20A");
    assert.ok(protectedCanaryCheck);
    assert.strictEqual(protectedCanaryCheck.ok, false);
    assert.strictEqual(protectedCanaryCheck.reason, "production entry protected canary evidence has stale artifact provenance");
    assert.deepStrictEqual(protectedCanaryCheck.doc_refs.runbook_checklist, ["27A"]);
    assert.strictEqual(result.request.approval_verification.blocker_summary.has_stale_artifact_provenance_blocker, true);
    assert.strictEqual(result.request.approval_verification.blocker_summary.has_production_entry_protected_canary_blocker, true);
    assert.deepStrictEqual(result.request.submit_trace_summary.failed_submit_check_ids, ["SUBMIT_CHK_20A"]);
    assert.deepStrictEqual(result.request.submit_trace_summary.failed_runbook_checklist, ["27A"]);
    assert.deepStrictEqual(result.request.submit_trace_summary.blocker_families, [
      "STALE_ARTIFACT_PROVENANCE",
      "PROTECTED_ENTRY_CANARY",
      "BOUNDED_RUNTIME",
    ]);
    assert.strictEqual(result.request.submit_trace_summary.primary_blocker_family, "STALE_ARTIFACT_PROVENANCE");
    assert.strictEqual(
      result.request.approval_verification.recommended_next_action,
      "DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE"
    );
    assert.strictEqual(
      result.request.approval_verification.recommended_next_action_reason_code,
      "STALE_ARTIFACT_PROVENANCE_BLOCKER"
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function submitRequestClassifiesLiveEvidenceCycleMismatchSeparately() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-request-live-evidence-cycle-"));
  try {
    const artifactDir = path.join(dir, "PCY__CANARY__LIVE_EVIDENCE_CYCLE");
    fs.mkdirSync(artifactDir, { recursive: true });
    seedBoundedSubmitArtifacts(artifactDir, "PCY__CANARY__LIVE_EVIDENCE_CYCLE");
    const blocker = "DEPLOY_DECISION:LIVE_STREAK_POSITION_CYCLE_MISMATCH";
    const deployDecisionPath = path.join(artifactDir, "promotion-deploy-decision.json");
    const deployDecision = JSON.parse(fs.readFileSync(deployDecisionPath, "utf8"));
    deployDecision.approved = false;
    deployDecision.decision = "HOLD";
    deployDecision.blockers = [blocker];
    writeJson(deployDecisionPath, deployDecision);

    const cloudbuildContextPath = path.join(artifactDir, "promotion-cloudbuild-context.json");
    const cloudbuildContext = JSON.parse(fs.readFileSync(cloudbuildContextPath, "utf8"));
    cloudbuildContext.final_status_line = `HOLD ; cycle=PCY__CANARY__LIVE_EVIDENCE_CYCLE ; blockers=1 ; warnings=0 ; live_evidence_cycle=BLOCKED ; top=${blocker}`;
    cloudbuildContext.recommended_next_action = "DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE";
    cloudbuildContext.recommended_next_action_reason = "LIVE evidence cycle blocker detected; all LIVE evidence must come from the same selected position cycle";
    cloudbuildContext.recommended_next_action_reason_code = "LIVE_EVIDENCE_CYCLE_BLOCKER";
    cloudbuildContext.deploy_decision_summary.blocker_summary = {
      blocker_n: 1,
      top_blockers: [blocker],
      has_provenance_blocker: false,
      has_stale_artifact_provenance_blocker: false,
      has_live_evidence_cycle_blocker: true,
      has_candidate_selection_blocker: false,
      has_bounded_runtime_blocker: false,
      has_production_entry_protected_canary_blocker: false,
    };
    writeJson(cloudbuildContextPath, cloudbuildContext);

    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__CANARY__LIVE_EVIDENCE_CYCLE",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "V2_PROMOTION_CLOUDBUILD_SUBMIT_BLOCKED");
    assert.strictEqual(result.request.approval_verification.blocker_summary.has_live_evidence_cycle_blocker, true);
    assert.deepStrictEqual(result.request.submit_trace_summary.blocker_families, ["LIVE_EVIDENCE_CYCLE", "CONTEXT"]);
    assert.strictEqual(result.request.submit_trace_summary.primary_blocker_family, "LIVE_EVIDENCE_CYCLE");
    assert.strictEqual(
      result.request.submit_trace_summary.recommended_next_action,
      "DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE"
    );
    assert.strictEqual(
      result.request.submit_trace_summary.recommended_next_action_reason_code,
      "LIVE_EVIDENCE_CYCLE_BLOCKER"
    );
    assert.ok(result.request.operator_summary.lines.includes("live_evidence_cycle_blocker=YES"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("live_evidence_cycle_blocker=YES"));
    const blockerCountCheck = result.request.approval_verification.checks.find((row) => row.id === "SUBMIT_CHK_07");
    assert.ok(blockerCountCheck);
    assert.strictEqual(blockerCountCheck.ok, false);
    assert.ok(blockerCountCheck.reason.includes(blocker));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function submitRequestSurfacesCanaryDeployWarningsToOperatorSummary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-request-warning-"));
  try {
    const artifactDir = path.join(dir, "PCY__CANARY__WARNING");
    fs.mkdirSync(artifactDir, { recursive: true });
    seedBoundedSubmitArtifacts(artifactDir, "PCY__CANARY__WARNING", {
      deployWarnings: ["DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"],
    });
    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__CANARY__WARNING",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
    });
    assert.strictEqual(result.reason, "V2_PROMOTION_CLOUDBUILD_SUBMIT_REQUEST_READY");
    assert.strictEqual(result.request.submit_trace_summary.deploy_warning_attention_required, true);
    assert.deepStrictEqual(result.request.submit_trace_summary.deploy_warning_runbook_checklist, ["19"]);
    assert.strictEqual(result.request.operator_summary.status, "READY_WITH_DEPLOY_WARNING");
    assert.ok(result.request.operator_summary.headline.includes("DEPLOY_WARNING"));
    assert.ok(result.request.operator_summary.headline.includes("RUNBOOK:19"));
    assert.ok(result.request.operator_summary.lines.includes("deploy_warning_attention=YES"));
    assert.ok(result.request.operator_summary.lines.includes("deploy_warning_count=1"));
    assert.ok(result.request.operator_summary.lines.includes("deploy_warning_runbook=19"));
    assert.ok(result.request.operator_summary.lines.includes("deploy_top_warnings=DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"));
    assert.strictEqual(result.request.operator_alert_preview.severity, "WARN");
    assert.strictEqual(result.request.operator_alert_preview.title, "V2 Promotion Submit Ready With Deploy Warning");
    assert.ok(fs.existsSync(result.output_file));
    const stored = JSON.parse(fs.readFileSync(result.output_file, "utf8"));
    assert.strictEqual(stored.submit_trace_summary.deploy_warning_attention_required, true);
    assert.deepStrictEqual(stored.submit_trace_summary.deploy_warning_runbook_checklist, ["19"]);
    assert.strictEqual(stored.operator_summary.status, "READY_WITH_DEPLOY_WARNING");
    assert.strictEqual(stored.operator_alert_preview.title, "V2 Promotion Submit Ready With Deploy Warning");
    assert.strictEqual(stored.operator_alert_preview.summary_text, stored.operator_summary.text);
    assert.deepStrictEqual(stored.operator_alert_preview.sections[0].lines, stored.operator_summary.lines);
    assert.ok(stored.operator_alert_preview.sections[1].lines.includes("deploy_warning_attention=YES"));
    assert.ok(stored.operator_alert_preview.sections[1].lines.includes("deploy_warning_runbook=19"));
    assert.ok(stored.operator_alert_preview.sections[1].lines.includes("deploy_top_warnings=DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"));
    const rendered = renderer.renderAlert({
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
    });
    assert.strictEqual(rendered.preview.title, "V2 Promotion Submit Ready With Deploy Warning");
    assert.strictEqual(rendered.preview.summary_text, stored.operator_summary.text);
    assert.strictEqual(rendered.telegram_args.severity, "WARN");
    assert.strictEqual(rendered.telegram_args.title, "V2 Promotion Submit Ready With Deploy Warning");
    const cliPayload = submit.__test.buildCliResultPayload(result);
    assert.strictEqual(cliPayload.operator_summary.status, "READY_WITH_DEPLOY_WARNING");
    assert.strictEqual(cliPayload.operator_alert_preview.title, "V2 Promotion Submit Ready With Deploy Warning");
    assert.strictEqual(cliPayload.submit_trace_summary.deploy_warning_attention_required, true);
    assert.deepStrictEqual(cliPayload.submit_trace_summary.deploy_warning_runbook_checklist, ["19"]);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function submitRequestMapsProductionRouteCanaryDeployWarningsToRunbook26() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-request-prod-warning-"));
  try {
    const artifactDir = path.join(dir, "PCY__CANARY__PROD_WARNING");
    fs.mkdirSync(artifactDir, { recursive: true });
    seedBoundedSubmitArtifacts(artifactDir, "PCY__CANARY__PROD_WARNING", {
      deployWarnings: ["DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"],
    });
    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__CANARY__PROD_WARNING",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
    });
    assert.strictEqual(result.reason, "V2_PROMOTION_CLOUDBUILD_SUBMIT_REQUEST_READY");
    assert.strictEqual(result.request.submit_trace_summary.deploy_warning_attention_required, true);
    assert.deepStrictEqual(result.request.submit_trace_summary.deploy_warning_runbook_checklist, ["26"]);
    assert.strictEqual(result.request.submit_trace_summary.deploy_warning_summary.has_live_readiness_warning, true);
    assert.strictEqual(result.request.submit_trace_summary.deploy_warning_summary.has_repair_firestore_canary_streak_warning, false);
    assert.strictEqual(result.request.submit_trace_summary.deploy_warning_summary.has_production_entry_route_canary_streak_warning, true);
    assert.strictEqual(result.request.operator_summary.status, "READY_WITH_DEPLOY_WARNING");
    assert.ok(result.request.operator_summary.headline.includes("RUNBOOK:26"));
    assert.ok(result.request.operator_summary.lines.includes("deploy_warning_runbook=26"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("deploy_warning_runbook=26"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("deploy_top_warnings=DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function submitRequestSurfacesLiveCutoverReadinessToOperatorSummaryAndAlert() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-request-live-cutover-"));
  try {
    const artifactDir = path.join(dir, "PCY__LIVE__CUTOVER");
    fs.mkdirSync(artifactDir, { recursive: true });
    const cutoverFile = path.join(artifactDir, "v2_repair_live_cutover_readiness_latest.json");
    const productionCutoverFile = path.join(artifactDir, "v2_production_cutover_readiness_latest.json");
    const schedulerTrafficCollectorPreflightFile = path.join(artifactDir, "v2_scheduler_traffic_collector_preflight_latest.json");
    const schedulerTrafficCutoverFile = path.join(artifactDir, "v2_scheduler_traffic_cutover_readiness_latest.json");
    seedBoundedSubmitArtifacts(artifactDir, "PCY__LIVE__CUTOVER", {
      liveCutoverReadinessSummary: buildLiveCutoverReadinessSummaryFixture(cutoverFile),
      productionCutoverReadinessSummary: buildProductionCutoverReadinessSummaryFixture(productionCutoverFile),
      schedulerTrafficCollectorPreflightSummary: buildSchedulerTrafficCollectorPreflightSummaryFixture(schedulerTrafficCollectorPreflightFile),
      schedulerTrafficCutoverReadinessSummary: buildSchedulerTrafficCutoverReadinessSummaryFixture(schedulerTrafficCutoverFile),
    });
    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "LIVE",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__LIVE__CUTOVER",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
    });
    assert.strictEqual(result.reason, "V2_PROMOTION_CLOUDBUILD_SUBMIT_REQUEST_READY");
    assert.strictEqual(result.request.submit_trace_summary.live_cutover_readiness_summary.ok, true);
    assert.strictEqual(result.request.submit_trace_summary.live_evidence_readiness_summary.ok, true);
    assert.deepStrictEqual(result.request.submit_trace_summary.live_evidence_readiness_summary.failed_axis_ids, []);
    assert.strictEqual(result.request.submit_trace_summary.live_cutover_readiness_summary.auto_apply, false);
    assert.strictEqual(result.request.submit_trace_summary.live_cutover_readiness_summary.mutates_environment, false);
    assert.strictEqual(result.request.submit_trace_summary.live_cutover_readiness_summary.required_env_change_n, 4);
    assert.strictEqual(result.request.submit_trace_summary.production_cutover_readiness_summary.ok, true);
    assert.strictEqual(result.request.submit_trace_summary.production_cutover_readiness_summary.legacy_webhook_blocked, true);
    assert.strictEqual(result.request.submit_trace_summary.scheduler_traffic_collector_preflight_summary.ok, true);
    assert.strictEqual(result.request.submit_trace_summary.scheduler_traffic_collector_preflight_summary.project_id, "donbeolja-dev");
    assert.strictEqual(result.request.submit_trace_summary.scheduler_traffic_cutover_readiness_summary.ok, true);
    assert.strictEqual(result.request.submit_trace_summary.scheduler_traffic_cutover_readiness_summary.scheduler_sot, "OPENCLAW_CRON");
    assert.ok(result.request.operator_summary.lines.includes("live_cutover_ready=YES"));
    assert.ok(result.request.operator_summary.lines.includes("live_evidence_ready=YES"));
    assert.ok(result.request.operator_summary.lines.includes("live_evidence_failed_axes=NONE"));
    assert.ok(result.request.operator_summary.lines.includes("live_evidence_submit_checks=NONE"));
    assert.ok(result.request.operator_summary.lines.includes("live_evidence_runbook=NONE"));
    assert.ok(result.request.operator_summary.lines.includes(`live_evidence_file=${path.join(artifactDir, "v2_live_evidence_readiness_latest.json")}`));
    assert.ok(result.request.operator_summary.lines.includes("live_cutover_auto_apply=NO"));
    assert.ok(result.request.operator_summary.lines.includes("live_cutover_mutates_env=NO"));
    assert.ok(result.request.operator_summary.lines.includes("live_cutover_env_changes=4"));
    assert.ok(result.request.operator_summary.lines.includes(`live_cutover_file=${cutoverFile}`));
    assert.ok(result.request.operator_summary.lines.includes("production_cutover_ready=YES"));
    assert.ok(result.request.operator_summary.lines.includes("production_cutover_legacy_blocked=YES"));
    assert.ok(result.request.operator_summary.lines.includes("production_cutover_guard_reason=V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED"));
    assert.ok(result.request.operator_summary.lines.includes(`production_cutover_file=${productionCutoverFile}`));
    assert.ok(result.request.operator_summary.lines.includes("scheduler_collector_preflight=YES"));
    assert.ok(result.request.operator_summary.lines.includes("scheduler_collector_project=donbeolja-dev"));
    assert.ok(result.request.operator_summary.lines.includes(`scheduler_collector_file=${schedulerTrafficCollectorPreflightFile}`));
    assert.ok(result.request.operator_summary.lines.includes("scheduler_traffic_ready=YES"));
    assert.ok(result.request.operator_summary.lines.includes("scheduler_traffic_sot=OPENCLAW_CRON"));
    assert.ok(result.request.operator_summary.lines.includes("scheduler_traffic_legacy_active=0"));
    assert.ok(result.request.operator_summary.lines.includes(`scheduler_traffic_file=${schedulerTrafficCutoverFile}`));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("live_cutover_ready=YES"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("live_evidence_ready=YES"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("live_evidence_failed_axes=NONE"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("live_evidence_submit_checks=NONE"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("live_evidence_runbook=NONE"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("live_cutover_auto_apply=NO"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("live_cutover_mutates_env=NO"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("live_cutover_env_changes=4"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("production_cutover_ready=YES"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("production_cutover_legacy_blocked=YES"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("production_cutover_guard_reason=V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes(`production_cutover_file=${productionCutoverFile}`));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("scheduler_collector_preflight=YES"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("scheduler_collector_project=donbeolja-dev"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes(`scheduler_collector_file=${schedulerTrafficCollectorPreflightFile}`));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("scheduler_traffic_ready=YES"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("scheduler_traffic_sot=OPENCLAW_CRON"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("scheduler_traffic_legacy_active=0"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes(`scheduler_traffic_file=${schedulerTrafficCutoverFile}`));

    const stored = JSON.parse(fs.readFileSync(result.output_file, "utf8"));
    assert.strictEqual(stored.submit_trace_summary.live_cutover_readiness_summary.ok, true);
    assert.strictEqual(stored.submit_trace_summary.live_evidence_readiness_summary.ok, true);
    assert.strictEqual(stored.submit_trace_summary.production_cutover_readiness_summary.ok, true);
    assert.strictEqual(stored.submit_trace_summary.scheduler_traffic_collector_preflight_summary.ok, true);
    assert.strictEqual(stored.submit_trace_summary.scheduler_traffic_cutover_readiness_summary.ok, true);
    assert.ok(stored.operator_summary.lines.includes("live_cutover_ready=YES"));
    assert.ok(stored.operator_summary.lines.includes("live_evidence_ready=YES"));
    assert.ok(stored.operator_summary.lines.includes("production_cutover_ready=YES"));
    assert.ok(stored.operator_summary.lines.includes("scheduler_collector_preflight=YES"));
    assert.ok(stored.operator_summary.lines.includes("scheduler_traffic_ready=YES"));
    const rendered = renderer.renderAlert({
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
    });
    assert.ok(rendered.preview.sections[1].lines.includes("live_cutover_ready=YES"));
    assert.ok(rendered.preview.sections[1].lines.includes("live_evidence_ready=YES"));
    assert.ok(rendered.preview.sections[1].lines.includes("production_cutover_ready=YES"));
    assert.ok(rendered.preview.sections[1].lines.includes("scheduler_collector_preflight=YES"));
    assert.ok(rendered.preview.sections[1].lines.includes("scheduler_traffic_ready=YES"));
    const cliPayload = submit.__test.buildCliResultPayload(result);
    assert.strictEqual(cliPayload.submit_trace_summary.live_cutover_readiness_summary.ok, true);
    assert.strictEqual(cliPayload.submit_trace_summary.live_evidence_readiness_summary.ok, true);
    assert.strictEqual(cliPayload.submit_trace_summary.production_cutover_readiness_summary.ok, true);
    assert.strictEqual(cliPayload.submit_trace_summary.scheduler_traffic_collector_preflight_summary.ok, true);
    assert.strictEqual(cliPayload.submit_trace_summary.scheduler_traffic_cutover_readiness_summary.ok, true);
    assert.ok(cliPayload.operator_summary.lines.includes("live_cutover_ready=YES"));
    assert.ok(cliPayload.operator_summary.lines.includes("live_evidence_ready=YES"));
    assert.ok(cliPayload.operator_summary.lines.includes("production_cutover_ready=YES"));
    assert.ok(cliPayload.operator_summary.lines.includes("scheduler_collector_preflight=YES"));
    assert.ok(cliPayload.operator_summary.lines.includes("scheduler_traffic_ready=YES"));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function liveSubmitBlocksWithoutLiveEvidenceReadinessSummary() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-live-evidence-missing-"));
  try {
    const artifactDir = path.join(dir, "PCY__LIVE__EVIDENCE_MISSING");
    fs.mkdirSync(artifactDir, { recursive: true });
    const cutoverFile = path.join(artifactDir, "v2_repair_live_cutover_readiness_latest.json");
    const productionCutoverFile = path.join(artifactDir, "v2_production_cutover_readiness_latest.json");
    const schedulerTrafficCollectorPreflightFile = path.join(artifactDir, "v2_scheduler_traffic_collector_preflight_latest.json");
    const schedulerTrafficCutoverFile = path.join(artifactDir, "v2_scheduler_traffic_cutover_readiness_latest.json");
    seedBoundedSubmitArtifacts(artifactDir, "PCY__LIVE__EVIDENCE_MISSING", {
      liveEvidenceReadinessSummary: null,
      liveCutoverReadinessSummary: buildLiveCutoverReadinessSummaryFixture(cutoverFile),
      productionCutoverReadinessSummary: buildProductionCutoverReadinessSummaryFixture(productionCutoverFile),
      schedulerTrafficCollectorPreflightSummary: buildSchedulerTrafficCollectorPreflightSummaryFixture(schedulerTrafficCollectorPreflightFile),
      schedulerTrafficCutoverReadinessSummary: buildSchedulerTrafficCutoverReadinessSummaryFixture(schedulerTrafficCutoverFile),
    });
    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "LIVE",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__LIVE__EVIDENCE_MISSING",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
    });
    assert.strictEqual(result.reason, "V2_PROMOTION_CLOUDBUILD_SUBMIT_BLOCKED");
    assert.strictEqual(result.request.submit_trace_summary.ok, false);
    assert.ok(result.request.submit_trace_summary.failed_submit_check_ids.includes("SUBMIT_CHK_24"));
    assert.ok(result.request.submit_trace_summary.failed_runbook_checklist.includes("13G"));
    assert.deepStrictEqual(result.request.submit_trace_summary.blocker_families, ["LIVE_EVIDENCE_READINESS"]);
    assert.strictEqual(result.request.submit_trace_summary.primary_blocker_family, "LIVE_EVIDENCE_READINESS");
    assert.strictEqual(result.request.submit_trace_summary.recommended_next_action, "REGENERATE_LIVE_EVIDENCE_READINESS_AND_RECHECK_DEPLOY_DECISION");
    assert.strictEqual(result.request.submit_trace_summary.recommended_next_action_reason_code, "LIVE_EVIDENCE_READINESS_BLOCKER");
    assert.strictEqual(result.request.submit_trace_summary.live_evidence_readiness_summary, null);
    assert.ok(result.request.operator_summary.lines.includes("live_evidence_ready=N/A"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("live_evidence_ready=N/A"));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function liveSubmitBlocksWithoutOpenClawSupremeClosedLoopEvidence() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-openclaw-supreme-missing-"));
  try {
    const artifactDir = path.join(dir, "PCY__LIVE__OPENCLAW_SUPREME_MISSING");
    fs.mkdirSync(artifactDir, { recursive: true });
    const cutoverFile = path.join(artifactDir, "v2_repair_live_cutover_readiness_latest.json");
    const productionCutoverFile = path.join(artifactDir, "v2_production_cutover_readiness_latest.json");
    const schedulerTrafficCollectorPreflightFile = path.join(artifactDir, "v2_scheduler_traffic_collector_preflight_latest.json");
    const schedulerTrafficCutoverFile = path.join(artifactDir, "v2_scheduler_traffic_cutover_readiness_latest.json");
    seedBoundedSubmitArtifacts(artifactDir, "PCY__LIVE__OPENCLAW_SUPREME_MISSING", {
      liveCutoverReadinessSummary: buildLiveCutoverReadinessSummaryFixture(cutoverFile),
      productionCutoverReadinessSummary: buildProductionCutoverReadinessSummaryFixture(productionCutoverFile),
      schedulerTrafficCollectorPreflightSummary: buildSchedulerTrafficCollectorPreflightSummaryFixture(schedulerTrafficCollectorPreflightFile),
      schedulerTrafficCutoverReadinessSummary: buildSchedulerTrafficCutoverReadinessSummaryFixture(schedulerTrafficCutoverFile),
    });
    const deployDecisionPath = path.join(artifactDir, "promotion-deploy-decision.json");
    const deployDecision = JSON.parse(fs.readFileSync(deployDecisionPath, "utf8"));
    delete deployDecision.bounded_runtime_summary.openclaw_supreme_control_plane_summary;
    writeJson(deployDecisionPath, deployDecision);
    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "LIVE",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__LIVE__OPENCLAW_SUPREME_MISSING",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
    });
    assert.strictEqual(result.reason, "V2_PROMOTION_CLOUDBUILD_SUBMIT_BLOCKED");
    const check = result.request.approval_verification.checks.find((row) => row.id === "SUBMIT_CHK_23");
    assert.ok(check);
    assert.strictEqual(check.ok, false);
    assert.deepStrictEqual(check.doc_refs.runbook_checklist, ["31"]);
    assert.deepStrictEqual(result.request.submit_trace_summary.failed_submit_check_ids, ["SUBMIT_CHK_23"]);
    assert.deepStrictEqual(result.request.submit_trace_summary.failed_runbook_checklist, ["31"]);
    assert.deepStrictEqual(result.request.submit_trace_summary.blocker_families, ["OPENCLAW_SUPREME_CONTROL_PLANE"]);
    assert.strictEqual(result.request.submit_trace_summary.primary_blocker_family, "OPENCLAW_SUPREME_CONTROL_PLANE");
    assert.strictEqual(
      result.request.submit_trace_summary.recommended_next_action,
      "FIX_OPENCLAW_SUPREME_CONTROL_PLANE_AND_RECHECK_DEPLOY_DECISION"
    );
    assert.strictEqual(
      result.request.submit_trace_summary.recommended_next_action_reason_code,
      "OPENCLAW_SUPREME_CONTROL_PLANE_BLOCKER"
    );
    assert.ok(result.request.operator_summary.lines.includes("openclaw_supreme_blocker=YES"));
    assert.ok(result.request.operator_alert_preview.sections[0].lines.includes("openclaw_supreme_blocker=YES"));
    assert.ok(result.request.operator_alert_preview.sections[1].lines.includes("openclaw_supreme_blocker=YES"));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function liveSubmitClassifiesStaleProductionCutoverReadinessFreshnessAsStaleArtifact() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-prod-cutover-stale-"));
  try {
    const artifactDir = path.join(dir, "PCY__LIVE__PROD_CUTOVER_STALE");
    fs.mkdirSync(artifactDir, { recursive: true });
    const cutoverFile = path.join(artifactDir, "v2_repair_live_cutover_readiness_latest.json");
    const productionCutoverFile = path.join(artifactDir, "v2_production_cutover_readiness_latest.json");
    const schedulerTrafficCollectorPreflightFile = path.join(artifactDir, "v2_scheduler_traffic_collector_preflight_latest.json");
    const schedulerTrafficCutoverFile = path.join(artifactDir, "v2_scheduler_traffic_cutover_readiness_latest.json");
    seedBoundedSubmitArtifacts(artifactDir, "PCY__LIVE__PROD_CUTOVER_STALE", {
      liveCutoverReadinessSummary: buildLiveCutoverReadinessSummaryFixture(cutoverFile),
      productionCutoverReadinessSummary: {
        ...buildProductionCutoverReadinessSummaryFixture(productionCutoverFile),
        artifact_generated_age_minutes: 181,
      },
      schedulerTrafficCollectorPreflightSummary: buildSchedulerTrafficCollectorPreflightSummaryFixture(schedulerTrafficCollectorPreflightFile),
      schedulerTrafficCutoverReadinessSummary: buildSchedulerTrafficCutoverReadinessSummaryFixture(schedulerTrafficCutoverFile),
    });
    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "LIVE",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__LIVE__PROD_CUTOVER_STALE",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "V2_PROMOTION_CLOUDBUILD_SUBMIT_BLOCKED");
    assert.ok(result.request.submit_trace_summary.failed_submit_check_ids.includes("SUBMIT_CHK_15"));
    assert.ok(result.request.submit_trace_summary.failed_runbook_checklist.includes("23"));
    assert.deepStrictEqual(result.request.submit_trace_summary.blocker_families, ["STALE_ARTIFACT_PROVENANCE", "PRODUCTION_CUTOVER"]);
    assert.strictEqual(result.request.submit_trace_summary.primary_blocker_family, "STALE_ARTIFACT_PROVENANCE");
    assert.strictEqual(result.request.submit_trace_summary.recommended_next_action, "DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE");
    assert.strictEqual(result.request.submit_trace_summary.recommended_next_action_reason_code, "STALE_ARTIFACT_PROVENANCE_BLOCKER");
    assert.ok(result.request.operator_summary.lines.includes("stale_artifact_provenance_blocker=YES"));
    const check = result.request.approval_verification.checks.find((row) => row.id === "SUBMIT_CHK_15");
    assert.ok(check);
    assert.strictEqual(check.ok, false);
    assert.strictEqual(check.reason, "LIVE production cutover readiness has stale artifact provenance");
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function liveSubmitBlocksWhenSchedulerTrafficCollectorPreflightIsMissing() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-scheduler-preflight-missing-"));
  try {
    const artifactDir = path.join(dir, "PCY__LIVE__SCHED_PRE_MISSING");
    fs.mkdirSync(artifactDir, { recursive: true });
    const cutoverFile = path.join(artifactDir, "v2_repair_live_cutover_readiness_latest.json");
    const productionCutoverFile = path.join(artifactDir, "v2_production_cutover_readiness_latest.json");
    const schedulerTrafficCutoverFile = path.join(artifactDir, "v2_scheduler_traffic_cutover_readiness_latest.json");
    seedBoundedSubmitArtifacts(artifactDir, "PCY__LIVE__SCHED_PRE_MISSING", {
      liveCutoverReadinessSummary: buildLiveCutoverReadinessSummaryFixture(cutoverFile),
      productionCutoverReadinessSummary: buildProductionCutoverReadinessSummaryFixture(productionCutoverFile),
      schedulerTrafficCutoverReadinessSummary: buildSchedulerTrafficCutoverReadinessSummaryFixture(schedulerTrafficCutoverFile),
    });
    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "LIVE",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__LIVE__SCHED_PRE_MISSING",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
    });
    assert.strictEqual(result.request.submit_trace_summary.ok, false);
    assert.ok(result.request.submit_trace_summary.failed_submit_check_ids.includes("SUBMIT_CHK_17"));
    assert.ok(result.request.submit_trace_summary.failed_runbook_checklist.includes("24A"));
    assert.deepStrictEqual(result.request.submit_trace_summary.blocker_families, ["SCHEDULER_COLLECTOR"]);
    assert.strictEqual(result.request.submit_trace_summary.primary_blocker_family, "SCHEDULER_COLLECTOR");
    assert.strictEqual(result.request.submit_trace_summary.recommended_next_action, "FIX_V2_SCHEDULER_COLLECTOR_IAM_AND_RERUN_LIVE_CLOUDBUILD_WRAPPER");
    assert.strictEqual(result.request.submit_trace_summary.recommended_next_action_reason_code, "SCHEDULER_COLLECTOR_BLOCKER");
    assert.strictEqual(result.request.submit_trace_summary.scheduler_traffic_collector_preflight_summary, null);
    assert.ok(result.request.operator_summary.lines.includes("scheduler_collector_preflight=N/A"));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function liveSubmitBlocksWhenRepairCutoverReadinessSummaryIsMissing() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-request-live-cutover-missing-"));
  try {
    const artifactDir = path.join(dir, "PCY__LIVE__CUTOVER_MISSING");
    fs.mkdirSync(artifactDir, { recursive: true });
    seedBoundedSubmitArtifacts(artifactDir, "PCY__LIVE__CUTOVER_MISSING");
    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "LIVE",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__LIVE__CUTOVER_MISSING",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "V2_PROMOTION_CLOUDBUILD_SUBMIT_BLOCKED");
    const cutoverCheck = result.request.approval_verification.checks.find((row) => row.id === "SUBMIT_CHK_12");
    assert.ok(cutoverCheck);
    assert.strictEqual(cutoverCheck.ok, false);
    assert.deepStrictEqual(cutoverCheck.doc_refs.runbook_checklist, ["20"]);
    assert.ok(result.request.submit_trace_summary.failed_submit_check_ids.includes("SUBMIT_CHK_12"));
    assert.ok(result.request.submit_trace_summary.failed_runbook_checklist.includes("20"));
    assert.strictEqual(result.request.submit_trace_summary.live_cutover_readiness_summary, null);
    assert.ok(result.request.operator_summary.lines.includes("live_cutover_ready=N/A"));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function liveSubmitBlocksWhenProductionCutoverReadinessSummaryIsMissing() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-request-production-cutover-missing-"));
  try {
    const artifactDir = path.join(dir, "PCY__LIVE__PROD_CUTOVER_MISSING");
    fs.mkdirSync(artifactDir, { recursive: true });
    const cutoverFile = path.join(artifactDir, "v2_repair_live_cutover_readiness_latest.json");
    seedBoundedSubmitArtifacts(artifactDir, "PCY__LIVE__PROD_CUTOVER_MISSING", {
      liveCutoverReadinessSummary: buildLiveCutoverReadinessSummaryFixture(cutoverFile),
    });
    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "LIVE",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__LIVE__PROD_CUTOVER_MISSING",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "V2_PROMOTION_CLOUDBUILD_SUBMIT_BLOCKED");
    const productionCutoverCheck = result.request.approval_verification.checks.find((row) => row.id === "SUBMIT_CHK_15");
    assert.ok(productionCutoverCheck);
    assert.strictEqual(productionCutoverCheck.ok, false);
    assert.deepStrictEqual(productionCutoverCheck.doc_refs.runbook_checklist, ["23"]);
    assert.ok(result.request.submit_trace_summary.failed_submit_check_ids.includes("SUBMIT_CHK_15"));
    assert.ok(result.request.submit_trace_summary.failed_runbook_checklist.includes("23"));
    assert.strictEqual(result.request.submit_trace_summary.production_cutover_readiness_summary, null);
    assert.ok(result.request.operator_summary.lines.includes("production_cutover_ready=N/A"));
    assert.strictEqual(
      result.request.submit_trace_summary.recommended_next_action_reason_code,
      "PRODUCTION_CUTOVER_BLOCKER"
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function submitRequestBlocksWhenLineageHashMismatches() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-request-blocked-"));
  try {
    const artifactDir = path.join(dir, "PCY__CANARY__BLOCKED");
    fs.mkdirSync(artifactDir, { recursive: true });
    seedBoundedSubmitArtifacts(artifactDir, "PCY__CANARY__BLOCKED", {
      contextLineageHash: "lineage-hash-mismatch",
    });
    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__CANARY__BLOCKED",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "V2_PROMOTION_CLOUDBUILD_SUBMIT_BLOCKED");
    assert.strictEqual(result.request.approval_verification.required, true);
    assert.strictEqual(result.request.approval_verification.ok, false);
    const lineageCheck = result.request.approval_verification.checks.find((row) => row.id === "SUBMIT_CHK_08");
    assert.ok(lineageCheck);
    assert.strictEqual(lineageCheck.ok, false);
    assert.deepStrictEqual(lineageCheck.doc_refs.runbook_checklist, ["16", "17"]);
    assert.strictEqual(result.request.approval_verification.blocker_summary.has_provenance_blocker, true);
    assert.strictEqual(
      result.request.approval_verification.recommended_next_action,
      "DISCARD_ARTIFACT_DIR_AND_RERUN_FROM_PREFLIGHT"
    );
    const payload = JSON.parse(fs.readFileSync(result.output_file, "utf8"));
    assert.strictEqual(payload.approval_verification.ok, false);
    assert.strictEqual(payload.submit_trace_summary.ok, false);
    assert.strictEqual(payload.operator_summary.status, "BLOCKED");
    assert.strictEqual(payload.operator_alert_preview.title, "V2 Promotion Submit Blocked");
    assert.strictEqual(payload.operator_alert_preview.summary_text, payload.operator_summary.text);
    assert.deepStrictEqual(payload.operator_alert_preview.sections[0].lines, payload.operator_summary.lines);
    assert.strictEqual(payload.operator_alert_delivery.required, true);
    assert.strictEqual(payload.operator_alert_delivery.send_enabled, false);
    assert.strictEqual(payload.operator_alert_delivery.ok, true);
    assert.strictEqual(payload.operator_alert_delivery.reason, "V2_PROMOTION_OPERATOR_ALERT_READY");
    assert.strictEqual(payload.operator_delivery_summary.status, "READY_NOT_SENT");
    assert.strictEqual(payload.operator_delivery_summary.send_enabled, false);
    assert.strictEqual(payload.operator_delivery_summary.transport_state, "NONE");
    assert.ok(payload.operator_summary.headline.includes("SUBMIT_BLOCKED"));
    assert.strictEqual(payload.operator_summary.text, payload.operator_summary.lines.join("\n"));
    assert.ok(payload.operator_summary.lines.includes("status=BLOCKED"));
    assert.ok(payload.operator_summary.lines.includes("alert_retry_attention=NO"));
    assert.ok(payload.operator_summary.lines.includes("alert_runbook_refs=NONE"));
    assert.ok(payload.operator_summary.lines.includes("alert_failed=0"));
    assert.ok(payload.operator_summary.lines.includes("alert_pending=0"));
    assert.strictEqual(payload.submit_trace_summary.lineage_consistency_summary.ok, false);
    assert.strictEqual(
      payload.submit_trace_summary.lineage_consistency_summary.reason,
      "CLOUDBUILD_CONTEXT_DEPLOY_DECISION_LINEAGE_MISMATCH"
    );
    assert.ok(payload.operator_summary.lines.includes("lineage_consistency=FAIL"));
    assert.ok(payload.operator_summary.lines.includes("lineage_consistency_reason=CLOUDBUILD_CONTEXT_DEPLOY_DECISION_LINEAGE_MISMATCH"));
    assert.ok(payload.operator_summary.lines.includes("lineage_bounded_ok=YES"));
    assert.ok(payload.operator_summary.lines.includes("lineage_context_hash_match=NO"));
    assert.ok(payload.operator_summary.lines.includes("lineage_context_ok=YES"));
    assert.ok(payload.operator_alert_preview.sections[1].lines.includes("lineage_consistency=FAIL"));
    assert.ok(payload.operator_alert_preview.sections[1].lines.includes("lineage_context_hash_match=NO"));
    assert.deepStrictEqual(payload.submit_trace_summary.failed_submit_check_ids, ["SUBMIT_CHK_08"]);
    assert.deepStrictEqual(payload.submit_trace_summary.failed_runbook_checklist, ["16", "17"]);
    assert.deepStrictEqual(payload.submit_trace_summary.blocker_families, ["PROVENANCE"]);
    assert.strictEqual(payload.submit_trace_summary.primary_blocker_family, "PROVENANCE");
    assert.strictEqual(payload.submit_trace_summary.alert_retry_attention_required, false);
    assert.deepStrictEqual(payload.submit_trace_summary.alert_runbook_refs, []);
    assert.strictEqual(payload.submit_trace_summary.alert_retry_summary, null);
    assert.strictEqual(payload.submit_trace_summary.recommended_next_action_reason_code, "PROVENANCE_OR_CONTRACT_BLOCKER");
    assert.strictEqual(payload.approval_verification.lineage_hashes.cloudbuild_context, "lineage-hash-mismatch");
    assert.strictEqual(payload.approval_verification.blocker_summary.has_provenance_blocker, true);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function submitRequestSurfacesAlertAttentionWithoutBlockingSubmit() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-request-alert-attention-"));
  try {
    const artifactDir = path.join(dir, "PCY__CANARY__ALERT_ATTENTION");
    fs.mkdirSync(artifactDir, { recursive: true });
    seedBoundedSubmitArtifacts(artifactDir, "PCY__CANARY__ALERT_ATTENTION", {
      alertRetrySummary: {
        outbox_n: 4,
        failed_n: 1,
        pending_n: 2,
        retryable_failed_n: 1,
        terminal_failed_n: 0,
        runbook_ref_counts: {
          ALERT_RBK_04: 1,
        },
        latest_failed: {
          runbook_refs: ["ALERT_RBK_04"],
        },
      },
    });
    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__CANARY__ALERT_ATTENTION",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.reason, "V2_PROMOTION_CLOUDBUILD_SUBMIT_REQUEST_READY");
    const payload = JSON.parse(fs.readFileSync(result.output_file, "utf8"));
    assert.strictEqual(payload.submit_trace_summary.ok, true);
    assert.strictEqual(payload.submit_trace_summary.alert_retry_attention_required, true);
    assert.deepStrictEqual(payload.submit_trace_summary.alert_runbook_refs, ["ALERT_RBK_04"]);
    assert.strictEqual(payload.submit_trace_summary.alert_retry_summary.failed_n, 1);
    assert.strictEqual(payload.submit_trace_summary.alert_retry_summary.pending_n, 2);
    assert.strictEqual(payload.operator_summary.status, "READY_WITH_ALERT_ATTENTION");
    assert.ok(payload.operator_summary.headline.includes("SUBMIT_READY_WITH_ALERT_ATTENTION"));
    assert.ok(payload.operator_summary.headline.includes("ALERT_ATTENTION"));
    assert.ok(payload.operator_summary.headline.includes("RUNBOOK:ALERT_RBK_04"));
    assert.ok(payload.operator_summary.lines.includes("alert_retry_attention=YES"));
    assert.ok(payload.operator_summary.lines.includes("alert_runbook_refs=ALERT_RBK_04"));
    assert.ok(payload.operator_summary.lines.includes("alert_failed=1"));
    assert.ok(payload.operator_summary.lines.includes("alert_pending=2"));
    assert.strictEqual(payload.operator_alert_preview.title, "V2 Promotion Submit Ready With Alert Attention");
    assert.strictEqual(payload.operator_alert_preview.severity, "WARN");
    assert.strictEqual(payload.operator_delivery_summary.status, "READY_NOT_SENT");
    assert.strictEqual(payload.operator_delivery_summary.send_enabled, false);
    assert.strictEqual(payload.operator_delivery_summary.transport_state, "NONE");
    assert.ok(payload.operator_alert_preview.sections[1].lines.includes("alert_retry_attention=YES"));
    assert.ok(payload.operator_alert_preview.sections[1].lines.includes("alert_runbook_refs=ALERT_RBK_04"));
    assert.ok(payload.operator_alert_preview.sections[1].lines.includes("alert_failed=1"));
    assert.ok(payload.operator_alert_preview.sections[1].lines.includes("alert_pending=2"));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function submitRequestRunsOperatorAlertDeliveryWhenEnabled() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-request-alert-"));
  try {
    const artifactDir = path.join(dir, "PCY__CANARY__ALERT");
    fs.mkdirSync(artifactDir, { recursive: true });
    seedBoundedSubmitArtifacts(artifactDir, "PCY__CANARY__ALERT");
    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__CANARY__ALERT",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
      V2_PROMOTION_OPERATOR_ALERT_SEND_ENABLED: "1",
      SKIP_ALERT: "1",
    });
    assert.strictEqual(result.ok, true);
    const payload = JSON.parse(fs.readFileSync(result.output_file, "utf8"));
    assert.strictEqual(payload.operator_alert_delivery.required, true);
    assert.strictEqual(payload.operator_alert_delivery.send_enabled, true);
    assert.strictEqual(payload.operator_alert_delivery.ok, true);
    assert.strictEqual(payload.operator_alert_delivery.reason, "V2_PROMOTION_OPERATOR_ALERT_SENT");
    assert.strictEqual(payload.operator_alert_delivery.transport_result.skipped, true);
    assert.strictEqual(payload.operator_alert_delivery.transport_result.reason, "SKIP_ALERT");
    assert.strictEqual(payload.operator_delivery_summary.status, "DELIVERY_SKIPPED");
    assert.strictEqual(payload.operator_delivery_summary.send_enabled, true);
    assert.strictEqual(payload.operator_delivery_summary.transport_state, "SKIPPED");
    assert.ok(payload.operator_delivery_summary.lines.includes("delivery_status=DELIVERY_SKIPPED"));
    assert.ok(payload.operator_delivery_summary.lines.includes("delivery_send_enabled=YES"));
    assert.ok(payload.operator_delivery_summary.lines.includes("delivery_transport_state=SKIPPED"));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function submitRequestFailsClosedWhenOperatorAlertDeliveryFails() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-request-alert-fail-"));
  try {
    const artifactDir = path.join(dir, "PCY__CANARY__ALERT_FAIL");
    fs.mkdirSync(artifactDir, { recursive: true });
    seedBoundedSubmitArtifacts(artifactDir, "PCY__CANARY__ALERT_FAIL");
    const result = submit.submitCloudBuild({
      GOOGLE_CLOUD_PROJECT: "donbeolja-dev",
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__CANARY__ALERT_FAIL",
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_PROMOTION_CLOUDBUILD_SUBMIT_ENABLED: "0",
      V2_PROMOTION_OPERATOR_ALERT_SEND_ENABLED: "1",
      SIGNAL_LIFECYCLE_ALERT_CHANNEL: "unknown:operator-alert-fail",
      TRADE_ALERT_CHANNEL: "",
      EXIT_INTEGRITY_ALERT_CHANNEL: "",
      TELEGRAM_CHAT_ID: "",
      SKIP_ALERT: "0",
      AUTOMATION_TELEGRAM_POLICY: "ALL",
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "V2_PROMOTION_CLOUDBUILD_SUBMIT_ALERT_FAILED");
    const payload = JSON.parse(fs.readFileSync(result.output_file, "utf8"));
    assert.strictEqual(payload.approval_verification.ok, true);
    assert.strictEqual(payload.operator_alert_delivery.required, true);
    assert.strictEqual(payload.operator_alert_delivery.send_enabled, true);
    assert.strictEqual(payload.operator_alert_delivery.ok, false);
    assert.strictEqual(payload.operator_alert_delivery.reason, "V2_PROMOTION_OPERATOR_ALERT_SEND_FAILED");
    assert.strictEqual(payload.operator_alert_delivery.transport_result.ok, false);
    assert.strictEqual(payload.operator_alert_delivery.transport_result.results[0].type, "unknown");
    assert.strictEqual(payload.operator_alert_delivery.transport_result.results[0].error, "UNKNOWN_CHANNEL");
    assert.strictEqual(payload.operator_delivery_summary.status, "DELIVERY_FAILED");
    assert.strictEqual(payload.operator_delivery_summary.send_enabled, true);
    assert.strictEqual(payload.operator_delivery_summary.transport_state, "FAILED");
    assert.ok(payload.operator_delivery_summary.lines.includes("delivery_status=DELIVERY_FAILED"));
    assert.ok(payload.operator_delivery_summary.lines.includes("delivery_send_enabled=YES"));
    assert.ok(payload.operator_delivery_summary.lines.includes("delivery_transport_state=FAILED"));
    assert.ok(payload.operator_delivery_summary.lines.includes("delivery_reason=V2_PROMOTION_OPERATOR_ALERT_SEND_FAILED"));
    const cliPayload = submit.__test.buildCliResultPayload(result);
    assert.strictEqual(cliPayload.ok, false);
    assert.strictEqual(cliPayload.reason, "V2_PROMOTION_CLOUDBUILD_SUBMIT_ALERT_FAILED");
    assert.strictEqual(cliPayload.operator_alert_delivery.ok, false);
    assert.strictEqual(cliPayload.operator_alert_delivery.reason, "V2_PROMOTION_OPERATOR_ALERT_SEND_FAILED");
    assert.strictEqual(cliPayload.operator_alert_delivery.transport_result.results[0].error, "UNKNOWN_CHANNEL");
    assert.strictEqual(cliPayload.operator_delivery_summary.status, "DELIVERY_FAILED");
    assert.strictEqual(cliPayload.operator_delivery_summary.transport_state, "FAILED");
    assert.ok(cliPayload.operator_delivery_summary.lines.includes("delivery_status=DELIVERY_FAILED"));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

console.log("SUBMIT_V2_PROMOTION_CLOUDBUILD_TEST_OK");
