#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { hasLineageContract, contractsMatch } = require("./lib/v2-promotion-lineage-contract");
const { auditV2EntryBoundaries } = require("../src/v2/entryBoundaryAudit");
const { auditV2FillSyncCanonicalBoundary } = require("../src/v2/fillSyncCanonicalBoundaryAudit");
const { auditWorkspaceV2ProductionCutoverContract } = require("../src/v2/productionCutoverAudit");

const OUTPUT_FILENAME = "promotion-deploy-decision.json";
const UNIFIED_REPORT_FILENAME = "unified-promotion-report.json";
const ROOT_DIR = path.resolve(__dirname, "..");
const SRC_V2_DIR = path.join(ROOT_DIR, "src", "v2");
const REQUIRED_RUNTIME_CHAIN_CHECK_IDS = Object.freeze([
  "COLLECTED_POSITION_CYCLE_ID_PRESENT",
  "COLLECTED_ENTRY_EVENT_ID_PRESENT",
  "COLLECTED_PROJECTION_POSITION_CYCLE_MATCH",
  "COLLECTED_PROJECTION_STAGE_PRESENT",
  "COLLECTED_PROTECTION_RUNTIME_POSITION_CYCLE_MATCH",
  "COLLECTED_PROTECTION_HEALTH_STATUS_PRESENT",
  "COLLECTED_ACTIVE_OR_TERMINAL_PROTECTION_STATUS_VALID",
  "COLLECTED_TRANSITIONS_POSITION_CYCLE_MATCH",
  "COLLECTED_TRANSITIONS_ENTRY_EVENT_MATCH",
  "COLLECTED_TRANSITIONS_EXCHANGE_EVIDENCE_PRESENT",
  "COLLECTED_TERMINAL_FULL_EXIT_EVIDENCE_PRESENT",
  "COLLECTED_STOP_TERMINAL_FILL_EVIDENCE_PRESENT",
  "COLLECTED_OUTBOX_TRANSITION_LINKS_COMPLETE",
  "COLLECTED_OUTBOX_POSITION_CYCLE_MATCH",
  "REPLAY_GATE_EPISODE_VALID",
]);
const REQUIRED_PRODUCTION_LIVE_ENTRY_SIZING_CHECK_IDS = Object.freeze([
  "V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_RESOLVES_TRANSPORTS_BEFORE_ROUTE",
  "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_REQUIRE_APPROVED_SIZING",
  "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_REJECT_SIZING_CONFLICT",
  "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_BLOCK_DRY_RUN_CFG",
  "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_DO_NOT_EXPOSE_SECRETS",
  "V2_PRODUCTION_ENTRY_LIVE_REQUEST_BUILDER_EMBEDS_SIZING",
]);
const MIN_LIVE_STREAK_COVERAGE_MINUTES = 24 * 60;
const MAX_PROTECTED_CANARY_ARTIFACT_AGE_MINUTES = 180;

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function readOptionalArtifact(artifactDir, filename) {
  const dir = trimOrNull(artifactDir);
  if (!dir) return null;
  const filePath = path.join(dir, filename);
  if (!fs.existsSync(filePath)) return null;
  return readJsonFile(filePath);
}

function resolveArtifactDir(env = process.env) {
  return trimOrNull(env.V2_PROMOTION_ARTIFACT_DIR) || path.resolve("tmp", "v2-promotion-artifacts");
}

function resolveUnifiedPromotionReport(env = process.env) {
  const filePath = trimOrNull(env.V2_PROMOTION_UNIFIED_REPORT_FILE);
  if (filePath) return readJsonFile(filePath);

  const inlineJson = trimOrNull(env.V2_PROMOTION_UNIFIED_REPORT_JSON);
  if (inlineJson) return JSON.parse(inlineJson);

  const artifactDir = resolveArtifactDir(env);
  const artifactFile = path.join(artifactDir, UNIFIED_REPORT_FILENAME);
  if (fs.existsSync(artifactFile)) return readJsonFile(artifactFile);

  throw new Error("V2_PROMOTION_UNIFIED_REPORT_REQUIRED");
}

function ensureArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeObject(value) {
  return value && typeof value === "object" ? value : null;
}

function walkJsFiles(dir) {
  const rows = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      rows.push(...walkJsFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".js")) {
      rows.push(full);
    }
  }
  return rows;
}

function buildV2EntryBoundaryAuditSummary({ rootDir = ROOT_DIR, srcV2Dir = SRC_V2_DIR } = {}) {
  try {
    const files = walkJsFiles(srcV2Dir).map((filePath) => ({
      path: filePath,
      content: fs.readFileSync(filePath, "utf8"),
    }));
    const audit = auditV2EntryBoundaries({ files, rootDir });
    return Object.freeze({
      ...audit,
      reason: audit.ok === true ? "V2_ENTRY_BOUNDARY_AUDIT_PASS" : "V2_ENTRY_BOUNDARY_AUDIT_BLOCKED",
      scope: "src/v2",
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: "V2_ENTRY_BOUNDARY_AUDIT_THROWN",
      scope: "src/v2",
      checked_file_n: 0,
      violation_n: 0,
      violations: [],
      error: {
        message: error && error.message ? error.message : String(error),
      },
    });
  }
}

function hasEntryBoundaryAudit(summary) {
  const row = normalizeObject(summary);
  return !!(
    row &&
    row.ok === true &&
    trimOrNull(row.reason) === "V2_ENTRY_BOUNDARY_AUDIT_PASS" &&
    trimOrNull(row.scope) === "src/v2" &&
    Number(row.checked_file_n) > 0 &&
    Number(row.violation_n) === 0 &&
    ensureArray(row.violations).length === 0
  );
}

function buildV2FillSyncCanonicalBoundaryAuditSummary({ rootDir = ROOT_DIR } = {}) {
  try {
    const audit = auditV2FillSyncCanonicalBoundary({
      fillSyncSource: fs.readFileSync(path.join(rootDir, "src", "services", "binanceFuturesFillsSync.js"), "utf8"),
      shadowExitWriterSource: fs.readFileSync(path.join(rootDir, "src", "v2", "openclawShadowExitWriter.js"), "utf8"),
    });
    return Object.freeze({
      ok: audit.ok === true,
      reason: audit.ok === true ? "V2_FILL_SYNC_CANONICAL_BOUNDARY_AUDIT_PASS" : "V2_FILL_SYNC_CANONICAL_BOUNDARY_AUDIT_BLOCKED",
      scope: "binance_fills_sync_canonical_boundary",
      contract: audit,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: "V2_FILL_SYNC_CANONICAL_BOUNDARY_AUDIT_THROWN",
      scope: "binance_fills_sync_canonical_boundary",
      contract: null,
      error: {
        message: error && error.message ? error.message : String(error),
      },
    });
  }
}

function hasFillSyncCanonicalBoundaryAudit(summary) {
  const row = normalizeObject(summary);
  const contract = normalizeObject(row && row.contract);
  return !!(
    row &&
    row.ok === true &&
    trimOrNull(row.reason) === "V2_FILL_SYNC_CANONICAL_BOUNDARY_AUDIT_PASS" &&
    trimOrNull(row.scope) === "binance_fills_sync_canonical_boundary" &&
    contract &&
    contract.ok === true &&
    trimOrNull(contract.reason) === "V2_FILL_SYNC_CANONICAL_BOUNDARY_PASS" &&
    Number(contract.fail_n) === 0 &&
    ensureArray(contract.failed_check_ids).length === 0
  );
}

function buildV2ProductionCutoverAuditSummary() {
  try {
    const contract = auditWorkspaceV2ProductionCutoverContract({ rootDir: ROOT_DIR });
    return Object.freeze({
      ok: contract.ok === true,
      reason: contract.ok === true ? "V2_PRODUCTION_CUTOVER_AUDIT_PASS" : "V2_PRODUCTION_CUTOVER_AUDIT_BLOCKED",
      scope: "production_webhook_cutover",
      contract,
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: "V2_PRODUCTION_CUTOVER_AUDIT_THROWN",
      scope: "production_webhook_cutover",
      contract: null,
      error: {
        message: error && error.message ? error.message : String(error),
      },
    });
  }
}

function hasProductionCutoverAudit(summary) {
  const row = normalizeObject(summary);
  const contract = normalizeObject(row && row.contract);
  return !!(
    row &&
    row.ok === true &&
    trimOrNull(row.reason) === "V2_PRODUCTION_CUTOVER_AUDIT_PASS" &&
    trimOrNull(row.scope) === "production_webhook_cutover" &&
    contract &&
    contract.ok === true &&
    Number(contract.fail_n) === 0 &&
    ensureArray(contract.failed_check_ids).length === 0
  );
}

function hasProductionLiveEntrySizingContract(summary) {
  const row = normalizeObject(summary);
  const contract = normalizeObject(row && row.contract);
  const checks = ensureArray(contract && contract.checks);
  if (
    !row ||
    !contract ||
    row.ok !== true ||
    contract.ok !== true ||
    Number(contract.fail_n) !== 0 ||
    ensureArray(contract.failed_check_ids).length !== 0 ||
    checks.length === 0
  ) {
    return false;
  }
  const byId = new Map(checks.map((check) => [trimOrNull(check && check.id), check]));
  return REQUIRED_PRODUCTION_LIVE_ENTRY_SIZING_CHECK_IDS.every((id) => {
    const check = byId.get(id);
    return check && check.ok === true;
  });
}

function hasBoundedRuntimeEvidence(summary) {
  const row = normalizeObject(summary);
  if (!row) return false;
  const selectorQueryBudget = normalizeObject(row.selector_query_budget);
  const collectorQueryBudget = normalizeObject(row.collector_query_budget);
  const manifestCounts = normalizeObject(row.manifest_counts);
  return !!(
    selectorQueryBudget &&
    collectorQueryBudget &&
    manifestCounts &&
    Number.isFinite(Number(row.exporter_snapshot_size_bytes))
  );
}

function hasRuntimeLineageContract(summary) {
  const row = normalizeObject(summary);
  return hasLineageContract(row && row.lineage_contract);
}

function hasEvidenceSnapshotCoverage(summary) {
  const row = normalizeObject(summary);
  const evidence = normalizeObject(row && row.evidence_snapshot_summary);
  if (!evidence) return false;
  const transitionCount = Number(evidence.transition_n);
  const transitionEvidenceCount = Number(evidence.transition_evidence_n);
  const missingTransitionEvidenceCount = Number(evidence.missing_transition_evidence_n);
  const protectionRuntimeCount = Number(evidence.protection_runtime_n);
  const protectionRuntimeEvidenceCount = Number(evidence.protection_runtime_evidence_n);
  const missingProtectionRuntimeEvidenceCount = Number(evidence.missing_protection_runtime_evidence_n);
  const terminalCount = Number(evidence.terminal_transition_n);
  const terminalFullExitEvidenceCount = Number(evidence.terminal_full_exit_evidence_n);
  const missingTerminalFullExitEvidenceCount = Number(evidence.missing_terminal_full_exit_evidence_n);
  const stopTerminalCount = Number(evidence.stop_terminal_transition_n);
  const stopTerminalFillEvidenceCount = Number(evidence.stop_terminal_fill_evidence_n);
  const missingStopTerminalFillEvidenceCount = Number(evidence.missing_stop_terminal_fill_evidence_n);
  return (
    evidence.ok === true &&
    Number.isFinite(transitionCount) &&
    Number.isFinite(transitionEvidenceCount) &&
    Number.isFinite(missingTransitionEvidenceCount) &&
    Number.isFinite(protectionRuntimeCount) &&
    Number.isFinite(protectionRuntimeEvidenceCount) &&
    Number.isFinite(missingProtectionRuntimeEvidenceCount) &&
    Number.isFinite(terminalCount) &&
    Number.isFinite(terminalFullExitEvidenceCount) &&
    Number.isFinite(missingTerminalFullExitEvidenceCount) &&
    Number.isFinite(stopTerminalCount) &&
    Number.isFinite(stopTerminalFillEvidenceCount) &&
    Number.isFinite(missingStopTerminalFillEvidenceCount) &&
    transitionEvidenceCount >= transitionCount &&
    protectionRuntimeEvidenceCount >= protectionRuntimeCount &&
    missingTransitionEvidenceCount === 0 &&
    missingProtectionRuntimeEvidenceCount === 0 &&
    terminalFullExitEvidenceCount >= terminalCount &&
    stopTerminalFillEvidenceCount >= stopTerminalCount &&
    missingTerminalFullExitEvidenceCount === 0 &&
    missingStopTerminalFillEvidenceCount === 0
  );
}

function hasOpenClawExecutionSeparationCoverage(summary) {
  const row = normalizeObject(summary);
  const separation = normalizeObject(row && row.openclaw_execution_separation_summary);
  if (!separation) return false;
  return (
    separation.ok === true &&
    Number(separation.audit_n) > 0 &&
    Number(separation.fail_n) === 0 &&
    ensureArray(separation.failed_check_ids).length === 0
  );
}

function hasRuntimeChainAuditCoverage(summary) {
  const row = normalizeObject(summary);
  const audit = normalizeObject(row && row.runtime_chain_audit_summary);
  if (!audit) return false;
  const passed = new Set(ensureArray(audit.passed_check_ids).map(String).filter(Boolean));
  return (
    audit.ok === true &&
    Number(audit.check_n) >= REQUIRED_RUNTIME_CHAIN_CHECK_IDS.length &&
    Number(audit.fail_n) === 0 &&
    ensureArray(audit.failed_check_ids).length === 0 &&
    REQUIRED_RUNTIME_CHAIN_CHECK_IDS.every((id) => passed.has(id))
  );
}

function hasRepairEvidenceSummary(summary) {
  const row = normalizeObject(summary);
  const repair = normalizeObject(row && row.repair_evidence_summary);
  if (!repair) return false;
  const requestCount = Number(repair.repair_request_n);
  const ledgerCount = Number(repair.repair_execution_ledger_n);
  const completionCount = Number(repair.completion_ledger_n);
  const evidenceCount = Number(repair.completion_evidence_n);
  const missingEvidenceCount = Number(repair.missing_completion_evidence_n);
  const orderEvidenceCount = Number(repair.order_evidence_n);
  if (
    repair.ok !== true ||
    !Number.isFinite(requestCount) ||
    !Number.isFinite(ledgerCount) ||
    !Number.isFinite(completionCount) ||
    !Number.isFinite(evidenceCount) ||
    !Number.isFinite(missingEvidenceCount) ||
    !Number.isFinite(orderEvidenceCount) ||
    missingEvidenceCount !== 0
  ) {
    return false;
  }
  if (requestCount === 0) return completionCount === 0 && evidenceCount === 0;
  return (
    ledgerCount > 0 &&
    completionCount > 0 &&
    evidenceCount > 0 &&
    orderEvidenceCount > 0 &&
    Array.isArray(repair.runbook_refs) &&
    repair.runbook_refs.length > 0 &&
    normalizeObject(repair.latest_completion) != null
  );
}

function hasOpenClawExecutionAuditLedgerWrite(summary) {
  const row = normalizeObject(summary);
  const ledgerWrite = normalizeObject(row && row.openclaw_execution_audit_ledger_write);
  if (!ledgerWrite) return false;
  return (
    ledgerWrite.ok === true &&
    ledgerWrite.skipped === false &&
    trimOrNull(ledgerWrite.reason) === "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN" &&
    !!trimOrNull(ledgerWrite.collection_key) &&
    !!trimOrNull(ledgerWrite.doc_id)
  );
}

function hasRepairFirestoreCanaryStreak(summary) {
  const row = normalizeObject(summary);
  const streak = normalizeObject(row && row.repair_firestore_canary_streak);
  if (!streak) return false;
  return (
    streak.ok === true &&
    trimOrNull(streak.reason) === "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS" &&
    trimOrNull(streak.artifact_filename) === "v2_repair_queue_firestore_canary_streak_latest.json" &&
    !!trimOrNull(streak.artifact_file) &&
    !!trimOrNull(streak.artifact_dir) &&
    streak.artifact_current_dir_match === true &&
    Number(streak.healthy_run_n) >= Number(streak.min_run_count) &&
    Number(streak.unhealthy_run_n) === 0 &&
    Number(streak.firestore_evidence_missing_n || 0) === 0 &&
    Number(streak.invalid_line_n) === 0 &&
    hasFreshLongRunStreakCoverage(streak) &&
    ensureArray(streak.blockers).length === 0
  );
}

function hasCollectorExecutionSummary(streak, {
  schedulerJobId,
  producerScript,
  producerScope,
  canaryMode,
} = {}) {
  const row = normalizeObject(streak);
  const collector = normalizeObject(row && row.collector_execution_summary);
  if (!row || !collector) return false;
  return (
    trimOrNull(collector.status) === "PASS" &&
    trimOrNull(collector.scheduler_job_id) === schedulerJobId &&
    trimOrNull(collector.expected_scheduler_job_id) === schedulerJobId &&
    trimOrNull(collector.producer_script) === producerScript &&
    trimOrNull(collector.producer_scope) === producerScope &&
    trimOrNull(collector.canary_mode) === canaryMode &&
    collector.exchange_write_performed === false &&
    trimOrNull(collector.history_source) === "FIRESTORE" &&
    collector.firestore_source_required === true &&
    numericFieldsMatch(collector, row, [
      "row_n",
      "healthy_run_n",
      "latest_age_minutes",
      "coverage_minutes",
      "max_observed_gap_minutes",
    ]) &&
    ensureArray(collector.blockers).length === 0
  );
}

function hasProductionEntryRouteCollectorExecutionSummary(streak) {
  return hasCollectorExecutionSummary(streak, {
    schedulerJobId: "v2_production_entry_route_canary",
    producerScript: "run-v2-production-entry-route-canary",
    producerScope: "production_entry_route_canary",
    canaryMode: "NO_EXCHANGE_ROUTE_PROOF",
  });
}

function hasProductionEntryRouteCanaryStreak(summary) {
  const row = normalizeObject(summary);
  const streak = normalizeObject(row && row.production_entry_route_canary_streak);
  if (!streak) return false;
  return (
    streak.ok === true &&
    trimOrNull(streak.reason) === "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS" &&
    trimOrNull(streak.artifact_filename) === "v2_production_entry_route_canary_streak_latest.json" &&
    !!trimOrNull(streak.artifact_file) &&
    !!trimOrNull(streak.artifact_dir) &&
    streak.artifact_current_dir_match === true &&
    trimOrNull(streak.history_source) === "FIRESTORE" &&
    streak.firestore_source_required === true &&
    !!trimOrNull(streak.history_file) &&
    Number(streak.healthy_run_n) >= Number(streak.min_run_count) &&
    Number(streak.unhealthy_run_n) === 0 &&
    Number(streak.invalid_line_n) === 0 &&
    hasProductionEntryRouteCollectorExecutionSummary(streak) &&
    hasFreshLongRunStreakCoverage(streak) &&
    ensureArray(streak.blockers).length === 0
  );
}

function hasFreshLongRunStreakCoverage(streak) {
  const row = normalizeObject(streak);
  if (!row) return false;
  const lookbackHours = Number(row.lookback_hours);
  const coverageMinutes = Number(row.coverage_minutes);
  const maxGapMinutes = Number(row.max_gap_minutes);
  const latestAgeMinutes = Number(row.latest_age_minutes);
  const maxObservedGapMinutes = Number(row.max_observed_gap_minutes);
  const artifactGeneratedAgeMinutes = Number(row.artifact_generated_age_minutes);
  return (
    Number.isFinite(lookbackHours) &&
    lookbackHours >= 24 &&
    Number.isFinite(coverageMinutes) &&
    coverageMinutes >= MIN_LIVE_STREAK_COVERAGE_MINUTES &&
    Number.isFinite(maxGapMinutes) &&
    maxGapMinutes > 0 &&
    !!trimOrNull(row.generated_at) &&
    !!trimOrNull(row.artifact_generated_at) &&
    Number.isFinite(artifactGeneratedAgeMinutes) &&
    artifactGeneratedAgeMinutes <= maxGapMinutes &&
    Number.isFinite(latestAgeMinutes) &&
    latestAgeMinutes <= maxGapMinutes &&
    Number.isFinite(maxObservedGapMinutes) &&
    maxObservedGapMinutes <= maxGapMinutes
  );
}

function hasExitRuntimeCanaryStreak(summary) {
  const row = normalizeObject(summary);
  const streak = normalizeObject(row && row.exit_runtime_canary_streak);
  if (!streak) return false;
  return (
    streak.ok === true &&
    trimOrNull(streak.reason) === "V2_EXIT_RUNTIME_CANARY_STREAK_PASS" &&
    trimOrNull(streak.artifact_filename) === "v2_exit_runtime_canary_streak_latest.json" &&
    !!trimOrNull(streak.artifact_file) &&
    !!trimOrNull(streak.artifact_dir) &&
    streak.artifact_current_dir_match === true &&
    trimOrNull(streak.history_source) === "FIRESTORE" &&
    streak.firestore_source_required === true &&
    !!trimOrNull(streak.history_file) &&
    Number(streak.healthy_run_n) >= Number(streak.min_run_count) &&
    Number(streak.unhealthy_run_n) === 0 &&
    Number(streak.invalid_line_n) === 0 &&
    Number(streak.tp1_missing_n || 0) === 0 &&
    Number(streak.native_refresh_unhealthy_n || 0) === 0 &&
    Number(streak.unprotected_window_violation_n || 0) === 0 &&
    Number(streak.alert_silent_drop_n || 0) === 0 &&
    Number(streak.alert_retry_unresolved_n || 0) === 0 &&
    Number(streak.alert_outbox_integrity_gap_n || 0) === 0 &&
    Number(streak.trail_activation_evidence_gap_n || 0) === 0 &&
    hasExitRuntimeCollectorExecutionSummary(streak) &&
    hasExitRuntimeLongRunQualitySummary(streak) &&
    hasFreshLongRunStreakCoverage(streak) &&
    ensureArray(streak.blockers).length === 0
  );
}

function hasExitRuntimeCollectorExecutionSummary(streak) {
  return hasCollectorExecutionSummary(streak, {
    schedulerJobId: "v2_exit_runtime_canary",
    producerScript: "run-v2-exit-runtime-canary",
    producerScope: "exit_runtime_canary",
    canaryMode: "LIVE_EXIT_RUNTIME_OBSERVATION",
  });
}

function hasExitRuntimeLongRunQualitySummary(streak) {
  const row = normalizeObject(streak);
  const quality = normalizeObject(row && row.long_run_quality_summary);
  const defectCounts = normalizeObject(quality && quality.defect_counts);
  if (!row || !quality || !defectCounts) return false;
  const maxGapMinutes = Number(row.max_gap_minutes);
  const latestAgeMinutes = Number(quality.latest_age_minutes);
  const maxObservedGapMinutes = Number(quality.max_observed_gap_minutes);
  return (
    trimOrNull(quality.status) === "PASS" &&
    trimOrNull(quality.history_source) === "FIRESTORE" &&
    quality.firestore_source_required === true &&
    Number(quality.coverage_minutes) >= MIN_LIVE_STREAK_COVERAGE_MINUTES &&
    numericFieldsMatch(quality, row, [
      "coverage_minutes",
      "latest_age_minutes",
      "max_observed_gap_minutes",
    ]) &&
    numericFieldsMatch(defectCounts, row, [
      "tp1_missing_n",
      "native_refresh_unhealthy_n",
      "unprotected_window_violation_n",
      "alert_silent_drop_n",
      "alert_retry_unresolved_n",
      "alert_outbox_integrity_gap_n",
      "trail_activation_evidence_gap_n",
    ]) &&
    Number.isFinite(maxGapMinutes) &&
    maxGapMinutes > 0 &&
    Number.isFinite(latestAgeMinutes) &&
    latestAgeMinutes <= maxGapMinutes &&
    Number.isFinite(maxObservedGapMinutes) &&
    maxObservedGapMinutes <= maxGapMinutes &&
    Number(defectCounts.tp1_missing_n || 0) === 0 &&
    Number(defectCounts.native_refresh_unhealthy_n || 0) === 0 &&
    Number(defectCounts.unprotected_window_violation_n || 0) === 0 &&
    Number(defectCounts.alert_silent_drop_n || 0) === 0 &&
    Number(defectCounts.alert_retry_unresolved_n || 0) === 0 &&
    Number(defectCounts.alert_outbox_integrity_gap_n || 0) === 0 &&
    Number(defectCounts.trail_activation_evidence_gap_n || 0) === 0 &&
    ensureArray(quality.blockers).length === 0
  );
}

function numericFieldsMatch(left, right, fields) {
  return ensureArray(fields).every((field) => {
    const leftValue = Number(left && left[field]);
    const rightValue = Number(right && right[field]);
    return Number.isFinite(leftValue) && Number.isFinite(rightValue) && Math.abs(leftValue - rightValue) <= 1e-9;
  });
}

function hasProductionEntryProtectedCanary(summary) {
  const row = normalizeObject(summary);
  const canary = normalizeObject(row && row.production_entry_protected_canary);
  const routeSummary = normalizeObject(canary && canary.route_result_summary);
  const liveEndpointSummary = normalizeObject(canary && canary.live_endpoint_probe_summary);
  const checkIds = new Set(ensureArray(canary && canary.check_ids).map(String).filter(Boolean));
  if (!canary || !routeSummary || !liveEndpointSummary) return false;
  return (
    canary.ok === true &&
    trimOrNull(canary.reason) === "V2_PRODUCTION_ENTRY_PROTECTED_CANARY_PASS" &&
    trimOrNull(canary.scope) === "production_entry_protected_canary" &&
    trimOrNull(canary.canary_mode) === "PROTECTED_ENTRY_NO_EXCHANGE_PROOF" &&
    trimOrNull(canary.artifact_filename) === "v2_production_entry_protected_canary_latest.json" &&
    !!trimOrNull(canary.artifact_file) &&
    !!trimOrNull(canary.artifact_dir) &&
    canary.artifact_current_dir_match === true &&
    hasFreshProtectedCanaryArtifact(canary) &&
    canary.exchange_write_performed === false &&
    canary.route_called === true &&
    canary.kernel_called === true &&
    canary.entry_transport_called === true &&
    canary.initial_sl_transport_called === true &&
    canary.initial_tp1_transport_called === true &&
    Number(canary.memory_firestore_batch_commit_n) >= 2 &&
    Number(canary.memory_firestore_write_n) >= 4 &&
    Number(canary.fail_n) === 0 &&
    ensureArray(canary.failed_check_ids).length === 0 &&
    routeSummary.ok === true &&
    trimOrNull(routeSummary.reason) === "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED" &&
    trimOrNull(routeSummary.runtime_health_status) === "HEALTHY" &&
    !!trimOrNull(routeSummary.position_cycle_id) &&
    !!trimOrNull(routeSummary.entry_event_id) &&
    !!trimOrNull(routeSummary.protection_runtime_id) &&
    !!trimOrNull(routeSummary.sl_order_id) &&
    !!trimOrNull(routeSummary.tp1_order_id) &&
    liveEndpointSummary.ok === true &&
    trimOrNull(liveEndpointSummary.reason) === "V2_PRODUCTION_ENTRY_LIVE_EXECUTED_AND_PROTECTED" &&
    liveEndpointSummary.endpoint_enabled === true &&
    liveEndpointSummary.route_called === true &&
    liveEndpointSummary.transport_resolution_ok === true &&
    trimOrNull(liveEndpointSummary.transport_reason) === "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_READY" &&
    liveEndpointSummary.exchange_write_performed === false &&
    trimOrNull(liveEndpointSummary.decision_mode) === "LIVE" &&
    liveEndpointSummary.runtime_enabled === true &&
    liveEndpointSummary.runtime_dry_run === false &&
    liveEndpointSummary.runtime_canary_only === false &&
    checkIds.has("V2_PROTECTED_ENTRY_CANARY_REQUEST_SIZING_APPROVED") &&
    checkIds.has("V2_PROTECTED_ENTRY_CANARY_ACTIVE_PROTECTED") &&
    checkIds.has("V2_PROTECTED_ENTRY_CANARY_SL_ORDER_PRESENT") &&
    checkIds.has("V2_PROTECTED_ENTRY_CANARY_TP1_ORDER_PRESENT") &&
    checkIds.has("V2_PROTECTED_ENTRY_CANARY_BATCH_WRITES_PRESENT") &&
    checkIds.has("V2_PROTECTED_ENTRY_CANARY_NO_EXCHANGE_WRITE") &&
    checkIds.has("V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_PROBE_OK") &&
    checkIds.has("V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_ROUTE_CALLED") &&
    checkIds.has("V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_TRANSPORTS_READY") &&
    checkIds.has("V2_PROTECTED_ENTRY_CANARY_LIVE_ENDPOINT_NO_EXCHANGE_WRITE")
  );
}

function hasFreshProtectedCanaryArtifact(canary) {
  const row = normalizeObject(canary);
  if (!row) return false;
  const artifactGeneratedAgeMinutes = Number(row.artifact_generated_age_minutes);
  return (
    !!trimOrNull(row.generated_at) &&
    !!trimOrNull(row.artifact_generated_at) &&
    Number.isFinite(artifactGeneratedAgeMinutes) &&
    artifactGeneratedAgeMinutes <= MAX_PROTECTED_CANARY_ARTIFACT_AGE_MINUTES
  );
}

function hasStaleArtifactProvenance(row, expectedFilename) {
  const artifact = normalizeObject(row);
  const filename = trimOrNull(expectedFilename);
  if (!artifact || !filename) return false;
  const hasArtifactFields = !!(
    trimOrNull(artifact.artifact_file) ||
    trimOrNull(artifact.artifact_dir) ||
    trimOrNull(artifact.artifact_filename) ||
    Object.prototype.hasOwnProperty.call(artifact, "artifact_current_dir_match")
  );
  if (!hasArtifactFields) return false;
  return !(
    trimOrNull(artifact.artifact_filename) === filename &&
    !!trimOrNull(artifact.artifact_file) &&
    !!trimOrNull(artifact.artifact_dir) &&
    artifact.artifact_current_dir_match === true
  );
}

function hasStaleArtifactFreshness(row, maxAgeMinutes) {
  const artifact = normalizeObject(row);
  if (!artifact) return false;
  const hasArtifactFields = !!(
    trimOrNull(artifact.artifact_file) ||
    trimOrNull(artifact.artifact_dir) ||
    trimOrNull(artifact.artifact_filename) ||
    Object.prototype.hasOwnProperty.call(artifact, "artifact_current_dir_match") ||
    trimOrNull(artifact.generated_at) ||
    trimOrNull(artifact.artifact_generated_at) ||
    Object.prototype.hasOwnProperty.call(artifact, "artifact_generated_age_minutes")
  );
  if (!hasArtifactFields) return false;
  const maxAge = Number(maxAgeMinutes);
  const artifactGeneratedAgeMinutes = Number(artifact.artifact_generated_age_minutes);
  return !(
    !!trimOrNull(artifact.generated_at) &&
    !!trimOrNull(artifact.artifact_generated_at) &&
    Number.isFinite(maxAge) &&
    maxAge > 0 &&
    Number.isFinite(artifactGeneratedAgeMinutes) &&
    artifactGeneratedAgeMinutes <= maxAge
  );
}

function pushUnique(rows, value) {
  if (!rows.includes(value)) rows.push(value);
}

function collectStaleArtifactProvenanceBlockers(summary, { mode = null } = {}) {
  const row = normalizeObject(summary);
  if (!row || !["CANARY", "LIVE"].includes(mode || "")) return [];
  const blockers = [];
  if (mode === "LIVE" && (
    hasStaleArtifactProvenance(row.repair_firestore_canary_streak, "v2_repair_queue_firestore_canary_streak_latest.json") ||
    hasStaleArtifactFreshness(row.repair_firestore_canary_streak, row.repair_firestore_canary_streak && row.repair_firestore_canary_streak.max_gap_minutes)
  )) {
    pushUnique(blockers, "DEPLOY_DECISION:STALE_ARTIFACT_PROVENANCE:REPAIR_FIRESTORE_CANARY_STREAK");
  }
  if (mode === "LIVE" && (
    hasStaleArtifactProvenance(row.production_entry_route_canary_streak, "v2_production_entry_route_canary_streak_latest.json") ||
    hasStaleArtifactFreshness(row.production_entry_route_canary_streak, row.production_entry_route_canary_streak && row.production_entry_route_canary_streak.max_gap_minutes)
  )) {
    pushUnique(blockers, "DEPLOY_DECISION:STALE_ARTIFACT_PROVENANCE:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK");
  }
  if (
    hasStaleArtifactProvenance(row.production_entry_protected_canary, "v2_production_entry_protected_canary_latest.json") ||
    hasStaleArtifactFreshness(row.production_entry_protected_canary, MAX_PROTECTED_CANARY_ARTIFACT_AGE_MINUTES)
  ) {
    pushUnique(blockers, "DEPLOY_DECISION:STALE_ARTIFACT_PROVENANCE:PRODUCTION_ENTRY_PROTECTED_CANARY");
  }
  if (mode === "LIVE" && (
    hasStaleArtifactProvenance(row.exit_runtime_canary_streak, "v2_exit_runtime_canary_streak_latest.json") ||
    hasStaleArtifactFreshness(row.exit_runtime_canary_streak, row.exit_runtime_canary_streak && row.exit_runtime_canary_streak.max_gap_minutes)
  )) {
    pushUnique(blockers, "DEPLOY_DECISION:STALE_ARTIFACT_PROVENANCE:EXIT_RUNTIME_CANARY_STREAK");
  }
  return blockers;
}

function collectLiveEvidenceCycleConsistencyBlockers(summary, { mode = null, positionCycleId = null, artifactDir = null } = {}) {
  const row = normalizeObject(summary);
  if (!row || mode !== "LIVE") return [];
  const blockers = [];
  const expectedArtifactDir = trimOrNull(artifactDir);
  const evidenceRows = [
    row.repair_firestore_canary_streak,
    row.production_entry_route_canary_streak,
    row.exit_runtime_canary_streak,
    row.production_entry_protected_canary,
  ].map(normalizeObject).filter(Boolean);
  const artifactDirs = Array.from(new Set(
    evidenceRows.map((entry) => trimOrNull(entry && entry.artifact_dir)).filter(Boolean)
  ));
  if (
    artifactDirs.length !== 1 ||
    evidenceRows.length !== 4 ||
    (expectedArtifactDir && artifactDirs[0] !== expectedArtifactDir)
  ) {
    blockers.push("DEPLOY_DECISION:LIVE_EVIDENCE_ARTIFACT_CYCLE_MISMATCH");
  }

  const expectedPositionCycleId = trimOrNull(positionCycleId);
  const streakRows = [
    row.repair_firestore_canary_streak,
    row.production_entry_route_canary_streak,
    row.exit_runtime_canary_streak,
  ].map(normalizeObject).filter(Boolean);
  const streakPositionCycleIds = Array.from(new Set(
    streakRows.map((entry) => trimOrNull(entry && (
      entry.position_cycle_id ||
      entry.selected_position_cycle_id ||
      entry.latest_position_cycle_id
    ))).filter(Boolean)
  ));
  if (
    streakRows.length !== 3 ||
    !expectedPositionCycleId ||
    streakPositionCycleIds.length !== 1 ||
    streakPositionCycleIds[0] !== expectedPositionCycleId
  ) {
    blockers.push("DEPLOY_DECISION:LIVE_STREAK_POSITION_CYCLE_MISMATCH");
  }

  const protectedCanary = normalizeObject(row.production_entry_protected_canary);
  const routeSummary = normalizeObject(protectedCanary && protectedCanary.route_result_summary);
  const protectedPositionCycleId = trimOrNull(routeSummary && routeSummary.position_cycle_id);
  if (!protectedPositionCycleId || !expectedPositionCycleId || protectedPositionCycleId !== expectedPositionCycleId) {
    blockers.push("DEPLOY_DECISION:LIVE_PROTECTED_ENTRY_POSITION_CYCLE_MISMATCH");
  }
  return blockers;
}

function hasExactCandidateSnapshotCounts(summary) {
  const row = normalizeObject(summary);
  const selectedPreflight = normalizeObject(row && row.selected_preflight);
  const snapshotCounts = normalizeObject(selectedPreflight && selectedPreflight.snapshot_counts);
  return !!(
    selectedPreflight &&
    selectedPreflight.ok === true &&
    Number(selectedPreflight.blocker_n) === 0 &&
    snapshotCounts &&
    Number(snapshotCounts.episode_n) === 1 &&
    Number(snapshotCounts.shadow_live_pair_n) === 1 &&
    Number(snapshotCounts.source_mode_pair_n) === 1
  );
}

function buildAlertRetrySummary(summary) {
  const row = normalizeObject(summary);
  if (!row) return null;
  return Object.freeze({
    outbox_n: Number.isFinite(Number(row.outbox_n)) ? Number(row.outbox_n) : null,
    failed_n: Number.isFinite(Number(row.failed_n)) ? Number(row.failed_n) : null,
    sent_n: Number.isFinite(Number(row.sent_n)) ? Number(row.sent_n) : null,
    pending_n: Number.isFinite(Number(row.pending_n)) ? Number(row.pending_n) : null,
    retryable_failed_n: Number.isFinite(Number(row.retryable_failed_n)) ? Number(row.retryable_failed_n) : null,
    terminal_failed_n: Number.isFinite(Number(row.terminal_failed_n)) ? Number(row.terminal_failed_n) : null,
    family_counts: normalizeObject(row.family_counts) || {},
    retry_policy_counts: normalizeObject(row.retry_policy_counts) || {},
    runbook_ref_counts: normalizeObject(row.runbook_ref_counts) || {},
    latest_failed: normalizeObject(row.latest_failed) ? Object.freeze({
      alert_outbox_id: trimOrNull(row.latest_failed.alert_outbox_id),
      last_reason: trimOrNull(row.latest_failed.last_reason),
      last_reason_family: trimOrNull(row.latest_failed.last_reason_family),
      retry_policy_code: trimOrNull(row.latest_failed.retry_policy_code),
      runbook_refs: Array.isArray(row.latest_failed.runbook_refs) ? row.latest_failed.runbook_refs.slice() : [],
      last_attempt_at: trimOrNull(row.latest_failed.last_attempt_at),
    }) : null,
  });
}

function hasAlertRetryAttention(summary) {
  const row = normalizeObject(summary);
  if (!row) return false;
  return Number(row.failed_n || 0) > 0 || Number(row.pending_n || 0) > 0;
}

function hasCandidateSelectionContract(summary) {
  const row = normalizeObject(summary);
  const contract = normalizeObject(row && row.selection_contract);
  if (!contract) return false;
  return (
    contract.ok === true &&
    contract.scan_limit_respected === true &&
    contract.recent_window_enforced === true &&
    contract.selected_candidate_present === true &&
    contract.selected_preflight_ok === true &&
    contract.selected_runtime_chain_ok === true &&
    contract.selected_cycle_matches_preflight === true &&
    contract.selected_cycle_matches_collector_env === true &&
    contract.selected_snapshot_counts_exact === true
  );
}

function buildCandidateSelectionBlockers({ mode = null, positionCycleId = null, candidateSelectionSummary = null } = {}) {
  if (!["CANARY", "LIVE"].includes(mode || "")) return [];
  const row = normalizeObject(candidateSelectionSummary);
  if (!row) return [];

  const blockers = [];
  const selectedPositionCycleId = trimOrNull(row.selected_position_cycle_id);
  if (row.ok !== true) {
    blockers.push("DEPLOY_DECISION:CANDIDATE_SELECTION_NOT_READY");
  }
  if (!selectedPositionCycleId) {
    blockers.push("DEPLOY_DECISION:CANDIDATE_SELECTION_POSITION_CYCLE_REQUIRED");
  } else if (positionCycleId && selectedPositionCycleId !== positionCycleId) {
    blockers.push("DEPLOY_DECISION:CANDIDATE_SELECTION_POSITION_CYCLE_MISMATCH");
  }
  if (!hasCandidateSelectionContract(row)) {
    blockers.push("DEPLOY_DECISION:CANDIDATE_SELECTION_CONTRACT_REQUIRED");
  }
  if (!hasExactCandidateSnapshotCounts(row)) {
    blockers.push("DEPLOY_DECISION:CANDIDATE_SELECTION_PREFLIGHT_COUNTS_REQUIRED");
  }
  return blockers;
}

function buildPromotionPositionLineageBlockers({
  mode = null,
  positionCycleId = null,
  selectorMeta = null,
  candidateSelectionSummary = null,
} = {}) {
  if (!["CANARY", "LIVE"].includes(mode || "")) return [];
  const blockers = [];
  const selector = normalizeObject(selectorMeta);
  const candidate = normalizeObject(candidateSelectionSummary);
  const selectedPreflight = normalizeObject(candidate && candidate.selected_preflight);
  const selectorPositionCycleId = trimOrNull(selector && selector.position_cycle_id);
  const selectedPositionCycleId = trimOrNull(candidate && candidate.selected_position_cycle_id);
  const selectedPreflightPositionCycleId = trimOrNull(selectedPreflight && selectedPreflight.position_cycle_id);

  if (selector && !selectorPositionCycleId) {
    blockers.push("DEPLOY_DECISION:SELECTOR_META_POSITION_CYCLE_REQUIRED");
  } else if (selectorPositionCycleId && positionCycleId && selectorPositionCycleId !== positionCycleId) {
    blockers.push("DEPLOY_DECISION:SELECTOR_META_POSITION_CYCLE_MISMATCH");
  }
  if (selectedPreflightPositionCycleId && positionCycleId && selectedPreflightPositionCycleId !== positionCycleId) {
    blockers.push("DEPLOY_DECISION:CANDIDATE_SELECTION_PREFLIGHT_POSITION_CYCLE_MISMATCH");
  }
  if (
    selectedPreflightPositionCycleId &&
    selectedPositionCycleId &&
    selectedPreflightPositionCycleId !== selectedPositionCycleId
  ) {
    blockers.push("DEPLOY_DECISION:CANDIDATE_SELECTION_PREFLIGHT_POSITION_CYCLE_MISMATCH");
  }
  if (selectorPositionCycleId && selectedPositionCycleId && selectorPositionCycleId !== selectedPositionCycleId) {
    blockers.push("DEPLOY_DECISION:SELECTOR_CANDIDATE_POSITION_CYCLE_MISMATCH");
  }
  return blockers;
}

function buildDeployDecision(unifiedReport, {
  entryBoundaryAudit = buildV2EntryBoundaryAuditSummary(),
  fillSyncCanonicalBoundaryAudit = buildV2FillSyncCanonicalBoundaryAuditSummary(),
  productionCutoverAudit = buildV2ProductionCutoverAuditSummary(),
  artifactDir = null,
} = {}) {
  const report = unifiedReport && typeof unifiedReport === "object" ? unifiedReport : null;
  if (!report) {
    return Object.freeze({
      approved: false,
      decision: "REJECT",
      mode: null,
      position_cycle_id: null,
      fail_closed: true,
      blockers: ["DEPLOY_DECISION:UNIFIED_REPORT_REQUIRED"],
      warnings: [],
      reason: "UNIFIED_REPORT_REQUIRED",
      bounded_runtime_summary: null,
      entry_boundary_audit: entryBoundaryAudit,
      fill_sync_canonical_boundary_audit: fillSyncCanonicalBoundaryAudit,
      production_cutover_audit: productionCutoverAudit,
      candidate_selection_summary: null,
    });
  }

  const mode = upper(report.mode);
  const positionCycleId = trimOrNull(report.position_cycle_id);
  const blockers = [];
  const warnings = ensureArray(report.warnings).slice();
  const criticalWatchdogIssueCodes = ensureArray(report.critical_watchdog_issue_codes).map(upper).filter(Boolean);
  const boundedRuntimeSummary = normalizeObject(report.bounded_runtime_summary);
  const selectorMeta = normalizeObject(report.selector_meta);
  const alertRetrySummary = buildAlertRetrySummary(boundedRuntimeSummary && boundedRuntimeSummary.alert_retry_summary);
  const candidateSelectionSummary = normalizeObject(report.candidate_selection_summary);

  if (!mode) blockers.push("DEPLOY_DECISION:MODE_REQUIRED");
  if (!["SHADOW", "CANARY", "LIVE"].includes(mode || "")) {
    blockers.push("DEPLOY_DECISION:MODE_INVALID");
  }
  if (["CANARY", "LIVE"].includes(mode || "") && !positionCycleId) {
    blockers.push("DEPLOY_DECISION:POSITION_CYCLE_ID_REQUIRED");
  }
  if (["CANARY", "LIVE"].includes(mode || "") && !hasBoundedRuntimeEvidence(boundedRuntimeSummary)) {
    blockers.push("DEPLOY_DECISION:BOUNDED_RUNTIME_SUMMARY_REQUIRED");
  }
  if (["CANARY", "LIVE"].includes(mode || "") && !hasRuntimeLineageContract(boundedRuntimeSummary)) {
    blockers.push("DEPLOY_DECISION:LINEAGE_CONTRACT_REQUIRED");
  }
  if (["CANARY", "LIVE"].includes(mode || "") && !hasEvidenceSnapshotCoverage(boundedRuntimeSummary)) {
    blockers.push("DEPLOY_DECISION:EVIDENCE_SNAPSHOT_SUMMARY_REQUIRED");
  }
  if (["CANARY", "LIVE"].includes(mode || "") && !hasOpenClawExecutionSeparationCoverage(boundedRuntimeSummary)) {
    blockers.push("DEPLOY_DECISION:OPENCLAW_EXECUTION_SEPARATION_REQUIRED");
  }
  if (["CANARY", "LIVE"].includes(mode || "") && !hasRuntimeChainAuditCoverage(boundedRuntimeSummary)) {
    blockers.push("DEPLOY_DECISION:RUNTIME_CHAIN_AUDIT_REQUIRED");
  }
  if (["CANARY", "LIVE"].includes(mode || "") && !hasRepairEvidenceSummary(boundedRuntimeSummary)) {
    blockers.push("DEPLOY_DECISION:REPAIR_EVIDENCE_SUMMARY_REQUIRED");
  }
  if (["CANARY", "LIVE"].includes(mode || "") && !hasOpenClawExecutionAuditLedgerWrite(boundedRuntimeSummary)) {
    blockers.push("DEPLOY_DECISION:OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_REQUIRED");
  }
  if (["CANARY", "LIVE"].includes(mode || "") && !hasEntryBoundaryAudit(entryBoundaryAudit)) {
    blockers.push("DEPLOY_DECISION:V2_ENTRY_BOUNDARY_AUDIT_REQUIRED");
  }
  if (["CANARY", "LIVE"].includes(mode || "") && !hasFillSyncCanonicalBoundaryAudit(fillSyncCanonicalBoundaryAudit)) {
    blockers.push("DEPLOY_DECISION:V2_FILL_SYNC_CANONICAL_BOUNDARY_AUDIT_REQUIRED");
  }
  if (["CANARY", "LIVE"].includes(mode || "") && !hasProductionCutoverAudit(productionCutoverAudit)) {
    blockers.push("DEPLOY_DECISION:V2_PRODUCTION_CUTOVER_AUDIT_REQUIRED");
  }
  if (["CANARY", "LIVE"].includes(mode || "") && !hasProductionLiveEntrySizingContract(productionCutoverAudit)) {
    blockers.push("DEPLOY_DECISION:V2_PRODUCTION_LIVE_ENTRY_SIZING_CONTRACT_REQUIRED");
  }
  blockers.push(...collectStaleArtifactProvenanceBlockers(boundedRuntimeSummary, { mode }));
  if (mode === "LIVE" && !hasRepairFirestoreCanaryStreak(boundedRuntimeSummary)) {
    blockers.push("DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_REQUIRED");
  }
  if (mode === "CANARY" && !hasRepairFirestoreCanaryStreak(boundedRuntimeSummary)) {
    warnings.push("DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY");
  }
  if (mode === "LIVE" && !hasProductionEntryRouteCanaryStreak(boundedRuntimeSummary)) {
    blockers.push("DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRED");
  }
  if (mode === "CANARY" && !hasProductionEntryRouteCanaryStreak(boundedRuntimeSummary)) {
    warnings.push("DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY");
  }
  if (mode === "LIVE" && !hasExitRuntimeCanaryStreak(boundedRuntimeSummary)) {
    blockers.push("DEPLOY_DECISION:EXIT_RUNTIME_CANARY_STREAK_REQUIRED");
  }
  if (mode === "CANARY" && !hasExitRuntimeCanaryStreak(boundedRuntimeSummary)) {
    warnings.push("DEPLOY_DECISION:EXIT_RUNTIME_CANARY_STREAK_NOT_READY");
  }
  if (["CANARY", "LIVE"].includes(mode || "") && !hasProductionEntryProtectedCanary(boundedRuntimeSummary)) {
    blockers.push("DEPLOY_DECISION:PRODUCTION_ENTRY_PROTECTED_CANARY_REQUIRED");
  }
  blockers.push(...collectLiveEvidenceCycleConsistencyBlockers(boundedRuntimeSummary, {
    mode,
    positionCycleId,
    artifactDir,
  }));
  if (mode === "SHADOW") {
    blockers.push("DEPLOY_DECISION:SHADOW_MODE_NOT_DEPLOYABLE");
  }
  if (criticalWatchdogIssueCodes.length > 0) {
    blockers.push(`DEPLOY_DECISION:CRITICAL_WATCHDOG_ISSUES_PRESENT:${criticalWatchdogIssueCodes.join("|")}`);
  }
  blockers.push(...buildCandidateSelectionBlockers({
    mode,
    positionCycleId,
    candidateSelectionSummary,
  }));
  blockers.push(...buildPromotionPositionLineageBlockers({
    mode,
    positionCycleId,
    selectorMeta,
    candidateSelectionSummary,
  }));
  blockers.push(...ensureArray(report.blockers));

  const approved = blockers.length === 0 && report.pass === true;
  return Object.freeze({
    approved,
    decision: approved ? "APPROVE_DEPLOY" : "HOLD",
    mode: mode || null,
    position_cycle_id: positionCycleId,
    fail_closed: approved !== true,
    bounded_runtime_summary: boundedRuntimeSummary,
    selector_meta: selectorMeta,
    entry_boundary_audit: entryBoundaryAudit,
    fill_sync_canonical_boundary_audit: fillSyncCanonicalBoundaryAudit,
    production_cutover_audit: productionCutoverAudit,
    alert_retry_summary: alertRetrySummary,
    alert_retry_attention_required: hasAlertRetryAttention(alertRetrySummary),
    candidate_selection_summary: candidateSelectionSummary,
    blockers,
    warnings,
    reason: approved ? "UNIFIED_REPORT_APPROVED" : "UNIFIED_REPORT_BLOCKED",
  });
}

function applyPreflightLineageChecks(decision, { preflightReport = null } = {}) {
  const row = normalizeObject(decision) || {};
  const mode = upper(row.mode);
  if (!["CANARY", "LIVE"].includes(mode || "")) return Object.freeze({ ...row });

  const blockers = ensureArray(row.blockers).slice();
  const runtimeLineage = normalizeObject(row.bounded_runtime_summary && row.bounded_runtime_summary.lineage_contract);
  const preflight = normalizeObject(preflightReport);
  const preflightLineage = normalizeObject(preflight && preflight.lineage_contract);

  if (!preflight) {
    // Raw pipeline/replay verification may not materialize a preflight artifact.
    // In that case keep the runtime lineage contract but defer preflight linkage
    // enforcement to canary wrapper/runbook paths that do materialize preflight.
  } else if (!hasLineageContract(preflightLineage)) {
    blockers.push("DEPLOY_DECISION:PREFLIGHT_LINEAGE_CONTRACT_REQUIRED");
  } else if (!hasLineageContract(runtimeLineage)) {
    blockers.push("DEPLOY_DECISION:LINEAGE_CONTRACT_REQUIRED");
  } else if (!contractsMatch(preflightLineage, runtimeLineage)) {
    blockers.push("DEPLOY_DECISION:LINEAGE_CONTRACT_MISMATCH");
  }

  const approved = blockers.length === 0 && row.reason === "UNIFIED_REPORT_APPROVED";
  return Object.freeze({
    ...row,
    approved,
    decision: approved ? "APPROVE_DEPLOY" : "HOLD",
    fail_closed: approved !== true,
    blockers,
    reason: approved ? "UNIFIED_REPORT_APPROVED" : "UNIFIED_REPORT_BLOCKED",
  });
}

function writeDeployDecisionArtifact(env = process.env) {
  const artifactDir = resolveArtifactDir(env);
  const unifiedReport = resolveUnifiedPromotionReport(env);
  const preflightReport = readOptionalArtifact(artifactDir, "promotion-preflight.json");
  const decision = applyPreflightLineageChecks(
    buildDeployDecision(unifiedReport, { artifactDir }),
    { preflightReport }
  );
  ensureDir(artifactDir);
  const outputFile = path.join(artifactDir, OUTPUT_FILENAME);
  writeJson(outputFile, decision);
  return Object.freeze({
    artifactDir,
    outputFile,
    unifiedReport,
    decision,
  });
}

async function main(env = process.env) {
  const result = writeDeployDecisionArtifact(env);
  const payload = {
    ok: result.decision.approved === true,
    reason: result.decision.approved === true
      ? "V2_PROMOTION_DEPLOY_DECISION_APPROVED"
      : "V2_PROMOTION_DEPLOY_DECISION_BLOCKED",
    artifact_dir: result.artifactDir,
    output_file: result.outputFile,
    decision: result.decision.decision,
    mode: result.decision.mode,
    position_cycle_id: result.decision.position_cycle_id,
    blockers: result.decision.blockers,
    warnings: result.decision.warnings,
  };
  if (result.decision.approved !== true) {
    console.error(JSON.stringify(payload));
    process.exit(1);
  }
  console.log(JSON.stringify(payload));
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("CHECK_V2_PROMOTION_DEPLOY_DECISION_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    writeDeployDecisionArtifact,
    __test: {
      OUTPUT_FILENAME,
      UNIFIED_REPORT_FILENAME,
      trimOrNull,
      upper,
      normalizeObject,
      hasBoundedRuntimeEvidence,
      hasRuntimeLineageContract,
      hasEvidenceSnapshotCoverage,
      hasOpenClawExecutionSeparationCoverage,
      hasRuntimeChainAuditCoverage,
      REQUIRED_RUNTIME_CHAIN_CHECK_IDS,
      hasRepairEvidenceSummary,
      hasOpenClawExecutionAuditLedgerWrite,
      buildV2EntryBoundaryAuditSummary,
      hasEntryBoundaryAudit,
      buildV2FillSyncCanonicalBoundaryAuditSummary,
      hasFillSyncCanonicalBoundaryAudit,
      buildV2ProductionCutoverAuditSummary,
      hasProductionCutoverAudit,
      REQUIRED_PRODUCTION_LIVE_ENTRY_SIZING_CHECK_IDS,
      MIN_LIVE_STREAK_COVERAGE_MINUTES,
      MAX_PROTECTED_CANARY_ARTIFACT_AGE_MINUTES,
      hasProductionLiveEntrySizingContract,
      hasRepairFirestoreCanaryStreak,
      hasCollectorExecutionSummary,
      hasProductionEntryRouteCollectorExecutionSummary,
      hasProductionEntryRouteCanaryStreak,
      hasProductionEntryProtectedCanary,
      hasFreshProtectedCanaryArtifact,
      hasExitRuntimeCollectorExecutionSummary,
      hasExitRuntimeLongRunQualitySummary,
      hasFreshLongRunStreakCoverage,
      hasExitRuntimeCanaryStreak,
      hasStaleArtifactProvenance,
      hasStaleArtifactFreshness,
      collectStaleArtifactProvenanceBlockers,
      collectLiveEvidenceCycleConsistencyBlockers,
      buildAlertRetrySummary,
      hasAlertRetryAttention,
      hasExactCandidateSnapshotCounts,
      hasCandidateSelectionContract,
      buildCandidateSelectionBlockers,
      buildPromotionPositionLineageBlockers,
      applyPreflightLineageChecks,
      resolveArtifactDir,
      resolveUnifiedPromotionReport,
      buildDeployDecision,
    },
  };
}
