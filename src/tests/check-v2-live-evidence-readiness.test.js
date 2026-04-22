"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const checker = require("../../scripts/check-v2-live-evidence-readiness");
const deployDecision = require("../../scripts/check-v2-promotion-deploy-decision");

const CYCLE_ID = "PCY__LIVE__EVIDENCE__01";
const GENERATED_AT = "2026-04-22T12:00:00.000Z";
const LINEAGE_CONTRACT_FIXTURE = Object.freeze({
  version: "V2_PROMOTION_SELECTOR_LINEAGE_SHA256_V1",
  hash: "lineage-hash-fixture",
});

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function buildProductionRuntimeChainAuditFixture() {
  return {
    ok: true,
    reason: "V2_PRODUCTION_RUNTIME_CHAIN_AUDIT_PASS",
    scope: "production_runtime_chain",
    contract: {
      ok: true,
      reason: "V2_PRODUCTION_RUNTIME_CHAIN_PASS",
      fail_n: 0,
      failed_check_ids: [],
      check_n: 1,
      checks: [],
    },
  };
}

function buildBoundedRuntimeSummaryFixture({ artifactDir = "/tmp/dbj-v2-live-evidence" } = {}) {
  const runtimeCheckIds = deployDecision.__test.REQUIRED_RUNTIME_CHAIN_CHECK_IDS;
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
    openclaw_execution_separation_summary: {
      ok: true,
      audit_n: 1,
      fail_n: 0,
      failed_check_ids: [],
    },
    runtime_chain_audit_summary: {
      ok: true,
      check_n: runtimeCheckIds.length,
      fail_n: 0,
      check_ids: runtimeCheckIds.slice(),
      passed_check_ids: runtimeCheckIds.slice(),
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
      doc_id: "OCEAUV2__LIVE__EVIDENCE__01",
    },
    openclaw_supreme_control_plane_summary: buildOpenClawSupremeSummaryFixture({ artifactDir }),
    repair_firestore_canary_streak: buildRepairStreakFixture({ artifactDir }),
    production_entry_route_canary_streak: buildProductionEntryRouteStreakFixture({ artifactDir }),
    exit_runtime_canary_streak: buildExitRuntimeStreakFixture({ artifactDir }),
    production_entry_protected_canary: buildProtectedEntryCanaryFixture({ artifactDir }),
  };
}

function buildOpenClawSupremeSummaryFixture({ artifactDir }) {
  return {
    ok: true,
    world_state_n: 1,
    latest_world_state_hash: "world-state-hash-fixture",
    execution_permit_n: 1,
    permit_validation_pass_n: 1,
    permit_validation_fail_n: 0,
    outcome_adjudication_n: 1,
    outcome_unadjudicated_n: 0,
    learner_shadow_summary: {
      ok: true,
      evaluation_n: 1,
      shadow_only_n: 1,
      live_applied_n: 0,
      stale_evaluation_n: 0,
      max_evaluation_age_minutes: 1440,
      max_observed_evaluation_age_minutes: 1,
      latest_evaluated_at: "2026-04-22T12:01:00.000Z",
      blockers: [],
    },
    collector_execution_summary: {
      status: "PASS",
      producer_script: "collect-v2-promotion-runtime-snapshot",
      producer_scope: "openclaw_supreme_control_plane",
      source: "V2_FIRESTORE_COLLECTOR",
      position_cycle_id: CYCLE_ID,
      openclaw_decision_id: "OCDV2__LIVE__EVIDENCE__01",
      collected_at: "2026-04-22T12:02:00.000Z",
      artifact_file: path.join(artifactDir, "promotion-runtime-snapshot.json"),
      artifact_dir: artifactDir,
      artifact_filename: "promotion-runtime-snapshot.json",
      artifact_current_dir_match: true,
        generated_at: "2026-04-22T12:00:00.000Z",
      artifact_generated_at: GENERATED_AT,
      artifact_generated_age_minutes: 15,
      exchange_write_performed: false,
      blockers: [],
    },
    lineage_consistency_summary: {
      ok: true,
      expected_openclaw_decision_id: "OCDV2__LIVE__EVIDENCE__01",
      expected_position_cycle_id: CYCLE_ID,
      expected_world_state_hash: "world-state-hash-fixture",
      permit_lineage_match_n: 1,
      permit_lineage_mismatch_n: 0,
      outcome_lineage_match_n: 1,
      outcome_lineage_mismatch_n: 0,
      learner_lineage_match_n: 1,
      learner_lineage_mismatch_n: 0,
      blockers: [],
    },
    blockers: [],
  };
}

function buildRepairStreakFixture({ artifactDir }) {
  return {
    ok: true,
    reason: "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS",
    position_cycle_id: CYCLE_ID,
    artifact_file: path.join(artifactDir, "v2_repair_queue_firestore_canary_streak_latest.json"),
    artifact_dir: artifactDir,
    artifact_filename: "v2_repair_queue_firestore_canary_streak_latest.json",
    artifact_current_dir_match: true,
    generated_at: GENERATED_AT,
    artifact_generated_at: GENERATED_AT,
    artifact_generated_age_minutes: 15,
    lookback_hours: 24,
    healthy_run_n: 13,
    min_run_count: 12,
    max_gap_minutes: 180,
    unhealthy_run_n: 0,
    firestore_evidence_missing_n: 0,
    invalid_line_n: 0,
    latest_age_minutes: 15,
    coverage_minutes: 1440,
    max_observed_gap_minutes: 120,
    blockers: [],
  };
}

function buildProductionEntryRouteStreakFixture({ artifactDir }) {
  return {
    ok: true,
    reason: "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS",
    position_cycle_id: CYCLE_ID,
    artifact_file: path.join(artifactDir, "v2_production_entry_route_canary_streak_latest.json"),
    artifact_dir: artifactDir,
    artifact_filename: "v2_production_entry_route_canary_streak_latest.json",
    artifact_current_dir_match: true,
    generated_at: GENERATED_AT,
    artifact_generated_at: GENERATED_AT,
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
  };
}

function buildExitRuntimeStreakFixture({ artifactDir }) {
  const defectCounts = {
    tp1_missing_n: 0,
    native_refresh_unhealthy_n: 0,
    unprotected_window_violation_n: 0,
    alert_silent_drop_n: 0,
    alert_retry_unresolved_n: 0,
    alert_outbox_integrity_gap_n: 0,
    trail_activation_evidence_gap_n: 0,
  };
  return {
    ok: true,
    reason: "V2_EXIT_RUNTIME_CANARY_STREAK_PASS",
    position_cycle_id: CYCLE_ID,
    artifact_file: path.join(artifactDir, "v2_exit_runtime_canary_streak_latest.json"),
    artifact_dir: artifactDir,
    artifact_filename: "v2_exit_runtime_canary_streak_latest.json",
    artifact_current_dir_match: true,
    generated_at: GENERATED_AT,
    artifact_generated_at: GENERATED_AT,
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
    ...defectCounts,
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
      blockers: [],
    },
    long_run_quality_summary: {
      status: "PASS",
      history_source: "FIRESTORE",
      firestore_source_required: true,
      coverage_minutes: 1440,
      latest_age_minutes: 15,
      max_observed_gap_minutes: 120,
      defect_counts: defectCounts,
      blockers: [],
    },
    blockers: [],
  };
}

function buildProtectedEntryCanaryFixture({ artifactDir }) {
  return {
    ok: true,
    reason: "V2_PRODUCTION_ENTRY_PROTECTED_CANARY_PASS",
    scope: "production_entry_protected_canary",
    canary_mode: "PROTECTED_ENTRY_NO_EXCHANGE_PROOF",
    artifact_file: path.join(artifactDir, "v2_production_entry_protected_canary_latest.json"),
    artifact_dir: artifactDir,
    artifact_filename: "v2_production_entry_protected_canary_latest.json",
    artifact_current_dir_match: true,
    generated_at: GENERATED_AT,
    artifact_generated_at: GENERATED_AT,
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
      position_cycle_id: CYCLE_ID,
      entry_event_id: "ENTRY__LIVE__EVIDENCE__01",
      protection_runtime_id: "PRTV2__LIVE__EVIDENCE__01",
      runtime_health_status: "HEALTHY",
      sl_order_id: "SL__LIVE__EVIDENCE__01",
      tp1_order_id: "TP1__LIVE__EVIDENCE__01",
    },
  };
}

function buildLiveDeployDecisionFixture({ artifactDir = "/tmp/dbj-v2-live-evidence", bounded = null } = {}) {
  const runtimeSummary = bounded || buildBoundedRuntimeSummaryFixture({ artifactDir });
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "LIVE",
    position_cycle_id: CYCLE_ID,
    selector_meta: { position_cycle_id: CYCLE_ID },
    bounded_runtime_summary: runtimeSummary,
  }, {
    artifactDir,
    productionRuntimeChainAudit: buildProductionRuntimeChainAuditFixture(),
  });
  assert.deepStrictEqual(decision.blockers, []);
  assert.strictEqual(decision.approved, true);
  return decision;
}

(function liveReadyDecisionPasses() {
  const artifactDir = "/tmp/dbj-v2-live-evidence-ready";
  const decision = buildLiveDeployDecisionFixture({ artifactDir });
  const result = checker.evaluateLiveEvidenceReadiness({ deployDecision: decision, artifactDir });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_LIVE_EVIDENCE_READY");
  assert.strictEqual(result.evidence_ready, true);
  assert.strictEqual(result.deploy_ready, true);
  assert.strictEqual(result.failed_axis_n, 0);
  assert.deepStrictEqual(result.failed_axis_ids, []);
})();

(function missingExitRuntimeStreakFailsWithRunbook28() {
  const artifactDir = "/tmp/dbj-v2-live-evidence-missing-exit";
  const bounded = buildBoundedRuntimeSummaryFixture({ artifactDir });
  delete bounded.exit_runtime_canary_streak;
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "LIVE",
    position_cycle_id: CYCLE_ID,
    selector_meta: { position_cycle_id: CYCLE_ID },
    bounded_runtime_summary: bounded,
  }, {
    artifactDir,
    productionRuntimeChainAudit: buildProductionRuntimeChainAuditFixture(),
  });
  const result = checker.evaluateLiveEvidenceReadiness({ deployDecision: decision, artifactDir });
  assert.strictEqual(result.ok, false);
  assert.ok(result.failed_axis_ids.includes("exit_runtime_canary_streak"));
  assert.ok(result.blockers.includes("LIVE_EVIDENCE:EXIT_RUNTIME_CANARY_STREAK_REQUIRED"));
  assert.ok(result.submit_check_ids.includes("SUBMIT_CHK_21"));
  assert.ok(result.runbook_refs.includes("28"));
})();

(function temporalMismatchFailsWithRunbook30() {
  const artifactDir = "/tmp/dbj-v2-live-evidence-temporal";
  const bounded = buildBoundedRuntimeSummaryFixture({ artifactDir });
  bounded.exit_runtime_canary_streak.artifact_generated_at = "2026-04-22T13:00:01.000Z";
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "LIVE",
    position_cycle_id: CYCLE_ID,
    selector_meta: { position_cycle_id: CYCLE_ID },
    bounded_runtime_summary: bounded,
  }, {
    artifactDir,
    productionRuntimeChainAudit: buildProductionRuntimeChainAuditFixture(),
  });
  const result = checker.evaluateLiveEvidenceReadiness({ deployDecision: decision, artifactDir });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.temporal_coherence.ok, false);
  assert.ok(result.temporal_coherence.blockers.includes("DEPLOY_DECISION:LIVE_STREAK_TEMPORAL_WINDOW_MISMATCH"));
  assert.ok(result.submit_check_ids.includes("SUBMIT_CHK_06"));
  assert.ok(result.submit_check_ids.includes("SUBMIT_CHK_07"));
  assert.ok(result.runbook_refs.includes("30"));
})();

(function openClawSupremeArtifactDirMismatchFailsSameCycleReadiness() {
  const artifactDir = "/tmp/dbj-v2-live-evidence-openclaw-cycle";
  const bounded = buildBoundedRuntimeSummaryFixture({ artifactDir });
  bounded.openclaw_supreme_control_plane_summary.collector_execution_summary.artifact_dir = "/tmp/other-v2-artifact-cycle";
  const decision = deployDecision.__test.buildDeployDecision({
    pass: true,
    mode: "LIVE",
    position_cycle_id: CYCLE_ID,
    selector_meta: { position_cycle_id: CYCLE_ID },
    bounded_runtime_summary: bounded,
  }, {
    artifactDir,
    productionRuntimeChainAudit: buildProductionRuntimeChainAuditFixture(),
  });
  const result = checker.evaluateLiveEvidenceReadiness({ deployDecision: decision, artifactDir });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.temporal_coherence.ok, false);
  assert.ok(result.temporal_coherence.blockers.includes("DEPLOY_DECISION:LIVE_EVIDENCE_ARTIFACT_CYCLE_MISMATCH"));
  assert.ok(result.submit_check_ids.includes("SUBMIT_CHK_06"));
  assert.ok(result.runbook_refs.includes("30"));
})();

(function canaryModeIsNotLiveReady() {
  const artifactDir = "/tmp/dbj-v2-live-evidence-canary-mode";
  const decision = buildLiveDeployDecisionFixture({ artifactDir });
  const canaryDecision = deepClone(decision);
  canaryDecision.mode = "CANARY";
  const result = checker.evaluateLiveEvidenceReadiness({ deployDecision: canaryDecision, artifactDir });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.evidence_ready, false);
  assert.strictEqual(result.deploy_ready, false);
})();

(function canWriteReadinessArtifact() {
  const artifactDir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-live-evidence-"));
  const decision = buildLiveDeployDecisionFixture({ artifactDir });
  const decisionFile = path.join(artifactDir, "promotion-deploy-decision.json");
  fs.writeFileSync(decisionFile, JSON.stringify(decision, null, 2), "utf8");
  const payload = checker.main({
    V2_PROMOTION_ARTIFACT_DIR: artifactDir,
  });
  const outputFile = path.join(artifactDir, checker.__test.OUTPUT_FILENAME);
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.output_file, outputFile);
  assert.strictEqual(JSON.parse(fs.readFileSync(outputFile, "utf8")).reason, "V2_LIVE_EVIDENCE_READY");
})();

console.log("CHECK_V2_LIVE_EVIDENCE_READINESS_TEST_OK");
