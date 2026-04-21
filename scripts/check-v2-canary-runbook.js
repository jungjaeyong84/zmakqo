#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { hasLineageContract, contractsMatch } = require("./lib/v2-promotion-lineage-contract");
const submitTrace = require("./lib/v2-promotion-submit-trace");
const deployDecisionCheck = require("./check-v2-promotion-deploy-decision");

const OUTPUT_FILENAME = "promotion-runbook-review.json";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function resolveArtifactDir(env = process.env) {
  const artifactDir = trimOrNull(env.V2_PROMOTION_ARTIFACT_DIR);
  if (!artifactDir) throw new Error("V2_PROMOTION_ARTIFACT_DIR_REQUIRED");
  return path.resolve(artifactDir);
}

function resolveExpectedPositionCycleId(env = process.env) {
  const cycleId = trimOrNull(env.V2_PROMOTION_EXPECT_POSITION_CYCLE_ID)
    || trimOrNull(env.V2_PROMOTION_SELECT_POSITION_CYCLE_ID);
  if (!cycleId) throw new Error("V2_PROMOTION_EXPECT_POSITION_CYCLE_ID_REQUIRED");
  return cycleId;
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function readRequiredArtifact(artifactDir, filename) {
  const filePath = path.join(artifactDir, filename);
  if (!fs.existsSync(filePath)) {
    throw new Error(`V2_CANARY_RUNBOOK_ARTIFACT_REQUIRED:${filename}`);
  }
  return Object.freeze({
    filePath,
    payload: readJsonFile(filePath),
  });
}

function readOptionalArtifact(artifactDir, filename) {
  const filePath = path.join(artifactDir, filename);
  if (!fs.existsSync(filePath)) return null;
  return Object.freeze({
    filePath,
    payload: readJsonFile(filePath),
  });
}

function buildCheck({ id, label, status, reason, file = null, field = null }) {
  return Object.freeze({
    id,
    label,
    status,
    reason: trimOrNull(reason),
    file: trimOrNull(file),
    field: trimOrNull(field),
  });
}

function hasBoundedRuntimeSummary(summary) {
  const row = summary && typeof summary === "object" ? summary : null;
  return !!(
    row &&
    row.selector_query_budget &&
    row.collector_query_budget &&
    Number.isFinite(Number(row.exporter_snapshot_size_bytes)) &&
    row.manifest_counts
  );
}

function hasEvidenceSnapshotCoverage(summary) {
  const row = summary && typeof summary === "object" ? summary : null;
  const evidence = row && typeof row.evidence_snapshot_summary === "object"
    ? row.evidence_snapshot_summary
    : null;
  return !!(
    evidence &&
    evidence.ok === true &&
    Number(evidence.missing_transition_evidence_n) === 0 &&
    Number(evidence.missing_protection_runtime_evidence_n) === 0 &&
    Number.isFinite(Number(evidence.transition_n)) &&
    Number.isFinite(Number(evidence.transition_evidence_n)) &&
    Number.isFinite(Number(evidence.protection_runtime_n)) &&
    Number.isFinite(Number(evidence.protection_runtime_evidence_n))
  );
}

function hasRuntimeChainAudit(summary) {
  return deployDecisionCheck.__test.hasRuntimeChainAuditCoverage(summary);
}

function hasEntryBoundaryAudit(summary) {
  return deployDecisionCheck.__test.hasEntryBoundaryAudit(summary);
}

function hasFillSyncCanonicalBoundaryAudit(summary) {
  return deployDecisionCheck.__test.hasFillSyncCanonicalBoundaryAudit(summary);
}

function hasProductionCutoverAudit(summary) {
  return deployDecisionCheck.__test.hasProductionCutoverAudit(summary);
}

function hasCandidateSelectionContract(summary) {
  const row = summary && typeof summary === "object" ? summary : null;
  const contract = row && typeof row.selection_contract === "object" ? row.selection_contract : null;
  return !!(
    contract &&
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

function hasConsistentLineageContract({ preflight = null, runtimeManifest = null, deployDecision = null } = {}) {
  const preflightLineage = preflight && typeof preflight.lineage_contract === "object" ? preflight.lineage_contract : null;
  const manifestLineage = runtimeManifest && runtimeManifest.snapshot_meta && typeof runtimeManifest.snapshot_meta === "object"
    && runtimeManifest.snapshot_meta.lineage_contract && typeof runtimeManifest.snapshot_meta.lineage_contract === "object"
    ? runtimeManifest.snapshot_meta.lineage_contract
    : null;
  const deployLineage = deployDecision && deployDecision.bounded_runtime_summary && typeof deployDecision.bounded_runtime_summary === "object"
    && deployDecision.bounded_runtime_summary.lineage_contract && typeof deployDecision.bounded_runtime_summary.lineage_contract === "object"
    ? deployDecision.bounded_runtime_summary.lineage_contract
    : null;
  return hasLineageContract(preflightLineage)
    && hasLineageContract(manifestLineage)
    && hasLineageContract(deployLineage)
    && contractsMatch(preflightLineage, manifestLineage)
    && contractsMatch(manifestLineage, deployLineage);
}

function hasContextLineageHashMatch({ cloudbuildContext = null, deployDecision = null } = {}) {
  const contextHash = trimOrNull(cloudbuildContext && cloudbuildContext.lineage_contract_hash);
  const deployHash = trimOrNull(
    deployDecision
    && deployDecision.bounded_runtime_summary
    && deployDecision.bounded_runtime_summary.lineage_contract
    && deployDecision.bounded_runtime_summary.lineage_contract.hash
  );
  return !!(contextHash && deployHash && contextHash === deployHash);
}

function resolvePathOrNull(value) {
  const text = trimOrNull(value);
  return text ? path.resolve(text) : null;
}

function hasContextArtifactDirCoherence({
  artifactDir = null,
  expectedPositionCycleId = null,
  preflight = null,
  runtimeManifest = null,
  deployDecision = null,
  cloudbuildContext = null,
} = {}) {
  const artifactPath = resolvePathOrNull(artifactDir);
  const contextArtifactPath = resolvePathOrNull(cloudbuildContext && cloudbuildContext.artifact_dir);
  const contextResolvedPath = resolvePathOrNull(cloudbuildContext && cloudbuildContext.resolved_artifact_dir);
  const selfCheck = cloudbuildContext && typeof cloudbuildContext.artifact_dir_coherence === "object"
    ? cloudbuildContext.artifact_dir_coherence
    : null;
  const selfCheckArtifactPath = resolvePathOrNull(selfCheck && selfCheck.artifact_dir);
  const selfCheckResolvedPath = resolvePathOrNull(selfCheck && selfCheck.resolved_artifact_dir);
  const expectedCycleId = trimOrNull(expectedPositionCycleId);
  const preflightCycleId = trimOrNull(preflight && preflight.position_cycle_id);
  const manifestCycleId = trimOrNull(
    runtimeManifest
    && runtimeManifest.snapshot_meta
    && runtimeManifest.snapshot_meta.selector_meta
    && runtimeManifest.snapshot_meta.selector_meta.position_cycle_id
  );
  const deployCycleId = trimOrNull(deployDecision && deployDecision.position_cycle_id);
  const contextCycleId = trimOrNull(cloudbuildContext && cloudbuildContext.position_cycle_id);
  const selfCheckCycleId = trimOrNull(selfCheck && selfCheck.position_cycle_id);
  const selfCheckDeployCycleId = trimOrNull(selfCheck && selfCheck.deploy_decision_position_cycle_id);
  return !!(
    artifactPath &&
    contextArtifactPath &&
    contextResolvedPath &&
    selfCheck &&
    selfCheck.ok === true &&
    selfCheckArtifactPath &&
    selfCheckResolvedPath &&
    expectedCycleId &&
    preflightCycleId &&
    manifestCycleId &&
    deployCycleId &&
    contextCycleId &&
    artifactPath === contextArtifactPath &&
    artifactPath === contextResolvedPath &&
    artifactPath === selfCheckArtifactPath &&
    artifactPath === selfCheckResolvedPath &&
    artifactPath.includes(expectedCycleId) &&
    preflightCycleId === expectedCycleId &&
    manifestCycleId === expectedCycleId &&
    deployCycleId === expectedCycleId &&
    contextCycleId === expectedCycleId &&
    selfCheckCycleId === expectedCycleId &&
    selfCheckDeployCycleId === expectedCycleId &&
    selfCheck.artifact_dir_matches_resolved_artifact_dir === true &&
    selfCheck.artifact_dir_contains_position_cycle_id === true &&
    selfCheck.resolved_artifact_dir_contains_position_cycle_id === true &&
    selfCheck.context_cycle_matches_deploy_decision === true
  );
}

function normalizeWarnings(warnings) {
  return (Array.isArray(warnings) ? warnings : [])
    .map((value) => trimOrNull(value))
    .filter(Boolean);
}

function normalizeArray(values) {
  return (Array.isArray(values) ? values : [])
    .map((value) => trimOrNull(value))
    .filter(Boolean);
}

function arraysEqual(left, right) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function buildExpectedContextBlockerFamilies(blockerSummary) {
  const row = blockerSummary && typeof blockerSummary === "object" ? blockerSummary : null;
  if (!row) return [];
  const families = [];
  if (row.has_provenance_blocker === true) families.push("PROVENANCE");
  if (row.has_candidate_selection_blocker === true) families.push("CANDIDATE_SELECTION");
  if (row.has_bounded_runtime_blocker === true) families.push("BOUNDED_RUNTIME");
  if (row.has_entry_boundary_blocker === true) families.push("ENTRY_BOUNDARY");
  if (row.has_production_cutover_blocker === true) families.push("PRODUCTION_CUTOVER");
  if (row.has_watchdog_blocker === true) families.push("WATCHDOG");
  if (Number(row.blocker_n || 0) > 0 && families.length === 0) families.push("UNCLASSIFIED");
  return families;
}

function hasConsistentContextSubmitTrace({ cloudbuildContext = null } = {}) {
  const context = cloudbuildContext && typeof cloudbuildContext === "object" ? cloudbuildContext : null;
  const trace = context && context.submit_trace && typeof context.submit_trace === "object"
    ? context.submit_trace
    : null;
  const deploySummary = context && context.deploy_decision_summary && typeof context.deploy_decision_summary === "object"
    ? context.deploy_decision_summary
    : null;
  const blockerSummary = deploySummary && deploySummary.blocker_summary && typeof deploySummary.blocker_summary === "object"
    ? deploySummary.blocker_summary
    : null;
  if (!context || !trace || !deploySummary || !blockerSummary) return false;

  const expectedRelevantSubmitChecks = ["SUBMIT_CHK_01A", "SUBMIT_CHK_06", "SUBMIT_CHK_07", "SUBMIT_CHK_08"];
  const expectedRelevantRunbook = submitTrace.collectRunbookChecklist(expectedRelevantSubmitChecks);
  const failedSubmitChecks = [];
  const artifactDirCoherence = context.artifact_dir_coherence && typeof context.artifact_dir_coherence === "object"
    ? context.artifact_dir_coherence
    : null;
  const artifactDirOk = artifactDirCoherence && artifactDirCoherence.ok === true;
  const actionOk = trimOrNull(context.recommended_next_action) === "PROCEED_WITH_SUBMIT_WRAPPER";
  const blockerOk = Number(blockerSummary.blocker_n) === 0;
  const lineageOk = !!trimOrNull(context.lineage_contract_hash);
  if (!artifactDirOk) failedSubmitChecks.push("SUBMIT_CHK_01A");
  if (!actionOk) failedSubmitChecks.push("SUBMIT_CHK_06");
  if (!blockerOk) failedSubmitChecks.push("SUBMIT_CHK_07");
  if (!lineageOk) failedSubmitChecks.push("SUBMIT_CHK_08");

  const expectedFailedRunbook = submitTrace.collectRunbookChecklist(failedSubmitChecks);
  const baseExpectedFamilies = buildExpectedContextBlockerFamilies(blockerSummary);
  const expectedFamilies = failedSubmitChecks.includes("SUBMIT_CHK_01A") || failedSubmitChecks.includes("SUBMIT_CHK_08")
    ? Array.from(new Set(["PROVENANCE", ...baseExpectedFamilies]))
    : baseExpectedFamilies;
  const expectedPrimaryFamily = expectedFamilies[0] || null;
  const checks = Array.isArray(trace.checks) ? trace.checks : [];
  const checksById = new Map(checks.map((row) => [trimOrNull(row && row.id), row]));
  const expectedOkById = new Map([
    ["SUBMIT_CHK_01A", artifactDirOk],
    ["SUBMIT_CHK_06", actionOk],
    ["SUBMIT_CHK_07", blockerOk],
    ["SUBMIT_CHK_08", lineageOk],
  ]);

  const checksMatch = expectedRelevantSubmitChecks.every((id) => {
    const row = checksById.get(id);
    return !!(
      row &&
      row.ok === expectedOkById.get(id) &&
      arraysEqual(normalizeArray(row.runbook_checklist), submitTrace.getRunbookChecklistForSubmitCheck(id))
    );
  });

  return (
    arraysEqual(normalizeArray(trace.relevant_submit_check_ids), expectedRelevantSubmitChecks) &&
    arraysEqual(normalizeArray(trace.relevant_runbook_checklist), expectedRelevantRunbook) &&
    arraysEqual(normalizeArray(trace.failed_submit_check_ids), failedSubmitChecks) &&
    arraysEqual(normalizeArray(trace.failed_runbook_checklist), expectedFailedRunbook) &&
    arraysEqual(normalizeArray(trace.blocker_families), expectedFamilies) &&
    (trimOrNull(trace.primary_blocker_family) || null) === expectedPrimaryFamily &&
    trimOrNull(trace.recommended_next_action_reason_code) === trimOrNull(context.recommended_next_action_reason_code) &&
    checks.length === expectedRelevantSubmitChecks.length &&
    checksMatch
  );
}

function collectExpectedWarningRunbookChecklist({
  hasRepairFirestoreCanaryStreakWarning = false,
  hasProductionEntryRouteCanaryStreakWarning = false,
  hasLiveReadinessWarning = false,
} = {}) {
  const refs = new Set();
  if (hasRepairFirestoreCanaryStreakWarning) refs.add("19");
  if (hasProductionEntryRouteCanaryStreakWarning) refs.add("26");
  if (hasLiveReadinessWarning && refs.size === 0) {
    refs.add("19");
    refs.add("26");
  }
  return Object.freeze(Array.from(refs).sort((a, b) => Number(a) - Number(b)));
}

function hasConsistentWarningSummary({ cloudbuildContext = null, deployDecision = null } = {}) {
  const warnings = normalizeWarnings(deployDecision && deployDecision.warnings);
  const finalStatusLine = trimOrNull(cloudbuildContext && cloudbuildContext.final_status_line) || "";
  const summary = cloudbuildContext
    && cloudbuildContext.deploy_decision_summary
    && typeof cloudbuildContext.deploy_decision_summary === "object"
    && cloudbuildContext.deploy_decision_summary.warning_summary
    && typeof cloudbuildContext.deploy_decision_summary.warning_summary === "object"
    ? cloudbuildContext.deploy_decision_summary.warning_summary
    : null;
  const submitTrace = cloudbuildContext
    && cloudbuildContext.submit_trace
    && typeof cloudbuildContext.submit_trace === "object"
    ? cloudbuildContext.submit_trace
    : null;
  if (!summary) return false;
  if (!submitTrace) return false;
  const topWarnings = normalizeWarnings(summary.top_warnings);
  const expectedTopWarnings = warnings.slice(0, 3);
  const expectedRepairFirestoreCanaryStreakWarning = warnings.some((warning) => warning.includes("REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"));
  const expectedProductionEntryRouteCanaryStreakWarning = warnings.some((warning) => warning.includes("PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"));
  const expectedLiveReadinessWarning = expectedRepairFirestoreCanaryStreakWarning || expectedProductionEntryRouteCanaryStreakWarning;
  const expectedRunbookChecklist = collectExpectedWarningRunbookChecklist({
    hasRepairFirestoreCanaryStreakWarning: expectedRepairFirestoreCanaryStreakWarning,
    hasProductionEntryRouteCanaryStreakWarning: expectedProductionEntryRouteCanaryStreakWarning,
    hasLiveReadinessWarning: expectedLiveReadinessWarning,
  });
  const submitTraceWarningSummary = submitTrace.deploy_warning_summary;
  const submitTraceRunbookChecklist = Array.isArray(submitTrace.deploy_warning_runbook_checklist)
    ? submitTrace.deploy_warning_runbook_checklist.map((value) => trimOrNull(value)).filter(Boolean).sort((a, b) => Number(a) - Number(b))
    : [];
  return (
    Number(summary.warning_n) === warnings.length &&
    JSON.stringify(topWarnings) === JSON.stringify(expectedTopWarnings) &&
    summary.has_live_readiness_warning === expectedLiveReadinessWarning &&
    summary.has_repair_firestore_canary_streak_warning === expectedRepairFirestoreCanaryStreakWarning &&
    summary.has_production_entry_route_canary_streak_warning === expectedProductionEntryRouteCanaryStreakWarning &&
    submitTrace.deploy_warning_attention_required === (warnings.length > 0) &&
    JSON.stringify(submitTraceWarningSummary) === JSON.stringify(summary) &&
    JSON.stringify(submitTraceRunbookChecklist) === JSON.stringify(expectedRunbookChecklist) &&
    finalStatusLine.includes(`warnings=${warnings.length}`) &&
    expectedTopWarnings.every((warning) => finalStatusLine.includes(warning))
  );
}

function hasLiveCutoverReadinessPlan(readiness) {
  const row = readiness && typeof readiness === "object" ? readiness : null;
  const envChanges = Array.isArray(row && row.required_env_changes) ? row.required_env_changes : [];
  const envPlan = new Set(envChanges.map((entry) => `${trimOrNull(entry && entry.name)}=${trimOrNull(entry && entry.value)}`));
  const runbookChecklist = Array.isArray(row && row.runbook_checklist) ? row.runbook_checklist : [];
  const submitCheckIds = Array.isArray(row && row.submit_check_ids) ? row.submit_check_ids : [];
  return !!(
    row &&
    row.ok === true &&
    trimOrNull(row.reason) === "V2_REPAIR_FIRESTORE_CANARY_READY_FOR_LIVE_PREFLIGHT" &&
    row.auto_apply === false &&
    row.mutates_environment === false &&
    runbookChecklist.includes("19") &&
    submitCheckIds.includes("SUBMIT_CHK_11") &&
    envPlan.has("DONBEOLJA_V2_REPAIR_LIVE_ENABLE_REQUESTED=1") &&
    envPlan.has("DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_REQUIRED=1") &&
    envPlan.has("DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_REQUIRED=1") &&
    envPlan.has("DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_REQUIRED=1")
  );
}

function hasProductionCutoverReadinessPlan({ readiness = null, cloudbuildContext = null } = {}) {
  const artifact = readiness && typeof readiness === "object" ? readiness : null;
  const contextSummary = cloudbuildContext && typeof cloudbuildContext === "object"
    && cloudbuildContext.production_cutover_readiness_summary
    && typeof cloudbuildContext.production_cutover_readiness_summary === "object"
    ? cloudbuildContext.production_cutover_readiness_summary
    : null;
  const summary = artifact || contextSummary;
  const guard = summary && typeof summary.guard === "object" ? summary.guard : null;
  const compactLegacyBlocked = contextSummary && contextSummary.legacy_webhook_blocked === true;
  const fullLegacyBlocked = guard && guard.allowed === false && trimOrNull(guard.reason) === "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED";
  return !!(
    summary &&
    summary.ok === true &&
    trimOrNull(summary.reason) === "V2_PRODUCTION_CUTOVER_READINESS_PASS" &&
    Number(summary.fail_n || summary.blocker_n || 0) === 0 &&
    (compactLegacyBlocked || fullLegacyBlocked)
  );
}

function hasSchedulerTrafficCutoverReadinessPlan({ readiness = null, cloudbuildContext = null } = {}) {
  const artifact = readiness && typeof readiness === "object" ? readiness : null;
  const contextSummary = cloudbuildContext && typeof cloudbuildContext === "object"
    && cloudbuildContext.scheduler_traffic_cutover_readiness_summary
    && typeof cloudbuildContext.scheduler_traffic_cutover_readiness_summary === "object"
    ? cloudbuildContext.scheduler_traffic_cutover_readiness_summary
    : null;
  const summary = artifact || contextSummary;
  const cloudRunServices = Array.isArray(summary && summary.cloud_run_services) ? summary.cloud_run_services : [];
  return !!(
    summary &&
    summary.ok === true &&
    trimOrNull(summary.reason) === "V2_SCHEDULER_TRAFFIC_CUTOVER_READINESS_PASS" &&
    Number(summary.fail_n || summary.blocker_n || 0) === 0 &&
    trimOrNull(summary.scheduler_sot) === "OPENCLAW_CRON" &&
    Array.isArray(summary.missing_openclaw_job_ids) &&
    summary.missing_openclaw_job_ids.length === 0 &&
    Number(summary.active_legacy_scheduler_job_n || 0) === 0 &&
    cloudRunServices.length >= 2 &&
    cloudRunServices.every((service) => (
      trimOrNull(service && service.scheduler_autostart) === "0" &&
      trimOrNull(service && service.scheduler_cutover_mode) === "OPENCLAW_CRON" &&
      Number(service && service.traffic_percent) === 100 &&
      service.latest_revision_ready === true
    ))
  );
}

function evaluateRunbookReview({ artifactDir, expectedPositionCycleId, artifacts }) {
  const checks = [];
  const preflight = artifacts.preflight.payload;
  const canaryFlow = artifacts.canaryFlow.payload;
  const runtimeManifest = artifacts.runtimeManifest.payload;
  const unifiedReport = artifacts.unifiedReport.payload;
  const deployDecision = artifacts.deployDecision.payload;
  const cloudbuildContext = artifacts.cloudbuildContext.payload;
  const liveCutoverReadiness = artifacts.liveCutoverReadiness && artifacts.liveCutoverReadiness.payload;
  const productionCutoverReadiness = artifacts.productionCutoverReadiness && artifacts.productionCutoverReadiness.payload;
  const schedulerTrafficCutoverReadiness = artifacts.schedulerTrafficCutoverReadiness && artifacts.schedulerTrafficCutoverReadiness.payload;

  checks.push(buildCheck({
    id: "CHK_01",
    label: "artifact dir contains expected position cycle id",
    status: artifactDir.includes(expectedPositionCycleId) ? "PASS" : "FAIL",
    reason: artifactDir.includes(expectedPositionCycleId)
      ? "artifact dir is bounded by expected cycle id"
      : "artifact dir does not contain expected cycle id",
    file: artifactDir,
    field: "path",
  }));

  checks.push(buildCheck({
    id: "CHK_01A",
    label: "cloudbuild context resolved artifact dir matches selected cycle",
    status: hasContextArtifactDirCoherence({
      artifactDir,
      expectedPositionCycleId,
      preflight,
      runtimeManifest,
      deployDecision,
      cloudbuildContext,
    }) ? "PASS" : "FAIL",
    reason: hasContextArtifactDirCoherence({
      artifactDir,
      expectedPositionCycleId,
      preflight,
      runtimeManifest,
      deployDecision,
      cloudbuildContext,
    })
      ? "context artifact dir, self-check, and selected cycle are coherent"
      : "context artifact dir, self-check, resolved dir, or selected cycle is inconsistent",
    file: artifacts.cloudbuildContext.filePath,
    field: "artifact_dir,resolved_artifact_dir,artifact_dir_coherence,position_cycle_id",
  }));

  checks.push(buildCheck({
    id: "CHK_03",
    label: "preflight passed",
    status: preflight && preflight.ok === true ? "PASS" : "FAIL",
    reason: preflight && preflight.ok === true ? "preflight ok=true" : "preflight ok must be true",
    file: artifacts.preflight.filePath,
    field: "ok",
  }));

  checks.push(buildCheck({
    id: "CHK_04",
    label: "canary flow passed",
    status: canaryFlow && canaryFlow.ok === true && canaryFlow.stage === "PIPELINE_PASS" ? "PASS" : "FAIL",
    reason: canaryFlow && canaryFlow.ok === true && canaryFlow.stage === "PIPELINE_PASS"
      ? "canary flow reached pipeline pass"
      : "canary flow must have ok=true and stage=PIPELINE_PASS",
    file: artifacts.canaryFlow.filePath,
    field: "ok,stage",
  }));

  checks.push(buildCheck({
    id: "CHK_05",
    label: "runtime manifest selector cycle matches expected",
    status: trimOrNull(runtimeManifest && runtimeManifest.snapshot_meta && runtimeManifest.snapshot_meta.selector_meta && runtimeManifest.snapshot_meta.selector_meta.position_cycle_id) === expectedPositionCycleId
      ? "PASS"
      : "FAIL",
    reason: trimOrNull(runtimeManifest && runtimeManifest.snapshot_meta && runtimeManifest.snapshot_meta.selector_meta && runtimeManifest.snapshot_meta.selector_meta.position_cycle_id) === expectedPositionCycleId
      ? "runtime manifest selector cycle matches"
      : "runtime manifest selector cycle mismatch",
    file: artifacts.runtimeManifest.filePath,
    field: "snapshot_meta.selector_meta.position_cycle_id",
  }));

  checks.push(buildCheck({
    id: "CHK_06",
    label: "unified report cycle matches expected",
    status: trimOrNull(unifiedReport && unifiedReport.position_cycle_id) === expectedPositionCycleId ? "PASS" : "FAIL",
    reason: trimOrNull(unifiedReport && unifiedReport.position_cycle_id) === expectedPositionCycleId
      ? "unified report cycle matches"
      : "unified report cycle mismatch",
    file: artifacts.unifiedReport.filePath,
    field: "position_cycle_id",
  }));

  checks.push(buildCheck({
    id: "CHK_07",
    label: "deploy decision approved",
    status: deployDecision && deployDecision.approved === true ? "PASS" : "FAIL",
    reason: deployDecision && deployDecision.approved === true ? "deploy decision approved" : "deploy decision must be approved",
    file: artifacts.deployDecision.filePath,
    field: "approved",
  }));

  checks.push(buildCheck({
    id: "CHK_08",
    label: "bounded runtime summary complete",
    status: hasBoundedRuntimeSummary(deployDecision && deployDecision.bounded_runtime_summary) ? "PASS" : "FAIL",
    reason: hasBoundedRuntimeSummary(deployDecision && deployDecision.bounded_runtime_summary)
      ? "bounded runtime summary contains required evidence"
      : "bounded runtime summary is incomplete",
    file: artifacts.deployDecision.filePath,
    field: "bounded_runtime_summary",
  }));

  checks.push(buildCheck({
    id: "CHK_14",
    label: "evidence snapshot coverage complete",
    status: hasEvidenceSnapshotCoverage(deployDecision && deployDecision.bounded_runtime_summary) ? "PASS" : "FAIL",
    reason: hasEvidenceSnapshotCoverage(deployDecision && deployDecision.bounded_runtime_summary)
      ? "evidence snapshot coverage is complete"
      : "evidence snapshot coverage is incomplete",
    file: artifacts.deployDecision.filePath,
    field: "bounded_runtime_summary.evidence_snapshot_summary",
  }));

  checks.push(buildCheck({
    id: "CHK_26",
    label: "runtime chain audit complete",
    status: hasRuntimeChainAudit(deployDecision && deployDecision.bounded_runtime_summary) ? "PASS" : "FAIL",
    reason: hasRuntimeChainAudit(deployDecision && deployDecision.bounded_runtime_summary)
      ? "runtime chain audit passed"
      : "runtime chain audit is missing or failed",
    file: artifacts.deployDecision.filePath,
    field: "bounded_runtime_summary.runtime_chain_audit_summary",
  }));

  checks.push(buildCheck({
    id: "CHK_21",
    label: "V2 entry boundary audit complete",
    status: hasEntryBoundaryAudit(deployDecision && deployDecision.entry_boundary_audit) ? "PASS" : "FAIL",
    reason: hasEntryBoundaryAudit(deployDecision && deployDecision.entry_boundary_audit)
      ? "V2 entry boundary audit passed"
      : "V2 entry boundary audit is missing or failed",
    file: artifacts.deployDecision.filePath,
    field: "entry_boundary_audit",
  }));

  checks.push(buildCheck({
    id: "CHK_25",
    label: "V2 fill sync canonical boundary audit complete",
    status: hasFillSyncCanonicalBoundaryAudit(deployDecision && deployDecision.fill_sync_canonical_boundary_audit) ? "PASS" : "FAIL",
    reason: hasFillSyncCanonicalBoundaryAudit(deployDecision && deployDecision.fill_sync_canonical_boundary_audit)
      ? "V2 fill sync canonical boundary audit passed"
      : "V2 fill sync canonical boundary audit is missing or failed",
    file: artifacts.deployDecision.filePath,
    field: "fill_sync_canonical_boundary_audit",
  }));

  checks.push(buildCheck({
    id: "CHK_22",
    label: "V2 production cutover audit complete",
    status: hasProductionCutoverAudit(deployDecision && deployDecision.production_cutover_audit) ? "PASS" : "FAIL",
    reason: hasProductionCutoverAudit(deployDecision && deployDecision.production_cutover_audit)
      ? "V2 production cutover audit passed"
      : "V2 production cutover audit is missing or failed",
    file: artifacts.deployDecision.filePath,
    field: "production_cutover_audit",
  }));

  checks.push(buildCheck({
    id: "CHK_18",
    label: "OpenClaw execution audit ledger write complete",
    status: deployDecisionCheck.__test.hasOpenClawExecutionAuditLedgerWrite(deployDecision && deployDecision.bounded_runtime_summary) ? "PASS" : "FAIL",
    reason: deployDecisionCheck.__test.hasOpenClawExecutionAuditLedgerWrite(deployDecision && deployDecision.bounded_runtime_summary)
      ? "OpenClaw execution audit ledger write evidence is complete"
      : "OpenClaw execution audit ledger write evidence is missing or skipped",
    file: artifacts.deployDecision.filePath,
    field: "bounded_runtime_summary.openclaw_execution_audit_ledger_write",
  }));

  checks.push(buildCheck({
    id: "CHK_16",
    label: "lineage contract matches across preflight manifest and deploy decision",
    status: hasConsistentLineageContract({
      preflight,
      runtimeManifest,
      deployDecision,
    }) ? "PASS" : "FAIL",
    reason: hasConsistentLineageContract({
      preflight,
      runtimeManifest,
      deployDecision,
    })
      ? "lineage contract matches across bounded artifacts"
      : "lineage contract is missing or mismatched across bounded artifacts",
    file: artifacts.deployDecision.filePath,
    field: "lineage_contract.hash",
  }));

  checks.push(buildCheck({
    id: "CHK_17",
    label: "cloudbuild context lineage hash matches deploy decision",
    status: hasContextLineageHashMatch({
      cloudbuildContext,
      deployDecision,
    }) ? "PASS" : "FAIL",
    reason: hasContextLineageHashMatch({
      cloudbuildContext,
      deployDecision,
    })
      ? "cloudbuild context lineage hash matches deploy decision"
      : "cloudbuild context lineage hash is missing or mismatched",
    file: artifacts.cloudbuildContext.filePath,
    field: "lineage_contract_hash",
  }));

  const candidateSummary = deployDecision && deployDecision.candidate_selection_summary;
  if (candidateSummary && typeof candidateSummary === "object") {
    const candidateCycleId = trimOrNull(candidateSummary.selected_position_cycle_id);
    const deployCycleId = trimOrNull(deployDecision && deployDecision.position_cycle_id);
    checks.push(buildCheck({
      id: "CHK_09",
      label: "candidate selection cycle matches deploy cycle",
      status: candidateCycleId && deployCycleId && candidateCycleId === deployCycleId ? "PASS" : "FAIL",
      reason: candidateCycleId && deployCycleId && candidateCycleId === deployCycleId
        ? "candidate selection cycle matches deploy cycle"
        : "candidate selection cycle mismatch",
      file: artifacts.deployDecision.filePath,
      field: "candidate_selection_summary.selected_position_cycle_id,position_cycle_id",
    }));
    checks.push(buildCheck({
      id: "CHK_15",
      label: "candidate selection contract complete",
      status: hasCandidateSelectionContract(candidateSummary) ? "PASS" : "FAIL",
      reason: hasCandidateSelectionContract(candidateSummary)
        ? "candidate selection contract is complete"
        : "candidate selection contract is incomplete",
      file: artifacts.deployDecision.filePath,
      field: "candidate_selection_summary.selection_contract",
    }));
  } else {
    checks.push(buildCheck({
      id: "CHK_09",
      label: "candidate selection cycle matches deploy cycle",
      status: "SKIP",
      reason: "explicit cycle path has no candidate selection summary",
      file: artifacts.deployDecision.filePath,
      field: "candidate_selection_summary",
    }));
    checks.push(buildCheck({
      id: "CHK_15",
      label: "candidate selection contract complete",
      status: "SKIP",
      reason: "explicit cycle path has no candidate selection summary",
      file: artifacts.deployDecision.filePath,
      field: "candidate_selection_summary.selection_contract",
    }));
  }

  const finalStatusLine = trimOrNull(cloudbuildContext && cloudbuildContext.final_status_line);
  checks.push(buildCheck({
    id: "CHK_10",
    label: "cloudbuild final status line approved",
    status: finalStatusLine && finalStatusLine.startsWith("APPROVE_DEPLOY") ? "PASS" : "FAIL",
    reason: finalStatusLine && finalStatusLine.startsWith("APPROVE_DEPLOY")
      ? "final status line shows approve deploy"
      : "final status line must start with APPROVE_DEPLOY",
    file: artifacts.cloudbuildContext.filePath,
    field: "final_status_line",
  }));

  checks.push(buildCheck({
    id: "CHK_11",
    label: "cloudbuild recommended next action proceeds",
    status: trimOrNull(cloudbuildContext && cloudbuildContext.recommended_next_action) === "PROCEED_WITH_SUBMIT_WRAPPER" ? "PASS" : "FAIL",
    reason: trimOrNull(cloudbuildContext && cloudbuildContext.recommended_next_action) === "PROCEED_WITH_SUBMIT_WRAPPER"
      ? "recommended next action matches submit path"
      : "recommended next action must be PROCEED_WITH_SUBMIT_WRAPPER",
    file: artifacts.cloudbuildContext.filePath,
    field: "recommended_next_action",
  }));

  checks.push(buildCheck({
    id: "CHK_12",
    label: "cloudbuild recommended next action reason consistent",
    status: trimOrNull(cloudbuildContext && cloudbuildContext.recommended_next_action_reason) === "deploy decision approved with no blocking families"
      ? "PASS"
      : "FAIL",
    reason: trimOrNull(cloudbuildContext && cloudbuildContext.recommended_next_action_reason) === "deploy decision approved with no blocking families"
      ? "recommended next action reason matches approved state"
      : "recommended next action reason must match approved state",
    file: artifacts.cloudbuildContext.filePath,
    field: "recommended_next_action_reason",
  }));

  const blockerN = Number(cloudbuildContext && cloudbuildContext.deploy_decision_summary && cloudbuildContext.deploy_decision_summary.blocker_summary && cloudbuildContext.deploy_decision_summary.blocker_summary.blocker_n);
  checks.push(buildCheck({
    id: "CHK_13",
    label: "cloudbuild blocker count is zero",
    status: blockerN === 0 ? "PASS" : "FAIL",
    reason: blockerN === 0 ? "cloudbuild blocker count is zero" : "cloudbuild blocker count must be zero",
    file: artifacts.cloudbuildContext.filePath,
    field: "deploy_decision_summary.blocker_summary.blocker_n",
  }));

  checks.push(buildCheck({
    id: "CHK_13B",
    label: "cloudbuild warning summary and trace match deploy decision warnings",
    status: hasConsistentWarningSummary({ cloudbuildContext, deployDecision }) ? "PASS" : "FAIL",
    reason: hasConsistentWarningSummary({ cloudbuildContext, deployDecision })
      ? "cloudbuild warning summary and submit trace match deploy decision warnings and streak classifiers"
      : "cloudbuild warning summary, submit trace, streak classifiers, or final status line is inconsistent with deploy decision warnings",
    file: artifacts.cloudbuildContext.filePath,
    field: "deploy_decision_summary.warning_summary,submit_trace.deploy_warning_summary,submit_trace.deploy_warning_runbook_checklist,final_status_line",
  }));

  checks.push(buildCheck({
    id: "CHK_13C",
    label: "cloudbuild submit trace maps context blockers to submit checks",
    status: hasConsistentContextSubmitTrace({ cloudbuildContext }) ? "PASS" : "FAIL",
    reason: hasConsistentContextSubmitTrace({ cloudbuildContext })
      ? "cloudbuild submit trace maps context checks, runbook refs, blocker family, and reason code consistently"
      : "cloudbuild submit trace does not match context submit checks, runbook refs, blocker family, or reason code",
    file: artifacts.cloudbuildContext.filePath,
    field: "submit_trace.relevant_submit_check_ids,submit_trace.failed_submit_check_ids,submit_trace.failed_runbook_checklist,submit_trace.blocker_families,submit_trace.recommended_next_action_reason_code",
  }));

  const deployMode = String(deployDecision && deployDecision.mode || "").trim().toUpperCase();
  if (deployMode === "LIVE" || artifacts.liveCutoverReadiness) {
    checks.push(buildCheck({
      id: "CHK_20",
      label: "LIVE repair cutover readiness plan is explicit and non-mutating",
      status: hasLiveCutoverReadinessPlan(liveCutoverReadiness) ? "PASS" : "FAIL",
      reason: hasLiveCutoverReadinessPlan(liveCutoverReadiness)
        ? "LIVE repair cutover readiness plan is explicit and does not mutate environment"
        : "LIVE repair cutover readiness artifact is missing, not ready, or mutates environment",
      file: artifacts.liveCutoverReadiness ? artifacts.liveCutoverReadiness.filePath : path.join(artifactDir, "v2_repair_live_cutover_readiness_latest.json"),
      field: "reason,auto_apply,mutates_environment,required_env_changes",
    }));
  }

  if (deployMode === "LIVE" || artifacts.productionCutoverReadiness) {
    checks.push(buildCheck({
      id: "CHK_23",
      label: "LIVE production cutover readiness blocks legacy webhook",
      status: hasProductionCutoverReadinessPlan({ readiness: productionCutoverReadiness, cloudbuildContext }) ? "PASS" : "FAIL",
      reason: hasProductionCutoverReadinessPlan({ readiness: productionCutoverReadiness, cloudbuildContext })
        ? "LIVE production cutover readiness proves legacy webhook is blocked"
        : "LIVE production cutover readiness is missing, failed, or does not block legacy webhook",
      file: artifacts.productionCutoverReadiness ? artifacts.productionCutoverReadiness.filePath : path.join(artifactDir, "v2_production_cutover_readiness_latest.json"),
      field: "reason,guard.reason,production_cutover_readiness_summary.legacy_webhook_blocked",
    }));
  }

  if (deployMode === "LIVE" || artifacts.schedulerTrafficCutoverReadiness) {
    checks.push(buildCheck({
      id: "CHK_24",
      label: "LIVE scheduler traffic cutover uses OpenClaw cron only",
      status: hasSchedulerTrafficCutoverReadinessPlan({ readiness: schedulerTrafficCutoverReadiness, cloudbuildContext }) ? "PASS" : "FAIL",
      reason: hasSchedulerTrafficCutoverReadinessPlan({ readiness: schedulerTrafficCutoverReadiness, cloudbuildContext })
        ? "LIVE scheduler traffic cutover proves OpenClaw cron ownership and ready Cloud Run traffic"
        : "LIVE scheduler traffic cutover readiness is missing, failed, or still has legacy/autostart traffic risk",
      file: artifacts.schedulerTrafficCutoverReadiness ? artifacts.schedulerTrafficCutoverReadiness.filePath : path.join(artifactDir, "v2_scheduler_traffic_cutover_readiness_latest.json"),
      field: "reason,scheduler_sot,missing_openclaw_job_ids,active_legacy_scheduler_jobs,cloud_run_services",
    }));
  }

  const failCount = checks.filter((row) => row.status === "FAIL").length;
  const skipCount = checks.filter((row) => row.status === "SKIP").length;
  const passCount = checks.filter((row) => row.status === "PASS").length;
  return Object.freeze({
    ok: failCount === 0,
    overall_status: failCount === 0 ? "PASS" : "FAIL",
    artifact_dir: artifactDir,
    expected_position_cycle_id: expectedPositionCycleId,
    check_n: checks.length,
    pass_n: passCount,
    fail_n: failCount,
    skip_n: skipCount,
    checks,
  });
}

function writeReviewArtifact(artifactDir, payload) {
  const outputFile = path.join(artifactDir, OUTPUT_FILENAME);
  fs.writeFileSync(outputFile, JSON.stringify(payload, null, 2), "utf8");
  return outputFile;
}

function runCanaryRunbookCheck(env = process.env) {
  const artifactDir = resolveArtifactDir(env);
  const expectedPositionCycleId = resolveExpectedPositionCycleId(env);
  const artifacts = Object.freeze({
    preflight: readRequiredArtifact(artifactDir, "promotion-preflight.json"),
    canaryFlow: readRequiredArtifact(artifactDir, "promotion-canary-flow.json"),
    runtimeManifest: readRequiredArtifact(artifactDir, "promotion-runtime-manifest.json"),
    unifiedReport: readRequiredArtifact(artifactDir, "unified-promotion-report.json"),
    deployDecision: readRequiredArtifact(artifactDir, "promotion-deploy-decision.json"),
    cloudbuildContext: readRequiredArtifact(artifactDir, "promotion-cloudbuild-context.json"),
    liveCutoverReadiness: readOptionalArtifact(artifactDir, "v2_repair_live_cutover_readiness_latest.json"),
    productionCutoverReadiness: readOptionalArtifact(artifactDir, "v2_production_cutover_readiness_latest.json"),
    schedulerTrafficCutoverReadiness: readOptionalArtifact(artifactDir, "v2_scheduler_traffic_cutover_readiness_latest.json"),
  });
  const review = evaluateRunbookReview({
    artifactDir,
    expectedPositionCycleId,
    artifacts,
  });
  const outputFile = writeReviewArtifact(artifactDir, review);
  return Object.freeze({
    outputFile,
    review,
  });
}

async function main(env = process.env) {
  let result = null;
  try {
    result = runCanaryRunbookCheck(env);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_CANARY_RUNBOOK_CHECK_THROWN",
      error: {
        message: error && error.message ? error.message : String(error),
      },
    }));
    process.exit(1);
  }

  const payload = {
    ok: result.review.ok === true,
    reason: result.review.ok === true
      ? "V2_CANARY_RUNBOOK_CHECK_PASS"
      : "V2_CANARY_RUNBOOK_CHECK_BLOCKED",
    artifact_dir: result.review.artifact_dir,
    output_file: result.outputFile,
    expected_position_cycle_id: result.review.expected_position_cycle_id,
    fail_n: result.review.fail_n,
    skip_n: result.review.skip_n,
  };
  if (result.review.ok !== true) {
    console.error(JSON.stringify(payload));
    process.exit(1);
  }
  console.log(JSON.stringify(payload));
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("CHECK_V2_CANARY_RUNBOOK_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    runCanaryRunbookCheck,
    __test: {
      OUTPUT_FILENAME,
      trimOrNull,
      resolveArtifactDir,
      resolveExpectedPositionCycleId,
      hasBoundedRuntimeSummary,
      hasEvidenceSnapshotCoverage,
      hasEntryBoundaryAudit,
      hasFillSyncCanonicalBoundaryAudit,
      hasProductionCutoverAudit,
      hasCandidateSelectionContract,
      hasConsistentLineageContract,
      hasContextLineageHashMatch,
      resolvePathOrNull,
      hasContextArtifactDirCoherence,
      normalizeWarnings,
      normalizeArray,
      hasConsistentContextSubmitTrace,
      hasConsistentWarningSummary,
      collectExpectedWarningRunbookChecklist,
      hasLiveCutoverReadinessPlan,
      hasProductionCutoverReadinessPlan,
      hasSchedulerTrafficCutoverReadinessPlan,
      evaluateRunbookReview,
    },
  };
}
