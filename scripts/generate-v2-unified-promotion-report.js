#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const gate = require("./check-v2-promotion-gate");

const OUTPUT_FILENAME = "unified-promotion-report.json";
const CANDIDATE_SELECTION_FILENAME = "promotion-canary-candidate-selection.json";
const REPAIR_FIRESTORE_CANARY_STREAK_FILENAME = "v2_repair_queue_firestore_canary_streak_latest.json";
const PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_FILENAME = "v2_production_entry_route_canary_streak_latest.json";
const PRODUCTION_ENTRY_PROTECTED_CANARY_FILENAME = "v2_production_entry_protected_canary_latest.json";
const EXIT_RUNTIME_CANARY_STREAK_FILENAME = "v2_exit_runtime_canary_streak_latest.json";
const PERFORMANCE_GATE_FILENAME = "v2_performance_gate_latest.json";
const FIRESTORE_COST_GUARD_FILENAME = "v2_firestore_cost_guard_latest.json";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function resolveArtifactDir(env = process.env) {
  return trimOrNull(env.V2_PROMOTION_ARTIFACT_DIR) || path.resolve("tmp", "v2-promotion-artifacts");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function normalizeObject(value) {
  return value && typeof value === "object" ? value : null;
}

function normalizeNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function normalizeIdList(value) {
  return Object.freeze(Array.from(new Set(
    (Array.isArray(value) ? value : [])
      .map(trimOrNull)
      .filter(Boolean)
  )).sort());
}

function toMs(value) {
  const ms = Date.parse(String(value || "").trim());
  return Number.isFinite(ms) ? ms : null;
}

function buildEvidenceSnapshotSummary(summary) {
  const row = normalizeObject(summary);
  if (!row) return null;
  return Object.freeze({
    ok: row.ok === true,
    transition_n: normalizeNumber(row.transition_n),
    transition_evidence_n: normalizeNumber(row.transition_evidence_n),
    missing_transition_evidence_n: normalizeNumber(row.missing_transition_evidence_n),
    terminal_transition_n: normalizeNumber(row.terminal_transition_n),
    terminal_full_exit_evidence_n: normalizeNumber(row.terminal_full_exit_evidence_n),
    missing_terminal_full_exit_evidence_n: normalizeNumber(row.missing_terminal_full_exit_evidence_n),
    stop_terminal_transition_n: normalizeNumber(row.stop_terminal_transition_n),
    stop_terminal_fill_evidence_n: normalizeNumber(row.stop_terminal_fill_evidence_n),
    missing_stop_terminal_fill_evidence_n: normalizeNumber(row.missing_stop_terminal_fill_evidence_n),
    protection_runtime_n: normalizeNumber(row.protection_runtime_n),
    protection_runtime_evidence_n: normalizeNumber(row.protection_runtime_evidence_n),
    missing_protection_runtime_evidence_n: normalizeNumber(row.missing_protection_runtime_evidence_n),
  });
}

function buildLineageContractSummary(summary) {
  const row = normalizeObject(summary);
  if (!row) return null;
  return Object.freeze({
    version: trimOrNull(row.version),
    hash: trimOrNull(row.hash),
  });
}

function buildCandidateSelectionContractSummary(summary) {
  const row = normalizeObject(summary);
  if (!row) return null;
  return Object.freeze({
    ok: row.ok === true,
    scan_limit_respected: row.scan_limit_respected === true,
    recent_window_enforced: row.recent_window_enforced === true,
    selected_candidate_present: row.selected_candidate_present === true,
    selected_preflight_ok: row.selected_preflight_ok === true,
    selected_runtime_chain_ok: row.selected_runtime_chain_ok === true,
    selected_cycle_matches_preflight: row.selected_cycle_matches_preflight === true,
    selected_cycle_matches_collector_env: row.selected_cycle_matches_collector_env === true,
    selected_snapshot_counts_exact: row.selected_snapshot_counts_exact === true,
  });
}

function buildAlertRetrySummary(summary) {
  const row = normalizeObject(summary);
  if (!row) return null;
  return Object.freeze({
    outbox_n: normalizeNumber(row.outbox_n),
    failed_n: normalizeNumber(row.failed_n),
    sent_n: normalizeNumber(row.sent_n),
    pending_n: normalizeNumber(row.pending_n),
    retryable_failed_n: normalizeNumber(row.retryable_failed_n),
    terminal_failed_n: normalizeNumber(row.terminal_failed_n),
    family_counts: normalizeObject(row.family_counts) || {},
    retry_policy_counts: normalizeObject(row.retry_policy_counts) || {},
    runbook_ref_counts: normalizeObject(row.runbook_ref_counts) || {},
    latest_failed: normalizeObject(row.latest_failed)
      ? Object.freeze({
          alert_outbox_id: trimOrNull(row.latest_failed.alert_outbox_id),
          last_reason: trimOrNull(row.latest_failed.last_reason),
          last_reason_family: trimOrNull(row.latest_failed.last_reason_family),
          retry_policy_code: trimOrNull(row.latest_failed.retry_policy_code),
          runbook_refs: Array.isArray(row.latest_failed.runbook_refs) ? row.latest_failed.runbook_refs.slice() : [],
          last_attempt_at: trimOrNull(row.latest_failed.last_attempt_at),
        })
      : null,
  });
}

function buildOpenClawExecutionSeparationSummary(summary) {
  const row = normalizeObject(summary);
  if (!row) return null;
  return Object.freeze({
    ok: row.ok === true,
    audit_n: normalizeNumber(row.audit_n),
    fail_n: normalizeNumber(row.fail_n),
    failed_check_ids: Array.isArray(row.failed_check_ids) ? row.failed_check_ids.slice() : [],
  });
}

function buildRuntimeChainAuditSummary(summary) {
  const row = normalizeObject(summary);
  if (!row) return null;
  return Object.freeze({
    ok: row.ok === true,
    check_n: normalizeNumber(row.check_n),
    fail_n: normalizeNumber(row.fail_n),
    check_ids: Array.isArray(row.check_ids) ? row.check_ids.slice() : [],
    passed_check_ids: Array.isArray(row.passed_check_ids) ? row.passed_check_ids.slice() : [],
    failed_check_ids: Array.isArray(row.failed_check_ids) ? row.failed_check_ids.slice() : [],
  });
}

function buildRepairEvidenceSummary(summary) {
  const row = normalizeObject(summary);
  if (!row) return null;
  return Object.freeze({
    ok: row.ok === true,
    repair_request_n: normalizeNumber(row.repair_request_n),
    repair_execution_ledger_n: normalizeNumber(row.repair_execution_ledger_n),
    completion_ledger_n: normalizeNumber(row.completion_ledger_n),
    completion_evidence_n: normalizeNumber(row.completion_evidence_n),
    completed_success_n: normalizeNumber(row.completed_success_n),
    completed_failed_n: normalizeNumber(row.completed_failed_n),
    missing_completion_evidence_n: normalizeNumber(row.missing_completion_evidence_n),
    runbook_refs: Array.isArray(row.runbook_refs) ? row.runbook_refs.slice() : [],
    order_evidence_n: normalizeNumber(row.order_evidence_n),
    latest_completion: normalizeObject(row.latest_completion) || null,
  });
}

function readOptionalJson(filePath) {
  const resolved = path.resolve(filePath);
  if (!fs.existsSync(resolved)) return null;
  return JSON.parse(fs.readFileSync(resolved, "utf8"));
}

function withArtifactProvenance(payload, filePath, artifactDir, expectedFilename, nowMs = Date.now()) {
  const row = normalizeObject(payload);
  if (!row) return null;
  const resolvedArtifactDir = trimOrNull(artifactDir) ? path.resolve(artifactDir) : null;
  const expectedFile = resolvedArtifactDir && trimOrNull(expectedFilename)
    ? path.join(resolvedArtifactDir, expectedFilename)
    : null;
  const resolvedFile = path.resolve(filePath);
  const generatedMs = toMs(row.generated_at);
  const artifactGeneratedAgeMinutes = generatedMs == null
    ? null
    : Math.max(0, (Number(nowMs) - generatedMs) / 60000);
  return Object.freeze({
    ...row,
    artifact_file: resolvedFile,
    artifact_dir: resolvedArtifactDir,
    artifact_filename: path.basename(resolvedFile),
    artifact_current_dir_match: !!(expectedFile && resolvedFile === expectedFile),
    artifact_generated_at: trimOrNull(row.generated_at),
    artifact_generated_age_minutes: artifactGeneratedAgeMinutes,
  });
}

function readCandidateSelectionArtifact(artifactDir) {
  const dir = trimOrNull(artifactDir);
  if (!dir) return null;
  return readOptionalJson(path.join(dir, CANDIDATE_SELECTION_FILENAME));
}

function resolveRepairFirestoreCanaryStreakFile(env = process.env, artifactDir = null) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_FILE);
  if (explicit) return path.resolve(explicit);
  const dir = trimOrNull(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_DIR)
    || trimOrNull(env.DONBEOLJA_V2_REPAIR_CANARY_ARTIFACT_DIR);
  if (dir) return path.resolve(dir, REPAIR_FIRESTORE_CANARY_STREAK_FILENAME);
  const artifactScoped = trimOrNull(artifactDir)
    ? path.resolve(artifactDir, REPAIR_FIRESTORE_CANARY_STREAK_FILENAME)
    : null;
  if (artifactScoped && fs.existsSync(artifactScoped)) return artifactScoped;
  return path.resolve("ops", "daily", REPAIR_FIRESTORE_CANARY_STREAK_FILENAME);
}

function readRepairFirestoreCanaryStreakArtifact(env = process.env, artifactDir = null) {
  const filePath = resolveRepairFirestoreCanaryStreakFile(env, artifactDir);
  return withArtifactProvenance(
    readOptionalJson(filePath),
    filePath,
    artifactDir,
    REPAIR_FIRESTORE_CANARY_STREAK_FILENAME
  );
}

function resolveProductionEntryRouteCanaryStreakFile(env = process.env, artifactDir = null) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_FILE);
  if (explicit) return path.resolve(explicit);
  const dir = trimOrNull(env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_ARTIFACT_DIR);
  if (dir) return path.resolve(dir, PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_FILENAME);
  const artifactScoped = trimOrNull(artifactDir)
    ? path.resolve(artifactDir, PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_FILENAME)
    : null;
  if (artifactScoped && fs.existsSync(artifactScoped)) return artifactScoped;
  return path.resolve("ops", "daily", PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_FILENAME);
}

function readProductionEntryRouteCanaryStreakArtifact(env = process.env, artifactDir = null) {
  const filePath = resolveProductionEntryRouteCanaryStreakFile(env, artifactDir);
  return withArtifactProvenance(
    readOptionalJson(filePath),
    filePath,
    artifactDir,
    PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_FILENAME
  );
}

function resolveProductionEntryProtectedCanaryFile(env = process.env, artifactDir = null) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_PRODUCTION_ENTRY_PROTECTED_CANARY_FILE);
  if (explicit) return path.resolve(explicit);
  const dir = trimOrNull(env.DONBEOLJA_V2_PRODUCTION_ENTRY_PROTECTED_CANARY_ARTIFACT_DIR);
  if (dir) return path.resolve(dir, PRODUCTION_ENTRY_PROTECTED_CANARY_FILENAME);
  const artifactScoped = trimOrNull(artifactDir)
    ? path.resolve(artifactDir, PRODUCTION_ENTRY_PROTECTED_CANARY_FILENAME)
    : null;
  if (artifactScoped && fs.existsSync(artifactScoped)) return artifactScoped;
  return path.resolve("ops", "daily", PRODUCTION_ENTRY_PROTECTED_CANARY_FILENAME);
}

function readProductionEntryProtectedCanaryArtifact(env = process.env, artifactDir = null) {
  const filePath = resolveProductionEntryProtectedCanaryFile(env, artifactDir);
  return withArtifactProvenance(
    readOptionalJson(filePath),
    filePath,
    artifactDir,
    PRODUCTION_ENTRY_PROTECTED_CANARY_FILENAME
  );
}

function resolveExitRuntimeCanaryStreakFile(env = process.env, artifactDir = null) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_FILE);
  if (explicit) return path.resolve(explicit);
  const dir = trimOrNull(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_ARTIFACT_DIR);
  if (dir) return path.resolve(dir, EXIT_RUNTIME_CANARY_STREAK_FILENAME);
  const artifactScoped = trimOrNull(artifactDir)
    ? path.resolve(artifactDir, EXIT_RUNTIME_CANARY_STREAK_FILENAME)
    : null;
  if (artifactScoped && fs.existsSync(artifactScoped)) return artifactScoped;
  return path.resolve("ops", "daily", EXIT_RUNTIME_CANARY_STREAK_FILENAME);
}

function readExitRuntimeCanaryStreakArtifact(env = process.env, artifactDir = null) {
  const filePath = resolveExitRuntimeCanaryStreakFile(env, artifactDir);
  return withArtifactProvenance(
    readOptionalJson(filePath),
    filePath,
    artifactDir,
    EXIT_RUNTIME_CANARY_STREAK_FILENAME
  );
}

function resolvePerformanceGateFile(env = process.env, artifactDir = null) {
  const explicit = trimOrNull(env.V2_PERFORMANCE_GATE_OUTPUT_FILE);
  if (explicit) return path.resolve(explicit);
  const artifactScoped = trimOrNull(artifactDir)
    ? path.resolve(artifactDir, PERFORMANCE_GATE_FILENAME)
    : null;
  if (artifactScoped && fs.existsSync(artifactScoped)) return artifactScoped;
  return path.resolve("ops", "daily", PERFORMANCE_GATE_FILENAME);
}

function readPerformanceGateArtifact(env = process.env, artifactDir = null) {
  const filePath = resolvePerformanceGateFile(env, artifactDir);
  return withArtifactProvenance(
    readOptionalJson(filePath),
    filePath,
    artifactDir,
    PERFORMANCE_GATE_FILENAME
  );
}

function resolveFirestoreCostGuardFile(env = process.env, artifactDir = null) {
  const explicit = trimOrNull(env.V2_FIRESTORE_COST_GUARD_OUTPUT_FILE);
  if (explicit) return path.resolve(explicit);
  const artifactScoped = trimOrNull(artifactDir)
    ? path.resolve(artifactDir, FIRESTORE_COST_GUARD_FILENAME)
    : null;
  if (artifactScoped && fs.existsSync(artifactScoped)) return artifactScoped;
  return path.resolve("ops", "daily", FIRESTORE_COST_GUARD_FILENAME);
}

function readFirestoreCostGuardArtifact(env = process.env, artifactDir = null) {
  const filePath = resolveFirestoreCostGuardFile(env, artifactDir);
  return withArtifactProvenance(
    readOptionalJson(filePath),
    filePath,
    artifactDir,
    FIRESTORE_COST_GUARD_FILENAME
  );
}

function buildRepairFirestoreCanaryStreakSummary(streak) {
  const row = normalizeObject(streak);
  if (!row) return null;
  return Object.freeze({
    ok: row.ok === true,
    reason: trimOrNull(row.reason),
    generated_at: trimOrNull(row.generated_at),
    artifact_generated_at: trimOrNull(row.artifact_generated_at),
    artifact_generated_age_minutes: normalizeNumber(row.artifact_generated_age_minutes),
    artifact_file: trimOrNull(row.artifact_file),
    artifact_dir: trimOrNull(row.artifact_dir),
    artifact_filename: trimOrNull(row.artifact_filename),
    artifact_current_dir_match: row.artifact_current_dir_match === true,
    history_source: trimOrNull(row.history_source),
    history_file: trimOrNull(row.history_file),
    lookback_hours: normalizeNumber(row.lookback_hours),
    min_run_count: normalizeNumber(row.min_run_count),
    max_gap_minutes: normalizeNumber(row.max_gap_minutes),
    firestore_read_limit: normalizeNumber(row.firestore_read_limit),
    row_n: normalizeNumber(row.row_n),
    healthy_run_n: normalizeNumber(row.healthy_run_n),
    unhealthy_run_n: normalizeNumber(row.unhealthy_run_n),
    firestore_evidence_missing_n: normalizeNumber(row.firestore_evidence_missing_n),
    invalid_line_n: normalizeNumber(row.invalid_line_n),
    latest_age_minutes: normalizeNumber(row.latest_age_minutes),
    coverage_minutes: normalizeNumber(row.coverage_minutes),
    max_observed_gap_minutes: normalizeNumber(row.max_observed_gap_minutes),
    blockers: Array.isArray(row.blockers) ? row.blockers.slice() : [],
  });
}

function buildProductionEntryRouteCanaryStreakSummary(streak) {
  const row = normalizeObject(streak);
  if (!row) return null;
  return Object.freeze({
    ok: row.ok === true,
    reason: trimOrNull(row.reason),
    generated_at: trimOrNull(row.generated_at),
    artifact_generated_at: trimOrNull(row.artifact_generated_at),
    artifact_generated_age_minutes: normalizeNumber(row.artifact_generated_age_minutes),
    artifact_file: trimOrNull(row.artifact_file),
    artifact_dir: trimOrNull(row.artifact_dir),
    artifact_filename: trimOrNull(row.artifact_filename),
    artifact_current_dir_match: row.artifact_current_dir_match === true,
    history_source: trimOrNull(row.history_source),
    history_file: trimOrNull(row.history_file),
    lookback_hours: normalizeNumber(row.lookback_hours),
    min_run_count: normalizeNumber(row.min_run_count),
    max_gap_minutes: normalizeNumber(row.max_gap_minutes),
    firestore_read_limit: normalizeNumber(row.firestore_read_limit),
    row_n: normalizeNumber(row.row_n),
    healthy_run_n: normalizeNumber(row.healthy_run_n),
    unhealthy_run_n: normalizeNumber(row.unhealthy_run_n),
    invalid_line_n: normalizeNumber(row.invalid_line_n),
    latest_age_minutes: normalizeNumber(row.latest_age_minutes),
    coverage_minutes: normalizeNumber(row.coverage_minutes),
    max_observed_gap_minutes: normalizeNumber(row.max_observed_gap_minutes),
    blockers: Array.isArray(row.blockers) ? row.blockers.slice() : [],
  });
}

function buildExitRuntimeCanaryStreakSummary(streak) {
  const row = normalizeObject(streak);
  if (!row) return null;
  return Object.freeze({
    ok: row.ok === true,
    reason: trimOrNull(row.reason),
    generated_at: trimOrNull(row.generated_at),
    artifact_generated_at: trimOrNull(row.artifact_generated_at),
    artifact_generated_age_minutes: normalizeNumber(row.artifact_generated_age_minutes),
    artifact_file: trimOrNull(row.artifact_file),
    artifact_dir: trimOrNull(row.artifact_dir),
    artifact_filename: trimOrNull(row.artifact_filename),
    artifact_current_dir_match: row.artifact_current_dir_match === true,
    history_source: trimOrNull(row.history_source),
    history_file: trimOrNull(row.history_file),
    lookback_hours: normalizeNumber(row.lookback_hours),
    min_run_count: normalizeNumber(row.min_run_count),
    max_gap_minutes: normalizeNumber(row.max_gap_minutes),
    firestore_read_limit: normalizeNumber(row.firestore_read_limit),
    row_n: normalizeNumber(row.row_n),
    healthy_run_n: normalizeNumber(row.healthy_run_n),
    unhealthy_run_n: normalizeNumber(row.unhealthy_run_n),
    invalid_line_n: normalizeNumber(row.invalid_line_n),
    latest_age_minutes: normalizeNumber(row.latest_age_minutes),
    coverage_minutes: normalizeNumber(row.coverage_minutes),
    max_observed_gap_minutes: normalizeNumber(row.max_observed_gap_minutes),
    tp1_missing_n: normalizeNumber(row.tp1_missing_n),
    native_refresh_unhealthy_n: normalizeNumber(row.native_refresh_unhealthy_n),
    unprotected_window_violation_n: normalizeNumber(row.unprotected_window_violation_n),
    alert_silent_drop_n: normalizeNumber(row.alert_silent_drop_n),
    alert_retry_unresolved_n: normalizeNumber(row.alert_retry_unresolved_n),
    alert_outbox_integrity_gap_n: normalizeNumber(row.alert_outbox_integrity_gap_n),
    trail_activation_evidence_gap_n: normalizeNumber(row.trail_activation_evidence_gap_n),
    blockers: Array.isArray(row.blockers) ? row.blockers.slice() : [],
  });
}

function buildProductionEntryProtectedCanarySummary(canary) {
  const row = normalizeObject(canary);
  if (!row) return null;
  const summary = normalizeObject(row.route_result_summary);
  const liveEndpointSummary = normalizeObject(row.live_endpoint_probe_summary);
  return Object.freeze({
    ok: row.ok === true,
    reason: trimOrNull(row.reason),
    scope: trimOrNull(row.scope),
    canary_mode: trimOrNull(row.canary_mode),
    artifact_file: trimOrNull(row.artifact_file || row.output_file),
    artifact_dir: trimOrNull(row.artifact_dir),
    artifact_filename: trimOrNull(row.artifact_filename),
    artifact_current_dir_match: row.artifact_current_dir_match === true,
    exchange_write_performed: row.exchange_write_performed === true,
    generated_at: trimOrNull(row.generated_at),
    artifact_generated_at: trimOrNull(row.artifact_generated_at),
    artifact_generated_age_minutes: normalizeNumber(row.artifact_generated_age_minutes),
    route_called: row.route_called === true,
    kernel_called: row.kernel_called === true,
    entry_transport_called: row.entry_transport_called === true,
    initial_sl_transport_called: row.initial_sl_transport_called === true,
    initial_tp1_transport_called: row.initial_tp1_transport_called === true,
    memory_firestore_batch_commit_n: normalizeNumber(row.memory_firestore_batch_commit_n),
    memory_firestore_write_n: normalizeNumber(row.memory_firestore_write_n),
    fail_n: normalizeNumber(row.fail_n),
    check_ids: Array.isArray(row.check_ids) ? row.check_ids.slice() : [],
    failed_check_ids: Array.isArray(row.failed_check_ids) ? row.failed_check_ids.slice() : [],
    live_endpoint_probe_summary: liveEndpointSummary ? Object.freeze({
      ok: liveEndpointSummary.ok === true,
      reason: trimOrNull(liveEndpointSummary.reason),
      endpoint_enabled: liveEndpointSummary.endpoint_enabled === true,
      route_called: liveEndpointSummary.route_called === true,
      transport_resolution_ok: liveEndpointSummary.transport_resolution_ok === true,
      transport_reason: trimOrNull(liveEndpointSummary.transport_reason),
      exchange_write_performed: liveEndpointSummary.exchange_write_performed === true,
      decision_mode: trimOrNull(liveEndpointSummary.decision_mode),
      runtime_enabled: liveEndpointSummary.runtime_enabled === true,
      runtime_dry_run: liveEndpointSummary.runtime_dry_run === true,
      runtime_canary_only: liveEndpointSummary.runtime_canary_only === true,
    }) : null,
    route_result_summary: summary ? Object.freeze({
      ok: summary.ok === true,
      reason: trimOrNull(summary.reason),
      position_cycle_id: trimOrNull(summary.position_cycle_id),
      entry_event_id: trimOrNull(summary.entry_event_id),
      protection_runtime_id: trimOrNull(summary.protection_runtime_id),
      runtime_health_status: trimOrNull(summary.runtime_health_status),
      sl_order_id: trimOrNull(summary.sl_order_id),
      tp1_order_id: trimOrNull(summary.tp1_order_id),
      audit_ledger_reason: trimOrNull(summary.audit_ledger_reason),
    }) : null,
  });
}

function buildPerformanceGateSummary(gateSummary) {
  const row = normalizeObject(gateSummary);
  if (!row) return null;
  const metrics = normalizeObject(row.metrics);
  const thresholds = normalizeObject(row.thresholds);
  return Object.freeze({
    ok: row.ok === true,
    reason: trimOrNull(row.reason),
    generated_at: trimOrNull(row.generated_at),
    artifact_generated_at: trimOrNull(row.artifact_generated_at),
    artifact_generated_age_minutes: normalizeNumber(row.artifact_generated_age_minutes),
    artifact_file: trimOrNull(row.artifact_file || row.output_file),
    artifact_dir: trimOrNull(row.artifact_dir),
    artifact_filename: trimOrNull(row.artifact_filename),
    artifact_current_dir_match: row.artifact_current_dir_match === true,
    mode: trimOrNull(row.mode),
    blockers: Array.isArray(row.blockers) ? row.blockers.slice() : [],
    metrics: metrics ? Object.freeze({
      sample_n: normalizeNumber(metrics.sample_n),
      win_rate_pct: normalizeNumber(metrics.win_rate_pct),
      profit_factor: normalizeNumber(metrics.profit_factor),
      expectancy_r: normalizeNumber(metrics.expectancy_r),
      net_pnl_pct: normalizeNumber(metrics.net_pnl_pct),
      max_drawdown_pct: normalizeNumber(metrics.max_drawdown_pct),
    }) : null,
    thresholds: thresholds ? Object.freeze({
      min_sample_n: normalizeNumber(thresholds.min_sample_n),
      min_win_rate_pct: normalizeNumber(thresholds.min_win_rate_pct),
      min_profit_factor: normalizeNumber(thresholds.min_profit_factor),
      min_expectancy_r: normalizeNumber(thresholds.min_expectancy_r),
      min_net_pnl_pct: normalizeNumber(thresholds.min_net_pnl_pct),
    }) : null,
  });
}

function buildFirestoreCostGuardSummary(costGuard) {
  const row = normalizeObject(costGuard);
  if (!row) return null;
  const thresholds = normalizeObject(row.thresholds);
  return Object.freeze({
    ok: row.ok === true,
    reason: trimOrNull(row.reason),
    generated_at: trimOrNull(row.generated_at),
    artifact_generated_at: trimOrNull(row.artifact_generated_at),
    artifact_generated_age_minutes: normalizeNumber(row.artifact_generated_age_minutes),
    artifact_file: trimOrNull(row.artifact_file || row.output_file),
    artifact_dir: trimOrNull(row.artifact_dir),
    artifact_filename: trimOrNull(row.artifact_filename),
    artifact_current_dir_match: row.artifact_current_dir_match === true,
    estimated_total_reads: normalizeNumber(row.estimated_total_reads),
    collector_query_limit_total: normalizeNumber(row.collector_query_limit_total),
    billing_metric_required: row.billing_metric_required === true,
    billing_read_ops_total: normalizeNumber(row.billing_read_ops_total),
    billing_metric_rows: Array.isArray(row.billing_metric_rows) ? row.billing_metric_rows.slice() : [],
    blocker_n: normalizeNumber(row.blocker_n),
    blockers: Array.isArray(row.blockers) ? row.blockers.slice() : [],
    thresholds: thresholds ? Object.freeze({
      max_total_estimated_reads: normalizeNumber(thresholds.max_total_estimated_reads),
      max_collector_query_limit_total: normalizeNumber(thresholds.max_collector_query_limit_total),
      max_billing_read_ops: normalizeNumber(thresholds.max_billing_read_ops),
      require_billing_metric: thresholds.require_billing_metric === true,
      max_stale_artifact_age_minutes: normalizeNumber(thresholds.max_stale_artifact_age_minutes),
    }) : null,
  });
}

function buildOpenClawSupremeControlPlaneSummary(summary) {
  const row = normalizeObject(summary);
  if (!row) return null;
  const learner = normalizeObject(row.learner_shadow_summary);
  const lineage = normalizeObject(row.lineage_consistency_summary);
  const collector = normalizeObject(row.collector_execution_summary);
  return Object.freeze({
    ok: row.ok === true,
    world_state_n: normalizeNumber(row.world_state_n),
    latest_world_state_hash: trimOrNull(row.latest_world_state_hash),
    execution_permit_n: normalizeNumber(row.execution_permit_n),
    permit_validation_pass_n: normalizeNumber(row.permit_validation_pass_n),
    permit_validation_fail_n: normalizeNumber(row.permit_validation_fail_n),
    outcome_adjudication_n: normalizeNumber(row.outcome_adjudication_n),
    outcome_unadjudicated_n: normalizeNumber(row.outcome_unadjudicated_n),
    learner_shadow_summary: learner ? Object.freeze({
      ok: learner.ok === true,
      evaluation_n: normalizeNumber(learner.evaluation_n),
      shadow_only_n: normalizeNumber(learner.shadow_only_n),
      live_applied_n: normalizeNumber(learner.live_applied_n),
      stale_evaluation_n: normalizeNumber(learner.stale_evaluation_n),
      model_win_n: normalizeNumber(learner.model_win_n),
      expected_blocked_loss_n: normalizeNumber(learner.expected_blocked_loss_n),
      model_ok_n: normalizeNumber(learner.model_ok_n),
      model_error_n: normalizeNumber(learner.model_error_n),
      decisive_outcome_n: normalizeNumber(learner.decisive_outcome_n),
      model_error_rate: normalizeNumber(learner.model_error_rate),
      max_model_error_rate: normalizeNumber(learner.max_model_error_rate),
      max_evaluation_age_minutes: normalizeNumber(learner.max_evaluation_age_minutes),
      max_observed_evaluation_age_minutes: normalizeNumber(learner.max_observed_evaluation_age_minutes),
      latest_evaluated_at: trimOrNull(learner.latest_evaluated_at),
      blockers: Array.isArray(learner.blockers) ? learner.blockers.slice() : [],
    }) : null,
    collector_execution_summary: collector ? Object.freeze({
      status: trimOrNull(collector.status),
      producer_script: trimOrNull(collector.producer_script),
      producer_scope: trimOrNull(collector.producer_scope),
      source: trimOrNull(collector.source),
      position_cycle_id: trimOrNull(collector.position_cycle_id),
      openclaw_decision_id: trimOrNull(collector.openclaw_decision_id),
      openclaw_execution_permit_ids: normalizeIdList(collector.openclaw_execution_permit_ids),
      openclaw_outcome_adjudication_ids: normalizeIdList(collector.openclaw_outcome_adjudication_ids),
      collected_at: trimOrNull(collector.collected_at),
      artifact_file: trimOrNull(collector.artifact_file),
      artifact_dir: trimOrNull(collector.artifact_dir),
      artifact_filename: trimOrNull(collector.artifact_filename),
      artifact_current_dir_match: collector.artifact_current_dir_match === true,
      generated_at: trimOrNull(collector.generated_at),
      artifact_generated_at: trimOrNull(collector.artifact_generated_at),
      artifact_generated_age_minutes: normalizeNumber(collector.artifact_generated_age_minutes),
      exchange_write_performed: collector.exchange_write_performed === true,
      blockers: Array.isArray(collector.blockers) ? collector.blockers.slice() : [],
    }) : null,
    lineage_consistency_summary: lineage ? Object.freeze({
      ok: lineage.ok === true,
      expected_openclaw_decision_id: trimOrNull(lineage.expected_openclaw_decision_id),
      expected_position_cycle_id: trimOrNull(lineage.expected_position_cycle_id),
      expected_world_state_hash: trimOrNull(lineage.expected_world_state_hash),
      expected_openclaw_execution_permit_ids: normalizeIdList(lineage.expected_openclaw_execution_permit_ids),
      expected_openclaw_outcome_adjudication_ids: normalizeIdList(lineage.expected_openclaw_outcome_adjudication_ids),
      permit_lineage_match_n: normalizeNumber(lineage.permit_lineage_match_n),
      permit_lineage_mismatch_n: normalizeNumber(lineage.permit_lineage_mismatch_n),
      outcome_lineage_match_n: normalizeNumber(lineage.outcome_lineage_match_n),
      outcome_lineage_mismatch_n: normalizeNumber(lineage.outcome_lineage_mismatch_n),
      learner_lineage_match_n: normalizeNumber(lineage.learner_lineage_match_n),
      learner_lineage_mismatch_n: normalizeNumber(lineage.learner_lineage_mismatch_n),
      blockers: Array.isArray(lineage.blockers) ? lineage.blockers.slice() : [],
    }) : null,
    blockers: Array.isArray(row.blockers) ? row.blockers.slice() : [],
  });
}

function buildBoundedRuntimeSummary(manifest, selectorMeta, {
  repairFirestoreCanaryStreak = null,
  productionEntryRouteCanaryStreak = null,
  productionEntryProtectedCanary = null,
  exitRuntimeCanaryStreak = null,
  performanceGate = null,
  firestoreCostGuard = null,
} = {}) {
  const manifestRow = normalizeObject(manifest);
  const selectorRow = normalizeObject(selectorMeta);
  if (!manifestRow && !selectorRow) return null;

  const snapshotMeta = normalizeObject(manifestRow && manifestRow.snapshot_meta);
  return Object.freeze({
    selector_query_budget: normalizeObject(selectorRow && selectorRow.query_budget),
    collector_query_budget: normalizeObject(snapshotMeta && snapshotMeta.query_budget),
    exporter_snapshot_size_bytes: normalizeNumber(manifestRow && manifestRow.snapshot_size_bytes),
    manifest_counts: normalizeObject(manifestRow && manifestRow.counts),
    lineage_contract: buildLineageContractSummary(snapshotMeta && snapshotMeta.lineage_contract),
    evidence_snapshot_summary: buildEvidenceSnapshotSummary(snapshotMeta && snapshotMeta.evidence_snapshot_summary),
    alert_retry_summary: buildAlertRetrySummary(snapshotMeta && snapshotMeta.alert_retry_summary),
    openclaw_execution_separation_summary: buildOpenClawExecutionSeparationSummary(snapshotMeta && snapshotMeta.openclaw_execution_separation_summary),
    runtime_chain_audit_summary: buildRuntimeChainAuditSummary(snapshotMeta && snapshotMeta.runtime_chain_audit_summary),
    repair_evidence_summary: buildRepairEvidenceSummary(snapshotMeta && snapshotMeta.repair_evidence_summary),
    openclaw_execution_audit_ledger_write: normalizeObject(snapshotMeta && snapshotMeta.openclaw_execution_audit_ledger_write),
    openclaw_supreme_control_plane_summary: buildOpenClawSupremeControlPlaneSummary(snapshotMeta && snapshotMeta.openclaw_supreme_control_plane_summary),
    repair_firestore_canary_streak: buildRepairFirestoreCanaryStreakSummary(repairFirestoreCanaryStreak),
    production_entry_route_canary_streak: buildProductionEntryRouteCanaryStreakSummary(productionEntryRouteCanaryStreak),
    production_entry_protected_canary: buildProductionEntryProtectedCanarySummary(productionEntryProtectedCanary),
    exit_runtime_canary_streak: buildExitRuntimeCanaryStreakSummary(exitRuntimeCanaryStreak),
    performance_gate: buildPerformanceGateSummary(performanceGate),
    firestore_cost_guard: buildFirestoreCostGuardSummary(firestoreCostGuard),
  });
}

function buildCandidateSelectionSummary(candidateSelection) {
  const row = normalizeObject(candidateSelection);
  if (!row) return null;

  const selectedPreflight = normalizeObject(row.selected_preflight);
  const selectedPreflightBlockers = Array.isArray(selectedPreflight && selectedPreflight.blockers)
    ? selectedPreflight.blockers
    : [];

  return Object.freeze({
    ok: row.ok === true,
    selection_status: trimOrNull(row.selection_status),
    candidate_limit: normalizeNumber(row.candidate_limit),
    recent_window_hours: normalizeNumber(row.recent_window_hours),
    recent_cutoff_at: trimOrNull(row.recent_cutoff_at),
    active_position_cycle_n: normalizeNumber(row.active_position_cycle_n),
    recent_active_position_cycle_n: normalizeNumber(row.recent_active_position_cycle_n),
    selected_position_cycle_id: trimOrNull(row.selected_position_cycle_id),
    selected_preflight: selectedPreflight
      ? Object.freeze({
          ok: selectedPreflight.ok === true,
          position_cycle_id: trimOrNull(selectedPreflight.position_cycle_id),
          snapshot_counts: normalizeObject(selectedPreflight.snapshot_counts) || {},
          blocker_n: selectedPreflightBlockers.length,
        })
      : null,
    selection_contract: buildCandidateSelectionContractSummary(row.selection_contract),
  });
}

function buildUnifiedArtifactPayload(result, {
  candidateSelection = null,
  repairFirestoreCanaryStreak = null,
  productionEntryRouteCanaryStreak = null,
  productionEntryProtectedCanary = null,
  exitRuntimeCanaryStreak = null,
  performanceGate = null,
  firestoreCostGuard = null,
} = {}) {
  const row = result && typeof result === "object" ? result : {};
  const inputs = row.inputs && typeof row.inputs === "object" ? row.inputs : {};
  const report = row.report && typeof row.report === "object" ? row.report : null;
  const manifest = inputs.runtimeManifest && typeof inputs.runtimeManifest === "object"
    ? inputs.runtimeManifest
    : null;
  const selectorMeta = manifest && manifest.snapshot_meta && typeof manifest.snapshot_meta === "object"
    ? manifest.snapshot_meta.selector_meta
    : null;
  return Object.freeze({
    pass: report && report.pass === true,
    failClosed: report ? report.failClosed === true : true,
    mode: report && report.mode ? report.mode : null,
    position_cycle_id: trimOrNull(selectorMeta && selectorMeta.position_cycle_id),
    selector_meta: selectorMeta || null,
    bounded_runtime_summary: buildBoundedRuntimeSummary(manifest, selectorMeta, {
      repairFirestoreCanaryStreak,
      productionEntryRouteCanaryStreak,
      productionEntryProtectedCanary,
      exitRuntimeCanaryStreak,
      performanceGate,
      firestoreCostGuard,
    }),
    alert_retry_summary: buildAlertRetrySummary(manifest && manifest.snapshot_meta && manifest.snapshot_meta.alert_retry_summary),
    candidate_selection_summary: buildCandidateSelectionSummary(candidateSelection),
    report,
  });
}

function generateUnifiedPromotionReport(env = process.env) {
  const result = gate.__test.evaluateGateFromEnv(env);
  const artifactDir = resolveArtifactDir(env);
  const candidateSelection = readCandidateSelectionArtifact(artifactDir);
  const repairFirestoreCanaryStreak = readRepairFirestoreCanaryStreakArtifact(env, artifactDir);
  const productionEntryRouteCanaryStreak = readProductionEntryRouteCanaryStreakArtifact(env, artifactDir);
  const productionEntryProtectedCanary = readProductionEntryProtectedCanaryArtifact(env, artifactDir);
  const exitRuntimeCanaryStreak = readExitRuntimeCanaryStreakArtifact(env, artifactDir);
  const performanceGate = readPerformanceGateArtifact(env, artifactDir);
  const firestoreCostGuard = readFirestoreCostGuardArtifact(env, artifactDir);
  return buildUnifiedArtifactPayload(result, {
    candidateSelection,
    repairFirestoreCanaryStreak,
    productionEntryRouteCanaryStreak,
    productionEntryProtectedCanary,
    exitRuntimeCanaryStreak,
    performanceGate,
    firestoreCostGuard,
  });
}

async function main(env = process.env) {
  const artifactDir = resolveArtifactDir(env);
  const payload = generateUnifiedPromotionReport(env);
  ensureDir(artifactDir);
  const outputFile = path.join(artifactDir, OUTPUT_FILENAME);
  writeJson(outputFile, payload);
  console.log(JSON.stringify({
    ok: true,
    reason: "V2_UNIFIED_PROMOTION_REPORT_GENERATED",
    artifact_dir: artifactDir,
    output_file: outputFile,
    pass: payload.pass === true,
    mode: payload.mode,
    position_cycle_id: payload.position_cycle_id,
  }));
  return payload;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("GENERATE_V2_UNIFIED_PROMOTION_REPORT_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    generateUnifiedPromotionReport,
    __test: {
      OUTPUT_FILENAME,
      CANDIDATE_SELECTION_FILENAME,
      REPAIR_FIRESTORE_CANARY_STREAK_FILENAME,
      PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_FILENAME,
      PRODUCTION_ENTRY_PROTECTED_CANARY_FILENAME,
      EXIT_RUNTIME_CANARY_STREAK_FILENAME,
      PERFORMANCE_GATE_FILENAME,
      FIRESTORE_COST_GUARD_FILENAME,
      trimOrNull,
      resolveArtifactDir,
      resolveRepairFirestoreCanaryStreakFile,
      resolveProductionEntryRouteCanaryStreakFile,
      resolveProductionEntryProtectedCanaryFile,
      resolveExitRuntimeCanaryStreakFile,
      resolvePerformanceGateFile,
      resolveFirestoreCostGuardFile,
      normalizeObject,
      normalizeNumber,
      toMs,
      buildEvidenceSnapshotSummary,
      buildLineageContractSummary,
      buildCandidateSelectionContractSummary,
      buildOpenClawExecutionSeparationSummary,
      buildRuntimeChainAuditSummary,
      buildRepairEvidenceSummary,
      buildOpenClawSupremeControlPlaneSummary,
      readOptionalJson,
      readCandidateSelectionArtifact,
      readRepairFirestoreCanaryStreakArtifact,
      readProductionEntryRouteCanaryStreakArtifact,
      readProductionEntryProtectedCanaryArtifact,
      readExitRuntimeCanaryStreakArtifact,
      readPerformanceGateArtifact,
      readFirestoreCostGuardArtifact,
      buildRepairFirestoreCanaryStreakSummary,
      buildProductionEntryRouteCanaryStreakSummary,
      buildProductionEntryProtectedCanarySummary,
      buildExitRuntimeCanaryStreakSummary,
      buildPerformanceGateSummary,
      buildFirestoreCostGuardSummary,
      buildBoundedRuntimeSummary,
      buildCandidateSelectionSummary,
      buildUnifiedArtifactPayload,
    },
  };
}
