"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const cloudbuild = require("../../scripts/run-v2-promotion-cloudbuild");
const deployDecisionCheck = require("../../scripts/check-v2-promotion-deploy-decision");

const LINEAGE_CONTRACT_FIXTURE = Object.freeze({
  version: "V2_PROMOTION_SELECTOR_LINEAGE_SHA256_V1",
  hash: "lineage-hash-fixture",
});
const REQUIRED_RUNTIME_CHAIN_CHECK_IDS = deployDecisionCheck.__test.REQUIRED_RUNTIME_CHAIN_CHECK_IDS;
const REQUIRED_PRODUCTION_LIVE_ENTRY_SIZING_CHECK_IDS = deployDecisionCheck.__test.REQUIRED_PRODUCTION_LIVE_ENTRY_SIZING_CHECK_IDS;

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function buildArtifactDirCoherenceFixture(dir, cycleId) {
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
      doc_id: "OCEXSEPAUDV2__CLOUDBUILD",
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
      healthy_run_n: 13,
      min_run_count: 12,
      unhealthy_run_n: 0,
      invalid_line_n: 0,
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
      history_file: "donbeolja_v2__production_entry_route_canaries_v2",
      healthy_run_n: 13,
      min_run_count: 12,
      unhealthy_run_n: 0,
      invalid_line_n: 0,
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
        alert_outbox_id: "TAOV2__READ__01",
        last_reason: "ALERT_DELIVERY_FAILED",
        last_reason_family: "TRANSPORT",
        retry_policy_code: "ALERT_RETRY_TRANSPORT",
        runbook_refs: ["ALERT_RBK_04"],
        last_attempt_at: "2026-04-21T00:00:00.000Z",
      },
    },
  };
}

function buildPassingRepairFirestoreStreakFixture() {
  return {
    ok: true,
    reason: "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS",
    healthy_run_n: 13,
    min_run_count: 12,
    unhealthy_run_n: 0,
    invalid_line_n: 0,
    latest_age_minutes: 42,
    coverage_minutes: 1440,
    blockers: [],
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
      check_n: 14,
      fail_n: 0,
      failed_check_ids: [],
    },
  };
}

function buildSchedulerTrafficStateFixture() {
  return {
    scheduler_sot: "OPENCLAW_CRON",
    openclaw_cron_jobs: [
      { job_id: "binance_exit_integrity_cycle", enabled: true },
      { job_id: "openclaw_hourly_cycle", enabled: true },
      { job_id: "v2_repair_queue_service", enabled: true },
      { job_id: "openclaw_daily_cycle", enabled: true },
    ],
    openclaw_cloud_scheduler_jobs: [
      {
        job_id: "openclaw_agent_calibration",
        scheduler_name: "openclaw-calibration",
        enabled: true,
        criticality: "HIGH",
        state: "ENABLED",
        expected_http_path: "/api/openclaw/cron/calibration",
        actual_http_path: "/api/openclaw/cron/calibration",
        path_match: true,
        expected_schedule: "15 6 * * *",
        actual_schedule: "15 6 * * *",
        schedule_match: true,
        expected_time_zone: "Asia/Seoul",
        actual_time_zone: "Asia/Seoul",
        time_zone_match: true,
      },
      {
        job_id: "v2_production_entry_route_canary",
        scheduler_name: "v2-production-entry-route-canary",
        enabled: true,
        criticality: "HIGH",
        state: "ENABLED",
        expected_http_path: "/api/openclaw/cron/v2-production-entry-route-canary",
        actual_http_path: "/api/openclaw/cron/v2-production-entry-route-canary",
        path_match: true,
        expected_schedule: "5 * * * *",
        actual_schedule: "5 * * * *",
        schedule_match: true,
        expected_time_zone: "Asia/Seoul",
        actual_time_zone: "Asia/Seoul",
        time_zone_match: true,
      },
      {
        job_id: "v2_exit_runtime_canary",
        scheduler_name: "v2-exit-runtime-canary",
        enabled: true,
        criticality: "HIGH",
        state: "ENABLED",
        expected_http_path: "/api/openclaw/cron/v2-exit-runtime-canary",
        actual_http_path: "/api/openclaw/cron/v2-exit-runtime-canary",
        path_match: true,
        expected_schedule: "35 * * * *",
        actual_schedule: "35 * * * *",
        schedule_match: true,
        expected_time_zone: "Asia/Seoul",
        actual_time_zone: "Asia/Seoul",
        time_zone_match: true,
      },
    ],
    legacy_scheduler_jobs: [
      { label: "com.jaeyong.donbeolja.tick", enabled: false, active: false, target: "/scheduler/tick" },
    ],
    cloud_run_services: [
      {
        name: "donbeolja",
        traffic_percent: 100,
        latest_revision_ready: true,
        env: {
          SCHEDULER_AUTOSTART: "0",
          DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE: "OPENCLAW_CRON",
          DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED: "1",
          DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED: "1",
          DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE: "FIRESTORE",
          DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE: "1",
          DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED: "1",
          DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED: "1",
          DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE: "FIRESTORE",
          DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE: "1",
        },
      },
      {
        name: "donbeolja-exit-worker",
        traffic_percent: 100,
        latest_revision_ready: true,
        env: {
          SCHEDULER_AUTOSTART: "0",
          DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE: "OPENCLAW_CRON",
          DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED: "1",
          DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED: "1",
          DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE: "FIRESTORE",
          DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE: "1",
          DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED: "1",
          DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED: "1",
          DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE: "FIRESTORE",
          DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE: "1",
        },
      },
    ],
  };
}

function buildCloudRunServiceDescribeFixture(row) {
  const service = row && typeof row === "object" ? row : {};
  return {
    template: {
      spec: {
        containers: [
          {
            env: Object.entries(service.env || {}).map(([name, value]) => ({ name, value })),
          },
        ],
      },
    },
    status: {
      latestReadyRevisionName: `${service.name || "service"}-rev-0001`,
      conditions: [{ type: "Ready", status: service.latest_revision_ready === false ? "False" : "True" }],
      traffic: [
        {
          revisionName: `${service.name || "service"}-rev-0001`,
          latestRevision: true,
          percent: Number(service.traffic_percent || 0),
        },
      ],
    },
  };
}

function buildSchedulerTrafficCollectorExecFileSyncFixture(state = buildSchedulerTrafficStateFixture()) {
  return (cmd, args) => {
    assert.strictEqual(cmd, "gcloud");
    const joined = args.join(" ");
    if (joined === "config get-value project") return "donbeolja-dev\n";
    if (joined.includes("scheduler jobs list")) {
      const jobs = [
        ...(Array.isArray(state.openclaw_cloud_scheduler_jobs) ? state.openclaw_cloud_scheduler_jobs : []),
        ...(Array.isArray(state.legacy_scheduler_jobs) ? state.legacy_scheduler_jobs : []),
      ].map((job) => ({
        name: `projects/donbeolja-dev/locations/asia-northeast3/jobs/${job.scheduler_name || job.name || job.job_id}`,
        description: job.label || job.scheduler_name || job.name || job.job_id,
        schedule: job.actual_schedule || job.schedule || "* * * * *",
        timeZone: job.actual_time_zone || job.time_zone || "Asia/Seoul",
        state: job.enabled === false || job.active === false ? "PAUSED" : "ENABLED",
        httpTarget: {
          uri: `https://donbeolja.example${job.actual_http_path || job.expected_http_path || job.target || "/"}`,
        },
      }));
      return JSON.stringify(jobs);
    }
    if (joined.includes("run services describe")) {
      const serviceName = joined.includes("donbeolja-exit-worker") ? "donbeolja-exit-worker" : "donbeolja";
      const service = (Array.isArray(state.cloud_run_services) ? state.cloud_run_services : [])
        .find((row) => row && row.name === serviceName);
      return JSON.stringify(buildCloudRunServiceDescribeFixture(service || { name: serviceName }));
    }
    throw new Error(`UNEXPECTED_GCLOUD:${joined}`);
  };
}

function seedRunbookArtifacts(dir, cycleId) {
  writeJson(path.join(dir, "promotion-preflight.json"), {
    ok: true,
    position_cycle_id: cycleId,
    lineage_contract: LINEAGE_CONTRACT_FIXTURE,
  });
  writeJson(path.join(dir, "promotion-canary-flow.json"), {
    ok: true,
    stage: "PIPELINE_PASS",
    position_cycle_id: cycleId,
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
  writeJson(path.join(dir, "unified-promotion-report.json"), {
    position_cycle_id: cycleId,
  });
  writeJson(path.join(dir, "promotion-deploy-decision.json"), {
    approved: true,
    decision: "APPROVE_DEPLOY",
    position_cycle_id: cycleId,
    blockers: [],
    warnings: [],
    entry_boundary_audit: buildEntryBoundaryAuditFixture(),
    fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
    production_cutover_audit: buildProductionCutoverAuditFixture(),
    bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
  });
  writeJson(path.join(dir, "promotion-cloudbuild-context.json"), {
    position_cycle_id: cycleId,
    artifact_dir: dir,
    resolved_artifact_dir: dir,
    artifact_dir_coherence: buildArtifactDirCoherenceFixture(dir, cycleId),
    lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
    final_status_line: `APPROVE_DEPLOY ; cycle=${cycleId} ; blockers=0 ; warnings=0`,
    recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
    recommended_next_action_reason: "deploy decision approved with no blocking families",
    recommended_next_action_reason_code: "APPROVED_NO_BLOCKING_FAMILIES",
    submit_trace: {
      relevant_submit_check_ids: ["SUBMIT_CHK_01A", "SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08"],
      relevant_runbook_checklist: ["1", "5", "9", "11", "13", "16", "17"],
      failed_submit_check_ids: [],
      failed_runbook_checklist: [],
      blocker_families: [],
      primary_blocker_family: null,
      deploy_warning_attention_required: false,
      deploy_warning_summary: {
        warning_n: 0,
        top_warnings: [],
        has_live_readiness_warning: false,
        has_repair_firestore_canary_streak_warning: false,
        has_production_entry_route_canary_streak_warning: false,
      },
      deploy_warning_runbook_checklist: [],
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
    },
    deploy_decision_summary: {
      lineage_contract_hash: LINEAGE_CONTRACT_FIXTURE.hash,
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
}

(function noFlagsMeansOff() {
  const plan = cloudbuild.__test.buildCloudBuildPlan({});
  assert.strictEqual(plan.mode, "OFF");
  assert.strictEqual(plan.script, null);
})();

(function conflictingModesFailClosed() {
  let err = null;
  try {
    cloudbuild.__test.buildCloudBuildPlan({
      V2_PROMOTION_PIPELINE_ENABLED: "1",
      V2_PROMOTION_GATE_ENABLED: "1",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_CLOUDBUILD_MODE_CONFLICT:gate,pipeline");
})();

(function canaryFlowRequiresPositionCycleId() {
  let err = null;
  try {
    cloudbuild.__test.buildCloudBuildPlan({
      V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_CLOUDBUILD_POSITION_CYCLE_ID_REQUIRED");
})();

(function canaryFlowAutoSelectAllowsExplicitArtifactDirWithoutPositionCycleId() {
  const plan = cloudbuild.__test.buildCloudBuildPlan({
    V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
    V2_PROMOTION_CANARY_AUTO_SELECT_ENABLED: "1",
    V2_PROMOTION_MODE: "CANARY",
    V2_PROMOTION_ARTIFACT_DIR: "tmp/v2-promotion-artifacts/canary_flow/auto-select",
  });
  assert.strictEqual(plan.mode, "CANARY_FLOW");
  assert.strictEqual(plan.positionCycleId, null);
  assert.strictEqual(plan.canaryAutoSelectEnabled, true);
  assert.strictEqual(plan.effectiveEnv.DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED, "1");
  assert.ok(plan.artifactDir.endsWith(path.join("tmp", "v2-promotion-artifacts", "canary_flow", "auto-select")));
})();

(function canaryFlowDerivesBoundedArtifactDir() {
  const plan = cloudbuild.__test.buildCloudBuildPlan({
    V2_PROMOTION_CANARY_FLOW_ENABLED: "1",
    V2_PROMOTION_MODE: "CANARY",
    V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__TEST__01",
  });
  assert.strictEqual(plan.mode, "CANARY_FLOW");
  assert.strictEqual(plan.script, "run:v2-promotion-canary-flow");
  assert.strictEqual(plan.effectiveEnv.DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED, "1");
  assert.ok(plan.artifactDir.endsWith(path.join("tmp", "v2-promotion-artifacts", "canary_flow", "PCY__TEST__01")));
})();

(function explicitArtifactDirMustContainPositionCycleIdForBoundedModes() {
  let err = null;
  try {
    cloudbuild.__test.buildCloudBuildPlan({
      V2_PROMOTION_PIPELINE_ENABLED: "1",
      V2_PROMOTION_MODE: "LIVE",
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: "PCY__LIVE__01",
      V2_PROMOTION_ARTIFACT_DIR: "tmp/v2-promotion-artifacts/live/wrong-cycle",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_CLOUDBUILD_ARTIFACT_DIR_POSITION_CYCLE_MISMATCH");
})();

(function boundedPipelineRequiresPositionCycleIdInCanaryLive() {
  let err = null;
  try {
    cloudbuild.__test.buildCloudBuildPlan({
      V2_PROMOTION_PIPELINE_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_ARTIFACT_DIR: "tmp/v2-promotion-artifacts/pipeline/PCY__X",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_CLOUDBUILD_BOUNDED_PIPELINE_POSITION_CYCLE_ID_REQUIRED");
})();

(function gateModeRequiresExplicitArtifactDir() {
  let err = null;
  try {
    cloudbuild.__test.buildCloudBuildPlan({
      V2_PROMOTION_GATE_ENABLED: "1",
      V2_PROMOTION_MODE: "CANARY",
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_CLOUDBUILD_ARTIFACT_DIR_REQUIRED");
})();

(function canaryFlowRequiresApprovedDeployDecision() {
  const approval = cloudbuild.__test.validateDeployApproval({
    mode: "CANARY_FLOW",
    promotionMode: "CANARY",
    positionCycleId: "PCY__TEST__01",
  }, {
    approved: false,
    position_cycle_id: "PCY__TEST__01",
  });
  assert.strictEqual(approval.approved, false);
  assert.ok(approval.blockers.includes("V2_PROMOTION_CLOUDBUILD_DEPLOY_DECISION_NOT_APPROVED"));
})();

(function autoSelectedCanaryFlowRequiresDeployDecisionPositionCycleId() {
  const approval = cloudbuild.__test.validateDeployApproval({
    mode: "CANARY_FLOW",
    promotionMode: "CANARY",
    positionCycleId: null,
  }, {
    approved: true,
  });
  assert.strictEqual(approval.approved, false);
  assert.ok(approval.blockers.includes("V2_PROMOTION_CLOUDBUILD_DEPLOY_DECISION_POSITION_CYCLE_REQUIRED"));
})();

(function boundedPipelineRequiresMatchingPositionCycleIdInDeployDecision() {
  const approval = cloudbuild.__test.validateDeployApproval({
    mode: "PIPELINE",
    promotionMode: "LIVE",
    positionCycleId: "PCY__LIVE__01",
  }, {
    approved: true,
    position_cycle_id: "PCY__LIVE__02",
  });
  assert.strictEqual(approval.approved, false);
  assert.ok(approval.blockers.includes("V2_PROMOTION_CLOUDBUILD_DEPLOY_DECISION_POSITION_CYCLE_MISMATCH"));
})();

(function canaryFlowBlocksWhenDeployDecisionCarriesCandidateSelectionMismatch() {
  const approval = cloudbuild.__test.validateDeployApproval({
    mode: "CANARY_FLOW",
    promotionMode: "CANARY",
    positionCycleId: "PCY__TEST__01",
  }, {
    approved: false,
    position_cycle_id: "PCY__TEST__01",
    blockers: [
      "DEPLOY_DECISION:CANDIDATE_SELECTION_POSITION_CYCLE_MISMATCH",
    ],
  });
  assert.strictEqual(approval.approved, false);
  assert.ok(approval.blockers.includes("V2_PROMOTION_CLOUDBUILD_DEPLOY_DECISION_NOT_APPROVED"));
})();

(function deployDecisionSummaryCapturesBoundedAndCandidateContext() {
  const summary = cloudbuild.__test.buildDeployDecisionSummary({
    approved: true,
    decision: "APPROVE_DEPLOY",
    position_cycle_id: "PCY__READ__01",
    blockers: [],
    warnings: [],
    bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    candidate_selection_summary: {
      ok: true,
      selection_status: "READY",
      selected_position_cycle_id: "PCY__READ__01",
      recent_active_position_cycle_n: 1,
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
  assert.strictEqual(summary.approved, true);
  assert.strictEqual(summary.lineage_contract_hash, "lineage-hash-fixture");
  assert.strictEqual(summary.bounded_runtime_summary.selector_query_budget.query_limit, 25);
  assert.strictEqual(summary.bounded_runtime_summary.lineage_contract.hash, "lineage-hash-fixture");
  assert.strictEqual(summary.bounded_runtime_summary.evidence_snapshot_summary.ok, true);
  assert.strictEqual(summary.alert_retry_attention_required, true);
  assert.strictEqual(summary.alert_retry_summary.failed_n, 1);
  assert.strictEqual(summary.bounded_runtime_summary.alert_retry_summary.latest_failed.last_reason_family, "TRANSPORT");
  assert.strictEqual(summary.candidate_selection_summary.selected_position_cycle_id, "PCY__READ__01");
  assert.strictEqual(summary.candidate_selection_summary.selection_contract.ok, true);
  assert.strictEqual(summary.candidate_selection_summary.selection_contract.selected_runtime_chain_ok, true);
  assert.strictEqual(summary.blocker_summary.blocker_n, 0);
})();

(function blockerSummaryFlagsKeyFailureFamilies() {
  const summary = cloudbuild.__test.buildDeployDecisionSummary({
    approved: false,
    decision: "HOLD",
    position_cycle_id: "PCY__READ__02",
    blockers: [
      "PROVENANCE:POSITION_CYCLE_ID_REQUIRED",
      "DEPLOY_DECISION:CANDIDATE_SELECTION_POSITION_CYCLE_MISMATCH",
      "REPLAY:WATCHDOG_FAIL:WATCHDOG_ISSUES_PRESENT:TERMINAL_PROJECTION_MISMATCH",
      "DEPLOY_DECISION:BOUNDED_RUNTIME_SUMMARY_REQUIRED",
      "DEPLOY_DECISION:PRODUCTION_ENTRY_PROTECTED_CANARY_REQUIRED",
      "DEPLOY_DECISION:STALE_ARTIFACT_PROVENANCE:REPAIR_FIRESTORE_CANARY_STREAK",
      "DEPLOY_DECISION:LIVE_EVIDENCE_ARTIFACT_CYCLE_MISMATCH",
      "DEPLOY_DECISION:LIVE_STREAK_POSITION_CYCLE_MISMATCH",
      "DEPLOY_DECISION:OPENCLAW_SUPREME_CONTROL_PLANE_CLOSED_LOOP_REQUIRED",
    ],
    warnings: [],
  });
  assert.strictEqual(summary.blocker_summary.blocker_n, 9);
  assert.strictEqual(summary.blocker_summary.top_blockers.length, 3);
  assert.strictEqual(summary.blocker_summary.has_provenance_blocker, true);
  assert.strictEqual(summary.blocker_summary.has_stale_artifact_provenance_blocker, true);
  assert.strictEqual(summary.blocker_summary.has_live_evidence_cycle_blocker, true);
  assert.strictEqual(summary.blocker_summary.has_watchdog_blocker, true);
  assert.strictEqual(summary.blocker_summary.has_candidate_selection_blocker, true);
  assert.strictEqual(summary.blocker_summary.has_bounded_runtime_blocker, true);
  assert.strictEqual(summary.blocker_summary.has_production_entry_protected_canary_blocker, true);
  assert.strictEqual(summary.blocker_summary.has_openclaw_supreme_control_plane_blocker, true);
})();

(function staleArtifactProvenanceBlockerHasSpecificCloudbuildAction() {
  const decision = {
    approved: false,
    blocker_summary: {
      blocker_n: 1,
      has_provenance_blocker: false,
      has_stale_artifact_provenance_blocker: true,
      has_candidate_selection_blocker: false,
      has_production_entry_protected_canary_blocker: false,
      has_bounded_runtime_blocker: false,
      has_watchdog_blocker: false,
    },
  };
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextAction(decision),
    "DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE"
  );
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextActionReasonCode(decision),
    "STALE_ARTIFACT_PROVENANCE_BLOCKER"
  );
  assert.deepStrictEqual(
    cloudbuild.__test.buildContextBlockerFamilies(decision.blocker_summary),
    ["STALE_ARTIFACT_PROVENANCE"]
  );
})();

(function liveEvidenceCycleBlockerHasSpecificCloudbuildAction() {
  const decision = {
    approved: false,
    blocker_summary: {
      blocker_n: 1,
      has_provenance_blocker: false,
      has_stale_artifact_provenance_blocker: false,
      has_live_evidence_cycle_blocker: true,
      has_candidate_selection_blocker: false,
      has_production_entry_protected_canary_blocker: false,
      has_bounded_runtime_blocker: false,
      has_watchdog_blocker: false,
    },
  };
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextAction(decision),
    "DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE"
  );
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextActionReasonCode(decision),
    "LIVE_EVIDENCE_CYCLE_BLOCKER"
  );
  assert.deepStrictEqual(
    cloudbuild.__test.buildContextBlockerFamilies(decision.blocker_summary),
    ["LIVE_EVIDENCE_CYCLE"]
  );
})();

(function openClawSupremeBlockerHasSpecificCloudbuildAction() {
  const decision = {
    approved: false,
    blocker_summary: {
      blocker_n: 1,
      has_provenance_blocker: false,
      has_stale_artifact_provenance_blocker: false,
      has_live_evidence_cycle_blocker: false,
      has_candidate_selection_blocker: false,
      has_production_entry_protected_canary_blocker: false,
      has_openclaw_supreme_control_plane_blocker: true,
      has_bounded_runtime_blocker: false,
      has_watchdog_blocker: false,
    },
  };
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextAction(decision),
    "FIX_OPENCLAW_SUPREME_CONTROL_PLANE_AND_RECHECK_DEPLOY_DECISION"
  );
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextActionReasonCode(decision),
    "OPENCLAW_SUPREME_CONTROL_PLANE_BLOCKER"
  );
  assert.deepStrictEqual(
    cloudbuild.__test.buildContextBlockerFamilies(decision.blocker_summary),
    ["OPENCLAW_SUPREME_CONTROL_PLANE"]
  );
  assert.ok(cloudbuild.__test.buildStatusLine(decision).includes("openclaw_supreme=BLOCKED"));
})();

(function liveStreakPositionCycleMismatchIsLiveEvidenceCycleBlocker() {
  const summary = cloudbuild.__test.buildDeployDecisionSummary({
    approved: false,
    decision: "HOLD",
    position_cycle_id: "PCY__READ__LIVE_STREAK",
    blockers: [
      "DEPLOY_DECISION:LIVE_STREAK_POSITION_CYCLE_MISMATCH:repair_firestore_canary_streak:expected=PCY__READ__LIVE_STREAK:actual=PCY__OTHER",
    ],
    warnings: [],
  });
  assert.strictEqual(summary.blocker_summary.has_live_evidence_cycle_blocker, true);
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextActionReasonCode(summary),
    "LIVE_EVIDENCE_CYCLE_BLOCKER"
  );
  assert.deepStrictEqual(
    cloudbuild.__test.buildContextBlockerFamilies(summary.blocker_summary),
    ["LIVE_EVIDENCE_CYCLE"]
  );
  assert.ok(cloudbuild.__test.buildStatusLine(summary).includes("live_evidence_cycle=BLOCKED"));
})();

(function contextSubmitTraceIncludesOpenClawSupremeCheckAndRunbook() {
  const trace = cloudbuild.__test.buildContextSubmitTrace({
    approved: false,
    lineage_contract_hash: "lineage-hash-fixture",
    blocker_summary: {
      blocker_n: 1,
      has_openclaw_supreme_control_plane_blocker: true,
    },
  }, {
    artifactDirCoherence: { ok: true },
    lineageConsistencySummary: { ok: true },
  });
  assert.deepStrictEqual(trace.relevant_submit_check_ids, ["SUBMIT_CHK_01A", "SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08", "SUBMIT_CHK_23"]);
  assert.deepStrictEqual(trace.relevant_runbook_checklist, ["1", "5", "9", "11", "13", "16", "17", "31"]);
  assert.deepStrictEqual(trace.failed_submit_check_ids, ["SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_23"]);
  assert.deepStrictEqual(trace.failed_runbook_checklist, ["11", "13", "31"]);
  assert.deepStrictEqual(trace.blocker_families, ["OPENCLAW_SUPREME_CONTROL_PLANE"]);
  assert.strictEqual(trace.primary_blocker_family, "OPENCLAW_SUPREME_CONTROL_PLANE");
  assert.strictEqual(trace.recommended_next_action_reason_code, "OPENCLAW_SUPREME_CONTROL_PLANE_BLOCKER");
  const check = trace.checks.find((row) => row.id === "SUBMIT_CHK_23");
  assert.ok(check);
  assert.strictEqual(check.ok, false);
  assert.deepStrictEqual(check.runbook_checklist, ["31"]);
  assert.deepStrictEqual(check.fields, cloudbuild.__test.CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_23);
})();

(function repairEvidenceSummaryRequiredIsBoundedRuntimeBlocker() {
  const summary = cloudbuild.__test.buildDeployDecisionSummary({
    approved: false,
    decision: "HOLD",
    position_cycle_id: "PCY__READ__REPAIR_EVIDENCE",
    blockers: [
      "DEPLOY_DECISION:REPAIR_EVIDENCE_SUMMARY_REQUIRED",
    ],
    warnings: [],
  });
  assert.strictEqual(summary.blocker_summary.has_bounded_runtime_blocker, true);
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextActionReasonCode(summary),
    "BOUNDED_RUNTIME_BLOCKER"
  );
  assert.deepStrictEqual(
    cloudbuild.__test.buildContextBlockerFamilies(summary.blocker_summary),
    ["BOUNDED_RUNTIME"]
  );
})();

(function lineageContractMismatchIsProvenanceBlocker() {
  const summary = cloudbuild.__test.buildDeployDecisionSummary({
    approved: false,
    decision: "HOLD",
    position_cycle_id: "PCY__READ__LINEAGE",
    blockers: [
      "DEPLOY_DECISION:LINEAGE_CONTRACT_MISMATCH",
    ],
    warnings: [],
  });
  assert.strictEqual(summary.blocker_summary.has_provenance_blocker, true);
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextActionReasonCode(summary),
    "PROVENANCE_BLOCKER"
  );
  assert.deepStrictEqual(
    cloudbuild.__test.buildContextBlockerFamilies(summary.blocker_summary),
    ["PROVENANCE"]
  );
})();

(function runtimeChainAuditRequiredIsBoundedRuntimeBlocker() {
  const summary = cloudbuild.__test.buildDeployDecisionSummary({
    approved: false,
    decision: "HOLD",
    position_cycle_id: "PCY__READ__RUNTIME_CHAIN",
    blockers: [
      "DEPLOY_DECISION:RUNTIME_CHAIN_AUDIT_REQUIRED",
    ],
    warnings: [],
  });
  assert.strictEqual(summary.blocker_summary.has_bounded_runtime_blocker, true);
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextActionReasonCode(summary),
    "BOUNDED_RUNTIME_BLOCKER"
  );
  assert.deepStrictEqual(
    cloudbuild.__test.buildContextBlockerFamilies(summary.blocker_summary),
    ["BOUNDED_RUNTIME"]
  );
})();

(function protectedEntryCanaryBlockerHasSpecificCloudbuildAction() {
  const decision = {
    approved: false,
    blocker_summary: {
      blocker_n: 1,
      has_provenance_blocker: false,
      has_candidate_selection_blocker: false,
      has_production_entry_protected_canary_blocker: true,
      has_bounded_runtime_blocker: false,
      has_watchdog_blocker: false,
    },
  };
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextAction(decision),
    "FIX_V2_PROTECTED_ENTRY_CANARY_AND_RECHECK_DEPLOY_DECISION"
  );
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextActionReasonCode(decision),
    "PROTECTED_ENTRY_CANARY_BLOCKER"
  );
  assert.deepStrictEqual(
    cloudbuild.__test.buildContextBlockerFamilies(decision.blocker_summary),
    ["PROTECTED_ENTRY_CANARY"]
  );
})();

(function contextSubmitTraceMapsProtectedEntryCanaryToRunbook27A() {
  const trace = cloudbuild.__test.buildContextSubmitTrace({
    approved: false,
    lineage_contract_hash: "lineage-hash-fixture",
    recommended_next_action: "FIX_V2_PROTECTED_ENTRY_CANARY_AND_RECHECK_DEPLOY_DECISION",
    blocker_summary: {
      blocker_n: 1,
      has_provenance_blocker: false,
      has_candidate_selection_blocker: false,
      has_production_entry_protected_canary_blocker: true,
      has_bounded_runtime_blocker: false,
      has_watchdog_blocker: false,
    },
    bounded_runtime_summary: {
      lineage_contract: { hash: "lineage-hash-fixture" },
    },
  }, {
    artifactDirCoherence: { ok: true },
  });
  assert.deepStrictEqual(trace.relevant_submit_check_ids, ["SUBMIT_CHK_01A", "SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08", "SUBMIT_CHK_20A"]);
  assert.deepStrictEqual(trace.relevant_runbook_checklist, ["1", "5", "9", "11", "13", "16", "17", "27A"]);
  assert.deepStrictEqual(trace.failed_submit_check_ids, ["SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_20A"]);
  assert.deepStrictEqual(trace.failed_runbook_checklist, ["11", "13", "27A"]);
  assert.deepStrictEqual(trace.blocker_families, ["PROTECTED_ENTRY_CANARY"]);
  assert.strictEqual(trace.primary_blocker_family, "PROTECTED_ENTRY_CANARY");
  const protectedCheck = trace.checks.find((row) => row.id === "SUBMIT_CHK_20A");
  assert.ok(protectedCheck);
  assert.strictEqual(protectedCheck.ok, false);
  assert.deepStrictEqual(protectedCheck.runbook_checklist, ["27A"]);
})();

(function warningSummaryClassifiesBothLiveReadinessStreakWarnings() {
  const summary = cloudbuild.__test.summarizeWarnings([
    "DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY",
    "DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY",
  ]);
  assert.strictEqual(summary.warning_n, 2);
  assert.strictEqual(summary.has_live_readiness_warning, true);
  assert.strictEqual(summary.has_repair_firestore_canary_streak_warning, true);
  assert.strictEqual(summary.has_production_entry_route_canary_streak_warning, true);
})();

(function statusLineSummarizesDecisionForOperators() {
  const statusLine = cloudbuild.__test.buildStatusLine({
    approved: false,
    decision: "HOLD",
    position_cycle_id: "PCY__READ__03",
    blocker_n: 2,
    warning_n: 1,
    warning_summary: {
      top_warnings: ["DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"],
    },
    blocker_summary: {
      top_blockers: [
        "DEPLOY_DECISION:BOUNDED_RUNTIME_SUMMARY_REQUIRED",
        "PROVENANCE:POSITION_CYCLE_ID_REQUIRED",
      ],
    },
  });
  assert.ok(statusLine.includes("HOLD"));
  assert.ok(statusLine.includes("cycle=PCY__READ__03"));
  assert.ok(statusLine.includes("blockers=2"));
  assert.ok(statusLine.includes("warnings=1"));
  assert.ok(statusLine.includes("warn=DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"));
  assert.ok(statusLine.includes("top=DEPLOY_DECISION:BOUNDED_RUNTIME_SUMMARY_REQUIRED|PROVENANCE:POSITION_CYCLE_ID_REQUIRED"));
})();

(function statusLineSurfacesProtectedEntryCanaryBlocker() {
  const statusLine = cloudbuild.__test.buildStatusLine({
    approved: false,
    decision: "HOLD",
    position_cycle_id: "PCY__READ__PROTECTED",
    blocker_n: 1,
    warning_n: 0,
    blocker_summary: {
      top_blockers: ["DEPLOY_DECISION:PRODUCTION_ENTRY_PROTECTED_CANARY_REQUIRED"],
      has_production_entry_protected_canary_blocker: true,
    },
  });
  assert.ok(statusLine.includes("protected_entry_canary=BLOCKED"));
  assert.ok(statusLine.includes("DEPLOY_DECISION:PRODUCTION_ENTRY_PROTECTED_CANARY_REQUIRED"));
})();

(function statusLineSurfacesStaleArtifactProvenanceBlocker() {
  const statusLine = cloudbuild.__test.buildStatusLine({
    approved: false,
    decision: "HOLD",
    position_cycle_id: "PCY__READ__STALE_ARTIFACT",
    blocker_n: 1,
    warning_n: 0,
    blocker_summary: {
      top_blockers: ["DEPLOY_DECISION:STALE_ARTIFACT_PROVENANCE:REPAIR_FIRESTORE_CANARY_STREAK"],
      has_stale_artifact_provenance_blocker: true,
    },
  });
  assert.ok(statusLine.includes("stale_artifact=BLOCKED"));
  assert.ok(statusLine.includes("DEPLOY_DECISION:STALE_ARTIFACT_PROVENANCE:REPAIR_FIRESTORE_CANARY_STREAK"));
})();

(function statusLineSurfacesLiveEvidenceCycleBlocker() {
  const statusLine = cloudbuild.__test.buildStatusLine({
    approved: false,
    decision: "HOLD",
    position_cycle_id: "PCY__READ__LIVE_EVIDENCE",
    blocker_n: 1,
    warning_n: 0,
    blocker_summary: {
      top_blockers: ["DEPLOY_DECISION:LIVE_EVIDENCE_ARTIFACT_CYCLE_MISMATCH"],
      has_live_evidence_cycle_blocker: true,
    },
  });
  assert.ok(statusLine.includes("live_evidence_cycle=BLOCKED"));
  assert.ok(statusLine.includes("DEPLOY_DECISION:LIVE_EVIDENCE_ARTIFACT_CYCLE_MISMATCH"));
})();

(function statusLineShowsAlertAttentionWithoutChangingApproval() {
  const statusLine = cloudbuild.__test.buildStatusLine({
    approved: true,
    decision: "APPROVE_DEPLOY",
    position_cycle_id: "PCY__READ__04",
    blocker_n: 0,
    warning_n: 0,
    alert_retry_summary: {
      failed_n: 2,
      pending_n: 1,
    },
    blocker_summary: {
      top_blockers: [],
    },
  });
  assert.ok(statusLine.includes("APPROVE_DEPLOY"));
  assert.ok(statusLine.includes("alert_failed=2"));
  assert.ok(statusLine.includes("alert_pending=1"));
})();

(function recommendedNextActionFollowsBlockerFamily() {
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextAction({
      approved: true,
      blocker_summary: {
        has_provenance_blocker: false,
        has_candidate_selection_blocker: false,
        has_bounded_runtime_blocker: false,
        has_watchdog_blocker: false,
      },
    }),
    "PROCEED_WITH_SUBMIT_WRAPPER"
  );
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextAction({
      approved: false,
      blocker_summary: {
        has_provenance_blocker: true,
      },
    }),
    "DISCARD_ARTIFACT_DIR_AND_RERUN_FROM_PREFLIGHT"
  );
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextAction({
      approved: false,
      blocker_summary: {
        has_provenance_blocker: false,
        has_candidate_selection_blocker: true,
      },
    }),
    "RECHECK_SELECTED_POSITION_CYCLE_AND_RERUN_CANARY_FLOW"
  );
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextAction({
      approved: false,
      blocker_summary: {
        has_provenance_blocker: false,
        has_candidate_selection_blocker: false,
        has_bounded_runtime_blocker: true,
      },
    }),
    "REGENERATE_BOUNDED_RUNTIME_ARTIFACTS_AND_RECHECK_DEPLOY_DECISION"
  );
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextAction({
      approved: false,
      blocker_summary: {
        has_provenance_blocker: false,
        has_candidate_selection_blocker: false,
        has_bounded_runtime_blocker: false,
        has_watchdog_blocker: true,
      },
    }),
    "HOLD_PROMOTION_AND_REVIEW_REPLAY_WATCHDOG_EVIDENCE"
  );
})();

(function recommendedNextActionReasonExplainsWhy() {
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextActionReason({
      approved: true,
      blocker_summary: {
        has_provenance_blocker: false,
        has_candidate_selection_blocker: false,
        has_bounded_runtime_blocker: false,
        has_watchdog_blocker: false,
      },
    }),
    "deploy decision approved with no blocking families"
  );
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextActionReason({
      approved: false,
      blocker_summary: {
        has_provenance_blocker: true,
      },
    }),
    "provenance blocker detected; bounded artifact lineage is not trustworthy"
  );
  assert.strictEqual(
    cloudbuild.__test.buildRecommendedNextActionReasonCode({
      approved: false,
      blocker_summary: {
        has_provenance_blocker: false,
        has_candidate_selection_blocker: false,
        has_bounded_runtime_blocker: true,
        has_watchdog_blocker: false,
      },
    }),
    "BOUNDED_RUNTIME_BLOCKER"
  );
})();

(function contextSubmitTraceFlagsBrokenChecksAndRunbookNumbers() {
  const trace = cloudbuild.__test.buildContextSubmitTrace({
    approved: false,
    lineage_contract_hash: null,
    blocker_summary: {
      blocker_n: 2,
      has_provenance_blocker: false,
      has_candidate_selection_blocker: false,
      has_bounded_runtime_blocker: true,
      has_watchdog_blocker: false,
    },
  }, {
    artifactDirCoherence: { ok: true },
  });
  assert.deepStrictEqual(trace.relevant_submit_check_ids, ["SUBMIT_CHK_01A", "SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08"]);
  assert.deepStrictEqual(trace.relevant_runbook_checklist, ["1", "5", "9", "11", "13", "16", "17"]);
  assert.deepStrictEqual(trace.failed_submit_check_ids, ["SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08"]);
  assert.deepStrictEqual(trace.failed_runbook_checklist, ["11", "13", "16", "17"]);
  assert.deepStrictEqual(trace.blocker_families, ["PROVENANCE", "BOUNDED_RUNTIME"]);
  assert.strictEqual(trace.primary_blocker_family, "PROVENANCE");
  assert.strictEqual(trace.deploy_warning_attention_required, false);
  assert.strictEqual(trace.deploy_warning_summary, null);
  assert.deepStrictEqual(trace.deploy_warning_runbook_checklist, []);
})();

(function shadowPipelineDoesNotRequireDeployApproval() {
  const approval = cloudbuild.__test.validateDeployApproval({
    mode: "PIPELINE",
    promotionMode: "SHADOW",
    positionCycleId: null,
  }, null);
  assert.strictEqual(approval.required, false);
  assert.deepStrictEqual(approval.blockers, []);
})();

(function deployDecisionArtifactCanBeReadFromArtifactDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-cloudbuild-"));
  try {
    fs.writeFileSync(path.join(dir, cloudbuild.__test.DEPLOY_DECISION_FILENAME), JSON.stringify({
      approved: true,
      decision: "APPROVE_DEPLOY",
      position_cycle_id: "PCY__READ__01",
      blockers: [],
      warnings: [],
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      candidate_selection_summary: {
        ok: true,
        selection_status: "READY",
        selected_position_cycle_id: "PCY__READ__01",
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
    }, null, 2), "utf8");
    const decision = cloudbuild.__test.readDeployDecisionArtifact(dir);
    assert.strictEqual(decision.approved, true);
    assert.strictEqual(decision.position_cycle_id, "PCY__READ__01");
    const summary = cloudbuild.__test.buildDeployDecisionSummary(decision);
    assert.strictEqual(summary.lineage_contract_hash, "lineage-hash-fixture");
    assert.strictEqual(summary.bounded_runtime_summary.exporter_snapshot_size_bytes, 12345);
    assert.strictEqual(summary.bounded_runtime_summary.lineage_contract.hash, "lineage-hash-fixture");
    assert.strictEqual(summary.bounded_runtime_summary.evidence_snapshot_summary.ok, true);
    assert.strictEqual(summary.bounded_runtime_summary.repair_evidence_summary.ok, true);
    assert.strictEqual(summary.bounded_runtime_summary.openclaw_execution_audit_ledger_write.reason, "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN");
    assert.strictEqual(summary.bounded_runtime_summary.repair_firestore_canary_streak.reason, "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS");
    assert.strictEqual(summary.bounded_runtime_summary.production_entry_route_canary_streak.reason, "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS");
    assert.strictEqual(summary.bounded_runtime_summary.production_entry_route_canary_streak.history_source, "FIRESTORE");
    assert.strictEqual(summary.candidate_selection_summary.selection_contract.ok, true);
    assert.strictEqual(summary.candidate_selection_summary.selection_contract.selected_runtime_chain_ok, true);
    assert.strictEqual(summary.blocker_summary.blocker_n, 0);
    const statusLine = cloudbuild.__test.buildStatusLine(summary);
    assert.ok(statusLine.includes("APPROVE_DEPLOY"));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function contextArtifactWritesFinalStatusLine() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-cloudbuild-context-"));
  const dir = path.join(root, "PCY__CTX__01");
  try {
    fs.mkdirSync(dir, { recursive: true });
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: dir,
      positionCycleId: "PCY__CTX__01",
      promotionMode: "CANARY",
    };
    const file = cloudbuild.__test.writeContextArtifact(plan, {
      deployDecision: {
        approved: true,
        decision: "APPROVE_DEPLOY",
        position_cycle_id: "PCY__CTX__01",
        blockers: [],
        warnings: [],
      },
    });
    assert.ok(fs.existsSync(file));
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.ok(payload.final_status_line.includes("APPROVE_DEPLOY"));
    assert.strictEqual(payload.lineage_contract_hash, null);
    assert.strictEqual(payload.requested_artifact_dir, dir);
    assert.strictEqual(payload.resolved_artifact_dir, dir);
    assert.strictEqual(payload.deploy_decision_summary.blocker_summary.blocker_n, 0);
    assert.strictEqual(payload.recommended_next_action, "PROCEED_WITH_SUBMIT_WRAPPER");
    assert.strictEqual(payload.recommended_next_action_reason, "deploy decision approved with no blocking families");
    assert.strictEqual(payload.recommended_next_action_reason_code, "APPROVED_NO_BLOCKING_FAMILIES");
    assert.deepStrictEqual(payload.submit_trace.relevant_submit_check_ids, ["SUBMIT_CHK_01A", "SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08"]);
    assert.deepStrictEqual(payload.submit_trace.relevant_runbook_checklist, ["1", "5", "9", "11", "13", "16", "17"]);
    assert.deepStrictEqual(payload.submit_trace.failed_submit_check_ids, ["SUBMIT_CHK_08"]);
    assert.deepStrictEqual(payload.submit_trace.failed_runbook_checklist, ["16", "17"]);
    assert.strictEqual(payload.submit_trace.primary_blocker_family, "PROVENANCE");
    assert.strictEqual(payload.submit_trace.deploy_warning_attention_required, false);
    assert.strictEqual(payload.submit_trace.deploy_warning_summary.warning_n, 0);
    assert.deepStrictEqual(payload.submit_trace.deploy_warning_runbook_checklist, []);
    assert.strictEqual(payload.submit_trace.recommended_next_action_reason_code, "APPROVED_NO_BLOCKING_FAMILIES");
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function contextArtifactPersistsProductionRouteWarningClassifiers() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-cloudbuild-context-warning-"));
  const dir = path.join(root, "PCY__CTX__WARNING");
  try {
    fs.mkdirSync(dir, { recursive: true });
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: dir,
      positionCycleId: "PCY__CTX__WARNING",
      promotionMode: "CANARY",
    };
    const file = cloudbuild.__test.writeContextArtifact(plan, {
      deployDecision: {
        approved: true,
        decision: "APPROVE_DEPLOY",
        position_cycle_id: "PCY__CTX__WARNING",
        blockers: [],
        warnings: ["DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"],
      },
    });
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.strictEqual(payload.deploy_decision_summary.warning_summary.warning_n, 1);
    assert.deepStrictEqual(payload.deploy_decision_summary.warning_summary.top_warnings, [
      "DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY",
    ]);
    assert.strictEqual(payload.deploy_decision_summary.warning_summary.has_live_readiness_warning, true);
    assert.strictEqual(payload.deploy_decision_summary.warning_summary.has_repair_firestore_canary_streak_warning, false);
    assert.strictEqual(payload.deploy_decision_summary.warning_summary.has_production_entry_route_canary_streak_warning, true);
    assert.strictEqual(payload.submit_trace.deploy_warning_attention_required, true);
    assert.strictEqual(payload.submit_trace.deploy_warning_summary.has_production_entry_route_canary_streak_warning, true);
    assert.deepStrictEqual(payload.submit_trace.deploy_warning_runbook_checklist, ["26"]);
    assert.ok(payload.final_status_line.includes("warnings=1"));
    assert.ok(payload.final_status_line.includes("warn=DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"));
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function contextArtifactCanExposeRequestedAndResolvedDirs() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-cloudbuild-context-finalized-"));
  const finalDir = path.join(dir, "PCY__CTX__FINAL");
  try {
    fs.mkdirSync(finalDir, { recursive: true });
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: finalDir,
      positionCycleId: "PCY__CTX__FINAL",
      promotionMode: "CANARY",
    };
    const file = cloudbuild.__test.writeContextArtifact(plan, {
      requestedArtifactDir: dir,
      resolvedArtifactDir: finalDir,
      deployDecision: {
        approved: true,
        decision: "APPROVE_DEPLOY",
        position_cycle_id: "PCY__CTX__FINAL",
        blockers: [],
        warnings: [],
      },
    });
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.strictEqual(payload.lineage_contract_hash, null);
    assert.strictEqual(payload.requested_artifact_dir, dir);
    assert.strictEqual(payload.resolved_artifact_dir, finalDir);
    assert.strictEqual(payload.artifact_dir, finalDir);
    assert.strictEqual(payload.artifact_dir_coherence.ok, true);
    assert.strictEqual(payload.artifact_dir_coherence.reason, "ARTIFACT_DIR_COHERENT");
    assert.strictEqual(payload.artifact_dir_coherence.requested_artifact_dir, dir);
    assert.strictEqual(payload.artifact_dir_coherence.resolved_artifact_dir, finalDir);
    assert.strictEqual(payload.artifact_dir_coherence.artifact_dir, finalDir);
    assert.strictEqual(payload.artifact_dir_coherence.position_cycle_id, "PCY__CTX__FINAL");
    assert.strictEqual(payload.artifact_dir_coherence.deploy_decision_position_cycle_id, "PCY__CTX__FINAL");
    assert.strictEqual(payload.artifact_dir_coherence.position_cycle_required, true);
    assert.strictEqual(payload.artifact_dir_coherence.artifact_dir_matches_resolved_artifact_dir, true);
    assert.strictEqual(payload.artifact_dir_coherence.artifact_dir_contains_position_cycle_id, true);
    assert.strictEqual(payload.artifact_dir_coherence.resolved_artifact_dir_contains_position_cycle_id, true);
    assert.strictEqual(payload.artifact_dir_coherence.context_cycle_matches_deploy_decision, true);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function contextArtifactFlagsResolvedDirDriftAtWriteTime() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-cloudbuild-context-drift-"));
  const finalDir = path.join(dir, "PCY__CTX__DRIFT");
  const staleDir = path.join(dir, "PCY__CTX__STALE");
  try {
    fs.mkdirSync(finalDir, { recursive: true });
    fs.mkdirSync(staleDir, { recursive: true });
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: finalDir,
      positionCycleId: "PCY__CTX__DRIFT",
      promotionMode: "CANARY",
    };
    const file = cloudbuild.__test.writeContextArtifact(plan, {
      requestedArtifactDir: dir,
      resolvedArtifactDir: staleDir,
      deployDecision: {
        approved: true,
        decision: "APPROVE_DEPLOY",
        position_cycle_id: "PCY__CTX__DRIFT",
        blockers: [],
        warnings: [],
        bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      },
    });
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.strictEqual(payload.artifact_dir, finalDir);
    assert.strictEqual(payload.resolved_artifact_dir, staleDir);
    assert.strictEqual(payload.artifact_dir_coherence.ok, false);
    assert.strictEqual(payload.artifact_dir_coherence.reason, "ARTIFACT_DIR_RESOLVED_DIR_MISMATCH");
    assert.strictEqual(payload.artifact_dir_coherence.artifact_dir_matches_resolved_artifact_dir, false);
    assert.strictEqual(payload.recommended_next_action, "DISCARD_ARTIFACT_DIR_AND_RERUN_FROM_PREFLIGHT");
    assert.strictEqual(payload.recommended_next_action_reason, "artifact dir self-check failed: ARTIFACT_DIR_RESOLVED_DIR_MISMATCH");
    assert.strictEqual(payload.recommended_next_action_reason_code, "PROVENANCE_BLOCKER");
    assert.deepStrictEqual(payload.submit_trace.failed_submit_check_ids, ["SUBMIT_CHK_01A", "SUBMIT_CHK_06"]);
    assert.deepStrictEqual(payload.submit_trace.failed_runbook_checklist, ["1", "5", "9", "11"]);
    assert.deepStrictEqual(payload.submit_trace.blocker_families, ["PROVENANCE"]);
    assert.strictEqual(payload.submit_trace.primary_blocker_family, "PROVENANCE");
    assert.strictEqual(payload.submit_trace.recommended_next_action_reason_code, "PROVENANCE_BLOCKER");
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function contextArtifactSurfacesLineageHashWhenPresent() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-cloudbuild-context-lineage-"));
  const dir = path.join(root, "PCY__CTX__LINEAGE");
  try {
    fs.mkdirSync(dir, { recursive: true });
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: dir,
      positionCycleId: "PCY__CTX__LINEAGE",
      promotionMode: "CANARY",
    };
    const file = cloudbuild.__test.writeContextArtifact(plan, {
      deployDecision: {
        approved: true,
        decision: "APPROVE_DEPLOY",
        position_cycle_id: "PCY__CTX__LINEAGE",
        blockers: [],
        warnings: [],
        bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      },
    });
    const payload = JSON.parse(fs.readFileSync(file, "utf8"));
    assert.strictEqual(payload.lineage_contract_hash, "lineage-hash-fixture");
    assert.strictEqual(payload.deploy_decision_summary.lineage_contract_hash, "lineage-hash-fixture");
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function boundedDeployPathRunsRunbookReview() {
  const cycleId = "PCY__RUNBOOK__01";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-cloudbuild-runbook-"));
  const dir = path.join(root, cycleId);
  try {
    fs.mkdirSync(dir, { recursive: true });
    seedRunbookArtifacts(dir, cycleId);
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: dir,
      positionCycleId: cycleId,
      promotionMode: "CANARY",
      effectiveEnv: {
        V2_PROMOTION_ARTIFACT_DIR: dir,
        V2_PROMOTION_SELECT_POSITION_CYCLE_ID: cycleId,
      },
    };
    const deployApproval = {
      required: true,
      approved: true,
      decision: {
        approved: true,
        position_cycle_id: cycleId,
      },
    };
    const result = cloudbuild.__test.runCanaryRunbookReview(plan, deployApproval);
    assert.strictEqual(result.required, true);
    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.reason, "RUNBOOK_REVIEW_PASS");
    assert.ok(result.review);
    assert.strictEqual(result.review.ok, true);
    assert.ok(fs.existsSync(result.output_file));
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function liveDeployPathGeneratesCutoverReadinessBeforeRunbookReview() {
  const cycleId = "PCY__RUNBOOK__LIVE_CUTOVER";
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-cloudbuild-live-cutover-"));
  const dir = path.join(root, cycleId);
  try {
    fs.mkdirSync(dir, { recursive: true });
    seedRunbookArtifacts(dir, cycleId);
    writeJson(path.join(dir, "promotion-deploy-decision.json"), {
      mode: "LIVE",
      approved: true,
      decision: "APPROVE_DEPLOY",
      position_cycle_id: cycleId,
      blockers: [],
      warnings: [],
      entry_boundary_audit: buildEntryBoundaryAuditFixture(),
      fill_sync_canonical_boundary_audit: buildFillSyncCanonicalBoundaryAuditFixture(),
      production_cutover_audit: buildProductionCutoverAuditFixture(),
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    });
    writeJson(
      path.join(dir, "v2_repair_queue_firestore_canary_streak_latest.json"),
      buildPassingRepairFirestoreStreakFixture()
    );
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: dir,
      positionCycleId: cycleId,
      promotionMode: "LIVE",
      effectiveEnv: {
        V2_PROMOTION_ARTIFACT_DIR: dir,
        V2_PROMOTION_SELECT_POSITION_CYCLE_ID: cycleId,
        DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_DIR: dir,
        DONBEOLJA_V2_ENABLED: "1",
        DONBEOLJA_V2_DRY_RUN: "0",
        DONBEOLJA_V2_CANARY_ONLY: "0",
        DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "1",
        DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER: "1",
        DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON: JSON.stringify(buildSchedulerTrafficStateFixture()),
      },
      schedulerTrafficCollectorExecFileSync: buildSchedulerTrafficCollectorExecFileSyncFixture(),
    };
    const deployApproval = {
      required: true,
      approved: true,
      decision: {
        approved: true,
        position_cycle_id: cycleId,
      },
    };
    const cutover = cloudbuild.__test.generateLiveCutoverReadiness(plan, deployApproval);
    assert.strictEqual(cutover.required, true);
    assert.strictEqual(cutover.reason, "LIVE_CUTOVER_READINESS_PASS");
    assert.ok(fs.existsSync(cutover.output_file));
    const contextFile = cloudbuild.__test.writeContextArtifact(plan, {
      deployDecision: {
        mode: "LIVE",
        approved: true,
        position_cycle_id: cycleId,
        blockers: [],
        warnings: [],
        bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      },
      liveCutoverReadiness: cutover.report,
      liveCutoverReadinessFile: cutover.output_file,
    });
    const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
    assert.strictEqual(context.live_cutover_readiness_file, cutover.output_file);
    assert.strictEqual(context.live_cutover_readiness_summary.ok, true);
    assert.strictEqual(context.live_cutover_readiness_summary.auto_apply, false);
    assert.strictEqual(context.live_cutover_readiness_summary.mutates_environment, false);
    assert.strictEqual(context.live_cutover_readiness_summary.required_env_change_n, 4);
    assert.strictEqual(context.live_cutover_readiness_summary.artifact_file, cutover.output_file);
    assert.strictEqual(context.live_cutover_readiness_summary.artifact_filename, "v2_repair_live_cutover_readiness_latest.json");
    assert.strictEqual(context.live_cutover_readiness_summary.artifact_current_dir_match, true);
    assert.strictEqual(typeof context.live_cutover_readiness_summary.generated_at, "string");
    assert.strictEqual(typeof context.live_cutover_readiness_summary.artifact_generated_at, "string");
    assert.strictEqual(Number.isFinite(context.live_cutover_readiness_summary.artifact_generated_age_minutes), true);

    const productionCutover = cloudbuild.__test.generateProductionCutoverReadiness(plan, deployApproval);
    assert.strictEqual(productionCutover.required, true);
    assert.strictEqual(productionCutover.reason, "PRODUCTION_CUTOVER_READINESS_PASS");
    assert.ok(fs.existsSync(productionCutover.output_file));
    const contextFileWithProduction = cloudbuild.__test.writeContextArtifact(plan, {
      deployDecision: {
        mode: "LIVE",
        approved: true,
        position_cycle_id: cycleId,
        blockers: [],
        warnings: [],
        bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      },
      liveCutoverReadiness: cutover.report,
      liveCutoverReadinessFile: cutover.output_file,
      productionCutoverReadiness: productionCutover.report,
      productionCutoverReadinessFile: productionCutover.output_file,
    });
    const contextWithProduction = JSON.parse(fs.readFileSync(contextFileWithProduction, "utf8"));
    assert.strictEqual(contextWithProduction.production_cutover_readiness_file, productionCutover.output_file);
    assert.strictEqual(contextWithProduction.production_cutover_readiness_summary.ok, true);
    assert.strictEqual(contextWithProduction.production_cutover_readiness_summary.legacy_webhook_blocked, true);
    assert.strictEqual(contextWithProduction.production_cutover_readiness_summary.guard_reason, "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED");
    assert.strictEqual(contextWithProduction.production_cutover_readiness_summary.artifact_file, productionCutover.output_file);
    assert.strictEqual(contextWithProduction.production_cutover_readiness_summary.artifact_filename, "v2_production_cutover_readiness_latest.json");
    assert.strictEqual(contextWithProduction.production_cutover_readiness_summary.artifact_current_dir_match, true);
    assert.strictEqual(typeof contextWithProduction.production_cutover_readiness_summary.generated_at, "string");
    assert.strictEqual(typeof contextWithProduction.production_cutover_readiness_summary.artifact_generated_at, "string");
    assert.strictEqual(Number.isFinite(contextWithProduction.production_cutover_readiness_summary.artifact_generated_age_minutes), true);

    const schedulerTrafficCutover = cloudbuild.__test.generateSchedulerTrafficCutoverReadiness(plan, deployApproval);
    assert.strictEqual(schedulerTrafficCutover.required, true);
    assert.strictEqual(schedulerTrafficCutover.reason, "SCHEDULER_TRAFFIC_CUTOVER_READINESS_PASS");
    assert.ok(fs.existsSync(schedulerTrafficCutover.output_file));
    const contextFileWithSchedulerTraffic = cloudbuild.__test.writeContextArtifact(plan, {
      deployDecision: {
        mode: "LIVE",
        approved: true,
        position_cycle_id: cycleId,
        blockers: [],
        warnings: [],
        bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      },
      liveCutoverReadiness: cutover.report,
      liveCutoverReadinessFile: cutover.output_file,
      productionCutoverReadiness: productionCutover.report,
      productionCutoverReadinessFile: productionCutover.output_file,
      schedulerTrafficCollectorPreflight: schedulerTrafficCutover.collector_preflight,
      schedulerTrafficCollectorPreflightFile: schedulerTrafficCutover.collector_preflight_file,
      schedulerTrafficCutoverReadiness: schedulerTrafficCutover.report,
      schedulerTrafficCutoverReadinessFile: schedulerTrafficCutover.output_file,
    });
    const contextWithSchedulerTraffic = JSON.parse(fs.readFileSync(contextFileWithSchedulerTraffic, "utf8"));
    assert.strictEqual(contextWithSchedulerTraffic.scheduler_traffic_cutover_readiness_file, schedulerTrafficCutover.output_file);
    assert.strictEqual(contextWithSchedulerTraffic.scheduler_traffic_collector_preflight_file, schedulerTrafficCutover.collector_preflight_file);
    assert.strictEqual(contextWithSchedulerTraffic.scheduler_traffic_collector_preflight_summary.ok, true);
    assert.strictEqual(contextWithSchedulerTraffic.scheduler_traffic_cutover_readiness_summary.ok, true);
    assert.strictEqual(contextWithSchedulerTraffic.scheduler_traffic_cutover_readiness_summary.scheduler_sot, "OPENCLAW_CRON");
    assert.strictEqual(contextWithSchedulerTraffic.scheduler_traffic_collector_preflight_summary.artifact_file, schedulerTrafficCutover.collector_preflight_file);
    assert.strictEqual(contextWithSchedulerTraffic.scheduler_traffic_collector_preflight_summary.artifact_filename, "v2_scheduler_traffic_collector_preflight_latest.json");
    assert.strictEqual(contextWithSchedulerTraffic.scheduler_traffic_collector_preflight_summary.artifact_current_dir_match, true);
    assert.strictEqual(Number.isFinite(contextWithSchedulerTraffic.scheduler_traffic_collector_preflight_summary.artifact_generated_age_minutes), true);
    assert.strictEqual(contextWithSchedulerTraffic.scheduler_traffic_cutover_readiness_summary.artifact_file, schedulerTrafficCutover.output_file);
    assert.strictEqual(contextWithSchedulerTraffic.scheduler_traffic_cutover_readiness_summary.artifact_filename, "v2_scheduler_traffic_cutover_readiness_latest.json");
    assert.strictEqual(contextWithSchedulerTraffic.scheduler_traffic_cutover_readiness_summary.artifact_current_dir_match, true);
    assert.strictEqual(Number.isFinite(contextWithSchedulerTraffic.scheduler_traffic_cutover_readiness_summary.artifact_generated_age_minutes), true);

    const result = cloudbuild.__test.runCanaryRunbookReview(plan, deployApproval);
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
  } finally {
    try { fs.rmSync(root, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function schedulerTrafficPreflightFailureContextPreservesCause() {
  const cycleId = "PCY__RUNBOOK__LIVE_PREFLIGHT_FAIL";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dbj-v2-cloudbuild-${cycleId}-`));
  try {
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: dir,
      positionCycleId: cycleId,
      promotionMode: "LIVE",
      effectiveEnv: {},
    };
    const preflightFile = path.join(dir, "v2_scheduler_traffic_collector_preflight_latest.json");
    const failedPreflight = {
      ok: false,
      reason: "V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_BLOCKED",
      fail_n: 1,
      failed_check_ids: ["SCHED_TRAFFIC_COLLECTOR_PREREQ_02_SCHEDULER_JOBS_LIST"],
      project_id: "donbeolja-dev",
      region: "asia-northeast3",
      service_names: ["donbeolja", "donbeolja-exit-worker"],
      scheduler_job_n: null,
    };
    writeJson(preflightFile, failedPreflight);
    const schedulerTrafficError = new Error("V2_PROMOTION_CLOUDBUILD_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_BLOCKED");
    schedulerTrafficError.scheduler_traffic_collector_preflight = failedPreflight;
    schedulerTrafficError.scheduler_traffic_collector_preflight_file = preflightFile;
    const contextFile = cloudbuild.__test.writeSchedulerTrafficFailureContext(plan, {
      deployDecision: {
        mode: "LIVE",
        approved: true,
        position_cycle_id: cycleId,
        blockers: [],
        warnings: [],
        bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
      },
      requestedArtifactDir: dir,
      resolvedArtifactDir: dir,
      liveCutover: {
        report: {
          ok: true,
          reason: "V2_REPAIR_FIRESTORE_CANARY_READY_FOR_LIVE_PREFLIGHT",
          auto_apply: false,
          mutates_environment: false,
          required_env_changes: [],
          blockers: [],
        },
        output_file: path.join(dir, "v2_repair_live_cutover_readiness_latest.json"),
      },
      productionCutover: {
        report: {
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
        },
        output_file: path.join(dir, "v2_production_cutover_readiness_latest.json"),
      },
      schedulerTrafficError,
    });
    const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
    assert.strictEqual(cloudbuild.__test.isSchedulerTrafficReadinessError(schedulerTrafficError), true);
    assert.strictEqual(context.live_cutover_readiness_summary.ok, true);
    assert.strictEqual(context.production_cutover_readiness_summary.ok, true);
    assert.strictEqual(context.scheduler_traffic_collector_preflight_file, preflightFile);
    assert.strictEqual(context.scheduler_traffic_collector_preflight_summary.ok, false);
    assert.strictEqual(context.scheduler_traffic_collector_preflight_summary.reason, "V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_BLOCKED");
    assert.strictEqual(context.scheduler_traffic_collector_preflight_summary.blocker_n, 1);
    assert.deepStrictEqual(
      context.scheduler_traffic_collector_preflight_summary.failed_check_ids,
      ["SCHED_TRAFFIC_COLLECTOR_PREREQ_02_SCHEDULER_JOBS_LIST"]
    );
    assert.strictEqual(context.scheduler_traffic_collector_preflight_summary.project_id, "donbeolja-dev");
    assert.strictEqual(context.scheduler_traffic_cutover_readiness_summary, null);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function liveAndProductionReadinessFailureContextPreservesCause() {
  const cycleId = "PCY__RUNBOOK__LIVE_READINESS_FAIL";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dbj-v2-cloudbuild-${cycleId}-`));
  try {
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: dir,
      positionCycleId: cycleId,
      promotionMode: "LIVE",
      effectiveEnv: {},
    };
    const deployDecision = {
      mode: "LIVE",
      approved: true,
      position_cycle_id: cycleId,
      blockers: [],
      warnings: [],
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    };
    const liveFile = path.join(dir, "v2_repair_live_cutover_readiness_latest.json");
    const liveError = new Error("V2_PROMOTION_CLOUDBUILD_LIVE_CUTOVER_READINESS_BLOCKED");
    liveError.live_cutover_readiness = {
      ok: false,
      reason: "V2_REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY",
      auto_apply: false,
      mutates_environment: false,
      required_env_changes: [],
      blockers: ["REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"],
      submit_check_ids: ["SUBMIT_CHK_12"],
      runbook_checklist: ["20"],
    };
    liveError.live_cutover_readiness_file = liveFile;
    const liveContextFile = cloudbuild.__test.writePromotionReadinessFailureContext(plan, {
      deployDecision,
      requestedArtifactDir: dir,
      resolvedArtifactDir: dir,
      liveCutoverError: liveError,
    });
    const liveContext = JSON.parse(fs.readFileSync(liveContextFile, "utf8"));
    assert.strictEqual(cloudbuild.__test.isLiveCutoverReadinessError(liveError), true);
    assert.strictEqual(liveContext.live_cutover_readiness_file, liveFile);
    assert.strictEqual(liveContext.live_cutover_readiness_summary.ok, false);
    assert.strictEqual(liveContext.live_cutover_readiness_summary.reason, "V2_REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY");
    assert.strictEqual(liveContext.live_cutover_readiness_summary.blocker_n, 1);
    assert.deepStrictEqual(liveContext.live_cutover_readiness_summary.submit_check_ids, ["SUBMIT_CHK_12"]);

    const productionFile = path.join(dir, "v2_production_cutover_readiness_latest.json");
    const productionError = new Error("V2_PROMOTION_CLOUDBUILD_PRODUCTION_CUTOVER_READINESS_BLOCKED");
    productionError.production_cutover_readiness = {
      ok: false,
      reason: "V2_PRODUCTION_CUTOVER_READINESS_BLOCKED",
      fail_n: 1,
      failed_check_ids: ["PROD_CUTOVER_READINESS_03_LEGACY_WEBHOOK_BLOCKED"],
      guard: {
        allowed: true,
        reason: "V2_LEGACY_WEBHOOK_SIGNAL_ALLOWED",
        context: {
          v2_enabled: true,
          v2_dry_run: false,
          v2_canary_only: false,
          require_production_cutover: true,
          block_legacy_webhook_signal: false,
          allow_legacy_webhook_signal: true,
        },
      },
    };
    productionError.production_cutover_readiness_file = productionFile;
    const productionContextFile = cloudbuild.__test.writePromotionReadinessFailureContext(plan, {
      deployDecision,
      requestedArtifactDir: dir,
      resolvedArtifactDir: dir,
      liveCutover: {
        report: liveError.live_cutover_readiness,
        output_file: liveFile,
      },
      productionCutoverError: productionError,
    });
    const productionContext = JSON.parse(fs.readFileSync(productionContextFile, "utf8"));
    assert.strictEqual(cloudbuild.__test.isProductionCutoverReadinessError(productionError), true);
    assert.strictEqual(productionContext.live_cutover_readiness_summary.ok, false);
    assert.strictEqual(productionContext.production_cutover_readiness_file, productionFile);
    assert.strictEqual(productionContext.production_cutover_readiness_summary.ok, false);
    assert.strictEqual(productionContext.production_cutover_readiness_summary.legacy_webhook_blocked, false);
    assert.deepStrictEqual(
      productionContext.production_cutover_readiness_summary.failed_check_ids,
      ["PROD_CUTOVER_READINESS_03_LEGACY_WEBHOOK_BLOCKED"]
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function runbookReviewContextPreservesPassAndFailureCause() {
  const cycleId = "PCY__RUNBOOK__REVIEW_CONTEXT";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dbj-v2-cloudbuild-${cycleId}-`));
  try {
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: dir,
      positionCycleId: cycleId,
      promotionMode: "CANARY",
      effectiveEnv: {},
    };
    const deployDecision = {
      approved: true,
      decision: "APPROVE_DEPLOY",
      position_cycle_id: cycleId,
      blockers: [],
      warnings: [],
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    };
    const passReviewFile = path.join(dir, "promotion-runbook-review.json");
    const passReview = {
      ok: true,
      overall_status: "PASS",
      expected_position_cycle_id: cycleId,
      check_n: 2,
      pass_n: 2,
      fail_n: 0,
      skip_n: 0,
      checks: [
        { id: "CHK_01", status: "PASS", label: "cycle", reason: "ok" },
        { id: "CHK_02", status: "PASS", label: "artifact", reason: "ok" },
      ],
    };
    const passContextFile = cloudbuild.__test.writeRunbookReviewContext(plan, {
      deployDecision,
      requestedArtifactDir: dir,
      resolvedArtifactDir: dir,
      runbookReview: passReview,
      runbookReviewFile: passReviewFile,
    });
    const passContext = JSON.parse(fs.readFileSync(passContextFile, "utf8"));
    assert.strictEqual(passContext.runbook_review_file, passReviewFile);
    assert.strictEqual(passContext.runbook_review_summary.ok, true);
    assert.strictEqual(passContext.runbook_review_summary.overall_status, "PASS");
    assert.deepStrictEqual(passContext.runbook_review_summary.failed_check_ids, []);

    const failReviewFile = path.join(dir, "promotion-runbook-review-fail.json");
    const failReview = {
      ok: false,
      overall_status: "FAIL",
      expected_position_cycle_id: cycleId,
      check_n: 3,
      pass_n: 2,
      fail_n: 1,
      skip_n: 0,
      checks: [
        { id: "CHK_01", status: "PASS", label: "cycle", reason: "ok" },
        {
          id: "CHK_17",
          status: "FAIL",
          label: "cloudbuild context lineage hash matches deploy decision",
          reason: "cloudbuild context lineage hash is missing or mismatched",
          file: path.join(dir, "promotion-cloudbuild-context.json"),
          field: "lineage_contract_hash",
        },
        { id: "CHK_21", status: "PASS", label: "entry boundary", reason: "ok" },
      ],
    };
    const failContextFile = cloudbuild.__test.writeRunbookReviewContext(plan, {
      deployDecision,
      requestedArtifactDir: dir,
      resolvedArtifactDir: dir,
      runbookReview: failReview,
      runbookReviewFile: failReviewFile,
    });
    const failContext = JSON.parse(fs.readFileSync(failContextFile, "utf8"));
    assert.strictEqual(failContext.runbook_review_file, failReviewFile);
    assert.strictEqual(failContext.runbook_review_summary.ok, false);
    assert.strictEqual(failContext.runbook_review_summary.fail_n, 1);
    assert.deepStrictEqual(failContext.runbook_review_summary.failed_check_ids, ["CHK_17"]);
    assert.strictEqual(failContext.runbook_review_summary.top_failed_checks[0].field, "lineage_contract_hash");
    assert.strictEqual(failContext.runbook_review_summary.expected_position_cycle_id, cycleId);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function thrownRunbookReviewContextPreservesCause() {
  const cycleId = "PCY__RUNBOOK__THROWN_CONTEXT";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `dbj-v2-cloudbuild-${cycleId}-`));
  try {
    const plan = {
      mode: "CANARY_FLOW",
      script: "run:v2-promotion-canary-flow",
      artifactDir: dir,
      positionCycleId: cycleId,
      promotionMode: "CANARY",
      effectiveEnv: {},
    };
    const deployDecision = {
      approved: true,
      decision: "APPROVE_DEPLOY",
      position_cycle_id: cycleId,
      blockers: [],
      warnings: [],
      bounded_runtime_summary: buildBoundedRuntimeSummaryFixture(),
    };
    const cause = new Error("V2_CANARY_RUNBOOK_ARTIFACT_REQUIRED:promotion-runtime-manifest.json");
    const thrownReview = cloudbuild.__test.buildThrownRunbookReview({
      plan,
      expectedPositionCycleId: cycleId,
      cause,
    });
    const contextFile = cloudbuild.__test.writeRunbookReviewContext(plan, {
      deployDecision,
      requestedArtifactDir: dir,
      resolvedArtifactDir: dir,
      runbookReview: thrownReview,
      runbookReviewFile: null,
    });
    const context = JSON.parse(fs.readFileSync(contextFile, "utf8"));
    assert.strictEqual(context.runbook_review_file, null);
    assert.strictEqual(context.runbook_review_summary.ok, false);
    assert.strictEqual(context.runbook_review_summary.fail_n, 1);
    assert.deepStrictEqual(context.runbook_review_summary.failed_check_ids, ["CHK_RUNBOOK_REVIEW_THROWN"]);
    assert.strictEqual(
      context.runbook_review_summary.top_failed_checks[0].reason,
      "V2_CANARY_RUNBOOK_ARTIFACT_REQUIRED:promotion-runtime-manifest.json"
    );
    assert.strictEqual(context.runbook_review_summary.top_failed_checks[0].field, "promotion-runbook-review");
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function autoSelectPathSkipsRunbookReview() {
  const result = cloudbuild.__test.runCanaryRunbookReview({
    mode: "CANARY_FLOW",
    artifactDir: "/tmp/auto-select",
    positionCycleId: null,
    promotionMode: "CANARY",
    effectiveEnv: {},
  }, {
    required: true,
    approved: true,
    decision: {
      approved: true,
      position_cycle_id: "PCY__AUTO__01",
    },
  });
  assert.strictEqual(result.required, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "RUNBOOK_REVIEW_SKIPPED_UNBOUNDED_OR_NOT_APPROVED");
})();

(function autoSelectFinalizedPathRunsRunbookReview() {
  const cycleId = "PCY__AUTO_FINAL__01";
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-cloudbuild-auto-final-"));
  const finalDir = path.join(dir, cycleId);
  try {
    fs.mkdirSync(finalDir, { recursive: true });
    seedRunbookArtifacts(finalDir, cycleId);
    const result = cloudbuild.__test.runCanaryRunbookReview({
      mode: "CANARY_FLOW",
      artifactDir: finalDir,
      positionCycleId: null,
      promotionMode: "CANARY",
      effectiveEnv: {},
    }, {
      required: true,
      approved: true,
      decision: {
        approved: true,
        position_cycle_id: cycleId,
      },
    });
    assert.strictEqual(result.required, true);
    assert.strictEqual(result.skipped, false);
    assert.strictEqual(result.review.ok, true);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function canReadCanaryFlowArtifactFromRequestedDir() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-cloudbuild-flow-artifact-"));
  try {
    fs.writeFileSync(path.join(dir, cloudbuild.__test.CANARY_FLOW_FILENAME), JSON.stringify({
      ok: true,
      artifact_dir: path.join(dir, "PCY__FLOW__01"),
      position_cycle_id: "PCY__FLOW__01",
    }, null, 2), "utf8");
    const flowArtifact = cloudbuild.__test.readCanaryFlowArtifact(dir);
    assert.strictEqual(flowArtifact.position_cycle_id, "PCY__FLOW__01");
    assert.ok(flowArtifact.artifact_dir.endsWith(path.join(path.basename(dir), "PCY__FLOW__01")) || flowArtifact.artifact_dir.endsWith(path.join("PCY__FLOW__01")));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

console.log("RUN_V2_PROMOTION_CLOUDBUILD_TEST_OK");
