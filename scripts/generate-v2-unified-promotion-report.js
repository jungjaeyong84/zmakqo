#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const gate = require("./check-v2-promotion-gate");

const OUTPUT_FILENAME = "unified-promotion-report.json";
const CANDIDATE_SELECTION_FILENAME = "promotion-canary-candidate-selection.json";
const REPAIR_FIRESTORE_CANARY_STREAK_FILENAME = "v2_repair_queue_firestore_canary_streak_latest.json";
const PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_FILENAME = "v2_production_entry_route_canary_streak_latest.json";

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

function buildEvidenceSnapshotSummary(summary) {
  const row = normalizeObject(summary);
  if (!row) return null;
  return Object.freeze({
    ok: row.ok === true,
    transition_n: normalizeNumber(row.transition_n),
    transition_evidence_n: normalizeNumber(row.transition_evidence_n),
    missing_transition_evidence_n: normalizeNumber(row.missing_transition_evidence_n),
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
  return readOptionalJson(resolveRepairFirestoreCanaryStreakFile(env, artifactDir));
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
  return readOptionalJson(resolveProductionEntryRouteCanaryStreakFile(env, artifactDir));
}

function buildRepairFirestoreCanaryStreakSummary(streak) {
  const row = normalizeObject(streak);
  if (!row) return null;
  return Object.freeze({
    ok: row.ok === true,
    reason: trimOrNull(row.reason),
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

function buildProductionEntryRouteCanaryStreakSummary(streak) {
  const row = normalizeObject(streak);
  if (!row) return null;
  return Object.freeze({
    ok: row.ok === true,
    reason: trimOrNull(row.reason),
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

function buildBoundedRuntimeSummary(manifest, selectorMeta, {
  repairFirestoreCanaryStreak = null,
  productionEntryRouteCanaryStreak = null,
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
    repair_firestore_canary_streak: buildRepairFirestoreCanaryStreakSummary(repairFirestoreCanaryStreak),
    production_entry_route_canary_streak: buildProductionEntryRouteCanaryStreakSummary(productionEntryRouteCanaryStreak),
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
  return buildUnifiedArtifactPayload(result, {
    candidateSelection,
    repairFirestoreCanaryStreak,
    productionEntryRouteCanaryStreak,
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
      trimOrNull,
      resolveArtifactDir,
      resolveRepairFirestoreCanaryStreakFile,
      resolveProductionEntryRouteCanaryStreakFile,
      normalizeObject,
      normalizeNumber,
      buildEvidenceSnapshotSummary,
      buildLineageContractSummary,
      buildCandidateSelectionContractSummary,
      buildOpenClawExecutionSeparationSummary,
      buildRuntimeChainAuditSummary,
      buildRepairEvidenceSummary,
      readOptionalJson,
      readCandidateSelectionArtifact,
      readRepairFirestoreCanaryStreakArtifact,
      readProductionEntryRouteCanaryStreakArtifact,
      buildRepairFirestoreCanaryStreakSummary,
      buildProductionEntryRouteCanaryStreakSummary,
      buildBoundedRuntimeSummary,
      buildCandidateSelectionSummary,
      buildUnifiedArtifactPayload,
    },
  };
}
