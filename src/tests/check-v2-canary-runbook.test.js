"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const runbookCheck = require("../../scripts/check-v2-canary-runbook");
const deployDecisionCheck = require("../../scripts/check-v2-promotion-deploy-decision");

const LINEAGE_CONTRACT_FIXTURE = Object.freeze({
  version: "V2_PROMOTION_SELECTOR_LINEAGE_SHA256_V1",
  hash: "lineage-hash-fixture",
});
const REQUIRED_RUNTIME_CHAIN_CHECK_IDS = deployDecisionCheck.__test.REQUIRED_RUNTIME_CHAIN_CHECK_IDS;
const REQUIRED_PRODUCTION_LIVE_ENTRY_SIZING_CHECK_IDS = deployDecisionCheck.__test.REQUIRED_PRODUCTION_LIVE_ENTRY_SIZING_CHECK_IDS;

function writeJson(dir, filename, payload) {
  fs.writeFileSync(path.join(dir, filename), JSON.stringify(payload, null, 2), "utf8");
}

function buildWarningSummary(warnings = []) {
  const rows = Array.isArray(warnings) ? warnings : [];
  const hasRepairFirestoreCanaryStreakWarning = rows.some((value) => String(value).includes("REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"));
  const hasProductionEntryRouteCanaryStreakWarning = rows.some((value) => String(value).includes("PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"));
  return {
    warning_n: rows.length,
    top_warnings: rows.slice(0, 3),
    has_live_readiness_warning: hasRepairFirestoreCanaryStreakWarning || hasProductionEntryRouteCanaryStreakWarning,
    has_repair_firestore_canary_streak_warning: hasRepairFirestoreCanaryStreakWarning,
    has_production_entry_route_canary_streak_warning: hasProductionEntryRouteCanaryStreakWarning,
  };
}

function buildWarningSubmitTrace(warnings = []) {
  const summary = buildWarningSummary(warnings);
  const refs = [];
  if (summary.has_repair_firestore_canary_streak_warning) refs.push("19");
  if (summary.has_production_entry_route_canary_streak_warning) refs.push("26");
  return {
    relevant_submit_check_ids: ["SUBMIT_CHK_01A", "SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08"],
    relevant_runbook_checklist: ["1", "5", "9", "11", "13", "16", "17"],
    failed_submit_check_ids: [],
    failed_runbook_checklist: [],
    blocker_families: [],
    primary_blocker_family: null,
    deploy_warning_attention_required: rowsLength(warnings) > 0,
    deploy_warning_summary: summary,
    deploy_warning_runbook_checklist: refs,
    recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
    checks: [
      {
        id: "SUBMIT_CHK_01A",
        ok: true,
        runbook_checklist: ["1", "5", "9"],
        fields: ["artifact_dir", "resolved_artifact_dir", "artifact_dir_coherence", "position_cycle_id"],
        reason: "cloudbuild artifact dir self-check is coherent",
      },
      {
        id: "SUBMIT_CHK_06",
        ok: true,
        runbook_checklist: ["11"],
        fields: ["recommended_next_action"],
        reason: "cloudbuild context recommends submit wrapper",
      },
      {
        id: "SUBMIT_CHK_07",
        ok: true,
        runbook_checklist: ["13"],
        fields: ["deploy_decision_summary.blocker_summary.blocker_n"],
        reason: "cloudbuild blocker count is zero",
      },
      {
        id: "SUBMIT_CHK_08",
        ok: true,
        runbook_checklist: ["16", "17"],
        fields: [
          "lineage_contract_hash",
          "deploy_decision_summary.bounded_runtime_summary.lineage_contract.hash",
          "lineage_consistency_summary",
        ],
        reason: "cloudbuild lineage hashes are consistent for bounded provenance trace",
      },
    ],
  };
}

function rowsLength(rows) {
  return Array.isArray(rows) ? rows.length : 0;
}

function buildLineageConsistencySummary(hash = LINEAGE_CONTRACT_FIXTURE.hash) {
  return {
    ok: true,
    reason: "LINEAGE_CONSISTENT",
    hashes: {
      cloudbuild_context: hash,
      deploy_decision_summary: hash,
    },
  };
}

function buildBoundedRuntimeSummaryFixture() {
  return {
    selector_query_budget: { query_limit: 25 },
    collector_query_budget: { limits: { transitionsLimit: 50 } },
    exporter_snapshot_size_bytes: 12345,
    manifest_counts: { episode_n: 1 },
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
    runtime_chain_audit_summary: {
      ok: true,
      check_n: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.length,
      fail_n: 0,
      check_ids: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.slice(),
      passed_check_ids: REQUIRED_RUNTIME_CHAIN_CHECK_IDS.slice(),
      failed_check_ids: [],
    },
    openclaw_execution_audit_ledger_write: {
      ok: true,
      skipped: false,
      reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN",
      collection_key: "OPENCLAW_EXECUTION_AUDITS",
      doc_id: "OCEXSEPAUDV2__RUNBOOK",
    },
  };
}

function buildLiveCutoverReadinessFixture() {
  return {
    ok: true,
    reason: "V2_REPAIR_FIRESTORE_CANARY_READY_FOR_LIVE_PREFLIGHT",
    artifact_filename: "v2_repair_live_cutover_readiness_latest.json",
    artifact_current_dir_match: true,
    generated_at: "2026-04-22T12:00:00.000Z",
    artifact_generated_at: "2026-04-22T12:00:00.000Z",
    artifact_generated_age_minutes: 15,
    auto_apply: false,
    mutates_environment: false,
    runbook_checklist: ["19"],
    submit_check_ids: ["SUBMIT_CHK_11"],
    required_env_changes: [
      { name: "DONBEOLJA_V2_REPAIR_LIVE_ENABLE_REQUESTED", value: "1" },
      { name: "DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_REQUIRED", value: "1" },
      { name: "DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_REQUIRED", value: "1" },
      { name: "DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_REQUIRED", value: "1" },
    ],
  };
}

function buildProductionCutoverReadinessFixture() {
  return {
    ok: true,
    reason: "V2_PRODUCTION_CUTOVER_READINESS_PASS",
    artifact_filename: "v2_production_cutover_readiness_latest.json",
    artifact_current_dir_match: true,
    generated_at: "2026-04-22T12:00:00.000Z",
    artifact_generated_at: "2026-04-22T12:00:00.000Z",
    artifact_generated_age_minutes: 15,
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
  };
}

function buildSchedulerTrafficCutoverReadinessFixture() {
  return {
    ok: true,
    reason: "V2_SCHEDULER_TRAFFIC_CUTOVER_READINESS_PASS",
    artifact_filename: "v2_scheduler_traffic_cutover_readiness_latest.json",
    artifact_current_dir_match: true,
    generated_at: "2026-04-22T12:00:00.000Z",
    artifact_generated_at: "2026-04-22T12:00:00.000Z",
    artifact_generated_age_minutes: 15,
    fail_n: 0,
    scheduler_sot: "OPENCLAW_CRON",
    required_openclaw_job_ids: [
      "binance_exit_integrity_cycle",
      "openclaw_daily_cycle",
      "openclaw_hourly_cycle",
      "v2_repair_queue_service",
      "openclaw_server_primary_tick",
    ],
    missing_openclaw_job_ids: [],
    active_legacy_scheduler_jobs: [],
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
  };
}

function buildSchedulerTrafficCollectorPreflightFixture(filePath = null) {
  const requiredEnvNames = [
    "SCHEDULER_AUTOSTART",
    "DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE",
    "DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED",
    "DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED",
    "DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE",
    "DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE",
    "DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED",
    "DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED",
    "DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE",
    "DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE",
  ];
  return {
    ok: true,
    reason: "V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_PASS",
    artifact_filename: "v2_scheduler_traffic_collector_preflight_latest.json",
    artifact_current_dir_match: true,
    generated_at: "2026-04-22T12:00:00.000Z",
    artifact_generated_at: "2026-04-22T12:00:00.000Z",
    artifact_generated_age_minutes: 15,
    fail_n: 0,
    failed_check_ids: [],
    blocker_n: 0,
    project_id: "donbeolja-dev",
    region: "asia-northeast3",
    service_names: ["donbeolja", "donbeolja-exit-worker"],
    scheduler_job_n: 4,
    required_env_names: requiredEnvNames,
    required_env_exact_match_n: 2,
    required_env_mismatch_n: 0,
    ...(filePath ? { artifact_file: filePath, file: filePath } : {}),
  };
}

function buildLiveEvidenceReadinessFixture(filePath = null, cycleId = "PCY__RUNBOOK__LIVE_CUTOVER") {
  const outputFile = filePath || `/tmp/${cycleId}/v2_live_evidence_readiness_latest.json`;
  return {
    ok: true,
    reason: "V2_LIVE_EVIDENCE_READY",
    mode: "LIVE",
    artifact_dir: path.dirname(outputFile),
    position_cycle_id: cycleId,
    deploy_decision_approved: true,
    evidence_ready: true,
    deploy_ready: true,
    blocker_n: 0,
    blockers: [],
    deploy_decision_blockers: [],
    failed_axis_n: 0,
    failed_axis_ids: [],
    submit_check_ids: [],
    runbook_refs: [],
    axes: [
      { id: "production_runtime_chain", ok: true },
      { id: "repair_firestore_canary_streak", ok: true },
      { id: "production_entry_route_canary_streak", ok: true },
      { id: "exit_runtime_canary_streak", ok: true },
      { id: "production_entry_protected_canary", ok: true },
      { id: "openclaw_supreme_closed_loop", ok: true },
    ],
    temporal_coherence: {
      id: "live_evidence_temporal_coherence",
      ok: true,
      blockers: [],
    },
    output_file: outputFile,
    file: outputFile,
    artifact_file: outputFile,
    artifact_filename: "v2_live_evidence_readiness_latest.json",
    artifact_current_dir_match: true,
    generated_at: "2026-04-22T12:00:00.000Z",
    artifact_generated_at: "2026-04-22T12:00:00.000Z",
    artifact_generated_age_minutes: 15,
  };
}

function buildEntryBoundaryAuditFixture() {
  return {
    ok: true,
    reason: "V2_ENTRY_BOUNDARY_AUDIT_PASS",
    scope: "src/v2",
    checked_file_n: 12,
    violation_n: 0,
    violations: [],
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

function seedMinimalRunbookArtifacts(dir, cycleId, { deployDecisionPatch = {}, contextPatch = {} } = {}) {
  writeJson(dir, "promotion-preflight.json", {
    ok: true,
    position_cycle_id: cycleId,
    lineage_contract: LINEAGE_CONTRACT_FIXTURE,
  });
  writeJson(dir, "promotion-canary-flow.json", {
    ok: true,
    stage: "PIPELINE_PASS",
    position_cycle_id: cycleId,
  });
  writeJson(dir, "promotion-runtime-manifest.json", {
    snapshot_meta: {
      selector_meta: {
        position_cycle_id: cycleId,
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
      lineage_contract: LINEAGE_CONTRACT_FIXTURE,
    },
  });
  writeJson(dir, "unified-promotion-report.json", {
    position_cycle_id: cycleId,
  });
  writeJson(dir, "promotion-deploy-decision.json", {
    approved: true,
    position_cycle_id: cycleId,
    entry_boundary_audit: buildEntryBoundaryAuditFixture(),
    fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
    production_cutover_audit: buildProductionCutoverAuditFixture(),
    bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    ...deployDecisionPatch,
  });
  writeJson(dir, "promotion-cloudbuild-context.json", {
    position_cycle_id: cycleId,
    artifact_dir: dir,
    resolved_artifact_dir: dir,
    artifact_dir_coherence: buildArtifactDirCoherenceFixture(dir, cycleId),
    lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
    final_status_line: `APPROVE_DEPLOY ; cycle=${cycleId} ; blockers=0 ; warnings=0`,
    recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
    recommended_next_action_reason: "deploy decision approved with no blocking families",
    recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
    lineage_consistency_summary: buildLineageConsistencySummary(),
    submit_trace: buildWarningSubmitTrace([]),
    deploy_decision_summary: {
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      bounded_runtime_summary: {
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
      warning_summary: {
        warning_n: 0,
        top_warnings: [],
        has_live_readiness_warning: false,
        has_repair_firestore_canary_streak_warning: false,
        has_production_entry_route_canary_streak_warning: false,
      },
      blocker_summary: {
        blocker_n: 0,
      },
    },
    ...contextPatch,
  });
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

(function runbookReviewIncludesLiveEvidenceCycleChecklist() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runbook-live-evidence-cycle-check-"));
  try {
    const cycleId = "PCY__RUNBOOK__LIVE_EVIDENCE_CHECK";
    const dir = path.join(root, cycleId);
    fs.mkdirSync(dir, { recursive: true });
    seedMinimalRunbookArtifacts(dir, cycleId);
    const result = runbookCheck.runCanaryRunbookCheck({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_EXPECT_POSITION_CYCLE_ID: cycleId,
    });
    const check = result.review.checks.find((row) => row.id === "CHK_13E");
    assert.ok(check);
    assert.strictEqual(check.status, "PASS");
    assert.strictEqual(check.field, "deploy_decision_summary.blocker_summary.has_live_evidence_cycle_blocker,submit_trace.blocker_families,submit_trace.recommended_next_action_reason_code,final_status_line");
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function runbookCheckPassesForCoherentArtifactSet() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runbook-pass-"));
  try {
    const cycleId = "PCY__RUNBOOK__01";
    const dir = path.join(root, cycleId);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(dir, "promotion-preflight.json", {
      ok: true,
      position_cycle_id: cycleId,
      lineage_contract: LINEAGE_CONTRACT_FIXTURE,
    });
    writeJson(dir, "promotion-canary-flow.json", {
      ok: true,
      stage: "PIPELINE_PASS",
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-runtime-manifest.json", {
      snapshot_meta: {
        selector_meta: {
          position_cycle_id: cycleId,
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
    });
    writeJson(dir, "unified-promotion-report.json", {
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-deploy-decision.json", {
      approved: true,
      position_cycle_id: cycleId,
      selector_meta: {
        position_cycle_id: cycleId,
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
      entry_boundary_audit: buildEntryBoundaryAuditFixture(),
      fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
      production_cutover_audit: buildProductionCutoverAuditFixture(),
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      candidate_selection_summary: {
        selected_position_cycle_id: cycleId,
        selected_preflight: {
          position_cycle_id: cycleId,
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
      },
    });
    writeJson(dir, "promotion-cloudbuild-context.json", {
      position_cycle_id: cycleId,
      artifact_dir: dir,
      resolved_artifact_dir: dir,
      artifact_dir_coherence: buildArtifactDirCoherenceFixture(dir, cycleId),
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      final_status_line: `APPROVE_DEPLOY ; cycle=${cycleId} ; blockers=0 ; warnings=0`,
      recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
      recommended_next_action_reason: "deploy decision approved with no blocking families",
      recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
      lineage_consistency_summary: buildLineageConsistencySummary(),
      submit_trace: buildWarningSubmitTrace([]),
      deploy_decision_summary: {
        lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
        bounded_runtime_summary: {
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        warning_summary: {
          warning_n: 0,
          top_warnings: [],
          has_live_readiness_warning: false,
          has_repair_firestore_canary_streak_warning: false,
          has_production_entry_route_canary_streak_warning: false,
        },
        blocker_summary: {
          blocker_n: 0,
        },
      },
    });

    const contextFile = path.join(dir, "promotion-cloudbuild-context.json");
    const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
    context.lineage_consistency_summary = buildLineageConsistencySummary();
    context.deploy_decision_summary.lineage_contract_hash = LINEAGE_CONTRACT_FIXTURE.hash;
    context.deploy_decision_summary.bounded_runtime_summary = { lineage_contract: LINEAGE_CONTRACT_FIXTURE };
    fs.writeFileSync(contextFile, JSON.stringify(context, null, 2), "utf8");

    const result = await runbookCheck.main({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_EXPECT_POSITION_CYCLE_ID: cycleId,
    });
    assert.strictEqual(result.review.ok, true);
    assert.strictEqual(result.review.fail_n, 0);
    assert.strictEqual(result.review.skip_n, 0);
    const artifactDirCheck = result.review.checks.find((row) => row.id === "CHK_01A");
    assert.ok(artifactDirCheck);
    assert.strictEqual(artifactDirCheck.status, "PASS");
    assert.ok(fs.existsSync(path.join(dir, "promotion-runbook-review.json")));
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function runbookCheckFailsWhenPromotionPositionLineageDrifts() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runbook-position-lineage-drift-"));
  try {
    const cycleId = "PCY__RUNBOOK__POSITION_LINEAGE_A";
    const dir = path.join(root, cycleId);
    fs.mkdirSync(dir, { recursive: true });
    seedMinimalRunbookArtifacts(dir, cycleId, {
      deployDecisionPatch: {
        selector_meta: {
          position_cycle_id: "PCY__RUNBOOK__POSITION_LINEAGE_B",
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        candidate_selection_summary: {
          selected_position_cycle_id: cycleId,
          selected_preflight: {
            position_cycle_id: cycleId,
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
        },
      },
    });
    const result = runbookCheck.runCanaryRunbookCheck({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_EXPECT_POSITION_CYCLE_ID: cycleId,
    });
    assert.strictEqual(result.review.ok, false);
    assert.strictEqual(runbookCheck.__test.hasPromotionPositionLineageConsistency({
      position_cycle_id: cycleId,
      selector_meta: { position_cycle_id: "PCY__RUNBOOK__POSITION_LINEAGE_B" },
      candidate_selection_summary: {
        selected_position_cycle_id: cycleId,
        selected_preflight: { position_cycle_id: cycleId },
      },
    }), false);
    const candidateCheck = result.review.checks.find((row) => row.id === "CHK_09");
    assert.ok(candidateCheck);
    assert.strictEqual(candidateCheck.status, "FAIL");
    assert.strictEqual(candidateCheck.field, "selector_meta.position_cycle_id,candidate_selection_summary.selected_position_cycle_id,candidate_selection_summary.selected_preflight.position_cycle_id,position_cycle_id");
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function runbookCheckFailsWhenResolvedArtifactDirDrifts() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runbook-dir-drift-"));
  try {
    const cycleId = "PCY__RUNBOOK__DIR_DRIFT";
    const dir = path.join(root, cycleId);
    fs.mkdirSync(dir, { recursive: true });
    seedMinimalRunbookArtifacts(dir, cycleId, {
      contextPatch: {
        resolved_artifact_dir: path.join(root, "PCY__OTHER__DIR"),
      },
    });
    const result = runbookCheck.runCanaryRunbookCheck({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_EXPECT_POSITION_CYCLE_ID: cycleId,
    });
    assert.strictEqual(result.review.ok, false);
    const artifactDirCheck = result.review.checks.find((row) => row.id === "CHK_01A");
    assert.ok(artifactDirCheck);
    assert.strictEqual(artifactDirCheck.status, "FAIL");
    assert.strictEqual(artifactDirCheck.field, "artifact_dir,resolved_artifact_dir,artifact_dir_coherence,position_cycle_id");
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function runbookCheckFailsWhenContextSelfCheckIsFalse() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runbook-self-check-false-"));
  try {
    const cycleId = "PCY__RUNBOOK__SELF_CHECK_FALSE";
    const dir = path.join(root, cycleId);
    fs.mkdirSync(dir, { recursive: true });
    seedMinimalRunbookArtifacts(dir, cycleId, {
      contextPatch: {
        artifact_dir_coherence: buildArtifactDirCoherenceFixture(dir, cycleId, {
          ok: false,
          reason: "ARTIFACT_DIR_RESOLVED_DIR_MISMATCH",
          artifact_dir_matches_resolved_artifact_dir: false,
        }),
      },
    });
    const result = runbookCheck.runCanaryRunbookCheck({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_EXPECT_POSITION_CYCLE_ID: cycleId,
    });
    assert.strictEqual(result.review.ok, false);
    const artifactDirCheck = result.review.checks.find((row) => row.id === "CHK_01A");
    assert.ok(artifactDirCheck);
    assert.strictEqual(artifactDirCheck.status, "FAIL");
    assert.strictEqual(artifactDirCheck.reason, "context artifact dir, self-check, resolved dir, or selected cycle is inconsistent");
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function runbookCheckFailsWhenWarningSummaryDriftsFromDeployDecision() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runbook-warning-drift-"));
  try {
    const cycleId = "PCY__RUNBOOK__WARNING";
    const dir = path.join(root, cycleId);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(dir, "promotion-preflight.json", {
      ok: true,
      position_cycle_id: cycleId,
      lineage_contract: LINEAGE_CONTRACT_FIXTURE,
    });
    writeJson(dir, "promotion-canary-flow.json", {
      ok: true,
      stage: "PIPELINE_PASS",
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-runtime-manifest.json", {
      snapshot_meta: {
        selector_meta: {
          position_cycle_id: cycleId,
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
    });
    writeJson(dir, "unified-promotion-report.json", {
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-deploy-decision.json", {
      approved: true,
      position_cycle_id: cycleId,
      entry_boundary_audit: buildEntryBoundaryAuditFixture(),
      fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
      production_cutover_audit: buildProductionCutoverAuditFixture(),
      warnings: ["DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"],
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    });
    writeJson(dir, "promotion-cloudbuild-context.json", {
      position_cycle_id: cycleId,
      artifact_dir: dir,
      resolved_artifact_dir: dir,
      artifact_dir_coherence: buildArtifactDirCoherenceFixture(dir, cycleId),
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      final_status_line: `APPROVE_DEPLOY ; cycle=${cycleId} ; blockers=0 ; warnings=1`,
      recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
      recommended_next_action_reason: "deploy decision approved with no blocking families",
      recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
      lineage_consistency_summary: buildLineageConsistencySummary(),
      submit_trace: buildWarningSubmitTrace([]),
      deploy_decision_summary: {
        lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
        bounded_runtime_summary: {
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        warning_summary: {
          warning_n: 0,
          top_warnings: [],
        },
        blocker_summary: {
          blocker_n: 0,
        },
      },
    });

    const result = runbookCheck.runCanaryRunbookCheck({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_EXPECT_POSITION_CYCLE_ID: cycleId,
    });
    assert.strictEqual(result.review.ok, false);
    const warningCheck = result.review.checks.find((row) => row.id === "CHK_13B");
    assert.ok(warningCheck);
    assert.strictEqual(warningCheck.status, "FAIL");
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function runbookCheckPassesLiveCutoverReadinessForLiveMode() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runbook-live-cutover-pass-"));
  try {
    const cycleId = "PCY__RUNBOOK__LIVE_CUTOVER";
    const dir = path.join(root, cycleId);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(dir, "promotion-preflight.json", {
      ok: true,
      position_cycle_id: cycleId,
      lineage_contract: LINEAGE_CONTRACT_FIXTURE,
    });
    writeJson(dir, "promotion-canary-flow.json", {
      ok: true,
      stage: "PIPELINE_PASS",
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-runtime-manifest.json", {
      snapshot_meta: {
        selector_meta: {
          position_cycle_id: cycleId,
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
    });
    writeJson(dir, "unified-promotion-report.json", {
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-deploy-decision.json", {
      mode: "LIVE",
      approved: true,
      position_cycle_id: cycleId,
      entry_boundary_audit: buildEntryBoundaryAuditFixture(),
      fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
      production_cutover_audit: buildProductionCutoverAuditFixture(),
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    });
    const liveEvidenceReadinessFile = path.join(dir, "v2_live_evidence_readiness_latest.json");
    writeJson(dir, "promotion-cloudbuild-context.json", {
      position_cycle_id: cycleId,
      artifact_dir: dir,
      resolved_artifact_dir: dir,
      artifact_dir_coherence: buildArtifactDirCoherenceFixture(dir, cycleId),
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      final_status_line: `APPROVE_DEPLOY ; cycle=${cycleId} ; blockers=0 ; warnings=0`,
      recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
      recommended_next_action_reason: "deploy decision approved with no blocking families",
      recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
      lineage_consistency_summary: buildLineageConsistencySummary(),
      submit_trace: buildWarningSubmitTrace([]),
      production_cutover_readiness_file: path.join(dir, "v2_production_cutover_readiness_latest.json"),
      production_cutover_readiness_summary: {
        ok: true,
        reason: "V2_PRODUCTION_CUTOVER_READINESS_PASS",
        blocker_n: 0,
        guard_reason: "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED",
        legacy_webhook_blocked: true,
      },
      scheduler_traffic_collector_preflight_file: path.join(dir, "v2_scheduler_traffic_collector_preflight_latest.json"),
      scheduler_traffic_collector_preflight_summary: buildSchedulerTrafficCollectorPreflightFixture(path.join(dir, "v2_scheduler_traffic_collector_preflight_latest.json")),
      scheduler_traffic_cutover_readiness_file: path.join(dir, "v2_scheduler_traffic_cutover_readiness_latest.json"),
      scheduler_traffic_cutover_readiness_summary: {
        ...buildSchedulerTrafficCutoverReadinessFixture(),
        blocker_n: 0,
      },
      live_evidence_readiness_file: liveEvidenceReadinessFile,
      live_evidence_readiness_summary: buildLiveEvidenceReadinessFixture(liveEvidenceReadinessFile, cycleId),
      deploy_decision_summary: {
        lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
        bounded_runtime_summary: {
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        warning_summary: {
          warning_n: 0,
          top_warnings: [],
          has_live_readiness_warning: false,
          has_repair_firestore_canary_streak_warning: false,
          has_production_entry_route_canary_streak_warning: false,
        },
        blocker_summary: {
          blocker_n: 0,
        },
      },
    });
    writeJson(dir, "v2_repair_live_cutover_readiness_latest.json", buildLiveCutoverReadinessFixture());
    writeJson(dir, "v2_production_cutover_readiness_latest.json", buildProductionCutoverReadinessFixture());
    writeJson(dir, "v2_scheduler_traffic_collector_preflight_latest.json", buildSchedulerTrafficCollectorPreflightFixture(path.join(dir, "v2_scheduler_traffic_collector_preflight_latest.json")));
    writeJson(dir, "v2_scheduler_traffic_cutover_readiness_latest.json", buildSchedulerTrafficCutoverReadinessFixture());
    writeJson(dir, "v2_live_evidence_readiness_latest.json", buildLiveEvidenceReadinessFixture(liveEvidenceReadinessFile, cycleId));

    const result = runbookCheck.runCanaryRunbookCheck({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_EXPECT_POSITION_CYCLE_ID: cycleId,
    });
    assert.strictEqual(result.review.ok, true);
    const cutoverCheck = result.review.checks.find((row) => row.id === "CHK_20");
    assert.ok(cutoverCheck);
    assert.strictEqual(cutoverCheck.status, "PASS");
    const productionCutoverCheck = result.review.checks.find((row) => row.id === "CHK_23");
    assert.ok(productionCutoverCheck);
    assert.strictEqual(productionCutoverCheck.status, "PASS");
    const schedulerTrafficCutoverCheck = result.review.checks.find((row) => row.id === "CHK_24");
    assert.ok(schedulerTrafficCutoverCheck);
    assert.strictEqual(schedulerTrafficCutoverCheck.status, "PASS");
    const schedulerTrafficCollectorCheck = result.review.checks.find((row) => row.id === "CHK_24A");
    assert.ok(schedulerTrafficCollectorCheck);
    assert.strictEqual(schedulerTrafficCollectorCheck.status, "PASS");
    const liveEvidenceReadinessCheck = result.review.checks.find((row) => row.id === "CHK_13G");
    assert.ok(liveEvidenceReadinessCheck);
    assert.strictEqual(liveEvidenceReadinessCheck.status, "PASS");
    const readinessFreshnessCheck = result.review.checks.find((row) => row.id === "CHK_24B");
    assert.ok(readinessFreshnessCheck);
    assert.strictEqual(readinessFreshnessCheck.status, "PASS");
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function runbookCheckFailsWhenSchedulerCollectorCanaryEnvProofIsMissing() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runbook-live-collector-env-"));
  try {
    const cycleId = "PCY__RUNBOOK__LIVE_COLLECTOR_ENV";
    const dir = path.join(root, cycleId);
    fs.mkdirSync(dir, { recursive: true });
    const collectorFile = path.join(dir, "v2_scheduler_traffic_collector_preflight_latest.json");
    const liveEvidenceReadinessFile = path.join(dir, "v2_live_evidence_readiness_latest.json");
    const badCollector = {
      ...buildSchedulerTrafficCollectorPreflightFixture(collectorFile),
      required_env_exact_match_n: 1,
      required_env_mismatch_n: 1,
    };
    seedMinimalRunbookArtifacts(dir, cycleId, {
      deployDecisionPatch: { mode: "LIVE" },
      contextPatch: {
        live_cutover_readiness_file: path.join(dir, "v2_repair_live_cutover_readiness_latest.json"),
        live_cutover_readiness_summary: buildLiveCutoverReadinessFixture(),
        production_cutover_readiness_file: path.join(dir, "v2_production_cutover_readiness_latest.json"),
        production_cutover_readiness_summary: {
          ok: true,
          reason: "V2_PRODUCTION_CUTOVER_READINESS_PASS",
          blocker_n: 0,
          guard_reason: "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED",
          legacy_webhook_blocked: true,
        },
        scheduler_traffic_collector_preflight_file: collectorFile,
        scheduler_traffic_collector_preflight_summary: badCollector,
        scheduler_traffic_cutover_readiness_file: path.join(dir, "v2_scheduler_traffic_cutover_readiness_latest.json"),
        scheduler_traffic_cutover_readiness_summary: buildSchedulerTrafficCutoverReadinessFixture(),
        live_evidence_readiness_file: liveEvidenceReadinessFile,
        live_evidence_readiness_summary: buildLiveEvidenceReadinessFixture(liveEvidenceReadinessFile, cycleId),
      },
    });
    writeJson(dir, "v2_repair_live_cutover_readiness_latest.json", buildLiveCutoverReadinessFixture());
    writeJson(dir, "v2_production_cutover_readiness_latest.json", buildProductionCutoverReadinessFixture());
    writeJson(dir, "v2_scheduler_traffic_collector_preflight_latest.json", badCollector);
    writeJson(dir, "v2_scheduler_traffic_cutover_readiness_latest.json", buildSchedulerTrafficCutoverReadinessFixture());
    writeJson(dir, "v2_live_evidence_readiness_latest.json", buildLiveEvidenceReadinessFixture(liveEvidenceReadinessFile, cycleId));

    const result = runbookCheck.runCanaryRunbookCheck({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_EXPECT_POSITION_CYCLE_ID: cycleId,
    });
    assert.strictEqual(result.review.ok, false);
    const collectorCheck = result.review.checks.find((row) => row.id === "CHK_24A");
    assert.ok(collectorCheck);
    assert.strictEqual(collectorCheck.status, "FAIL");
    assert.strictEqual(collectorCheck.field, "reason,project_id,region,service_names,required_env_exact_match_n,required_env_mismatch_n,required_env_names,scheduler_traffic_collector_preflight_summary");
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function runbookCheckFailsWhenLiveReadinessArtifactIsStale() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runbook-live-readiness-stale-"));
  try {
    const cycleId = "PCY__RUNBOOK__LIVE_READINESS_STALE";
    const dir = path.join(root, cycleId);
    fs.mkdirSync(dir, { recursive: true });
    const liveEvidenceReadinessFile = path.join(dir, "v2_live_evidence_readiness_latest.json");
    seedMinimalRunbookArtifacts(dir, cycleId, {
      deployDecisionPatch: { mode: "LIVE" },
      contextPatch: {
        live_cutover_readiness_file: path.join(dir, "v2_repair_live_cutover_readiness_latest.json"),
        live_cutover_readiness_summary: buildLiveCutoverReadinessFixture(),
        production_cutover_readiness_file: path.join(dir, "v2_production_cutover_readiness_latest.json"),
        production_cutover_readiness_summary: {
          ok: true,
          reason: "V2_PRODUCTION_CUTOVER_READINESS_PASS",
          blocker_n: 0,
          guard_reason: "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED",
          legacy_webhook_blocked: true,
        },
        scheduler_traffic_collector_preflight_file: path.join(dir, "v2_scheduler_traffic_collector_preflight_latest.json"),
        scheduler_traffic_collector_preflight_summary: buildSchedulerTrafficCollectorPreflightFixture(path.join(dir, "v2_scheduler_traffic_collector_preflight_latest.json")),
        scheduler_traffic_cutover_readiness_file: path.join(dir, "v2_scheduler_traffic_cutover_readiness_latest.json"),
        scheduler_traffic_cutover_readiness_summary: buildSchedulerTrafficCutoverReadinessFixture(),
        live_evidence_readiness_file: liveEvidenceReadinessFile,
        live_evidence_readiness_summary: buildLiveEvidenceReadinessFixture(liveEvidenceReadinessFile, cycleId),
      },
    });
    writeJson(dir, "v2_repair_live_cutover_readiness_latest.json", buildLiveCutoverReadinessFixture());
    writeJson(dir, "v2_production_cutover_readiness_latest.json", {
      ...buildProductionCutoverReadinessFixture(),
      artifact_generated_age_minutes: runbookCheck.__test.MAX_LIVE_READINESS_ARTIFACT_AGE_MINUTES + 1,
    });
    writeJson(dir, "v2_scheduler_traffic_collector_preflight_latest.json", buildSchedulerTrafficCollectorPreflightFixture(path.join(dir, "v2_scheduler_traffic_collector_preflight_latest.json")));
    writeJson(dir, "v2_scheduler_traffic_cutover_readiness_latest.json", buildSchedulerTrafficCutoverReadinessFixture());
    writeJson(dir, "v2_live_evidence_readiness_latest.json", buildLiveEvidenceReadinessFixture(liveEvidenceReadinessFile, cycleId));

    const result = runbookCheck.runCanaryRunbookCheck({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_EXPECT_POSITION_CYCLE_ID: cycleId,
    });
    assert.strictEqual(result.review.ok, false);
    const readinessFreshnessCheck = result.review.checks.find((row) => row.id === "CHK_24B");
    assert.ok(readinessFreshnessCheck);
    assert.strictEqual(readinessFreshnessCheck.status, "FAIL");
    assert.strictEqual(readinessFreshnessCheck.field, "v2_repair_live_cutover_readiness_latest.json,v2_production_cutover_readiness_latest.json,v2_scheduler_traffic_collector_preflight_latest.json,v2_scheduler_traffic_cutover_readiness_latest.json,v2_live_evidence_readiness_latest.json");
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function runbookCheckFailsLiveModeWithoutLiveEvidenceReadinessSummary() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runbook-live-evidence-missing-"));
  try {
    const cycleId = "PCY__RUNBOOK__LIVE_EVIDENCE_MISSING";
    const dir = path.join(root, cycleId);
    fs.mkdirSync(dir, { recursive: true });
    seedMinimalRunbookArtifacts(dir, cycleId, {
      deployDecisionPatch: { mode: "LIVE" },
      contextPatch: {
        live_cutover_readiness_file: path.join(dir, "v2_repair_live_cutover_readiness_latest.json"),
        live_cutover_readiness_summary: buildLiveCutoverReadinessFixture(),
        production_cutover_readiness_file: path.join(dir, "v2_production_cutover_readiness_latest.json"),
        production_cutover_readiness_summary: {
          ok: true,
          reason: "V2_PRODUCTION_CUTOVER_READINESS_PASS",
          blocker_n: 0,
          guard_reason: "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED",
          legacy_webhook_blocked: true,
        },
        scheduler_traffic_collector_preflight_file: path.join(dir, "v2_scheduler_traffic_collector_preflight_latest.json"),
        scheduler_traffic_collector_preflight_summary: buildSchedulerTrafficCollectorPreflightFixture(path.join(dir, "v2_scheduler_traffic_collector_preflight_latest.json")),
        scheduler_traffic_cutover_readiness_file: path.join(dir, "v2_scheduler_traffic_cutover_readiness_latest.json"),
        scheduler_traffic_cutover_readiness_summary: buildSchedulerTrafficCutoverReadinessFixture(),
      },
    });
    writeJson(dir, "v2_repair_live_cutover_readiness_latest.json", buildLiveCutoverReadinessFixture());
    writeJson(dir, "v2_production_cutover_readiness_latest.json", buildProductionCutoverReadinessFixture());
    writeJson(dir, "v2_scheduler_traffic_collector_preflight_latest.json", buildSchedulerTrafficCollectorPreflightFixture(path.join(dir, "v2_scheduler_traffic_collector_preflight_latest.json")));
    writeJson(dir, "v2_scheduler_traffic_cutover_readiness_latest.json", buildSchedulerTrafficCutoverReadinessFixture());

    const result = runbookCheck.runCanaryRunbookCheck({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_EXPECT_POSITION_CYCLE_ID: cycleId,
    });
    assert.strictEqual(result.review.ok, false);
    const liveEvidenceReadinessCheck = result.review.checks.find((row) => row.id === "CHK_13G");
    assert.ok(liveEvidenceReadinessCheck);
    assert.strictEqual(liveEvidenceReadinessCheck.status, "FAIL");
    assert.strictEqual(liveEvidenceReadinessCheck.field, "live_evidence_readiness_summary,live_evidence_readiness_file,failed_axis_ids,submit_check_ids,runbook_refs,temporal_coherence");
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function runbookCheckFailsLiveModeWithoutCutoverReadiness() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runbook-live-cutover-missing-"));
  try {
    const cycleId = "PCY__RUNBOOK__LIVE_CUTOVER_MISSING";
    const dir = path.join(root, cycleId);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(dir, "promotion-preflight.json", {
      ok: true,
      position_cycle_id: cycleId,
      lineage_contract: LINEAGE_CONTRACT_FIXTURE,
    });
    writeJson(dir, "promotion-canary-flow.json", {
      ok: true,
      stage: "PIPELINE_PASS",
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-runtime-manifest.json", {
      snapshot_meta: {
        selector_meta: {
          position_cycle_id: cycleId,
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
    });
    writeJson(dir, "unified-promotion-report.json", {
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-deploy-decision.json", {
      mode: "LIVE",
      approved: true,
      position_cycle_id: cycleId,
      entry_boundary_audit: buildEntryBoundaryAuditFixture(),
      fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
      production_cutover_audit: buildProductionCutoverAuditFixture(),
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    });
    writeJson(dir, "promotion-cloudbuild-context.json", {
      position_cycle_id: cycleId,
      artifact_dir: dir,
      resolved_artifact_dir: dir,
      artifact_dir_coherence: buildArtifactDirCoherenceFixture(dir, cycleId),
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      final_status_line: `APPROVE_DEPLOY ; cycle=${cycleId} ; blockers=0 ; warnings=0`,
      recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
      recommended_next_action_reason: "deploy decision approved with no blocking families",
      recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
      lineage_consistency_summary: buildLineageConsistencySummary(),
      submit_trace: buildWarningSubmitTrace([]),
      deploy_decision_summary: {
        lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
        bounded_runtime_summary: {
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        warning_summary: {
          warning_n: 0,
          top_warnings: [],
          has_live_readiness_warning: false,
          has_repair_firestore_canary_streak_warning: false,
          has_production_entry_route_canary_streak_warning: false,
        },
        blocker_summary: {
          blocker_n: 0,
        },
      },
    });

    const result = runbookCheck.runCanaryRunbookCheck({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_EXPECT_POSITION_CYCLE_ID: cycleId,
    });
    assert.strictEqual(result.review.ok, false);
    const cutoverCheck = result.review.checks.find((row) => row.id === "CHK_20");
    assert.ok(cutoverCheck);
    assert.strictEqual(cutoverCheck.status, "FAIL");
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function warningSummaryHelperAcceptsMatchingWarningTopline() {
  assert.strictEqual(runbookCheck.__test.hasConsistentWarningSummary({
    deployDecision: {
      warnings: ["DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"],
    },
    cloudbuildContext: {
      final_status_line: "APPROVE_DEPLOY ; warnings=1 ; warn=DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY",
      submit_trace: buildWarningSubmitTrace(["DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"]),
      deploy_decision_summary: {
        warning_summary: {
          warning_n: 1,
          top_warnings: ["DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"],
          has_live_readiness_warning: true,
          has_repair_firestore_canary_streak_warning: true,
          has_production_entry_route_canary_streak_warning: false,
        },
      },
    },
  }), true);
})();

(function warningSummaryHelperAcceptsNoWarningClassifierContract() {
  assert.strictEqual(runbookCheck.__test.hasConsistentWarningSummary({
    deployDecision: {
      warnings: [],
    },
    cloudbuildContext: {
      final_status_line: "APPROVE_DEPLOY ; warnings=0",
      submit_trace: buildWarningSubmitTrace([]),
      deploy_decision_summary: {
        warning_summary: {
          warning_n: 0,
          top_warnings: [],
          has_live_readiness_warning: false,
          has_repair_firestore_canary_streak_warning: false,
          has_production_entry_route_canary_streak_warning: false,
        },
      },
    },
  }), true);
})();

(function warningSummaryHelperRejectsMissingNoWarningClassifiers() {
  assert.strictEqual(runbookCheck.__test.hasConsistentWarningSummary({
    deployDecision: {
      warnings: [],
    },
    cloudbuildContext: {
      final_status_line: "APPROVE_DEPLOY ; warnings=0",
      submit_trace: buildWarningSubmitTrace([]),
      deploy_decision_summary: {
        warning_summary: {
          warning_n: 0,
          top_warnings: [],
        },
      },
    },
  }), false);
})();

(function warningSummaryHelperRejectsSubmitTraceWarningDrift() {
  assert.strictEqual(runbookCheck.__test.hasConsistentWarningSummary({
    deployDecision: {
      warnings: ["DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"],
    },
    cloudbuildContext: {
      final_status_line: "APPROVE_DEPLOY ; warnings=1 ; warn=DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY",
      submit_trace: buildWarningSubmitTrace(["DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"]),
      deploy_decision_summary: {
        warning_summary: {
          warning_n: 1,
          top_warnings: ["DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"],
          has_live_readiness_warning: true,
          has_repair_firestore_canary_streak_warning: false,
          has_production_entry_route_canary_streak_warning: true,
        },
      },
    },
  }), false);
})();

(function warningSummaryHelperAcceptsProductionRouteStreakClassifier() {
  assert.strictEqual(runbookCheck.__test.hasConsistentWarningSummary({
    deployDecision: {
      warnings: ["DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"],
    },
    cloudbuildContext: {
      final_status_line: "APPROVE_DEPLOY ; warnings=1 ; warn=DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY",
      submit_trace: buildWarningSubmitTrace(["DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"]),
      deploy_decision_summary: {
        warning_summary: {
          warning_n: 1,
          top_warnings: ["DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"],
          has_live_readiness_warning: true,
          has_repair_firestore_canary_streak_warning: false,
          has_production_entry_route_canary_streak_warning: true,
        },
      },
    },
  }), true);
})();

(function contextSubmitTraceHelperAcceptsMatchingContextChecks() {
  assert.strictEqual(runbookCheck.__test.hasConsistentContextSubmitTrace({
    cloudbuildContext: {
      artifact_dir_coherence: buildArtifactDirCoherenceFixture("/tmp/PCY__TRACE__OK", "PCY__TRACE__OK"),
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      lineage_consistency_summary: buildLineageConsistencySummary(),
      recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
      recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
      submit_trace: buildWarningSubmitTrace([]),
      deploy_decision_summary: {
        lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
        blocker_summary: {
          blocker_n: 0,
        },
      },
    },
  }), true);
})();

(function contextSubmitTraceHelperAcceptsProtectedEntryCanaryCheck() {
  assert.strictEqual(runbookCheck.__test.hasConsistentContextSubmitTrace({
    cloudbuildContext: {
      artifact_dir_coherence: buildArtifactDirCoherenceFixture("/tmp/PCY__TRACE__PROTECTED", "PCY__TRACE__PROTECTED"),
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      lineage_consistency_summary: buildLineageConsistencySummary(),
      final_status_line: "HOLD ; cycle=PCY__TRACE__PROTECTED ; blockers=1 ; warnings=0 ; protected_entry_canary=BLOCKED ; top=DEPLOY_DECISION:PRODUCTION_ENTRY_PROTECTED_CANARY_REQUIRED",
      recommended_next_action: "FIX_V2_PROTECTED_ENTRY_CANARY_AND_RECHECK_DEPLOY_DECISION",
      recommended_next_action_reason_code: "PROTECTED_ENTRY_CANARY_BLOCKER",
      submit_trace: {
        relevant_submit_check_ids: ["SUBMIT_CHK_01A", "SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08", "SUBMIT_CHK_20A"],
        relevant_runbook_checklist: ["1", "5", "9", "11", "13", "16", "17", "27A"],
        failed_submit_check_ids: ["SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_20A"],
        failed_runbook_checklist: ["11", "13", "27A"],
        blocker_families: ["PROTECTED_ENTRY_CANARY"],
        primary_blocker_family: "PROTECTED_ENTRY_CANARY",
        recommended_next_action_reason_code: "PROTECTED_ENTRY_CANARY_BLOCKER",
        checks: [
          {
            id: "SUBMIT_CHK_01A",
            ok: true,
            runbook_checklist: ["1", "5", "9"],
            fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_01A,
          },
          {
            id: "SUBMIT_CHK_06",
            ok: false,
            runbook_checklist: ["11"],
            fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_06,
          },
          {
            id: "SUBMIT_CHK_07",
            ok: false,
            runbook_checklist: ["13"],
            fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_07,
          },
          {
            id: "SUBMIT_CHK_08",
            ok: true,
            runbook_checklist: ["16", "17"],
            fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_08,
          },
          {
            id: "SUBMIT_CHK_20A",
            ok: false,
            runbook_checklist: ["27A"],
            fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_20A,
          },
        ],
      },
      deploy_decision_summary: {
        lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
        bounded_runtime_summary: {
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        blocker_summary: {
          blocker_n: 1,
          has_production_entry_protected_canary_blocker: true,
        },
      },
    },
  }), true);
})();

(function contextSubmitTraceHelperAcceptsLiveEvidenceCycleBlocker() {
  assert.strictEqual(runbookCheck.__test.hasConsistentContextSubmitTrace({
    cloudbuildContext: {
      artifact_dir_coherence: buildArtifactDirCoherenceFixture("/tmp/PCY__TRACE__LIVE_EVIDENCE", "PCY__TRACE__LIVE_EVIDENCE"),
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      lineage_consistency_summary: buildLineageConsistencySummary(),
      final_status_line: "HOLD ; cycle=PCY__TRACE__LIVE_EVIDENCE ; blockers=1 ; warnings=0 ; live_evidence_cycle=BLOCKED ; top=DEPLOY_DECISION:LIVE_EVIDENCE_ARTIFACT_CYCLE_MISMATCH",
      recommended_next_action: "DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE",
      recommended_next_action_reason_code: "LIVE_EVIDENCE_CYCLE_BLOCKER",
      submit_trace: {
        relevant_submit_check_ids: ["SUBMIT_CHK_01A", "SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08"],
        relevant_runbook_checklist: ["1", "5", "9", "11", "13", "16", "17"],
        failed_submit_check_ids: ["SUBMIT_CHK_06", "SUBMIT_CHK_07"],
        failed_runbook_checklist: ["11", "13"],
        blocker_families: ["LIVE_EVIDENCE_CYCLE"],
        primary_blocker_family: "LIVE_EVIDENCE_CYCLE",
        recommended_next_action_reason_code: "LIVE_EVIDENCE_CYCLE_BLOCKER",
        checks: [
          {
            id: "SUBMIT_CHK_01A",
            ok: true,
            runbook_checklist: ["1", "5", "9"],
            fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_01A,
          },
          {
            id: "SUBMIT_CHK_06",
            ok: false,
            runbook_checklist: ["11"],
            fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_06,
          },
          {
            id: "SUBMIT_CHK_07",
            ok: false,
            runbook_checklist: ["13"],
            fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_07,
          },
          {
            id: "SUBMIT_CHK_08",
            ok: true,
            runbook_checklist: ["16", "17"],
            fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_08,
          },
        ],
      },
      deploy_decision_summary: {
        lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
        bounded_runtime_summary: {
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        blocker_summary: {
          blocker_n: 1,
          has_live_evidence_cycle_blocker: true,
        },
      },
    },
  }), true);
})();

(function contextSubmitTraceHelperAcceptsOpenClawSupremeBlocker() {
  assert.strictEqual(runbookCheck.__test.hasConsistentContextSubmitTrace({
    cloudbuildContext: {
      artifact_dir_coherence: buildArtifactDirCoherenceFixture("/tmp/PCY__TRACE__OPENCLAW_SUPREME", "PCY__TRACE__OPENCLAW_SUPREME"),
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      lineage_consistency_summary: buildLineageConsistencySummary(),
      final_status_line: "HOLD ; cycle=PCY__TRACE__OPENCLAW_SUPREME ; blockers=1 ; warnings=0 ; openclaw_supreme=BLOCKED ; top=DEPLOY_DECISION:OPENCLAW_SUPREME_CONTROL_PLANE_CLOSED_LOOP_REQUIRED",
      recommended_next_action: "FIX_OPENCLAW_SUPREME_CONTROL_PLANE_AND_RECHECK_DEPLOY_DECISION",
      recommended_next_action_reason_code: "OPENCLAW_SUPREME_CONTROL_PLANE_BLOCKER",
      submit_trace: {
        relevant_submit_check_ids: ["SUBMIT_CHK_01A", "SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08", "SUBMIT_CHK_23"],
        relevant_runbook_checklist: ["1", "5", "9", "11", "13", "16", "17", "31"],
        failed_submit_check_ids: ["SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_23"],
        failed_runbook_checklist: ["11", "13", "31"],
        blocker_families: ["OPENCLAW_SUPREME_CONTROL_PLANE"],
        primary_blocker_family: "OPENCLAW_SUPREME_CONTROL_PLANE",
        recommended_next_action_reason_code: "OPENCLAW_SUPREME_CONTROL_PLANE_BLOCKER",
        checks: [
          {
            id: "SUBMIT_CHK_01A",
            ok: true,
            runbook_checklist: ["1", "5", "9"],
            fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_01A,
          },
          {
            id: "SUBMIT_CHK_06",
            ok: false,
            runbook_checklist: ["11"],
            fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_06,
          },
          {
            id: "SUBMIT_CHK_07",
            ok: false,
            runbook_checklist: ["13"],
            fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_07,
          },
          {
            id: "SUBMIT_CHK_08",
            ok: true,
            runbook_checklist: ["16", "17"],
            fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_08,
          },
          {
            id: "SUBMIT_CHK_23",
            ok: false,
            runbook_checklist: ["31"],
            fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_23,
          },
        ],
      },
      deploy_decision_summary: {
        lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
        bounded_runtime_summary: {
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
          openclaw_supreme_control_plane_summary: { ok: false },
        },
        blocker_summary: {
          blocker_n: 1,
          has_openclaw_supreme_control_plane_blocker: true,
        },
      },
    },
  }), true);
})();

(function contextSubmitTraceHelperRejectsLiveEvidenceCycleStatusLineDrift() {
  const context = {
    artifact_dir_coherence: buildArtifactDirCoherenceFixture("/tmp/PCY__TRACE__LIVE_EVIDENCE_DRIFT", "PCY__TRACE__LIVE_EVIDENCE_DRIFT"),
    lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
    lineage_consistency_summary: buildLineageConsistencySummary(),
    final_status_line: "HOLD ; cycle=PCY__TRACE__LIVE_EVIDENCE_DRIFT ; blockers=1 ; warnings=0 ; top=DEPLOY_DECISION:LIVE_EVIDENCE_ARTIFACT_CYCLE_MISMATCH",
    recommended_next_action: "DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE",
    recommended_next_action_reason_code: "LIVE_EVIDENCE_CYCLE_BLOCKER",
    submit_trace: {
      relevant_submit_check_ids: ["SUBMIT_CHK_01A", "SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08"],
      relevant_runbook_checklist: ["1", "5", "9", "11", "13", "16", "17"],
      failed_submit_check_ids: ["SUBMIT_CHK_06", "SUBMIT_CHK_07"],
      failed_runbook_checklist: ["11", "13"],
      blocker_families: ["LIVE_EVIDENCE_CYCLE"],
      primary_blocker_family: "LIVE_EVIDENCE_CYCLE",
      recommended_next_action_reason_code: "LIVE_EVIDENCE_CYCLE_BLOCKER",
      checks: [
        { id: "SUBMIT_CHK_01A", ok: true, runbook_checklist: ["1", "5", "9"], fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_01A },
        { id: "SUBMIT_CHK_06", ok: false, runbook_checklist: ["11"], fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_06 },
        { id: "SUBMIT_CHK_07", ok: false, runbook_checklist: ["13"], fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_07 },
        { id: "SUBMIT_CHK_08", ok: true, runbook_checklist: ["16", "17"], fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_08 },
      ],
    },
    deploy_decision_summary: {
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      bounded_runtime_summary: {
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
      blocker_summary: {
        blocker_n: 1,
        has_live_evidence_cycle_blocker: true,
      },
    },
  };
  assert.strictEqual(runbookCheck.__test.hasConsistentContextSubmitTrace({ cloudbuildContext: context }), false);
  assert.strictEqual(runbookCheck.__test.hasConsistentLiveEvidenceCycleBlockerTrace({ cloudbuildContext: context }), false);
})();

(function contextSubmitTraceHelperRejectsOpenClawSupremeStatusLineDrift() {
  const context = {
    artifact_dir_coherence: buildArtifactDirCoherenceFixture("/tmp/PCY__TRACE__OPENCLAW_DRIFT", "PCY__TRACE__OPENCLAW_DRIFT"),
    lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
    lineage_consistency_summary: buildLineageConsistencySummary(),
    final_status_line: "HOLD ; cycle=PCY__TRACE__OPENCLAW_DRIFT ; blockers=1 ; warnings=0 ; top=DEPLOY_DECISION:OPENCLAW_SUPREME_CONTROL_PLANE_CLOSED_LOOP_REQUIRED",
    recommended_next_action: "FIX_OPENCLAW_SUPREME_CONTROL_PLANE_AND_RECHECK_DEPLOY_DECISION",
    recommended_next_action_reason_code: "OPENCLAW_SUPREME_CONTROL_PLANE_BLOCKER",
    submit_trace: {
      relevant_submit_check_ids: ["SUBMIT_CHK_01A", "SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08", "SUBMIT_CHK_23"],
      relevant_runbook_checklist: ["1", "5", "9", "11", "13", "16", "17", "31"],
      failed_submit_check_ids: ["SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_23"],
      failed_runbook_checklist: ["11", "13", "31"],
      blocker_families: ["OPENCLAW_SUPREME_CONTROL_PLANE"],
      primary_blocker_family: "OPENCLAW_SUPREME_CONTROL_PLANE",
      recommended_next_action_reason_code: "OPENCLAW_SUPREME_CONTROL_PLANE_BLOCKER",
      checks: [
        { id: "SUBMIT_CHK_01A", ok: true, runbook_checklist: ["1", "5", "9"], fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_01A },
        { id: "SUBMIT_CHK_06", ok: false, runbook_checklist: ["11"], fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_06 },
        { id: "SUBMIT_CHK_07", ok: false, runbook_checklist: ["13"], fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_07 },
        { id: "SUBMIT_CHK_08", ok: true, runbook_checklist: ["16", "17"], fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_08 },
        { id: "SUBMIT_CHK_23", ok: false, runbook_checklist: ["31"], fields: runbookCheck.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_23 },
      ],
    },
    deploy_decision_summary: {
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      bounded_runtime_summary: {
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        openclaw_supreme_control_plane_summary: { ok: false },
      },
      blocker_summary: {
        blocker_n: 1,
        has_openclaw_supreme_control_plane_blocker: true,
      },
    },
  };
  assert.strictEqual(runbookCheck.__test.hasConsistentContextSubmitTrace({ cloudbuildContext: context }), false);
  assert.strictEqual(runbookCheck.__test.hasConsistentOpenClawSupremeBlockerTrace({ cloudbuildContext: context }), false);
})();

(function contextSubmitTraceHelperRejectsFieldTraceDrift() {
  const trace = buildWarningSubmitTrace([]);
  assert.strictEqual(runbookCheck.__test.hasConsistentContextSubmitTrace({
    cloudbuildContext: {
      artifact_dir_coherence: buildArtifactDirCoherenceFixture("/tmp/PCY__TRACE__FIELD_DRIFT", "PCY__TRACE__FIELD_DRIFT"),
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      lineage_consistency_summary: buildLineageConsistencySummary(),
      recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
      recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
      submit_trace: {
        ...trace,
        checks: trace.checks.map((row) => (
          row.id === "SUBMIT_CHK_08"
            ? { ...row, fields: ["lineage_contract_hash"] }
            : row
        )),
      },
      deploy_decision_summary: {
        lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
        bounded_runtime_summary: {
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        blocker_summary: {
          blocker_n: 0,
        },
      },
    },
  }), false);
})();

(function contextSubmitTraceHelperRejectsProtectedEntryCanaryStatusLineDrift() {
  assert.strictEqual(runbookCheck.__test.hasConsistentContextSubmitTrace({
    cloudbuildContext: {
      artifact_dir_coherence: buildArtifactDirCoherenceFixture("/tmp/PCY__TRACE__PROTECTED_DRIFT", "PCY__TRACE__PROTECTED_DRIFT"),
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      lineage_consistency_summary: buildLineageConsistencySummary(),
      final_status_line: "HOLD ; cycle=PCY__TRACE__PROTECTED_DRIFT ; blockers=1 ; warnings=0 ; top=DEPLOY_DECISION:PRODUCTION_ENTRY_PROTECTED_CANARY_REQUIRED",
      recommended_next_action: "FIX_V2_PROTECTED_ENTRY_CANARY_AND_RECHECK_DEPLOY_DECISION",
      recommended_next_action_reason_code: "PROTECTED_ENTRY_CANARY_BLOCKER",
      submit_trace: {
        relevant_submit_check_ids: ["SUBMIT_CHK_01A", "SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08", "SUBMIT_CHK_20A"],
        relevant_runbook_checklist: ["1", "5", "9", "11", "13", "16", "17", "27A"],
        failed_submit_check_ids: ["SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_20A"],
        failed_runbook_checklist: ["11", "13", "27A"],
        blocker_families: ["PROTECTED_ENTRY_CANARY"],
        primary_blocker_family: "PROTECTED_ENTRY_CANARY",
        recommended_next_action_reason_code: "PROTECTED_ENTRY_CANARY_BLOCKER",
        checks: [
          { id: "SUBMIT_CHK_01A", ok: true, runbook_checklist: ["1", "5", "9"] },
          { id: "SUBMIT_CHK_06", ok: false, runbook_checklist: ["11"] },
          { id: "SUBMIT_CHK_07", ok: false, runbook_checklist: ["13"] },
          { id: "SUBMIT_CHK_08", ok: true, runbook_checklist: ["16", "17"] },
          { id: "SUBMIT_CHK_20A", ok: false, runbook_checklist: ["27A"] },
        ],
      },
      deploy_decision_summary: {
        lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
        bounded_runtime_summary: {
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        blocker_summary: {
          blocker_n: 1,
          has_production_entry_protected_canary_blocker: true,
        },
      },
    },
  }), false);
})();

(function contextSubmitTraceHelperRejectsFailedSubmitCheckDrift() {
  assert.strictEqual(runbookCheck.__test.hasConsistentContextSubmitTrace({
    cloudbuildContext: {
      artifact_dir_coherence: buildArtifactDirCoherenceFixture("/tmp/PCY__TRACE__DRIFT", "PCY__TRACE__DRIFT"),
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
      recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
      submit_trace: {
        ...buildWarningSubmitTrace([]),
        failed_submit_check_ids: ["SUBMIT_CHK_06"],
        failed_runbook_checklist: ["11"],
      },
      deploy_decision_summary: {
        blocker_summary: {
          blocker_n: 0,
        },
      },
    },
  }), false);
})();

(function contextSubmitTraceHelperRejectsBlockerFamilyDrift() {
  assert.strictEqual(runbookCheck.__test.hasConsistentContextSubmitTrace({
    cloudbuildContext: {
      artifact_dir_coherence: buildArtifactDirCoherenceFixture("/tmp/PCY__TRACE__BLOCKER", "PCY__TRACE__BLOCKER"),
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      recommended_next_action: "FIX_V2_PROMOTION_PROVENANCE_AND_RERUN",
      recommended_next_action_reason_code: "PROVENANCE_BLOCKER",
      submit_trace: {
        ...buildWarningSubmitTrace([]),
        failed_submit_check_ids: ["SUBMIT_CHK_06", "SUBMIT_CHK_07"],
        failed_runbook_checklist: ["11", "13"],
        blocker_families: [],
        primary_blocker_family: null,
        recommended_next_action_reason_code: "PROVENANCE_BLOCKER",
        checks: [
          {
            id: "SUBMIT_CHK_06",
            ok: false,
            runbook_checklist: ["11"],
          },
          {
            id: "SUBMIT_CHK_07",
            ok: false,
            runbook_checklist: ["13"],
          },
          {
            id: "SUBMIT_CHK_08",
            ok: true,
            runbook_checklist: ["16", "17"],
          },
        ],
      },
      deploy_decision_summary: {
        blocker_summary: {
          blocker_n: 1,
          has_provenance_blocker: true,
        },
      },
    },
  }), false);
})();

(function warningSummaryHelperRejectsMissingStreakClassifiers() {
  assert.strictEqual(runbookCheck.__test.hasConsistentWarningSummary({
    deployDecision: {
      warnings: ["DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"],
    },
    cloudbuildContext: {
      final_status_line: "APPROVE_DEPLOY ; warnings=1 ; warn=DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY",
      submit_trace: buildWarningSubmitTrace(["DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"]),
      deploy_decision_summary: {
        warning_summary: {
          warning_n: 1,
          top_warnings: ["DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"],
        },
      },
    },
  }), false);
})();

(async function runbookCheckFailsWhenCandidateSelectionContractIsMissing() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runbook-candidate-contract-fail-"));
  try {
    const cycleId = "PCY__RUNBOOK__04";
    const dir = path.join(root, cycleId);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(dir, "promotion-preflight.json", {
      ok: true,
      position_cycle_id: cycleId,
      lineage_contract: LINEAGE_CONTRACT_FIXTURE,
    });
    writeJson(dir, "promotion-canary-flow.json", {
      ok: true,
      stage: "PIPELINE_PASS",
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-runtime-manifest.json", {
      snapshot_meta: {
        selector_meta: {
          position_cycle_id: cycleId,
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
    });
    writeJson(dir, "unified-promotion-report.json", {
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-deploy-decision.json", {
      approved: true,
      position_cycle_id: cycleId,
      selector_meta: {
        position_cycle_id: cycleId,
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
      entry_boundary_audit: buildEntryBoundaryAuditFixture(),
      fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
      production_cutover_audit: buildProductionCutoverAuditFixture(),
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      candidate_selection_summary: {
        selected_position_cycle_id: cycleId,
        selected_preflight: {
          position_cycle_id: cycleId,
        },
      },
    });
    writeJson(dir, "promotion-cloudbuild-context.json", {
      position_cycle_id: cycleId,
      artifact_dir: dir,
      resolved_artifact_dir: dir,
      artifact_dir_coherence: buildArtifactDirCoherenceFixture(dir, cycleId),
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      final_status_line: `APPROVE_DEPLOY ; cycle=${cycleId} ; blockers=0 ; warnings=0`,
      recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
      recommended_next_action_reason: "deploy decision approved with no blocking families",
      recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
      lineage_consistency_summary: buildLineageConsistencySummary(),
      submit_trace: buildWarningSubmitTrace([]),
      deploy_decision_summary: {
        lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
        bounded_runtime_summary: {
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        warning_summary: {
          warning_n: 0,
          top_warnings: [],
          has_live_readiness_warning: false,
          has_repair_firestore_canary_streak_warning: false,
          has_production_entry_route_canary_streak_warning: false,
        },
        blocker_summary: {
          blocker_n: 0,
        },
      },
    });

    const result = runbookCheck.runCanaryRunbookCheck({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_EXPECT_POSITION_CYCLE_ID: cycleId,
    });
    assert.strictEqual(result.review.ok, false);
    const contractCheck = result.review.checks.find((row) => row.id === "CHK_15");
    assert.ok(contractCheck);
    assert.strictEqual(contractCheck.status, "FAIL");
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function runbookCheckFailsWhenCandidateRuntimeChainContractIsFalse() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runbook-candidate-runtime-chain-fail-"));
  try {
    const cycleId = "PCY__RUNBOOK__RUNTIME_CHAIN";
    const dir = path.join(root, cycleId);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(dir, "promotion-preflight.json", {
      ok: true,
      position_cycle_id: cycleId,
      lineage_contract: LINEAGE_CONTRACT_FIXTURE,
    });
    writeJson(dir, "promotion-canary-flow.json", {
      ok: true,
      stage: "PIPELINE_PASS",
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-runtime-manifest.json", {
      snapshot_meta: {
        selector_meta: {
          position_cycle_id: cycleId,
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
    });
    writeJson(dir, "unified-promotion-report.json", {
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-deploy-decision.json", {
      approved: true,
      position_cycle_id: cycleId,
      selector_meta: {
        position_cycle_id: cycleId,
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
      entry_boundary_audit: buildEntryBoundaryAuditFixture(),
      fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
      production_cutover_audit: buildProductionCutoverAuditFixture(),
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      candidate_selection_summary: {
        selected_position_cycle_id: cycleId,
        selected_preflight: {
          position_cycle_id: cycleId,
        },
        selection_contract: {
          ok: true,
          scan_limit_respected: true,
          recent_window_enforced: true,
          selected_candidate_present: true,
          selected_preflight_ok: true,
          selected_runtime_chain_ok: false,
          selected_cycle_matches_preflight: true,
          selected_cycle_matches_collector_env: true,
          selected_snapshot_counts_exact: true,
        },
      },
    });
    writeJson(dir, "promotion-cloudbuild-context.json", {
      position_cycle_id: cycleId,
      artifact_dir: dir,
      resolved_artifact_dir: dir,
      artifact_dir_coherence: buildArtifactDirCoherenceFixture(dir, cycleId),
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      final_status_line: `APPROVE_DEPLOY ; cycle=${cycleId} ; blockers=0 ; warnings=0`,
      recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
      recommended_next_action_reason: "deploy decision approved with no blocking families",
      recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
      submit_trace: buildWarningSubmitTrace([]),
      deploy_decision_summary: {
        warning_summary: {
          warning_n: 0,
          top_warnings: [],
          has_live_readiness_warning: false,
          has_repair_firestore_canary_streak_warning: false,
          has_production_entry_route_canary_streak_warning: false,
        },
        blocker_summary: {
          blocker_n: 0,
        },
      },
    });

    const result = runbookCheck.runCanaryRunbookCheck({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_EXPECT_POSITION_CYCLE_ID: cycleId,
    });
    assert.strictEqual(result.review.ok, false);
    const contractCheck = result.review.checks.find((row) => row.id === "CHK_15");
    assert.ok(contractCheck);
    assert.strictEqual(contractCheck.status, "FAIL");
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function runbookCheckSkipsCandidateMatchForExplicitCyclePath() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runbook-skip-"));
  try {
    const cycleId = "PCY__RUNBOOK__02";
    const dir = path.join(root, cycleId);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(dir, "promotion-preflight.json", {
      ok: true,
      position_cycle_id: cycleId,
      lineage_contract: LINEAGE_CONTRACT_FIXTURE,
    });
    writeJson(dir, "promotion-canary-flow.json", {
      ok: true,
      stage: "PIPELINE_PASS",
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-runtime-manifest.json", {
      snapshot_meta: {
        selector_meta: {
          position_cycle_id: cycleId,
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
    });
    writeJson(dir, "unified-promotion-report.json", {
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-deploy-decision.json", {
      approved: true,
      position_cycle_id: cycleId,
      entry_boundary_audit: buildEntryBoundaryAuditFixture(),
      fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
      production_cutover_audit: buildProductionCutoverAuditFixture(),
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    });
    writeJson(dir, "promotion-cloudbuild-context.json", {
      position_cycle_id: cycleId,
      artifact_dir: dir,
      resolved_artifact_dir: dir,
      artifact_dir_coherence: buildArtifactDirCoherenceFixture(dir, cycleId),
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      final_status_line: `APPROVE_DEPLOY ; cycle=${cycleId} ; blockers=0 ; warnings=0`,
      recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
      recommended_next_action_reason: "deploy decision approved with no blocking families",
      recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
      submit_trace: buildWarningSubmitTrace([]),
      deploy_decision_summary: {
        warning_summary: {
          warning_n: 0,
          top_warnings: [],
          has_live_readiness_warning: false,
          has_repair_firestore_canary_streak_warning: false,
          has_production_entry_route_canary_streak_warning: false,
        },
        blocker_summary: {
          blocker_n: 0,
        },
      },
    });

    const contextFile = path.join(dir, "promotion-cloudbuild-context.json");
    const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
    context.lineage_consistency_summary = buildLineageConsistencySummary();
    context.deploy_decision_summary.lineage_contract_hash = LINEAGE_CONTRACT_FIXTURE.hash;
    context.deploy_decision_summary.bounded_runtime_summary = { lineage_contract: LINEAGE_CONTRACT_FIXTURE };
    fs.writeFileSync(contextFile, JSON.stringify(context, null, 2), "utf8");

    const result = await runbookCheck.main({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_EXPECT_POSITION_CYCLE_ID: cycleId,
    });
    assert.strictEqual(result.review.ok, true);
    const candidateCheck = result.review.checks.find((row) => row.id === "CHK_09");
    assert.ok(candidateCheck);
    assert.strictEqual(candidateCheck.status, "SKIP");
    const lineageCheck = result.review.checks.find((row) => row.id === "CHK_16");
    assert.ok(lineageCheck);
    assert.strictEqual(lineageCheck.status, "PASS");
    const contextLineageCheck = result.review.checks.find((row) => row.id === "CHK_17");
    assert.ok(contextLineageCheck);
    assert.strictEqual(contextLineageCheck.status, "PASS");
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function runbookCheckFailsWhenEvidenceSnapshotCoverageIsMissing() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runbook-evidence-fail-"));
  try {
    const cycleId = "PCY__RUNBOOK__03";
    const dir = path.join(root, cycleId);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(dir, "promotion-preflight.json", {
      ok: true,
      position_cycle_id: cycleId,
      lineage_contract: LINEAGE_CONTRACT_FIXTURE,
    });
    writeJson(dir, "promotion-canary-flow.json", {
      ok: true,
      stage: "PIPELINE_PASS",
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-runtime-manifest.json", {
      snapshot_meta: {
        selector_meta: {
          position_cycle_id: cycleId,
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
    });
    writeJson(dir, "unified-promotion-report.json", {
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-deploy-decision.json", {
      approved: true,
      position_cycle_id: cycleId,
      entry_boundary_audit: buildEntryBoundaryAuditFixture(),
      fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
      production_cutover_audit: buildProductionCutoverAuditFixture(),
      bounded_runtime_summary: {
        selector_query_budget: { query_limit: 25 },
        collector_query_budget: { limits: { transitionsLimit: 50 } },
        exporter_snapshot_size_bytes: 12345,
        manifest_counts: { episode_n: 1 },
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
    });
    writeJson(dir, "promotion-cloudbuild-context.json", {
      position_cycle_id: cycleId,
      artifact_dir: dir,
      resolved_artifact_dir: dir,
      artifact_dir_coherence: buildArtifactDirCoherenceFixture(dir, cycleId),
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      final_status_line: `APPROVE_DEPLOY ; cycle=${cycleId} ; blockers=0 ; warnings=0`,
      recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
      recommended_next_action_reason: "deploy decision approved with no blocking families",
      recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
      submit_trace: buildWarningSubmitTrace([]),
      deploy_decision_summary: {
        warning_summary: {
          warning_n: 0,
          top_warnings: [],
          has_live_readiness_warning: false,
          has_repair_firestore_canary_streak_warning: false,
          has_production_entry_route_canary_streak_warning: false,
        },
        blocker_summary: {
          blocker_n: 0,
        },
      },
    });

    const result = runbookCheck.runCanaryRunbookCheck({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_EXPECT_POSITION_CYCLE_ID: cycleId,
    });
    assert.strictEqual(result.review.ok, false);
    const evidenceCheck = result.review.checks.find((row) => row.id === "CHK_14");
    assert.ok(evidenceCheck);
    assert.strictEqual(evidenceCheck.status, "FAIL");
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function runbookCheckFailsWhenOpenClawExecutionAuditLedgerWriteIsMissing() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runbook-openclaw-ledger-fail-"));
  try {
    const cycleId = "PCY__RUNBOOK__OPENCLAW_LEDGER";
    const dir = path.join(root, cycleId);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(dir, "promotion-preflight.json", {
      ok: true,
      position_cycle_id: cycleId,
      lineage_contract: LINEAGE_CONTRACT_FIXTURE,
    });
    writeJson(dir, "promotion-canary-flow.json", {
      ok: true,
      stage: "PIPELINE_PASS",
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-runtime-manifest.json", {
      snapshot_meta: {
        selector_meta: {
          position_cycle_id: cycleId,
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
    });
    writeJson(dir, "unified-promotion-report.json", {
      position_cycle_id: cycleId,
    });
    const bounded = buildBoundedRuntimeSummaryFixture();
    bounded.openclaw_execution_audit_ledger_write = {
      ok: true,
      skipped: true,
      reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_DISABLED",
      collection_key: null,
      doc_id: "OCEXSEPAUDV2__RUNBOOK",
    };
    writeJson(dir, "promotion-deploy-decision.json", {
      approved: true,
      position_cycle_id: cycleId,
      entry_boundary_audit: buildEntryBoundaryAuditFixture(),
      fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
      production_cutover_audit: buildProductionCutoverAuditFixture(),
      bounded_runtime_summary: bounded,
    });
    writeJson(dir, "promotion-cloudbuild-context.json", {
      position_cycle_id: cycleId,
      artifact_dir: dir,
      resolved_artifact_dir: dir,
      artifact_dir_coherence: buildArtifactDirCoherenceFixture(dir, cycleId),
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      final_status_line: `APPROVE_DEPLOY ; cycle=${cycleId} ; blockers=0 ; warnings=0`,
      recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
      recommended_next_action_reason: "deploy decision approved with no blocking families",
      recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
      submit_trace: buildWarningSubmitTrace([]),
      deploy_decision_summary: {
        warning_summary: {
          warning_n: 0,
          top_warnings: [],
          has_live_readiness_warning: false,
          has_repair_firestore_canary_streak_warning: false,
          has_production_entry_route_canary_streak_warning: false,
        },
        blocker_summary: {
          blocker_n: 0,
        },
      },
    });

    const result = runbookCheck.runCanaryRunbookCheck({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_EXPECT_POSITION_CYCLE_ID: cycleId,
    });
    assert.strictEqual(result.review.ok, false);
    const ledgerCheck = result.review.checks.find((row) => row.id === "CHK_18");
    assert.ok(ledgerCheck);
    assert.strictEqual(ledgerCheck.status, "FAIL");
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function runbookCheckFailsWhenContextLineageHashMismatches() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-runbook-context-lineage-fail-"));
  try {
    const cycleId = "PCY__RUNBOOK__05";
    const dir = path.join(root, cycleId);
    fs.mkdirSync(dir, { recursive: true });
    writeJson(dir, "promotion-preflight.json", {
      ok: true,
      position_cycle_id: cycleId,
      lineage_contract: LINEAGE_CONTRACT_FIXTURE,
    });
    writeJson(dir, "promotion-canary-flow.json", {
      ok: true,
      stage: "PIPELINE_PASS",
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-runtime-manifest.json", {
      snapshot_meta: {
        selector_meta: {
          position_cycle_id: cycleId,
          lineage_contract: LINEAGE_CONTRACT_FIXTURE,
        },
        lineage_contract: LINEAGE_CONTRACT_FIXTURE,
      },
    });
    writeJson(dir, "unified-promotion-report.json", {
      position_cycle_id: cycleId,
    });
    writeJson(dir, "promotion-deploy-decision.json", {
      approved: true,
      position_cycle_id: cycleId,
      entry_boundary_audit: buildEntryBoundaryAuditFixture(),
      fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
      production_cutover_audit: buildProductionCutoverAuditFixture(),
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    });
    writeJson(dir, "promotion-cloudbuild-context.json", {
      position_cycle_id: cycleId,
      artifact_dir: dir,
      resolved_artifact_dir: dir,
      artifact_dir_coherence: buildArtifactDirCoherenceFixture(dir, cycleId),
      lineage_contract_hash: "lineage-hash-mismatch",
      final_status_line: `APPROVE_DEPLOY ; cycle=${cycleId} ; blockers=0 ; warnings=0`,
      recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
      recommended_next_action_reason: "deploy decision approved with no blocking families",
      recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
      submit_trace: buildWarningSubmitTrace([]),
      deploy_decision_summary: {
        warning_summary: {
          warning_n: 0,
          top_warnings: [],
          has_live_readiness_warning: false,
          has_repair_firestore_canary_streak_warning: false,
          has_production_entry_route_canary_streak_warning: false,
        },
        blocker_summary: {
          blocker_n: 0,
        },
      },
    });

    const result = runbookCheck.runCanaryRunbookCheck({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_EXPECT_POSITION_CYCLE_ID: cycleId,
    });
    assert.strictEqual(result.review.ok, false);
    const contextLineageCheck = result.review.checks.find((row) => row.id === "CHK_17");
    assert.ok(contextLineageCheck);
    assert.strictEqual(contextLineageCheck.status, "FAIL");
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

console.log("CHECK_V2_CANARY_RUNBOOK_TEST_OK");
