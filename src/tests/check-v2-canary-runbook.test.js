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
    relevant_submit_check_ids: ["SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08"],
    relevant_runbook_checklist: ["11", "13", "16", "17"],
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
        fields: ["lineage_contract_hash", "deploy_decision_summary.lineage_contract_hash"],
        reason: "cloudbuild lineage hash present for bounded provenance trace",
      },
    ],
  };
}

function rowsLength(rows) {
  return Array.isArray(rows) ? rows.length : 0;
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
    fail_n: 0,
    scheduler_sot: "OPENCLAW_CRON",
    required_openclaw_job_ids: [
      "binance_exit_integrity_cycle",
      "openclaw_daily_cycle",
      "openclaw_hourly_cycle",
      "v2_repair_queue_service",
    ],
    missing_openclaw_job_ids: [],
    active_legacy_scheduler_jobs: [],
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
      check_n: 4,
      fail_n: 0,
      failed_check_ids: [],
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
    ...contextPatch,
  });
}

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
      entry_boundary_audit: buildEntryBoundaryAuditFixture(),
      fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
      production_cutover_audit: buildProductionCutoverAuditFixture(),
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      candidate_selection_summary: {
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
    });
    writeJson(dir, "promotion-cloudbuild-context.json", {
      position_cycle_id: cycleId,
      artifact_dir: dir,
      resolved_artifact_dir: dir,
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
    assert.strictEqual(artifactDirCheck.field, "artifact_dir,resolved_artifact_dir,position_cycle_id");
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
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      final_status_line: `APPROVE_DEPLOY ; cycle=${cycleId} ; blockers=0 ; warnings=1`,
      recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
      recommended_next_action_reason: "deploy decision approved with no blocking families",
      recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
      submit_trace: buildWarningSubmitTrace([]),
      deploy_decision_summary: {
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
    writeJson(dir, "promotion-cloudbuild-context.json", {
      position_cycle_id: cycleId,
      artifact_dir: dir,
      resolved_artifact_dir: dir,
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      final_status_line: `APPROVE_DEPLOY ; cycle=${cycleId} ; blockers=0 ; warnings=0`,
      recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
      recommended_next_action_reason: "deploy decision approved with no blocking families",
      recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
      submit_trace: buildWarningSubmitTrace([]),
      production_cutover_readiness_file: path.join(dir, "v2_production_cutover_readiness_latest.json"),
      production_cutover_readiness_summary: {
        ok: true,
        reason: "V2_PRODUCTION_CUTOVER_READINESS_PASS",
        blocker_n: 0,
        guard_reason: "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED",
        legacy_webhook_blocked: true,
      },
      scheduler_traffic_cutover_readiness_file: path.join(dir, "v2_scheduler_traffic_cutover_readiness_latest.json"),
      scheduler_traffic_cutover_readiness_summary: {
        ...buildSchedulerTrafficCutoverReadinessFixture(),
        blocker_n: 0,
      },
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
    writeJson(dir, "v2_repair_live_cutover_readiness_latest.json", buildLiveCutoverReadinessFixture());
    writeJson(dir, "v2_production_cutover_readiness_latest.json", buildProductionCutoverReadinessFixture());
    writeJson(dir, "v2_scheduler_traffic_cutover_readiness_latest.json", buildSchedulerTrafficCutoverReadinessFixture());

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
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
      recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
      recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
      submit_trace: buildWarningSubmitTrace([]),
      deploy_decision_summary: {
        blocker_summary: {
          blocker_n: 0,
        },
      },
    },
  }), true);
})();

(function contextSubmitTraceHelperRejectsFailedSubmitCheckDrift() {
  assert.strictEqual(runbookCheck.__test.hasConsistentContextSubmitTrace({
    cloudbuildContext: {
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
      entry_boundary_audit: buildEntryBoundaryAuditFixture(),
      fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
      production_cutover_audit: buildProductionCutoverAuditFixture(),
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      candidate_selection_summary: {
        selected_position_cycle_id: cycleId,
      },
    });
    writeJson(dir, "promotion-cloudbuild-context.json", {
      position_cycle_id: cycleId,
      artifact_dir: dir,
      resolved_artifact_dir: dir,
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
      entry_boundary_audit: buildEntryBoundaryAuditFixture(),
      fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
      production_cutover_audit: buildProductionCutoverAuditFixture(),
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      candidate_selection_summary: {
        selected_position_cycle_id: cycleId,
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
