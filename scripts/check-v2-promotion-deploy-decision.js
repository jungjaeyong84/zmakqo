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
    Number(streak.healthy_run_n) >= Number(streak.min_run_count) &&
    Number(streak.unhealthy_run_n) === 0 &&
    Number(streak.invalid_line_n) === 0 &&
    ensureArray(streak.blockers).length === 0
  );
}

function hasProductionEntryRouteCanaryStreak(summary) {
  const row = normalizeObject(summary);
  const streak = normalizeObject(row && row.production_entry_route_canary_streak);
  if (!streak) return false;
  return (
    streak.ok === true &&
    trimOrNull(streak.reason) === "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS" &&
    trimOrNull(streak.history_source) === "FIRESTORE" &&
    !!trimOrNull(streak.history_file) &&
    Number(streak.healthy_run_n) >= Number(streak.min_run_count) &&
    Number(streak.unhealthy_run_n) === 0 &&
    Number(streak.invalid_line_n) === 0 &&
    ensureArray(streak.blockers).length === 0
  );
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

function buildDeployDecision(unifiedReport, {
  entryBoundaryAudit = buildV2EntryBoundaryAuditSummary(),
  fillSyncCanonicalBoundaryAudit = buildV2FillSyncCanonicalBoundaryAuditSummary(),
  productionCutoverAudit = buildV2ProductionCutoverAuditSummary(),
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
  blockers.push(...ensureArray(report.blockers));

  const approved = blockers.length === 0 && report.pass === true;
  return Object.freeze({
    approved,
    decision: approved ? "APPROVE_DEPLOY" : "HOLD",
    mode: mode || null,
    position_cycle_id: positionCycleId,
    fail_closed: approved !== true,
    bounded_runtime_summary: boundedRuntimeSummary,
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
    buildDeployDecision(unifiedReport),
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
      hasProductionLiveEntrySizingContract,
      hasRepairFirestoreCanaryStreak,
      hasProductionEntryRouteCanaryStreak,
      buildAlertRetrySummary,
      hasAlertRetryAttention,
      hasExactCandidateSnapshotCounts,
      hasCandidateSelectionContract,
      buildCandidateSelectionBlockers,
      applyPreflightLineageChecks,
      resolveArtifactDir,
      resolveUnifiedPromotionReport,
      buildDeployDecision,
    },
  };
}
