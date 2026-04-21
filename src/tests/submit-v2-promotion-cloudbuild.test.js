"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const submit = require("../../scripts/submit-v2-promotion-cloudbuild");
const renderer = require("../../scripts/render-v2-promotion-submit-operator-alert");

const LINEAGE_CONTRACT_FIXTURE = Object.freeze({
  version: "V2_PROMOTION_SELECTOR_LINEAGE_SHA256_V1",
  hash: "lineage-hash-fixture",
});

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function buildProductionCutoverAuditFixture() {
  return {
    ok: true,
    reason: "V2_PRODUCTION_CUTOVER_AUDIT_PASS",
    scope: "production_webhook_cutover",
    contract: {
      ok: true,
      reason: "V2_PRODUCTION_CUTOVER_CONTRACT_PASS",
      check_n: 4,
      fail_n: 0,
      failed_check_ids: [],
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

function seedBoundedSubmitArtifacts(
  dir,
  cycleId,
  {
    autoSelect = false,
    contextLineageHash = null,
    alertRetrySummary = null,
    deployWarnings = [],
    liveCutoverReadinessSummary = null,
    productionCutoverReadinessSummary = null,
    schedulerTrafficCollectorPreflightSummary = null,
    schedulerTrafficCutoverReadinessSummary = null,
  } = {}
) {
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
        protection_runtime_n: 1,
        protection_runtime_evidence_n: 1,
        missing_protection_runtime_evidence_n: 0,
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
      repair_firestore_canary_streak: {
        ok: true,
        reason: "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS",
        healthy_run_n: 13,
        min_run_count: 12,
        unhealthy_run_n: 0,
        invalid_line_n: 0,
        blockers: [],
      },
      production_entry_route_canary_streak: {
        ok: true,
        reason: "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS",
        healthy_run_n: 13,
        min_run_count: 12,
        unhealthy_run_n: 0,
        invalid_line_n: 0,
        blockers: [],
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
          selected_cycle_matches_preflight: true,
          selected_cycle_matches_collector_env: true,
          selected_snapshot_counts_exact: true,
        },
      },
    } : {}),
  });
  writeJson(path.join(dir, "promotion-cloudbuild-context.json"), {
    lineage_contract_hash: contextLineageHash || LINEAGE_CONTRACT_FIXTURE.hash,
    final_status_line: `APPROVE_DEPLOY ; cycle=${cycleId} ; blockers=0 ; warnings=0`,
    recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
    recommended_next_action_reason: "deploy decision approved with no blocking families",
    ...(liveCutoverReadinessSummary ? {
      live_cutover_readiness_file: path.join(dir, "v2_repair_live_cutover_readiness_latest.json"),
      live_cutover_readiness_summary: liveCutoverReadinessSummary,
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
      lineage_contract_hash: contextLineageHash || LINEAGE_CONTRACT_FIXTURE.hash,
      ...(alertRetrySummary ? { alert_retry_summary: alertRetrySummary } : {}),
      warning_summary: {
        warning_n: deployWarnings.length,
        top_warnings: deployWarnings.slice(0, 3),
        has_live_readiness_warning: deployWarnings.some((value) => String(value).includes("REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY")),
      },
      blocker_summary: {
        blocker_n: 0,
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
    require_production_cutover: true,
    block_legacy_webhook_signal: true,
    allow_legacy_webhook_signal: false,
    ...(filePath ? { file: filePath } : {}),
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
    ],
    missing_openclaw_job_ids: [],
    active_legacy_scheduler_job_n: 0,
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
  assert.strictEqual(request.approval_contract.entry_boundary_audit_required, true);
  assert.strictEqual(request.approval_contract.fill_sync_canonical_boundary_audit_required, true);
  assert.strictEqual(request.approval_contract.production_cutover_audit_required, true);
  assert.strictEqual(request.approval_contract.production_cutover_readiness_summary_required, false);
  assert.strictEqual(request.approval_contract.openclaw_execution_audit_ledger_write_required, true);
  assert.strictEqual(request.approval_contract.repair_firestore_canary_streak_required, false);
  assert.strictEqual(request.approval_contract.production_entry_route_canary_streak_required, false);
  assert.strictEqual(request.approval_contract.live_cutover_readiness_summary_required, false);
  assert.strictEqual(request.approval_contract.runbook_review_pass_required, true);
  assert.strictEqual(request.approval_contract.candidate_selection_ready_required, false);
  assert.strictEqual(request.approval_contract.selected_preflight_required, false);
  assert.strictEqual(request.approval_contract.blocker_free_required, true);
  assert.strictEqual(request.approval_contract.recommended_next_action_required, "PROCEED_WITH_SUBMIT_WRAPPER");
  assert.strictEqual(request.approval_evidence_sources.required, true);
  assert.strictEqual(request.approval_evidence_sources.deploy_decision.file, "promotion-deploy-decision.json");
  assert.strictEqual(request.approval_evidence_sources.entry_boundary_audit.field, "entry_boundary_audit");
  assert.strictEqual(request.approval_evidence_sources.fill_sync_canonical_boundary_audit.field, "fill_sync_canonical_boundary_audit");
  assert.strictEqual(request.approval_evidence_sources.production_cutover_audit.field, "production_cutover_audit");
  assert.strictEqual(request.approval_evidence_sources.openclaw_execution_audit_ledger_write.field, "bounded_runtime_summary.openclaw_execution_audit_ledger_write");
  assert.strictEqual(request.approval_evidence_sources.repair_firestore_canary_streak, null);
  assert.strictEqual(request.approval_evidence_sources.production_entry_route_canary_streak, null);
  assert.strictEqual(request.approval_evidence_sources.runbook_review.expected_value, "PASS");
  assert.strictEqual(request.approval_evidence_sources.lineage_hash_sources.length, 4);
  assert.strictEqual(request.approval_evidence_sources.lineage_hash_sources[3].field, "lineage_contract_hash");
  assert.strictEqual(request.substitutions._V2_PROMOTION_CANARY_FLOW_ENABLED, "1");
  assert.strictEqual(request.substitutions._V2_PROMOTION_SELECT_POSITION_CYCLE_ID, "PCY__CANARY__01");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED, "1");
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
  assert.strictEqual(request.approval_contract.runbook_review_pass_required, true);
  assert.strictEqual(request.approval_contract.entry_boundary_audit_required, true);
  assert.strictEqual(request.approval_contract.fill_sync_canonical_boundary_audit_required, true);
  assert.strictEqual(request.approval_contract.production_cutover_audit_required, true);
  assert.strictEqual(request.approval_contract.production_cutover_readiness_summary_required, false);
  assert.strictEqual(request.approval_contract.openclaw_execution_audit_ledger_write_required, true);
  assert.strictEqual(request.approval_contract.repair_firestore_canary_streak_required, false);
  assert.strictEqual(request.approval_contract.production_entry_route_canary_streak_required, false);
  assert.strictEqual(request.approval_contract.live_cutover_readiness_summary_required, false);
  assert.strictEqual(request.approval_contract.candidate_selection_ready_required, true);
  assert.strictEqual(request.approval_contract.selected_preflight_required, true);
  assert.strictEqual(request.approval_evidence_sources.required, true);
  assert.strictEqual(request.approval_evidence_sources.candidate_selection.file, "promotion-deploy-decision.json");
  assert.strictEqual(request.approval_evidence_sources.candidate_selection.field, "candidate_selection_summary.selection_contract");
  assert.strictEqual(request.substitutions._V2_PROMOTION_CANARY_AUTO_SELECT_ENABLED, "1");
  assert.strictEqual(request.substitutions._DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED, "1");
  assert.strictEqual(
    request.substitutions._V2_PROMOTION_CANDIDATE_EXCHANGE_STATE_JSON,
    "{\"has_active_position\":false}"
  );
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
  assert.strictEqual(request.approval_contract.production_cutover_readiness_summary_required, true);
  assert.strictEqual(request.approval_contract.scheduler_traffic_cutover_readiness_summary_required, true);
  assert.strictEqual(request.approval_contract.live_cutover_readiness_summary_required, true);
  assert.strictEqual(
    request.approval_evidence_sources.repair_firestore_canary_streak.field,
    "bounded_runtime_summary.repair_firestore_canary_streak"
  );
  assert.strictEqual(
    request.approval_evidence_sources.production_entry_route_canary_streak.field,
    "bounded_runtime_summary.production_entry_route_canary_streak"
  );
  assert.strictEqual(
    request.approval_evidence_sources.live_cutover_readiness_summary.field,
    "live_cutover_readiness_summary"
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
  assert.strictEqual(request.approval_contract.entry_boundary_audit_required, false);
  assert.strictEqual(request.approval_contract.fill_sync_canonical_boundary_audit_required, false);
  assert.strictEqual(request.approval_contract.production_cutover_audit_required, false);
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
      { id: "SUBMIT_CHK_03", ok: false },
      { id: "SUBMIT_CHK_08", ok: false },
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
  assert.deepStrictEqual(summary.failed_runbook_checklist, ["8", "16", "17"]);
  assert.deepStrictEqual(summary.blocker_families, ["PROVENANCE", "BOUNDED_RUNTIME"]);
  assert.strictEqual(summary.primary_blocker_family, "PROVENANCE");
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
    assert.strictEqual(payload.approval_contract.entry_boundary_audit_required, true);
    assert.strictEqual(payload.approval_contract.fill_sync_canonical_boundary_audit_required, true);
    assert.strictEqual(payload.approval_contract.runbook_review_pass_required, true);
    assert.strictEqual(payload.approval_evidence_sources.required, true);
    assert.strictEqual(payload.approval_evidence_sources.entry_boundary_audit.field, "entry_boundary_audit");
    assert.strictEqual(payload.approval_evidence_sources.fill_sync_canonical_boundary_audit.field, "fill_sync_canonical_boundary_audit");
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
    assert.strictEqual(payload.submit_enabled, false);
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
    assert.strictEqual(stored.submit_trace_summary.production_cutover_readiness_summary.ok, true);
    assert.strictEqual(stored.submit_trace_summary.scheduler_traffic_collector_preflight_summary.ok, true);
    assert.strictEqual(stored.submit_trace_summary.scheduler_traffic_cutover_readiness_summary.ok, true);
    assert.ok(stored.operator_summary.lines.includes("live_cutover_ready=YES"));
    assert.ok(stored.operator_summary.lines.includes("production_cutover_ready=YES"));
    assert.ok(stored.operator_summary.lines.includes("scheduler_collector_preflight=YES"));
    assert.ok(stored.operator_summary.lines.includes("scheduler_traffic_ready=YES"));
    const rendered = renderer.renderAlert({
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
    });
    assert.ok(rendered.preview.sections[1].lines.includes("live_cutover_ready=YES"));
    assert.ok(rendered.preview.sections[1].lines.includes("production_cutover_ready=YES"));
    assert.ok(rendered.preview.sections[1].lines.includes("scheduler_collector_preflight=YES"));
    assert.ok(rendered.preview.sections[1].lines.includes("scheduler_traffic_ready=YES"));
    const cliPayload = submit.__test.buildCliResultPayload(result);
    assert.strictEqual(cliPayload.submit_trace_summary.live_cutover_readiness_summary.ok, true);
    assert.strictEqual(cliPayload.submit_trace_summary.production_cutover_readiness_summary.ok, true);
    assert.strictEqual(cliPayload.submit_trace_summary.scheduler_traffic_collector_preflight_summary.ok, true);
    assert.strictEqual(cliPayload.submit_trace_summary.scheduler_traffic_cutover_readiness_summary.ok, true);
    assert.ok(cliPayload.operator_summary.lines.includes("live_cutover_ready=YES"));
    assert.ok(cliPayload.operator_summary.lines.includes("production_cutover_ready=YES"));
    assert.ok(cliPayload.operator_summary.lines.includes("scheduler_collector_preflight=YES"));
    assert.ok(cliPayload.operator_summary.lines.includes("scheduler_traffic_ready=YES"));
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
    assert.ok(result.request.submit_trace_summary.failed_runbook_checklist.includes("24"));
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

console.log("SUBMIT_V2_PROMOTION_CLOUDBUILD_TEST_OK");
