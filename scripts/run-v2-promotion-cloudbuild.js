#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const runbookCheck = require("./check-v2-canary-runbook");
const liveCutoverReadiness = require("./check-v2-repair-live-cutover-readiness");
const submitContractCheck = require("./check-v2-promotion-submit-contract");
const submitTrace = require("./lib/v2-promotion-submit-trace");
const { auditV2ProductionCutoverReadiness } = require("../src/v2/productionCutoverAudit");
const { auditV2SchedulerTrafficCutoverReadiness } = require("../src/v2/schedulerTrafficCutoverAudit");
const { runV2SchedulerTrafficCollectorPreflight } = require("../src/v2/schedulerTrafficCollectorPreflight");
const { collectV2SchedulerTrafficState } = require("../src/v2/schedulerTrafficStateCollector");

const OUTPUT_FILENAME = "promotion-cloudbuild-context.json";
const DEPLOY_DECISION_FILENAME = "promotion-deploy-decision.json";
const CANARY_FLOW_FILENAME = "promotion-canary-flow.json";
const LIVE_CUTOVER_READINESS_FILENAME = "v2_repair_live_cutover_readiness_latest.json";
const PRODUCTION_CUTOVER_READINESS_FILENAME = "v2_production_cutover_readiness_latest.json";
const SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_FILENAME = "v2_scheduler_traffic_collector_preflight_latest.json";
const SCHEDULER_TRAFFIC_CUTOVER_READINESS_FILENAME = "v2_scheduler_traffic_cutover_readiness_latest.json";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function toMs(value) {
  const text = trimOrNull(value);
  if (!text) return null;
  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : null;
}

function ageMinutesSince(value, nowMs = Date.now()) {
  const generatedMs = toMs(value);
  if (!Number.isFinite(generatedMs)) return null;
  return Math.max(0, Math.floor((Number(nowMs) - generatedMs) / 60000));
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function isEnabled(value) {
  return String(value || "0").trim() === "1";
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

function buildArtifactProvenance({ artifactDir = null, filePath = null, expectedFilename = null, generatedAt = null, nowMs = Date.now() } = {}) {
  const file = trimOrNull(filePath);
  const dir = trimOrNull(artifactDir);
  const filename = trimOrNull(expectedFilename);
  const generated = trimOrNull(generatedAt);
  const resolvedFile = file ? path.resolve(file) : null;
  const resolvedExpected = dir && filename ? path.join(path.resolve(dir), filename) : null;
  return Object.freeze({
    artifact_file: file,
    artifact_dir: file ? path.dirname(file) : null,
    artifact_filename: file ? path.basename(file) : null,
    artifact_current_dir_match: !!(resolvedFile && resolvedExpected && resolvedFile === resolvedExpected),
    generated_at: generated,
    artifact_generated_at: generated,
    artifact_generated_age_minutes: ageMinutesSince(generated, nowMs),
  });
}

function summarizeBlockers(blockers) {
  const rows = Array.isArray(blockers) ? blockers : [];
  const normalized = rows
    .map((row) => trimOrNull(row))
    .filter(Boolean);
  const hasLiveEvidenceCycleBlocker = normalized.some((row) => (
    row.includes("LIVE_EVIDENCE_ARTIFACT_CYCLE_MISMATCH") ||
    row.includes("LIVE_STREAK_POSITION_CYCLE_MISMATCH") ||
    row.includes("LIVE_PROTECTED_ENTRY_POSITION_CYCLE_MISMATCH")
  ));
  return Object.freeze({
    blocker_n: normalized.length,
    top_blockers: normalized.slice(0, 3),
    has_provenance_blocker: normalized.some((row) => row.includes("PROVENANCE:")),
    has_stale_artifact_provenance_blocker: normalized.some((row) => row.includes("STALE_ARTIFACT_PROVENANCE")),
    has_live_evidence_cycle_blocker: hasLiveEvidenceCycleBlocker,
    has_watchdog_blocker: normalized.some((row) => row.includes("WATCHDOG")),
    has_candidate_selection_blocker: normalized.some((row) => row.includes("CANDIDATE_SELECTION")),
    has_bounded_runtime_blocker: normalized.some((row) => row.includes("BOUNDED_RUNTIME") || row.includes("EVIDENCE_SNAPSHOT")),
    has_production_entry_protected_canary_blocker: normalized.some((row) => row.includes("PRODUCTION_ENTRY_PROTECTED_CANARY")),
    has_entry_boundary_blocker: normalized.some((row) => row.includes("ENTRY_BOUNDARY")),
    has_production_cutover_blocker: normalized.some((row) => row.includes("PRODUCTION_CUTOVER")),
  });
}

function summarizeWarnings(warnings) {
  const rows = Array.isArray(warnings) ? warnings : [];
  const normalized = rows
    .map((row) => trimOrNull(row))
    .filter(Boolean);
  const hasRepairFirestoreCanaryStreakWarning = normalized.some((row) => row.includes("REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"));
  const hasProductionEntryRouteCanaryStreakWarning = normalized.some((row) => row.includes("PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"));
  return Object.freeze({
    warning_n: normalized.length,
    top_warnings: normalized.slice(0, 3),
    has_live_readiness_warning: hasRepairFirestoreCanaryStreakWarning || hasProductionEntryRouteCanaryStreakWarning,
    has_repair_firestore_canary_streak_warning: hasRepairFirestoreCanaryStreakWarning,
    has_production_entry_route_canary_streak_warning: hasProductionEntryRouteCanaryStreakWarning,
  });
}

function summarizeAlertRetry(summary) {
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

function buildStatusLine(summary) {
  const row = normalizeObject(summary);
  if (!row) return "NO_DEPLOY_DECISION";
  const status = row.approved === true ? "APPROVE_DEPLOY" : (trimOrNull(row.decision) || "HOLD");
  const cycle = trimOrNull(row.position_cycle_id) || "NO_CYCLE";
  const blockerSummary = normalizeObject(row.blocker_summary);
  const topBlockers = Array.isArray(blockerSummary && blockerSummary.top_blockers)
    ? blockerSummary.top_blockers.filter(Boolean)
    : [];
  const parts = [
    status,
    `cycle=${cycle}`,
    `blockers=${Number(row.blocker_n || 0)}`,
    `warnings=${Number(row.warning_n || 0)}`,
  ];
  const alertRetrySummary = normalizeObject(row.alert_retry_summary);
  if (alertRetrySummary && hasAlertRetryAttention(alertRetrySummary)) {
    parts.push(`alert_failed=${Number(alertRetrySummary.failed_n || 0)}`);
    parts.push(`alert_pending=${Number(alertRetrySummary.pending_n || 0)}`);
  }
  if (blockerSummary && blockerSummary.has_production_entry_protected_canary_blocker === true) {
    parts.push("protected_entry_canary=BLOCKED");
  }
  if (blockerSummary && blockerSummary.has_stale_artifact_provenance_blocker === true) {
    parts.push("stale_artifact=BLOCKED");
  }
  if (blockerSummary && blockerSummary.has_live_evidence_cycle_blocker === true) {
    parts.push("live_evidence_cycle=BLOCKED");
  }
  if (topBlockers.length) parts.push(`top=${topBlockers.join("|")}`);
  const warningSummary = normalizeObject(row.warning_summary);
  const topWarnings = Array.isArray(warningSummary && warningSummary.top_warnings)
    ? warningSummary.top_warnings.filter(Boolean)
    : [];
  if (topWarnings.length) parts.push(`warn=${topWarnings.join("|")}`);
  return parts.join(" ; ");
}

function buildRecommendedNextAction(summary) {
  const row = normalizeObject(summary);
  if (!row) return "READ_DEPLOY_DECISION";
  if (row.approved === true) return "PROCEED_WITH_SUBMIT_WRAPPER";
  const blockerSummary = normalizeObject(row.blocker_summary);
  if (blockerSummary && blockerSummary.has_provenance_blocker) {
    return "DISCARD_ARTIFACT_DIR_AND_RERUN_FROM_PREFLIGHT";
  }
  if (blockerSummary && blockerSummary.has_stale_artifact_provenance_blocker) {
    return "DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE";
  }
  if (blockerSummary && blockerSummary.has_live_evidence_cycle_blocker) {
    return "DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE";
  }
  if (blockerSummary && blockerSummary.has_candidate_selection_blocker) {
    return "RECHECK_SELECTED_POSITION_CYCLE_AND_RERUN_CANARY_FLOW";
  }
  if (blockerSummary && blockerSummary.has_production_entry_protected_canary_blocker) {
    return "FIX_V2_PROTECTED_ENTRY_CANARY_AND_RECHECK_DEPLOY_DECISION";
  }
  if (blockerSummary && blockerSummary.has_bounded_runtime_blocker) {
    return "REGENERATE_BOUNDED_RUNTIME_ARTIFACTS_AND_RECHECK_DEPLOY_DECISION";
  }
  if (blockerSummary && blockerSummary.has_entry_boundary_blocker) {
    return "FIX_V2_ENTRY_BOUNDARY_AND_RECHECK_DEPLOY_DECISION";
  }
  if (blockerSummary && blockerSummary.has_production_cutover_blocker) {
    return "FIX_V2_PRODUCTION_CUTOVER_AND_RECHECK_DEPLOY_DECISION";
  }
  if (blockerSummary && blockerSummary.has_watchdog_blocker) {
    return "HOLD_PROMOTION_AND_REVIEW_REPLAY_WATCHDOG_EVIDENCE";
  }
  return "HOLD_AND_REVIEW_DEPLOY_DECISION_BLOCKERS";
}

function buildRecommendedNextActionReason(summary) {
  const row = normalizeObject(summary);
  if (!row) return "deploy decision artifact missing";
  if (row.approved === true) {
    return "deploy decision approved with no blocking families";
  }
  const blockerSummary = normalizeObject(row.blocker_summary);
  if (blockerSummary && blockerSummary.has_provenance_blocker) {
    return "provenance blocker detected; bounded artifact lineage is not trustworthy";
  }
  if (blockerSummary && blockerSummary.has_stale_artifact_provenance_blocker) {
    return "stale artifact provenance blocker detected; required canary or streak evidence is not from the current artifact cycle";
  }
  if (blockerSummary && blockerSummary.has_live_evidence_cycle_blocker) {
    return "LIVE evidence cycle blocker detected; all LIVE canary/streak/protected-entry evidence must come from the same selected position cycle";
  }
  if (blockerSummary && blockerSummary.has_candidate_selection_blocker) {
    return "candidate selection blocker detected; selected cycle and approved cycle must be revalidated";
  }
  if (blockerSummary && blockerSummary.has_production_entry_protected_canary_blocker) {
    return "protected entry canary blocker detected; production entry must prove SL and TP1 protection before promotion";
  }
  if (blockerSummary && blockerSummary.has_bounded_runtime_blocker) {
    return "bounded runtime blocker detected; required selector/collector/exporter evidence is incomplete";
  }
  if (blockerSummary && blockerSummary.has_entry_boundary_blocker) {
    return "entry boundary blocker detected; V2 entry submit/transport/protection ownership is not isolated";
  }
  if (blockerSummary && blockerSummary.has_production_cutover_blocker) {
    return "production cutover blocker detected; V2 LIVE must prove legacy webhook is blocked";
  }
  if (blockerSummary && blockerSummary.has_watchdog_blocker) {
    return "watchdog blocker detected; replay or terminal evidence must be reviewed before promotion";
  }
  return "deploy decision blockers remain and require manual review";
}

function buildRecommendedNextActionReasonCode(summary) {
  const row = normalizeObject(summary);
  if (!row) return "DEPLOY_DECISION_ARTIFACT_MISSING";
  if (row.approved === true) return "APPROVED_NO_BLOCKING_FAMILIES";
  const blockerSummary = normalizeObject(row.blocker_summary);
  if (blockerSummary && blockerSummary.has_provenance_blocker) {
    return "PROVENANCE_BLOCKER";
  }
  if (blockerSummary && blockerSummary.has_stale_artifact_provenance_blocker) {
    return "STALE_ARTIFACT_PROVENANCE_BLOCKER";
  }
  if (blockerSummary && blockerSummary.has_live_evidence_cycle_blocker) {
    return "LIVE_EVIDENCE_CYCLE_BLOCKER";
  }
  if (blockerSummary && blockerSummary.has_candidate_selection_blocker) {
    return "CANDIDATE_SELECTION_BLOCKER";
  }
  if (blockerSummary && blockerSummary.has_production_entry_protected_canary_blocker) {
    return "PROTECTED_ENTRY_CANARY_BLOCKER";
  }
  if (blockerSummary && blockerSummary.has_bounded_runtime_blocker) {
    return "BOUNDED_RUNTIME_BLOCKER";
  }
  if (blockerSummary && blockerSummary.has_entry_boundary_blocker) {
    return "ENTRY_BOUNDARY_BLOCKER";
  }
  if (blockerSummary && blockerSummary.has_production_cutover_blocker) {
    return "PRODUCTION_CUTOVER_BLOCKER";
  }
  if (blockerSummary && blockerSummary.has_watchdog_blocker) {
    return "WATCHDOG_BLOCKER";
  }
  return "MANUAL_REVIEW_REQUIRED";
}

const CONTEXT_SUBMIT_TRACE_FIELDS = Object.freeze({
  SUBMIT_CHK_01A: Object.freeze(["artifact_dir", "resolved_artifact_dir", "artifact_dir_coherence", "position_cycle_id"]),
  SUBMIT_CHK_06: Object.freeze(["recommended_next_action"]),
  SUBMIT_CHK_07: Object.freeze(["deploy_decision_summary.blocker_summary.blocker_n"]),
  SUBMIT_CHK_08: Object.freeze(["lineage_contract_hash", "deploy_decision_summary.bounded_runtime_summary.lineage_contract.hash", "lineage_consistency_summary"]),
  SUBMIT_CHK_20A: Object.freeze([
    "deploy_decision_summary.bounded_runtime_summary.production_entry_protected_canary",
    "deploy_decision_summary.blocker_summary.has_production_entry_protected_canary_blocker",
  ]),
});

function resolvePathOrNull(value) {
  const text = trimOrNull(value);
  return text ? path.resolve(text) : null;
}

function pathHasExactSegment(filePath, segment) {
  const resolved = resolvePathOrNull(filePath);
  const expected = trimOrNull(segment);
  if (!resolved || !expected) return false;
  return resolved.split(path.sep).includes(expected);
}

function buildLineageConsistencySummary({ deployDecisionSummary = null } = {}) {
  const summary = normalizeObject(deployDecisionSummary);
  const contextHash = trimOrNull(summary && summary.lineage_contract_hash);
  const deployHash = trimOrNull(
    summary
    && summary.bounded_runtime_summary
    && summary.bounded_runtime_summary.lineage_contract
    && summary.bounded_runtime_summary.lineage_contract.hash
  );
  const hashes = Object.freeze({
    cloudbuild_context: contextHash,
    deploy_decision_summary: deployHash,
  });
  const rows = [contextHash, deployHash].filter(Boolean);
  const ok = rows.length === 2 && rows.every((value) => value === rows[0]);
  let reason = "LINEAGE_CONSISTENT";
  if (rows.length < 2) reason = "LINEAGE_HASH_MISSING";
  else if (!ok) reason = "LINEAGE_HASH_MISMATCH";
  return Object.freeze({ ok, reason, hashes });
}

function buildArtifactDirCoherence({ plan = null, requestedDir = null, resolvedDir = null, deployDecisionSummary = null } = {}) {
  const row = normalizeObject(plan) || {};
  const artifactDir = trimOrNull(row.artifactDir);
  const resolvedArtifactDir = trimOrNull(resolvedDir) || artifactDir;
  const requestedArtifactDir = trimOrNull(requestedDir) || artifactDir;
  const positionCycleId = trimOrNull(row.positionCycleId);
  const deployDecisionPositionCycleId = trimOrNull(deployDecisionSummary && deployDecisionSummary.position_cycle_id);
  const promotionMode = upper(row.promotionMode);
  const positionCycleRequired = ["CANARY_FLOW", "PIPELINE"].includes(upper(row.mode))
    && ["CANARY", "LIVE"].includes(promotionMode);
  const artifactDirResolved = resolvePathOrNull(artifactDir);
  const resolvedArtifactDirResolved = resolvePathOrNull(resolvedArtifactDir);
  const artifactDirMatchesResolvedArtifactDir = !!(
    artifactDirResolved &&
    resolvedArtifactDirResolved &&
    artifactDirResolved === resolvedArtifactDirResolved
  );
  const artifactDirContainsPositionCycleId = !positionCycleRequired || !!(
    artifactDir &&
    positionCycleId &&
    pathHasExactSegment(artifactDir, positionCycleId)
  );
  const resolvedArtifactDirContainsPositionCycleId = !positionCycleRequired || !!(
    resolvedArtifactDir &&
    positionCycleId &&
    pathHasExactSegment(resolvedArtifactDir, positionCycleId)
  );
  const contextCycleMatchesDeployDecision = !deployDecisionPositionCycleId || deployDecisionPositionCycleId === positionCycleId;
  const positionCyclePresent = !positionCycleRequired || !!positionCycleId;
  const ok = !!(
    artifactDir &&
    resolvedArtifactDir &&
    positionCyclePresent &&
    artifactDirMatchesResolvedArtifactDir &&
    artifactDirContainsPositionCycleId &&
    resolvedArtifactDirContainsPositionCycleId &&
    contextCycleMatchesDeployDecision
  );
  let reason = "ARTIFACT_DIR_COHERENT";
  if (!artifactDir || !resolvedArtifactDir) reason = "ARTIFACT_DIR_MISSING";
  else if (!positionCyclePresent) reason = "POSITION_CYCLE_ID_MISSING";
  else if (!artifactDirMatchesResolvedArtifactDir) reason = "ARTIFACT_DIR_RESOLVED_DIR_MISMATCH";
  else if (!artifactDirContainsPositionCycleId || !resolvedArtifactDirContainsPositionCycleId) reason = "ARTIFACT_DIR_POSITION_CYCLE_MISMATCH";
  else if (!contextCycleMatchesDeployDecision) reason = "DEPLOY_DECISION_POSITION_CYCLE_MISMATCH";
  return Object.freeze({
    ok,
    reason,
    requested_artifact_dir: requestedArtifactDir,
    resolved_artifact_dir: resolvedArtifactDir,
    artifact_dir: artifactDir,
    position_cycle_id: positionCycleId,
    deploy_decision_position_cycle_id: deployDecisionPositionCycleId,
    position_cycle_required: positionCycleRequired,
    artifact_dir_matches_resolved_artifact_dir: artifactDirMatchesResolvedArtifactDir,
    artifact_dir_contains_position_cycle_id: artifactDirContainsPositionCycleId,
    resolved_artifact_dir_contains_position_cycle_id: resolvedArtifactDirContainsPositionCycleId,
    context_cycle_matches_deploy_decision: contextCycleMatchesDeployDecision,
  });
}

function hasArtifactDirCoherenceFailure(artifactDirCoherence = null) {
  const row = normalizeObject(artifactDirCoherence);
  return !!(row && row.ok !== true);
}

function buildContextRecommendedNextAction(summary, artifactDirCoherence = null) {
  if (hasArtifactDirCoherenceFailure(artifactDirCoherence)) {
    return "DISCARD_ARTIFACT_DIR_AND_RERUN_FROM_PREFLIGHT";
  }
  return buildRecommendedNextAction(summary);
}

function buildContextRecommendedNextActionReason(summary, artifactDirCoherence = null) {
  const row = normalizeObject(artifactDirCoherence);
  if (hasArtifactDirCoherenceFailure(row)) {
    return `artifact dir self-check failed: ${trimOrNull(row.reason) || "ARTIFACT_DIR_COHERENCE_FAILED"}`;
  }
  return buildRecommendedNextActionReason(summary);
}

function buildContextRecommendedNextActionReasonCode(summary, artifactDirCoherence = null) {
  if (hasArtifactDirCoherenceFailure(artifactDirCoherence)) {
    return "PROVENANCE_BLOCKER";
  }
  return buildRecommendedNextActionReasonCode(summary);
}

function buildContextBlockerFamilies(summary) {
  const row = normalizeObject(summary);
  if (!row) return Object.freeze([]);
  const families = [];
  if (row.has_provenance_blocker) families.push("PROVENANCE");
  if (row.has_stale_artifact_provenance_blocker) families.push("STALE_ARTIFACT_PROVENANCE");
  if (row.has_live_evidence_cycle_blocker) families.push("LIVE_EVIDENCE_CYCLE");
  if (row.has_candidate_selection_blocker) families.push("CANDIDATE_SELECTION");
  if (row.has_production_entry_protected_canary_blocker) families.push("PROTECTED_ENTRY_CANARY");
  if (row.has_bounded_runtime_blocker) families.push("BOUNDED_RUNTIME");
  if (row.has_entry_boundary_blocker) families.push("ENTRY_BOUNDARY");
  if (row.has_production_cutover_blocker) families.push("PRODUCTION_CUTOVER");
  if (row.has_watchdog_blocker) families.push("WATCHDOG");
  if (Number(row.blocker_n || 0) > 0 && families.length === 0) families.push("UNCLASSIFIED");
  return Object.freeze(families);
}

function collectContextDeployWarningRunbookChecklist(summary) {
  const row = normalizeObject(summary);
  const warningSummary = normalizeObject(row && row.warning_summary);
  if (!warningSummary) return Object.freeze([]);
  const refs = new Set();
  const topWarnings = Array.isArray(warningSummary.top_warnings)
    ? warningSummary.top_warnings.map((value) => trimOrNull(value)).filter(Boolean)
    : [];
  if (
    warningSummary.has_repair_firestore_canary_streak_warning === true
    || topWarnings.some((warning) => warning.includes("REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"))
  ) {
    refs.add("19");
  }
  if (
    warningSummary.has_production_entry_route_canary_streak_warning === true
    || topWarnings.some((warning) => warning.includes("PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"))
  ) {
    refs.add("26");
  }
  if (warningSummary.has_live_readiness_warning === true && refs.size === 0) {
    refs.add("19");
    refs.add("26");
  }
  return Object.freeze(Array.from(refs).sort((a, b) => Number(a) - Number(b)));
}

function buildContextSubmitTrace(summary, { artifactDirCoherence = null, lineageConsistencySummary = null } = {}) {
  const row = normalizeObject(summary);
  const artifactCoherenceOk = artifactDirCoherence && artifactDirCoherence.ok === true;
  if (!row) {
    const failedIds = Object.freeze(["SUBMIT_CHK_01A", "SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08"]);
    return Object.freeze({
      relevant_submit_check_ids: failedIds,
      relevant_runbook_checklist: submitTrace.collectRunbookChecklist(failedIds),
      failed_submit_check_ids: failedIds,
      failed_runbook_checklist: submitTrace.collectRunbookChecklist(failedIds),
      blocker_families: Object.freeze(["PROVENANCE"]),
      primary_blocker_family: "PROVENANCE",
      deploy_warning_attention_required: false,
      deploy_warning_summary: null,
      deploy_warning_runbook_checklist: Object.freeze([]),
      recommended_next_action_reason_code: "DEPLOY_DECISION_ARTIFACT_MISSING",
      checks: Object.freeze([
        Object.freeze({
          id: "SUBMIT_CHK_01A",
          ok: false,
          runbook_checklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_01A"),
          fields: CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_01A,
          reason: "cloudbuild context is missing so artifact dir coherence cannot be validated",
        }),
        Object.freeze({
          id: "SUBMIT_CHK_06",
          ok: false,
          runbook_checklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_06"),
          fields: CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_06,
          reason: "cloudbuild context is missing so next action cannot be validated",
        }),
        Object.freeze({
          id: "SUBMIT_CHK_07",
          ok: false,
          runbook_checklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_07"),
          fields: CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_07,
          reason: "cloudbuild context is missing so blocker summary cannot be validated",
        }),
        Object.freeze({
          id: "SUBMIT_CHK_08",
          ok: false,
          runbook_checklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_08"),
          fields: CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_08,
          reason: "cloudbuild context is missing so lineage hash cannot be validated",
        }),
      ]),
    });
  }

  const recommendedNextAction = buildContextRecommendedNextAction(row, artifactDirCoherence);
  const blockerSummary = normalizeObject(row.blocker_summary);
  const hasProtectedEntryCanaryBlocker = blockerSummary && blockerSummary.has_production_entry_protected_canary_blocker === true;
  const lineageConsistency = normalizeObject(lineageConsistencySummary)
    || buildLineageConsistencySummary({ deployDecisionSummary: row });
  const lineageOk = lineageConsistency && lineageConsistency.ok === true;
  const checks = [
    Object.freeze({
      id: "SUBMIT_CHK_01A",
      ok: artifactCoherenceOk,
      runbook_checklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_01A"),
      fields: CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_01A,
      reason: artifactCoherenceOk
        ? "cloudbuild artifact dir self-check is coherent"
        : `cloudbuild artifact dir self-check failed: ${trimOrNull(artifactDirCoherence && artifactDirCoherence.reason) || "ARTIFACT_DIR_COHERENCE_FAILED"}`,
    }),
    Object.freeze({
      id: "SUBMIT_CHK_06",
      ok: recommendedNextAction === "PROCEED_WITH_SUBMIT_WRAPPER",
      runbook_checklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_06"),
      fields: CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_06,
      reason: recommendedNextAction === "PROCEED_WITH_SUBMIT_WRAPPER"
        ? "cloudbuild context recommends submit wrapper"
        : "cloudbuild context does not recommend submit wrapper",
    }),
    Object.freeze({
      id: "SUBMIT_CHK_07",
      ok: Number(blockerSummary && blockerSummary.blocker_n) === 0,
      runbook_checklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_07"),
      fields: CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_07,
      reason: Number(blockerSummary && blockerSummary.blocker_n) === 0
        ? "cloudbuild blocker count is zero"
        : "cloudbuild blocker count is not zero",
    }),
    Object.freeze({
      id: "SUBMIT_CHK_08",
      ok: lineageOk,
      runbook_checklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_08"),
      fields: CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_08,
      reason: lineageOk
        ? "cloudbuild lineage hashes are consistent for bounded provenance trace"
        : `cloudbuild lineage consistency failed: ${trimOrNull(lineageConsistency && lineageConsistency.reason) || "LINEAGE_CONSISTENCY_FAILED"}`,
    }),
  ];
  if (hasProtectedEntryCanaryBlocker) {
    checks.push(Object.freeze({
      id: "SUBMIT_CHK_20A",
      ok: false,
      runbook_checklist: submitTrace.getRunbookChecklistForSubmitCheck("SUBMIT_CHK_20A"),
      fields: CONTEXT_SUBMIT_TRACE_FIELDS.SUBMIT_CHK_20A,
      reason: "cloudbuild deploy decision reports protected entry canary blocker",
    }));
  }
  const frozenChecks = Object.freeze(checks);
  const failedSubmitCheckIds = Object.freeze(
    frozenChecks.filter((entry) => entry.ok !== true).map((entry) => entry.id)
  );
  const blockerFamilies = buildContextBlockerFamilies(blockerSummary);
  const effectiveBlockerFamilies = failedSubmitCheckIds.includes("SUBMIT_CHK_01A") || failedSubmitCheckIds.includes("SUBMIT_CHK_08")
    ? Object.freeze(Array.from(new Set(["PROVENANCE", ...blockerFamilies])))
    : blockerFamilies;
  const primaryBlockerFamily = effectiveBlockerFamilies[0] || null;
  const warningSummary = normalizeObject(row.warning_summary);
  return Object.freeze({
    relevant_submit_check_ids: Object.freeze(frozenChecks.map((entry) => entry.id)),
    relevant_runbook_checklist: submitTrace.collectRunbookChecklist(frozenChecks.map((entry) => entry.id)),
    failed_submit_check_ids: failedSubmitCheckIds,
    failed_runbook_checklist: submitTrace.collectRunbookChecklist(failedSubmitCheckIds),
    blocker_families: effectiveBlockerFamilies,
    primary_blocker_family: primaryBlockerFamily,
    deploy_warning_attention_required: Number(warningSummary && warningSummary.warning_n || 0) > 0,
    deploy_warning_summary: warningSummary,
    deploy_warning_runbook_checklist: collectContextDeployWarningRunbookChecklist(row),
    lineage_consistency_summary: lineageConsistency,
    recommended_next_action_reason_code: buildContextRecommendedNextActionReasonCode(row, artifactDirCoherence),
    checks: frozenChecks,
  });
}

function resolveExecutionMode(env = process.env) {
  const enabledModes = [
    { key: "mock", enabled: isEnabled(env.V2_PROMOTION_MOCK_ARTIFACTS_ENABLED) },
    { key: "pipeline", enabled: isEnabled(env.V2_PROMOTION_PIPELINE_ENABLED) },
    { key: "gate", enabled: isEnabled(env.V2_PROMOTION_GATE_ENABLED) },
    { key: "canary_flow", enabled: isEnabled(env.V2_PROMOTION_CANARY_FLOW_ENABLED) },
  ].filter((row) => row.enabled);

  if (enabledModes.length === 0) return "OFF";
  if (enabledModes.length > 1) {
    const keys = enabledModes.map((row) => row.key).sort().join(",");
    throw new Error(`V2_PROMOTION_CLOUDBUILD_MODE_CONFLICT:${keys}`);
  }
  return enabledModes[0].key.toUpperCase();
}

function deriveArtifactDir({ env = process.env, mode, positionCycleId = null }) {
  const explicit = trimOrNull(env.V2_PROMOTION_ARTIFACT_DIR);
  if (!explicit) {
    if (!positionCycleId) throw new Error("V2_PROMOTION_CLOUDBUILD_ARTIFACT_DIR_REQUIRED");
    return path.resolve("tmp", "v2-promotion-artifacts", String(mode || "unknown").toLowerCase(), positionCycleId);
  }
  if (positionCycleId && !pathHasExactSegment(explicit, positionCycleId)) {
    throw new Error("V2_PROMOTION_CLOUDBUILD_ARTIFACT_DIR_POSITION_CYCLE_MISMATCH");
  }
  return path.resolve(explicit);
}

function buildCloudBuildPlan(env = process.env) {
  const mode = resolveExecutionMode(env);
  if (mode === "OFF") {
    return Object.freeze({
      mode,
      script: null,
      artifactDir: null,
      positionCycleId: null,
      promotionMode: upper(env.V2_PROMOTION_MODE) || null,
      effectiveEnv: { ...env },
    });
  }

  const promotionMode = upper(env.V2_PROMOTION_MODE) || "CANARY";
  const positionCycleId = trimOrNull(env.V2_PROMOTION_SELECT_POSITION_CYCLE_ID);
  const canaryAutoSelectEnabled = isEnabled(env.V2_PROMOTION_CANARY_AUTO_SELECT_ENABLED);

  if (mode === "CANARY_FLOW") {
    if (!["CANARY", "LIVE"].includes(promotionMode)) {
      throw new Error("V2_PROMOTION_CLOUDBUILD_CANARY_FLOW_MODE_INVALID");
    }
    if (!positionCycleId && !canaryAutoSelectEnabled) {
      throw new Error("V2_PROMOTION_CLOUDBUILD_POSITION_CYCLE_ID_REQUIRED");
    }
  }

  if (mode === "PIPELINE" && ["CANARY", "LIVE"].includes(promotionMode) && !positionCycleId) {
    throw new Error("V2_PROMOTION_CLOUDBUILD_BOUNDED_PIPELINE_POSITION_CYCLE_ID_REQUIRED");
  }
  const requiresOpenClawExecutionAuditLedgerWrite = ["CANARY_FLOW", "PIPELINE"].includes(mode)
    && ["CANARY", "LIVE"].includes(promotionMode);

  const artifactDir = deriveArtifactDir({
    env,
    mode,
    positionCycleId: ["CANARY_FLOW", "PIPELINE"].includes(mode) ? positionCycleId : null,
  });

  const effectiveEnv = {
    ...env,
    V2_PROMOTION_ARTIFACT_DIR: artifactDir,
    ...(requiresOpenClawExecutionAuditLedgerWrite
      ? { DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED: "1" }
      : {}),
  };

  let script = null;
  if (mode === "MOCK") script = "generate:v2-promotion-artifacts:mock";
  if (mode === "PIPELINE") script = "run:v2-promotion-pipeline";
  if (mode === "GATE") script = "check:v2-promotion-gate";
  if (mode === "CANARY_FLOW") script = "run:v2-promotion-canary-flow";

  return Object.freeze({
    mode,
    script,
    artifactDir,
    positionCycleId,
    canaryAutoSelectEnabled,
    promotionMode,
    effectiveEnv,
  });
}

function buildDeployDecisionSummary(deployDecision) {
  const row = normalizeObject(deployDecision);
  if (!row) return null;
  const boundedRuntimeSummary = normalizeObject(row.bounded_runtime_summary);
  const candidateSelectionSummary = normalizeObject(row.candidate_selection_summary);
  const alertRetrySummary = summarizeAlertRetry(
    normalizeObject(row.alert_retry_summary)
    || normalizeObject(boundedRuntimeSummary && boundedRuntimeSummary.alert_retry_summary)
  );
  return Object.freeze({
    approved: row.approved === true,
    decision: trimOrNull(row.decision),
    position_cycle_id: trimOrNull(row.position_cycle_id),
    lineage_contract_hash: boundedRuntimeSummary && normalizeObject(boundedRuntimeSummary.lineage_contract)
      ? trimOrNull(boundedRuntimeSummary.lineage_contract.hash)
      : null,
    blocker_n: Array.isArray(row.blockers) ? row.blockers.length : 0,
    warning_n: Array.isArray(row.warnings) ? row.warnings.length : 0,
    blocker_summary: summarizeBlockers(row.blockers),
    warning_summary: summarizeWarnings(row.warnings),
    alert_retry_attention_required: hasAlertRetryAttention(alertRetrySummary),
    alert_retry_summary: alertRetrySummary,
    bounded_runtime_summary: boundedRuntimeSummary ? Object.freeze({
      selector_query_budget: normalizeObject(boundedRuntimeSummary.selector_query_budget),
      collector_query_budget: normalizeObject(boundedRuntimeSummary.collector_query_budget),
      exporter_snapshot_size_bytes: Number.isFinite(Number(boundedRuntimeSummary.exporter_snapshot_size_bytes))
        ? Number(boundedRuntimeSummary.exporter_snapshot_size_bytes)
        : null,
      manifest_counts: normalizeObject(boundedRuntimeSummary.manifest_counts),
      lineage_contract: normalizeObject(boundedRuntimeSummary.lineage_contract) ? Object.freeze({
        version: trimOrNull(boundedRuntimeSummary.lineage_contract.version),
        hash: trimOrNull(boundedRuntimeSummary.lineage_contract.hash),
      }) : null,
      evidence_snapshot_summary: normalizeObject(boundedRuntimeSummary.evidence_snapshot_summary) ? Object.freeze({
        ok: boundedRuntimeSummary.evidence_snapshot_summary.ok === true,
        transition_n: Number.isFinite(Number(boundedRuntimeSummary.evidence_snapshot_summary.transition_n))
          ? Number(boundedRuntimeSummary.evidence_snapshot_summary.transition_n)
          : null,
        transition_evidence_n: Number.isFinite(Number(boundedRuntimeSummary.evidence_snapshot_summary.transition_evidence_n))
          ? Number(boundedRuntimeSummary.evidence_snapshot_summary.transition_evidence_n)
          : null,
        missing_transition_evidence_n: Number.isFinite(Number(boundedRuntimeSummary.evidence_snapshot_summary.missing_transition_evidence_n))
          ? Number(boundedRuntimeSummary.evidence_snapshot_summary.missing_transition_evidence_n)
          : null,
        protection_runtime_n: Number.isFinite(Number(boundedRuntimeSummary.evidence_snapshot_summary.protection_runtime_n))
          ? Number(boundedRuntimeSummary.evidence_snapshot_summary.protection_runtime_n)
          : null,
        protection_runtime_evidence_n: Number.isFinite(Number(boundedRuntimeSummary.evidence_snapshot_summary.protection_runtime_evidence_n))
          ? Number(boundedRuntimeSummary.evidence_snapshot_summary.protection_runtime_evidence_n)
          : null,
        missing_protection_runtime_evidence_n: Number.isFinite(Number(boundedRuntimeSummary.evidence_snapshot_summary.missing_protection_runtime_evidence_n))
          ? Number(boundedRuntimeSummary.evidence_snapshot_summary.missing_protection_runtime_evidence_n)
          : null,
      }) : null,
      alert_retry_summary: alertRetrySummary,
      repair_evidence_summary: normalizeObject(boundedRuntimeSummary.repair_evidence_summary),
      openclaw_execution_audit_ledger_write: normalizeObject(boundedRuntimeSummary.openclaw_execution_audit_ledger_write),
      repair_firestore_canary_streak: normalizeObject(boundedRuntimeSummary.repair_firestore_canary_streak),
      production_entry_route_canary_streak: normalizeObject(boundedRuntimeSummary.production_entry_route_canary_streak),
      exit_runtime_canary_streak: normalizeObject(boundedRuntimeSummary.exit_runtime_canary_streak),
    }) : null,
    candidate_selection_summary: candidateSelectionSummary ? Object.freeze({
      ok: candidateSelectionSummary.ok === true,
      selection_status: trimOrNull(candidateSelectionSummary.selection_status),
      selected_position_cycle_id: trimOrNull(candidateSelectionSummary.selected_position_cycle_id),
      recent_active_position_cycle_n: Number.isFinite(Number(candidateSelectionSummary.recent_active_position_cycle_n))
        ? Number(candidateSelectionSummary.recent_active_position_cycle_n)
        : null,
      selection_contract: normalizeObject(candidateSelectionSummary.selection_contract) ? Object.freeze({
        ok: candidateSelectionSummary.selection_contract.ok === true,
        scan_limit_respected: candidateSelectionSummary.selection_contract.scan_limit_respected === true,
        recent_window_enforced: candidateSelectionSummary.selection_contract.recent_window_enforced === true,
        selected_candidate_present: candidateSelectionSummary.selection_contract.selected_candidate_present === true,
        selected_preflight_ok: candidateSelectionSummary.selection_contract.selected_preflight_ok === true,
        selected_runtime_chain_ok: candidateSelectionSummary.selection_contract.selected_runtime_chain_ok === true,
        selected_cycle_matches_preflight: candidateSelectionSummary.selection_contract.selected_cycle_matches_preflight === true,
        selected_cycle_matches_collector_env: candidateSelectionSummary.selection_contract.selected_cycle_matches_collector_env === true,
        selected_snapshot_counts_exact: candidateSelectionSummary.selection_contract.selected_snapshot_counts_exact === true,
      }) : null,
    }) : null,
  });
}

function buildLiveCutoverReadinessSummary(readiness, { artifactDir = null, filePath = null } = {}) {
  const row = normalizeObject(readiness);
  if (!row) return null;
  return Object.freeze({
    ok: row.ok === true,
    reason: trimOrNull(row.reason),
    auto_apply: row.auto_apply === true,
    mutates_environment: row.mutates_environment === true,
    recommended_next_action: trimOrNull(row.recommended_next_action),
    blocker_n: Array.isArray(row.blockers) ? row.blockers.length : 0,
    required_env_change_n: Array.isArray(row.required_env_changes) ? row.required_env_changes.length : 0,
    submit_check_ids: Array.isArray(row.submit_check_ids) ? row.submit_check_ids.slice() : [],
    runbook_checklist: Array.isArray(row.runbook_checklist) ? row.runbook_checklist.slice() : [],
    file: trimOrNull(filePath) || trimOrNull(row.artifact_file),
    ...buildArtifactProvenance({
      artifactDir,
      filePath: trimOrNull(filePath) || trimOrNull(row.artifact_file),
      expectedFilename: LIVE_CUTOVER_READINESS_FILENAME,
      generatedAt: trimOrNull(row.generated_at) || trimOrNull(row.artifact_generated_at),
    }),
  });
}

function buildProductionCutoverReadinessSummary(readiness, { artifactDir = null, filePath = null } = {}) {
  const row = normalizeObject(readiness);
  if (!row) return null;
  const guard = normalizeObject(row.guard);
  const context = normalizeObject(guard && guard.context);
  return Object.freeze({
    ok: row.ok === true,
    reason: trimOrNull(row.reason),
    blocker_n: Number.isFinite(Number(row.fail_n)) ? Number(row.fail_n) : 0,
    failed_check_ids: Array.isArray(row.failed_check_ids) ? row.failed_check_ids.slice() : [],
    guard_allowed: guard ? guard.allowed === true : null,
    guard_reason: trimOrNull(guard && guard.reason),
    legacy_webhook_blocked: guard ? guard.allowed === false && trimOrNull(guard.reason) === "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED" : false,
    v2_enabled: context ? context.v2_enabled === true : false,
    v2_dry_run: context ? context.v2_dry_run === true : null,
    v2_canary_only: context ? context.v2_canary_only === true : null,
    production_entry_live_endpoint_enabled: row.checks
      ? row.checks.some((check) => check && check.id === "V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED" && check.ok === true)
      : false,
    require_production_cutover: context ? context.require_production_cutover === true : false,
    block_legacy_webhook_signal: context ? context.block_legacy_webhook_signal === true : false,
    allow_legacy_webhook_signal: context ? context.allow_legacy_webhook_signal === true : false,
    file: trimOrNull(filePath) || trimOrNull(row.artifact_file),
    ...buildArtifactProvenance({
      artifactDir,
      filePath: trimOrNull(filePath) || trimOrNull(row.artifact_file),
      expectedFilename: PRODUCTION_CUTOVER_READINESS_FILENAME,
      generatedAt: trimOrNull(row.generated_at) || trimOrNull(row.artifact_generated_at),
    }),
  });
}

function buildSchedulerTrafficCutoverReadinessSummary(readiness, { artifactDir = null, filePath = null } = {}) {
  const row = normalizeObject(readiness);
  if (!row) return null;
  return Object.freeze({
    ok: row.ok === true,
    reason: trimOrNull(row.reason),
    blocker_n: Number.isFinite(Number(row.fail_n)) ? Number(row.fail_n) : 0,
    failed_check_ids: Array.isArray(row.failed_check_ids) ? row.failed_check_ids.slice() : [],
    scheduler_sot: trimOrNull(row.scheduler_sot),
    required_openclaw_job_ids: Array.isArray(row.required_openclaw_job_ids) ? row.required_openclaw_job_ids.slice() : [],
    missing_openclaw_job_ids: Array.isArray(row.missing_openclaw_job_ids) ? row.missing_openclaw_job_ids.slice() : [],
    active_legacy_scheduler_job_n: Array.isArray(row.active_legacy_scheduler_jobs) ? row.active_legacy_scheduler_jobs.length : 0,
    openclaw_cloud_scheduler_jobs: Array.isArray(row.openclaw_cloud_scheduler_jobs) ? row.openclaw_cloud_scheduler_jobs.slice() : [],
    cloud_run_services: Array.isArray(row.cloud_run_services) ? row.cloud_run_services.slice() : [],
    file: trimOrNull(filePath) || trimOrNull(row.artifact_file),
    ...buildArtifactProvenance({
      artifactDir,
      filePath: trimOrNull(filePath) || trimOrNull(row.artifact_file),
      expectedFilename: SCHEDULER_TRAFFIC_CUTOVER_READINESS_FILENAME,
      generatedAt: trimOrNull(row.generated_at) || trimOrNull(row.artifact_generated_at),
    }),
  });
}

function buildSchedulerTrafficCollectorPreflightSummary(preflight, { artifactDir = null, filePath = null } = {}) {
  const row = normalizeObject(preflight);
  if (!row) return null;
  return Object.freeze({
    ok: row.ok === true,
    reason: trimOrNull(row.reason),
    blocker_n: Number.isFinite(Number(row.fail_n)) ? Number(row.fail_n) : 0,
    failed_check_ids: Array.isArray(row.failed_check_ids) ? row.failed_check_ids.slice() : [],
    project_id: trimOrNull(row.project_id),
    region: trimOrNull(row.region),
    service_names: Array.isArray(row.service_names) ? row.service_names.slice() : [],
    scheduler_job_n: Number.isFinite(Number(row.scheduler_job_n)) ? Number(row.scheduler_job_n) : null,
    file: trimOrNull(filePath),
    ...buildArtifactProvenance({
      artifactDir,
      filePath: trimOrNull(filePath) || trimOrNull(row.artifact_file),
      expectedFilename: SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_FILENAME,
      generatedAt: trimOrNull(row.generated_at) || trimOrNull(row.artifact_generated_at),
    }),
  });
}

function buildRunbookReviewSummary(review, filePath = null) {
  const row = normalizeObject(review);
  if (!row) return null;
  const checks = Array.isArray(row.checks) ? row.checks : [];
  const failedChecks = checks.filter((check) => trimOrNull(check && check.status) === "FAIL");
  return Object.freeze({
    ok: row.ok === true,
    overall_status: trimOrNull(row.overall_status),
    check_n: Number.isFinite(Number(row.check_n)) ? Number(row.check_n) : checks.length,
    pass_n: Number.isFinite(Number(row.pass_n)) ? Number(row.pass_n) : checks.filter((check) => trimOrNull(check && check.status) === "PASS").length,
    fail_n: Number.isFinite(Number(row.fail_n)) ? Number(row.fail_n) : failedChecks.length,
    skip_n: Number.isFinite(Number(row.skip_n)) ? Number(row.skip_n) : checks.filter((check) => trimOrNull(check && check.status) === "SKIP").length,
    failed_check_ids: failedChecks.map((check) => trimOrNull(check && check.id)).filter(Boolean),
    top_failed_checks: failedChecks.slice(0, 3).map((check) => Object.freeze({
      id: trimOrNull(check && check.id),
      label: trimOrNull(check && check.label),
      reason: trimOrNull(check && check.reason),
      file: trimOrNull(check && check.file),
      field: trimOrNull(check && check.field),
    })),
    expected_position_cycle_id: trimOrNull(row.expected_position_cycle_id),
    file: trimOrNull(filePath),
  });
}

function writeContextArtifact(plan, {
  deployDecision = null,
  requestedArtifactDir = null,
  resolvedArtifactDir = null,
  liveCutoverReadiness = null,
  liveCutoverReadinessFile = null,
  productionCutoverReadiness = null,
  productionCutoverReadinessFile = null,
  schedulerTrafficCollectorPreflight = null,
  schedulerTrafficCollectorPreflightFile = null,
  schedulerTrafficCutoverReadiness = null,
  schedulerTrafficCutoverReadinessFile = null,
  runbookReview = null,
  runbookReviewFile = null,
} = {}) {
  if (!plan || !plan.artifactDir) return null;
  ensureDir(plan.artifactDir);
  const filePath = path.join(plan.artifactDir, OUTPUT_FILENAME);
  const deployDecisionSummary = buildDeployDecisionSummary(deployDecision);
  const liveCutoverReadinessSummary = buildLiveCutoverReadinessSummary(liveCutoverReadiness, {
    artifactDir: plan.artifactDir,
    filePath: liveCutoverReadinessFile,
  });
  const productionCutoverReadinessSummary = buildProductionCutoverReadinessSummary(productionCutoverReadiness, {
    artifactDir: plan.artifactDir,
    filePath: productionCutoverReadinessFile,
  });
  const schedulerTrafficCollectorPreflightSummary = buildSchedulerTrafficCollectorPreflightSummary(
    schedulerTrafficCollectorPreflight,
    {
      artifactDir: plan.artifactDir,
      filePath: schedulerTrafficCollectorPreflightFile,
    }
  );
  const schedulerTrafficCutoverReadinessSummary = buildSchedulerTrafficCutoverReadinessSummary(schedulerTrafficCutoverReadiness, {
    artifactDir: plan.artifactDir,
    filePath: schedulerTrafficCutoverReadinessFile,
  });
  const runbookReviewSummary = buildRunbookReviewSummary(runbookReview, runbookReviewFile);
  const requestedDir = trimOrNull(requestedArtifactDir) || plan.artifactDir;
  const resolvedDir = trimOrNull(resolvedArtifactDir) || plan.artifactDir;
  const artifactDirCoherence = buildArtifactDirCoherence({
    plan,
    requestedDir,
    resolvedDir,
    deployDecisionSummary,
  });
  const lineageConsistencySummary = buildLineageConsistencySummary({ deployDecisionSummary });
  const contextSubmitTrace = buildContextSubmitTrace(deployDecisionSummary, {
    artifactDirCoherence,
    lineageConsistencySummary,
  });
  writeJson(filePath, {
    mode: plan.mode,
    promotion_mode: plan.promotionMode,
    position_cycle_id: plan.positionCycleId,
    lineage_contract_hash: trimOrNull(deployDecisionSummary && deployDecisionSummary.lineage_contract_hash),
    requested_artifact_dir: requestedDir,
    resolved_artifact_dir: resolvedDir,
    artifact_dir: plan.artifactDir,
    artifact_dir_coherence: artifactDirCoherence,
    lineage_consistency_summary: lineageConsistencySummary,
    script: plan.script,
    generated_at: new Date().toISOString(),
    final_status_line: buildStatusLine(deployDecisionSummary),
    recommended_next_action: buildContextRecommendedNextAction(deployDecisionSummary, artifactDirCoherence),
    recommended_next_action_reason: buildContextRecommendedNextActionReason(deployDecisionSummary, artifactDirCoherence),
    recommended_next_action_reason_code: buildContextRecommendedNextActionReasonCode(deployDecisionSummary, artifactDirCoherence),
    submit_trace: contextSubmitTrace,
    live_cutover_readiness_file: trimOrNull(liveCutoverReadinessFile),
    live_cutover_readiness_summary: liveCutoverReadinessSummary,
    production_cutover_readiness_file: trimOrNull(productionCutoverReadinessFile),
    production_cutover_readiness_summary: productionCutoverReadinessSummary,
    scheduler_traffic_collector_preflight_file: trimOrNull(schedulerTrafficCollectorPreflightFile),
    scheduler_traffic_collector_preflight_summary: schedulerTrafficCollectorPreflightSummary,
    scheduler_traffic_cutover_readiness_file: trimOrNull(schedulerTrafficCutoverReadinessFile),
    scheduler_traffic_cutover_readiness_summary: schedulerTrafficCutoverReadinessSummary,
    runbook_review_file: trimOrNull(runbookReviewFile),
    runbook_review_summary: runbookReviewSummary,
    deploy_decision_summary: deployDecisionSummary,
  });
  return filePath;
}

function isSchedulerTrafficReadinessError(error) {
  const reason = trimOrNull(error && error.message);
  return reason === "V2_PROMOTION_CLOUDBUILD_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_BLOCKED" ||
    reason === "V2_PROMOTION_CLOUDBUILD_SCHEDULER_TRAFFIC_CUTOVER_READINESS_BLOCKED";
}

function writeSchedulerTrafficFailureContext(plan, {
  deployDecision = null,
  requestedArtifactDir = null,
  resolvedArtifactDir = null,
  liveCutover = null,
  productionCutover = null,
  schedulerTrafficError = null,
} = {}) {
  return writePromotionReadinessFailureContext(plan, {
    deployDecision,
    requestedArtifactDir,
    resolvedArtifactDir,
    liveCutover,
    productionCutover,
    schedulerTrafficError,
  });
}

function isLiveCutoverReadinessError(error) {
  return trimOrNull(error && error.message) === "V2_PROMOTION_CLOUDBUILD_LIVE_CUTOVER_READINESS_BLOCKED";
}

function isProductionCutoverReadinessError(error) {
  return trimOrNull(error && error.message) === "V2_PROMOTION_CLOUDBUILD_PRODUCTION_CUTOVER_READINESS_BLOCKED";
}

function isRunbookReviewError(error) {
  const reason = trimOrNull(error && error.message);
  return reason === "V2_PROMOTION_CLOUDBUILD_RUNBOOK_REVIEW_BLOCKED" ||
    reason === "V2_PROMOTION_CLOUDBUILD_RUNBOOK_REVIEW_THROWN";
}

function buildThrownRunbookReview({ plan = null, expectedPositionCycleId = null, cause = null } = {}) {
  const causeMessage = trimOrNull(cause && cause.message) || String(cause || "unknown runbook review error");
  const artifactDir = trimOrNull(plan && plan.artifactDir);
  return Object.freeze({
    ok: false,
    overall_status: "FAIL",
    artifact_dir: artifactDir,
    expected_position_cycle_id: trimOrNull(expectedPositionCycleId),
    check_n: 1,
    pass_n: 0,
    fail_n: 1,
    skip_n: 0,
    checks: Object.freeze([
      Object.freeze({
        id: "CHK_RUNBOOK_REVIEW_THROWN",
        label: "runbook review generated a structured failure",
        status: "FAIL",
        reason: causeMessage,
        file: artifactDir,
        field: "promotion-runbook-review",
      }),
    ]),
  });
}

function writePromotionReadinessFailureContext(plan, {
  deployDecision = null,
  requestedArtifactDir = null,
  resolvedArtifactDir = null,
  liveCutover = null,
  productionCutover = null,
  liveCutoverError = null,
  productionCutoverError = null,
  schedulerTrafficError = null,
} = {}) {
  const liveError = liveCutoverError && typeof liveCutoverError === "object"
    ? liveCutoverError
    : {};
  const productionError = productionCutoverError && typeof productionCutoverError === "object"
    ? productionCutoverError
    : {};
  const error = schedulerTrafficError && typeof schedulerTrafficError === "object"
    ? schedulerTrafficError
    : {};
  return writeContextArtifact(plan, {
    deployDecision,
    requestedArtifactDir,
    resolvedArtifactDir,
    liveCutoverReadiness: liveError.live_cutover_readiness || (liveCutover && liveCutover.report) || null,
    liveCutoverReadinessFile: liveError.live_cutover_readiness_file || (liveCutover && liveCutover.output_file) || null,
    productionCutoverReadiness: productionError.production_cutover_readiness || (productionCutover && productionCutover.report) || null,
    productionCutoverReadinessFile: productionError.production_cutover_readiness_file || (productionCutover && productionCutover.output_file) || null,
    schedulerTrafficCollectorPreflight: error.scheduler_traffic_collector_preflight || error.collector_preflight || null,
    schedulerTrafficCollectorPreflightFile: error.scheduler_traffic_collector_preflight_file || error.collector_preflight_file || null,
    schedulerTrafficCutoverReadiness: error.scheduler_traffic_cutover_readiness || null,
    schedulerTrafficCutoverReadinessFile: error.scheduler_traffic_cutover_readiness_file || null,
  });
}

function writeRunbookReviewContext(plan, {
  deployDecision = null,
  requestedArtifactDir = null,
  resolvedArtifactDir = null,
  liveCutover = null,
  productionCutover = null,
  schedulerTrafficCutover = null,
  runbookReview = null,
  runbookReviewFile = null,
} = {}) {
  return writeContextArtifact(plan, {
    deployDecision,
    requestedArtifactDir,
    resolvedArtifactDir,
    liveCutoverReadiness: liveCutover && liveCutover.report,
    liveCutoverReadinessFile: liveCutover && liveCutover.output_file,
    productionCutoverReadiness: productionCutover && productionCutover.report,
    productionCutoverReadinessFile: productionCutover && productionCutover.output_file,
    schedulerTrafficCollectorPreflight: schedulerTrafficCutover && schedulerTrafficCutover.collector_preflight,
    schedulerTrafficCollectorPreflightFile: schedulerTrafficCutover && schedulerTrafficCutover.collector_preflight_file,
    schedulerTrafficCutoverReadiness: schedulerTrafficCutover && schedulerTrafficCutover.report,
    schedulerTrafficCutoverReadinessFile: schedulerTrafficCutover && schedulerTrafficCutover.output_file,
    runbookReview,
    runbookReviewFile,
  });
}

function readDeployDecisionArtifact(artifactDir) {
  const dir = trimOrNull(artifactDir);
  if (!dir) return null;
  const filePath = path.join(dir, DEPLOY_DECISION_FILENAME);
  if (!fs.existsSync(filePath)) return null;
  return readJsonFile(filePath);
}

function readCanaryFlowArtifact(artifactDir) {
  const dir = trimOrNull(artifactDir);
  if (!dir) return null;
  const filePath = path.join(dir, CANARY_FLOW_FILENAME);
  if (!fs.existsSync(filePath)) return null;
  return readJsonFile(filePath);
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function shouldRequireDeployApproval(plan) {
  const row = plan && typeof plan === "object" ? plan : {};
  return ["CANARY_FLOW", "PIPELINE"].includes(row.mode) && ["CANARY", "LIVE"].includes(row.promotionMode);
}

function validateDeployApproval(plan, deployDecision) {
  if (!shouldRequireDeployApproval(plan)) {
    return Object.freeze({
      required: false,
      approved: null,
      blockers: [],
    });
  }
  const row = deployDecision && typeof deployDecision === "object" ? deployDecision : null;
  if (!row) {
    return Object.freeze({
      required: true,
      approved: false,
      blockers: ["V2_PROMOTION_CLOUDBUILD_DEPLOY_DECISION_REQUIRED"],
    });
  }
  const blockers = [];
  if (row.approved !== true) {
    blockers.push("V2_PROMOTION_CLOUDBUILD_DEPLOY_DECISION_NOT_APPROVED");
  }
  const planCycleId = trimOrNull(plan.positionCycleId);
  const decisionCycleId = trimOrNull(row.position_cycle_id);
  if (!decisionCycleId) {
    blockers.push("V2_PROMOTION_CLOUDBUILD_DEPLOY_DECISION_POSITION_CYCLE_REQUIRED");
  }
  if (planCycleId && decisionCycleId && decisionCycleId !== planCycleId) {
    blockers.push("V2_PROMOTION_CLOUDBUILD_DEPLOY_DECISION_POSITION_CYCLE_MISMATCH");
  }
  return Object.freeze({
    required: true,
    approved: blockers.length === 0,
    blockers,
    decision: row,
  });
}

function shouldRunCanaryRunbookReview(plan, deployApproval) {
  const row = plan && typeof plan === "object" ? plan : {};
  const approval = deployApproval && typeof deployApproval === "object" ? deployApproval : {};
  if (!approval.required || approval.approved !== true) return false;
  const artifactDir = trimOrNull(row.artifactDir);
  const decisionCycleId = trimOrNull(approval.decision && approval.decision.position_cycle_id);
  if (!artifactDir || !decisionCycleId) return false;
  return pathHasExactSegment(artifactDir, decisionCycleId);
}

function runCanaryRunbookReview(plan, deployApproval) {
  if (!shouldRunCanaryRunbookReview(plan, deployApproval)) {
    return Object.freeze({
      required: false,
      skipped: true,
      reason: "RUNBOOK_REVIEW_SKIPPED_UNBOUNDED_OR_NOT_APPROVED",
      review: null,
      output_file: null,
    });
  }
  const decisionCycleId = trimOrNull(deployApproval && deployApproval.decision && deployApproval.decision.position_cycle_id);
  const expectedPositionCycleId = decisionCycleId || trimOrNull(plan.positionCycleId);
  let result = null;
  try {
    result = runbookCheck.runCanaryRunbookCheck({
      ...plan.effectiveEnv,
      V2_PROMOTION_ARTIFACT_DIR: plan.artifactDir,
      V2_PROMOTION_EXPECT_POSITION_CYCLE_ID: expectedPositionCycleId,
    });
  } catch (cause) {
    const review = buildThrownRunbookReview({ plan, expectedPositionCycleId, cause });
    const error = new Error("V2_PROMOTION_CLOUDBUILD_RUNBOOK_REVIEW_THROWN");
    error.details = review;
    error.runbook_review = review;
    error.runbook_review_file = null;
    error.cause = cause;
    throw error;
  }
  if (!result.review || result.review.ok !== true) {
    const error = new Error("V2_PROMOTION_CLOUDBUILD_RUNBOOK_REVIEW_BLOCKED");
    error.details = result.review || null;
    error.runbook_review = result.review || null;
    error.runbook_review_file = result.outputFile || null;
    throw error;
  }
  return Object.freeze({
    required: true,
    skipped: false,
    reason: "RUNBOOK_REVIEW_PASS",
    review: result.review,
    output_file: result.outputFile,
  });
}

function shouldGenerateLiveCutoverReadiness(plan, deployApproval) {
  const row = plan && typeof plan === "object" ? plan : {};
  const approval = deployApproval && typeof deployApproval === "object" ? deployApproval : {};
  return !!(
    ["CANARY_FLOW", "PIPELINE"].includes(row.mode) &&
    row.promotionMode === "LIVE" &&
    approval.required === true &&
    approval.approved === true
  );
}

function generateLiveCutoverReadiness(plan, deployApproval) {
  if (!shouldGenerateLiveCutoverReadiness(plan, deployApproval)) {
    return Object.freeze({
      required: false,
      skipped: true,
      reason: "LIVE_CUTOVER_READINESS_SKIPPED",
      report: null,
      output_file: null,
    });
  }
  const outputFile = path.join(plan.artifactDir, LIVE_CUTOVER_READINESS_FILENAME);
  const env = {
    ...plan.effectiveEnv,
    V2_PROMOTION_ARTIFACT_DIR: plan.artifactDir,
    DONBEOLJA_V2_REPAIR_LIVE_CUTOVER_ARTIFACT_DIR: plan.artifactDir,
    DONBEOLJA_V2_REPAIR_LIVE_CUTOVER_READINESS_FILE: outputFile,
  };
  const report = liveCutoverReadiness.runCheck(env);
  const reportWithProvenance = report ? Object.freeze({
    ...report,
    ...buildArtifactProvenance({
      artifactDir: plan.artifactDir,
      filePath: outputFile,
      expectedFilename: LIVE_CUTOVER_READINESS_FILENAME,
      generatedAt: trimOrNull(report.generated_at) || new Date().toISOString(),
    }),
  }) : report;
  const writtenFile = liveCutoverReadiness.writeReadinessArtifact(env, reportWithProvenance);
  if (!reportWithProvenance || reportWithProvenance.ok !== true) {
    const error = new Error("V2_PROMOTION_CLOUDBUILD_LIVE_CUTOVER_READINESS_BLOCKED");
    error.details = reportWithProvenance || null;
    error.live_cutover_readiness = reportWithProvenance || null;
    error.live_cutover_readiness_file = writtenFile || outputFile;
    throw error;
  }
  return Object.freeze({
    required: true,
    skipped: false,
    reason: "LIVE_CUTOVER_READINESS_PASS",
    report: reportWithProvenance,
    output_file: writtenFile,
  });
}

function shouldGenerateProductionCutoverReadiness(plan, deployApproval) {
  const row = plan && typeof plan === "object" ? plan : {};
  const approval = deployApproval && typeof deployApproval === "object" ? deployApproval : {};
  return !!(
    ["CANARY_FLOW", "PIPELINE"].includes(row.mode) &&
    row.promotionMode === "LIVE" &&
    approval.required === true &&
    approval.approved === true
  );
}

function generateProductionCutoverReadiness(plan, deployApproval) {
  if (!shouldGenerateProductionCutoverReadiness(plan, deployApproval)) {
    return Object.freeze({
      required: false,
      skipped: true,
      reason: "PRODUCTION_CUTOVER_READINESS_SKIPPED",
      report: null,
      output_file: null,
    });
  }
  const outputFile = path.join(plan.artifactDir, PRODUCTION_CUTOVER_READINESS_FILENAME);
  const report = auditV2ProductionCutoverReadiness({
    ...plan.effectiveEnv,
    DONBEOLJA_V2_PRODUCTION_CUTOVER_READINESS_CHECK: "1",
  });
  const generatedAt = new Date().toISOString();
  const reportWithProvenance = report ? Object.freeze({
    ...report,
    ...buildArtifactProvenance({
      artifactDir: plan.artifactDir,
      filePath: outputFile,
      expectedFilename: PRODUCTION_CUTOVER_READINESS_FILENAME,
      generatedAt,
    }),
  }) : report;
  writeJson(outputFile, reportWithProvenance);
  if (!reportWithProvenance || reportWithProvenance.ok !== true) {
    const error = new Error("V2_PROMOTION_CLOUDBUILD_PRODUCTION_CUTOVER_READINESS_BLOCKED");
    error.details = reportWithProvenance || null;
    error.production_cutover_readiness = reportWithProvenance || null;
    error.production_cutover_readiness_file = outputFile;
    throw error;
  }
  return Object.freeze({
    required: true,
    skipped: false,
    reason: "PRODUCTION_CUTOVER_READINESS_PASS",
    report: reportWithProvenance,
    output_file: outputFile,
  });
}

function shouldGenerateSchedulerTrafficCutoverReadiness(plan, deployApproval) {
  const row = plan && typeof plan === "object" ? plan : {};
  const approval = deployApproval && typeof deployApproval === "object" ? deployApproval : {};
  return !!(
    ["CANARY_FLOW", "PIPELINE"].includes(row.mode) &&
    row.promotionMode === "LIVE" &&
    approval.required === true &&
    approval.approved === true
  );
}

function generateSchedulerTrafficCutoverReadiness(plan, deployApproval) {
  if (!shouldGenerateSchedulerTrafficCutoverReadiness(plan, deployApproval)) {
    return Object.freeze({
      required: false,
      skipped: true,
      reason: "SCHEDULER_TRAFFIC_CUTOVER_READINESS_SKIPPED",
      report: null,
      output_file: null,
    });
  }
  const outputFile = path.join(plan.artifactDir, SCHEDULER_TRAFFIC_CUTOVER_READINESS_FILENAME);
  const inlineStateJson = trimOrNull(plan.effectiveEnv && plan.effectiveEnv.DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON);
  const collectorPreflightFile = path.join(plan.artifactDir, SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_FILENAME);
  const collectorPreflight = runV2SchedulerTrafficCollectorPreflight({
    env: plan.effectiveEnv,
    execFileSync: plan.schedulerTrafficCollectorExecFileSync,
  });
  const collectorPreflightGeneratedAt = new Date().toISOString();
  const collectorPreflightWithProvenance = collectorPreflight ? Object.freeze({
    ...collectorPreflight,
    ...buildArtifactProvenance({
      artifactDir: plan.artifactDir,
      filePath: collectorPreflightFile,
      expectedFilename: SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_FILENAME,
      generatedAt: collectorPreflightGeneratedAt,
    }),
  }) : collectorPreflight;
  writeJson(collectorPreflightFile, collectorPreflightWithProvenance);
  if (!collectorPreflightWithProvenance || collectorPreflightWithProvenance.ok !== true) {
    const error = new Error("V2_PROMOTION_CLOUDBUILD_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_BLOCKED");
    error.details = collectorPreflightWithProvenance || null;
    error.scheduler_traffic_collector_preflight = collectorPreflightWithProvenance || null;
    error.scheduler_traffic_collector_preflight_file = collectorPreflightFile;
    error.scheduler_traffic_cutover_readiness = null;
    error.scheduler_traffic_cutover_readiness_file = null;
    throw error;
  }
  const auditEnv = inlineStateJson
    ? plan.effectiveEnv
    : Object.freeze({
        ...plan.effectiveEnv,
        DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON: JSON.stringify(collectV2SchedulerTrafficState({ env: plan.effectiveEnv })),
      });
  const report = auditV2SchedulerTrafficCutoverReadiness(auditEnv);
  const generatedAt = new Date().toISOString();
  const reportWithProvenance = report ? Object.freeze({
    ...report,
    ...buildArtifactProvenance({
      artifactDir: plan.artifactDir,
      filePath: outputFile,
      expectedFilename: SCHEDULER_TRAFFIC_CUTOVER_READINESS_FILENAME,
      generatedAt,
    }),
  }) : report;
  writeJson(outputFile, reportWithProvenance);
  if (!reportWithProvenance || reportWithProvenance.ok !== true) {
    const error = new Error("V2_PROMOTION_CLOUDBUILD_SCHEDULER_TRAFFIC_CUTOVER_READINESS_BLOCKED");
    error.details = reportWithProvenance || null;
    error.scheduler_traffic_collector_preflight = collectorPreflightWithProvenance || null;
    error.scheduler_traffic_collector_preflight_file = collectorPreflightFile;
    error.scheduler_traffic_cutover_readiness = reportWithProvenance || null;
    error.scheduler_traffic_cutover_readiness_file = outputFile;
    throw error;
  }
  return Object.freeze({
    required: true,
    skipped: false,
    reason: "SCHEDULER_TRAFFIC_CUTOVER_READINESS_PASS",
    collector_preflight: collectorPreflightWithProvenance,
    collector_preflight_file: collectorPreflightFile,
    report: reportWithProvenance,
    output_file: outputFile,
  });
}

function runCloudBuildPromotion(env = process.env) {
  submitContractCheck.assertSubmitContract();
  const plan = buildCloudBuildPlan(env);
  let contextFile = writeContextArtifact(plan, {
    requestedArtifactDir: plan.artifactDir,
    resolvedArtifactDir: plan.artifactDir,
  });
  if (plan.mode === "OFF") {
    return Object.freeze({
      ok: true,
      reason: "V2_PROMOTION_CLOUDBUILD_OFF",
      mode: plan.mode,
      artifact_dir: null,
      context_file: null,
      script: null,
    });
  }

  execFileSync("npm", ["run", plan.script], {
    cwd: process.cwd(),
    env: plan.effectiveEnv,
    stdio: "inherit",
  });

  const canaryFlow = plan.mode === "CANARY_FLOW" ? readCanaryFlowArtifact(plan.artifactDir) : null;
  const completedArtifactDir = trimOrNull(canaryFlow && canaryFlow.artifact_dir) || plan.artifactDir;
  const completedPlan = Object.freeze({
    ...plan,
    artifactDir: completedArtifactDir,
    positionCycleId: trimOrNull(canaryFlow && canaryFlow.position_cycle_id) || plan.positionCycleId,
    effectiveEnv: {
      ...plan.effectiveEnv,
      V2_PROMOTION_ARTIFACT_DIR: completedArtifactDir,
      ...(trimOrNull(canaryFlow && canaryFlow.position_cycle_id)
        ? { V2_PROMOTION_SELECT_POSITION_CYCLE_ID: trimOrNull(canaryFlow && canaryFlow.position_cycle_id) }
        : {}),
    },
  });
  const deployDecision = readDeployDecisionArtifact(completedArtifactDir);
  const deployApproval = validateDeployApproval(completedPlan, deployDecision);
  if (completedArtifactDir !== plan.artifactDir) {
    writeContextArtifact({
      ...plan,
      positionCycleId: completedPlan.positionCycleId,
    }, {
      deployDecision: deployApproval.decision || deployDecision || null,
      requestedArtifactDir: plan.artifactDir,
      resolvedArtifactDir: completedArtifactDir,
    });
  }
  contextFile = writeContextArtifact(completedPlan, {
    deployDecision: deployApproval.decision || deployDecision || null,
    requestedArtifactDir: plan.artifactDir,
    resolvedArtifactDir: completedArtifactDir,
  });
  if (deployApproval.blockers.length) {
    const error = new Error(deployApproval.blockers[0]);
    error.details = deployApproval;
    throw error;
  }
  let liveCutover = null;
  try {
    liveCutover = generateLiveCutoverReadiness(completedPlan, deployApproval);
  } catch (error) {
    if (isLiveCutoverReadinessError(error)) {
      writePromotionReadinessFailureContext(completedPlan, {
        deployDecision: deployApproval.decision || deployDecision || null,
        requestedArtifactDir: plan.artifactDir,
        resolvedArtifactDir: completedArtifactDir,
        liveCutoverError: error,
      });
    }
    throw error;
  }
  let productionCutover = null;
  try {
    productionCutover = generateProductionCutoverReadiness(completedPlan, deployApproval);
  } catch (error) {
    if (isProductionCutoverReadinessError(error)) {
      writePromotionReadinessFailureContext(completedPlan, {
        deployDecision: deployApproval.decision || deployDecision || null,
        requestedArtifactDir: plan.artifactDir,
        resolvedArtifactDir: completedArtifactDir,
        liveCutover,
        productionCutoverError: error,
      });
    }
    throw error;
  }
  let schedulerTrafficCutover = null;
  try {
    schedulerTrafficCutover = generateSchedulerTrafficCutoverReadiness(completedPlan, deployApproval);
  } catch (error) {
    if (isSchedulerTrafficReadinessError(error)) {
      writePromotionReadinessFailureContext(completedPlan, {
        deployDecision: deployApproval.decision || deployDecision || null,
        requestedArtifactDir: plan.artifactDir,
        resolvedArtifactDir: completedArtifactDir,
        liveCutover,
        productionCutover,
        schedulerTrafficError: error,
      });
    }
    throw error;
  }
  if (liveCutover.required === true) {
    contextFile = writeContextArtifact(completedPlan, {
      deployDecision: deployApproval.decision || deployDecision || null,
      requestedArtifactDir: plan.artifactDir,
      resolvedArtifactDir: completedArtifactDir,
      liveCutoverReadiness: liveCutover.report,
      liveCutoverReadinessFile: liveCutover.output_file,
      productionCutoverReadiness: productionCutover.report,
      productionCutoverReadinessFile: productionCutover.output_file,
      schedulerTrafficCollectorPreflight: schedulerTrafficCutover.collector_preflight,
      schedulerTrafficCollectorPreflightFile: schedulerTrafficCutover.collector_preflight_file,
      schedulerTrafficCutoverReadiness: schedulerTrafficCutover.report,
      schedulerTrafficCutoverReadinessFile: schedulerTrafficCutover.output_file,
    });
  } else if (productionCutover.required === true) {
    contextFile = writeContextArtifact(completedPlan, {
      deployDecision: deployApproval.decision || deployDecision || null,
      requestedArtifactDir: plan.artifactDir,
      resolvedArtifactDir: completedArtifactDir,
      productionCutoverReadiness: productionCutover.report,
      productionCutoverReadinessFile: productionCutover.output_file,
      schedulerTrafficCollectorPreflight: schedulerTrafficCutover.collector_preflight,
      schedulerTrafficCollectorPreflightFile: schedulerTrafficCutover.collector_preflight_file,
      schedulerTrafficCutoverReadiness: schedulerTrafficCutover.report,
      schedulerTrafficCutoverReadinessFile: schedulerTrafficCutover.output_file,
    });
  } else if (schedulerTrafficCutover.required === true) {
    contextFile = writeContextArtifact(completedPlan, {
      deployDecision: deployApproval.decision || deployDecision || null,
      requestedArtifactDir: plan.artifactDir,
      resolvedArtifactDir: completedArtifactDir,
      schedulerTrafficCollectorPreflight: schedulerTrafficCutover.collector_preflight,
      schedulerTrafficCollectorPreflightFile: schedulerTrafficCutover.collector_preflight_file,
      schedulerTrafficCutoverReadiness: schedulerTrafficCutover.report,
      schedulerTrafficCutoverReadinessFile: schedulerTrafficCutover.output_file,
    });
  }
  let runbookReview = null;
  try {
    runbookReview = runCanaryRunbookReview(completedPlan, deployApproval);
  } catch (error) {
    if (isRunbookReviewError(error)) {
      writeRunbookReviewContext(completedPlan, {
        deployDecision: deployApproval.decision || deployDecision || null,
        requestedArtifactDir: plan.artifactDir,
        resolvedArtifactDir: completedArtifactDir,
        liveCutover,
        productionCutover,
        schedulerTrafficCutover,
        runbookReview: error.runbook_review || error.details || null,
        runbookReviewFile: error.runbook_review_file || null,
      });
    }
    throw error;
  }
  contextFile = writeRunbookReviewContext(completedPlan, {
    deployDecision: deployApproval.decision || deployDecision || null,
    requestedArtifactDir: plan.artifactDir,
    resolvedArtifactDir: completedArtifactDir,
    liveCutover,
    productionCutover,
    schedulerTrafficCutover,
    runbookReview: runbookReview.review,
    runbookReviewFile: runbookReview.output_file,
  });

  return Object.freeze({
    ok: true,
    reason: "V2_PROMOTION_CLOUDBUILD_RUN_COMPLETE",
    mode: completedPlan.mode,
    requested_artifact_dir: plan.artifactDir,
    artifact_dir: completedPlan.artifactDir,
    context_file: contextFile,
    script: completedPlan.script,
    position_cycle_id: trimOrNull(deployApproval.decision && deployApproval.decision.position_cycle_id) || completedPlan.positionCycleId,
    deploy_decision: deployApproval.decision || null,
    runbook_review: runbookReview.review,
    runbook_review_file: runbookReview.output_file,
    runbook_review_status: runbookReview.reason,
    live_cutover_readiness: liveCutover.report,
    live_cutover_readiness_file: liveCutover.output_file,
    live_cutover_readiness_status: liveCutover.reason,
    production_cutover_readiness: productionCutover.report,
    production_cutover_readiness_file: productionCutover.output_file,
    production_cutover_readiness_status: productionCutover.reason,
    scheduler_traffic_collector_preflight: schedulerTrafficCutover.collector_preflight,
    scheduler_traffic_collector_preflight_file: schedulerTrafficCutover.collector_preflight_file,
    scheduler_traffic_cutover_readiness: schedulerTrafficCutover.report,
    scheduler_traffic_cutover_readiness_file: schedulerTrafficCutover.output_file,
    scheduler_traffic_cutover_readiness_status: schedulerTrafficCutover.reason,
  });
}

async function main(env = process.env) {
  const result = runCloudBuildPromotion(env);
  console.log(JSON.stringify(result));
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("RUN_V2_PROMOTION_CLOUDBUILD_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    runCloudBuildPromotion,
    __test: {
      OUTPUT_FILENAME,
      DEPLOY_DECISION_FILENAME,
      CANARY_FLOW_FILENAME,
      LIVE_CUTOVER_READINESS_FILENAME,
      PRODUCTION_CUTOVER_READINESS_FILENAME,
      SCHEDULER_TRAFFIC_CUTOVER_READINESS_FILENAME,
      trimOrNull,
      upper,
      isEnabled,
      summarizeBlockers,
      summarizeWarnings,
      summarizeAlertRetry,
      hasAlertRetryAttention,
      buildStatusLine,
      buildRecommendedNextAction,
      buildRecommendedNextActionReason,
      buildRecommendedNextActionReasonCode,
      hasArtifactDirCoherenceFailure,
      buildContextRecommendedNextAction,
      buildContextRecommendedNextActionReason,
      buildContextRecommendedNextActionReasonCode,
      buildContextBlockerFamilies,
      resolvePathOrNull,
      pathHasExactSegment,
      buildLineageConsistencySummary,
      buildArtifactDirCoherence,
      buildContextSubmitTrace,
      resolveExecutionMode,
      deriveArtifactDir,
      buildCloudBuildPlan,
      buildDeployDecisionSummary,
      buildLiveCutoverReadinessSummary,
      buildProductionCutoverReadinessSummary,
      buildSchedulerTrafficCutoverReadinessSummary,
      buildSchedulerTrafficCollectorPreflightSummary,
      buildRunbookReviewSummary,
      writeContextArtifact,
      isSchedulerTrafficReadinessError,
      isLiveCutoverReadinessError,
      isProductionCutoverReadinessError,
      isRunbookReviewError,
      buildThrownRunbookReview,
      writePromotionReadinessFailureContext,
      writeSchedulerTrafficFailureContext,
      writeRunbookReviewContext,
      readDeployDecisionArtifact,
      readCanaryFlowArtifact,
      shouldRequireDeployApproval,
      validateDeployApproval,
      shouldRunCanaryRunbookReview,
      runCanaryRunbookReview,
      shouldGenerateLiveCutoverReadiness,
      generateLiveCutoverReadiness,
      shouldGenerateProductionCutoverReadiness,
      generateProductionCutoverReadiness,
      shouldGenerateSchedulerTrafficCutoverReadiness,
      generateSchedulerTrafficCutoverReadiness,
      validateSubmitContract: submitContractCheck.assertSubmitContract,
    },
  };
}
