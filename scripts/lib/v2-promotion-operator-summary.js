"use strict";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeObject(value) {
  return value && typeof value === "object" ? value : null;
}

function yesNoNa(value) {
  if (value === true) return "YES";
  if (value === false) return "NO";
  return "N/A";
}

function buildArtifactDirCoherenceFlags(summary) {
  const row = normalizeObject(summary);
  if (!row) return "N/A";
  return [
    `dir_resolved:${yesNoNa(row.artifact_dir_matches_resolved_artifact_dir)}`,
    `dir_cycle:${yesNoNa(row.artifact_dir_contains_position_cycle_id)}`,
    `resolved_cycle:${yesNoNa(row.resolved_artifact_dir_contains_position_cycle_id)}`,
    `context_cycle:${yesNoNa(row.context_cycle_matches_deploy_decision)}`,
  ].join("|");
}

function buildOperatorSummaryLines(summary) {
  const row = normalizeObject(summary) || {};
  const failedSubmitCheckIds = Array.isArray(row.failed_submit_check_ids) ? row.failed_submit_check_ids.filter(Boolean) : [];
  const failedRunbookChecklist = Array.isArray(row.failed_runbook_checklist) ? row.failed_runbook_checklist.filter(Boolean) : [];
  const blockerFamilies = Array.isArray(row.blocker_families) ? row.blocker_families.filter(Boolean) : [];
  const alertRunbookRefs = Array.isArray(row.alert_runbook_refs) ? row.alert_runbook_refs.filter(Boolean) : [];
  const deployWarningRunbookChecklist = Array.isArray(row.deploy_warning_runbook_checklist) ? row.deploy_warning_runbook_checklist.filter(Boolean) : [];
  const deployTopWarnings = Array.isArray(row.deploy_top_warnings) ? row.deploy_top_warnings.filter(Boolean) : [];
  const liveCutover = normalizeObject(row.live_cutover_readiness_summary);
  const productionCutover = normalizeObject(row.production_cutover_readiness_summary);
  const schedulerTrafficCollectorPreflight = normalizeObject(row.scheduler_traffic_collector_preflight_summary);
  const schedulerTrafficCutover = normalizeObject(row.scheduler_traffic_cutover_readiness_summary);
  const runbookReview = normalizeObject(row.runbook_review_summary);
  const artifactDirCoherence = normalizeObject(row.artifact_dir_coherence_summary);
  const lineageConsistency = normalizeObject(row.lineage_consistency_summary);
  const runbookReviewFailedCheckIds = Array.isArray(runbookReview && runbookReview.failed_check_ids)
    ? runbookReview.failed_check_ids.filter(Boolean)
    : [];
  const lines = [
    trimOrNull(row.headline) || "SUBMIT_STATUS_UNKNOWN",
    `status=${trimOrNull(row.status) || "UNKNOWN"}`,
    `primary_blocker_family=${trimOrNull(row.primary_blocker_family) || "NONE"}`,
    `protected_entry_canary_blocker=${blockerFamilies.includes("PROTECTED_ENTRY_CANARY") || failedSubmitCheckIds.includes("SUBMIT_CHK_20A") ? "YES" : "NO"}`,
    `alert_retry_attention=${row.alert_retry_attention_required === true ? "YES" : "NO"}`,
    `alert_runbook_refs=${alertRunbookRefs.length ? alertRunbookRefs.join(",") : "NONE"}`,
    `alert_failed=${Number.isFinite(Number(row.alert_failed_n)) ? Number(row.alert_failed_n) : 0}`,
    `alert_pending=${Number.isFinite(Number(row.alert_pending_n)) ? Number(row.alert_pending_n) : 0}`,
    `deploy_warning_attention=${row.deploy_warning_attention_required === true ? "YES" : "NO"}`,
    `deploy_warning_count=${Number.isFinite(Number(row.deploy_warning_n)) ? Number(row.deploy_warning_n) : 0}`,
    `deploy_warning_runbook=${deployWarningRunbookChecklist.length ? deployWarningRunbookChecklist.join(",") : "NONE"}`,
    `deploy_top_warnings=${deployTopWarnings.length ? deployTopWarnings.join("|") : "NONE"}`,
    `live_cutover_ready=${liveCutover ? (liveCutover.ok === true ? "YES" : "NO") : "N/A"}`,
    `live_cutover_auto_apply=${liveCutover ? (liveCutover.auto_apply === true ? "YES" : "NO") : "N/A"}`,
    `live_cutover_mutates_env=${liveCutover ? (liveCutover.mutates_environment === true ? "YES" : "NO") : "N/A"}`,
    `live_cutover_env_changes=${liveCutover && Number.isFinite(Number(liveCutover.required_env_change_n)) ? Number(liveCutover.required_env_change_n) : 0}`,
    `live_cutover_file=${trimOrNull(liveCutover && liveCutover.file) || "NONE"}`,
    `production_cutover_ready=${productionCutover ? (productionCutover.ok === true ? "YES" : "NO") : "N/A"}`,
    `production_cutover_legacy_blocked=${productionCutover ? (productionCutover.legacy_webhook_blocked === true ? "YES" : "NO") : "N/A"}`,
    `production_cutover_guard_reason=${trimOrNull(productionCutover && productionCutover.guard_reason) || "NONE"}`,
    `production_cutover_file=${trimOrNull(productionCutover && productionCutover.file) || "NONE"}`,
    `scheduler_collector_preflight=${schedulerTrafficCollectorPreflight ? (schedulerTrafficCollectorPreflight.ok === true ? "YES" : "NO") : "N/A"}`,
    `scheduler_collector_project=${trimOrNull(schedulerTrafficCollectorPreflight && schedulerTrafficCollectorPreflight.project_id) || "NONE"}`,
    `scheduler_collector_file=${trimOrNull(schedulerTrafficCollectorPreflight && schedulerTrafficCollectorPreflight.file) || "NONE"}`,
    `scheduler_traffic_ready=${schedulerTrafficCutover ? (schedulerTrafficCutover.ok === true ? "YES" : "NO") : "N/A"}`,
    `scheduler_traffic_sot=${trimOrNull(schedulerTrafficCutover && schedulerTrafficCutover.scheduler_sot) || "NONE"}`,
    `scheduler_traffic_legacy_active=${schedulerTrafficCutover && Number.isFinite(Number(schedulerTrafficCutover.active_legacy_scheduler_job_n)) ? Number(schedulerTrafficCutover.active_legacy_scheduler_job_n) : 0}`,
    `scheduler_traffic_file=${trimOrNull(schedulerTrafficCutover && schedulerTrafficCutover.file) || "NONE"}`,
    `runbook_review=${runbookReview ? (runbookReview.ok === true ? "YES" : "NO") : "N/A"}`,
    `runbook_review_failures=${runbookReview && Number.isFinite(Number(runbookReview.fail_n)) ? Number(runbookReview.fail_n) : 0}`,
    `runbook_review_failed_checks=${runbookReviewFailedCheckIds.length ? runbookReviewFailedCheckIds.join(",") : "NONE"}`,
    `runbook_review_file=${trimOrNull(runbookReview && runbookReview.file) || "NONE"}`,
    `artifact_dir_coherence=${artifactDirCoherence ? (artifactDirCoherence.ok === true ? "PASS" : "FAIL") : "N/A"}`,
    `artifact_dir_coherence_reason=${trimOrNull(artifactDirCoherence && artifactDirCoherence.reason) || "NONE"}`,
    `artifact_dir_coherence_flags=${buildArtifactDirCoherenceFlags(artifactDirCoherence)}`,
    `artifact_dir_coherence_file=${trimOrNull(artifactDirCoherence && artifactDirCoherence.file) || "NONE"}`,
    `lineage_consistency=${lineageConsistency ? (lineageConsistency.ok === true ? "PASS" : "FAIL") : "N/A"}`,
    `lineage_consistency_reason=${trimOrNull(lineageConsistency && lineageConsistency.reason) || "NONE"}`,
    `lineage_bounded_ok=${lineageConsistency ? yesNoNa(lineageConsistency.bounded_lineage_ok) : "N/A"}`,
    `lineage_context_hash_match=${lineageConsistency ? yesNoNa(lineageConsistency.context_hash_matches_deploy_decision) : "N/A"}`,
    `lineage_context_ok=${lineageConsistency ? yesNoNa(lineageConsistency.context_lineage_ok) : "N/A"}`,
    `failed_submit_checks=${failedSubmitCheckIds.length ? failedSubmitCheckIds.join(",") : "NONE"}`,
    `runbook_checklist=${failedRunbookChecklist.length ? failedRunbookChecklist.join(",") : "NONE"}`,
    `next_action=${trimOrNull(row.recommended_next_action) || "NONE"}`,
    `reason_code=${trimOrNull(row.recommended_next_action_reason_code) || "NONE"}`,
    `reason=${trimOrNull(row.recommended_next_action_reason) || "NONE"}`,
    `artifact_dir=${trimOrNull(row.artifact_dir) || "NONE"}`,
    `output_file=${trimOrNull(row.output_file) || "NONE"}`,
  ];
  return Object.freeze(lines);
}

function buildOperatorSummaryText(summary) {
  return buildOperatorSummaryLines(summary).join("\n");
}

function buildOperatorSummary(result) {
  const row = normalizeObject(result) || {};
  const request = normalizeObject(row.request) || {};
  const trace = normalizeObject(request.submit_trace_summary);
  const blocked = row.ok !== true || (trace && trace.ok === false);
  const failedSubmitCheckIds = Object.freeze(
    (Array.isArray(trace && trace.failed_submit_check_ids) ? trace.failed_submit_check_ids : [])
      .map((value) => trimOrNull(value))
      .filter(Boolean)
  );
  const failedRunbookChecklist = Object.freeze(
    (Array.isArray(trace && trace.failed_runbook_checklist) ? trace.failed_runbook_checklist : [])
      .map((value) => trimOrNull(value))
      .filter(Boolean)
  );
  const alertRunbookRefs = Object.freeze(
    (Array.isArray(trace && trace.alert_runbook_refs) ? trace.alert_runbook_refs : [])
      .map((value) => trimOrNull(value))
      .filter(Boolean)
  );
  const alertRetrySummary = normalizeObject(trace && trace.alert_retry_summary);
  const alertAttentionRequired = trace && trace.alert_retry_attention_required === true;
  const deployWarningSummary = normalizeObject(trace && trace.deploy_warning_summary);
  const deployWarningAttentionRequired = trace && trace.deploy_warning_attention_required === true;
  const deployWarningRunbookChecklist = Object.freeze(
    (Array.isArray(trace && trace.deploy_warning_runbook_checklist) ? trace.deploy_warning_runbook_checklist : [])
      .map((value) => trimOrNull(value))
      .filter(Boolean)
  );
  const deployTopWarnings = Object.freeze(
    (Array.isArray(deployWarningSummary && deployWarningSummary.top_warnings) ? deployWarningSummary.top_warnings : [])
      .map((value) => trimOrNull(value))
      .filter(Boolean)
  );
  const liveCutoverReadinessSummary = normalizeObject(trace && trace.live_cutover_readiness_summary);
  const productionCutoverReadinessSummary = normalizeObject(trace && trace.production_cutover_readiness_summary);
  const schedulerTrafficCollectorPreflightSummary = normalizeObject(trace && trace.scheduler_traffic_collector_preflight_summary);
  const schedulerTrafficCutoverReadinessSummary = normalizeObject(trace && trace.scheduler_traffic_cutover_readiness_summary);
  const runbookReviewSummary = normalizeObject(trace && trace.runbook_review_summary);
  const artifactDirCoherenceSummary = normalizeObject(trace && trace.artifact_dir_coherence_summary);
  const lineageConsistencySummary = normalizeObject(trace && trace.lineage_consistency_summary);
  const readyStatus = deployWarningAttentionRequired && alertAttentionRequired
    ? "SUBMIT_READY_WITH_ATTENTION"
    : (deployWarningAttentionRequired
      ? "SUBMIT_READY_WITH_DEPLOY_WARNING"
      : (alertAttentionRequired ? "SUBMIT_READY_WITH_ALERT_ATTENTION" : "SUBMIT_READY"));
  const headlineParts = [
    blocked ? "SUBMIT_BLOCKED" : readyStatus,
    trimOrNull(trace && trace.primary_blocker_family)
      || (deployWarningAttentionRequired ? "DEPLOY_WARNING" : (alertAttentionRequired ? "ALERT_ATTENTION" : "NO_BLOCKER_FAMILY")),
    failedSubmitCheckIds.length ? failedSubmitCheckIds.join(",") : "NO_FAILED_SUBMIT_CHECKS",
    failedRunbookChecklist.length
      ? `RUNBOOK:${failedRunbookChecklist.join(",")}`
      : (deployWarningRunbookChecklist.length
        ? `RUNBOOK:${deployWarningRunbookChecklist.join(",")}`
        : (alertRunbookRefs.length ? `RUNBOOK:${alertRunbookRefs.join(",")}` : "RUNBOOK:NONE")),
  ];
  const status = blocked ? "BLOCKED" : readyStatus.replace(/^SUBMIT_/, "");
  const headline = headlineParts.join(" | ");
  const primaryBlockerFamily = trimOrNull(trace && trace.primary_blocker_family);
  const recommendedNextAction = trimOrNull(trace && trace.recommended_next_action);
  const recommendedNextActionReason = trimOrNull(trace && trace.recommended_next_action_reason);
  const recommendedNextActionReasonCode = trimOrNull(trace && trace.recommended_next_action_reason_code);
  const artifactDir = trimOrNull(request.artifact_dir);
  const outputFile = trimOrNull(row.output_file);
  const lines = buildOperatorSummaryLines({
    status,
    headline,
    primary_blocker_family: primaryBlockerFamily,
    blocker_families: Array.isArray(trace && trace.blocker_families) ? trace.blocker_families : [],
    alert_retry_attention_required: alertAttentionRequired,
    alert_runbook_refs: alertRunbookRefs,
    alert_failed_n: alertRetrySummary && alertRetrySummary.failed_n,
    alert_pending_n: alertRetrySummary && alertRetrySummary.pending_n,
    deploy_warning_attention_required: deployWarningAttentionRequired,
    deploy_warning_n: deployWarningSummary && deployWarningSummary.warning_n,
    deploy_warning_runbook_checklist: deployWarningRunbookChecklist,
    deploy_top_warnings: deployTopWarnings,
    live_cutover_readiness_summary: liveCutoverReadinessSummary,
    production_cutover_readiness_summary: productionCutoverReadinessSummary,
    scheduler_traffic_collector_preflight_summary: schedulerTrafficCollectorPreflightSummary,
    scheduler_traffic_cutover_readiness_summary: schedulerTrafficCutoverReadinessSummary,
    runbook_review_summary: runbookReviewSummary,
    artifact_dir_coherence_summary: artifactDirCoherenceSummary,
    lineage_consistency_summary: lineageConsistencySummary,
    failed_submit_check_ids: failedSubmitCheckIds,
    failed_runbook_checklist: failedRunbookChecklist,
    recommended_next_action: recommendedNextAction,
    recommended_next_action_reason: recommendedNextActionReason,
    recommended_next_action_reason_code: recommendedNextActionReasonCode,
    artifact_dir: artifactDir,
    output_file: outputFile,
  });
  return Object.freeze({
    status,
    headline,
    primary_blocker_family: primaryBlockerFamily,
    alert_retry_attention_required: alertAttentionRequired,
    alert_runbook_refs: alertRunbookRefs,
    alert_failed_n: alertRetrySummary && alertRetrySummary.failed_n,
    alert_pending_n: alertRetrySummary && alertRetrySummary.pending_n,
    deploy_warning_attention_required: deployWarningAttentionRequired,
    deploy_warning_n: deployWarningSummary && deployWarningSummary.warning_n,
    deploy_warning_runbook_checklist: deployWarningRunbookChecklist,
    deploy_top_warnings: deployTopWarnings,
    live_cutover_readiness_summary: liveCutoverReadinessSummary,
    production_cutover_readiness_summary: productionCutoverReadinessSummary,
    scheduler_traffic_collector_preflight_summary: schedulerTrafficCollectorPreflightSummary,
    scheduler_traffic_cutover_readiness_summary: schedulerTrafficCutoverReadinessSummary,
    runbook_review_summary: runbookReviewSummary,
    artifact_dir_coherence_summary: artifactDirCoherenceSummary,
    lineage_consistency_summary: lineageConsistencySummary,
    failed_submit_check_ids: failedSubmitCheckIds,
    failed_runbook_checklist: failedRunbookChecklist,
    recommended_next_action: recommendedNextAction,
    recommended_next_action_reason: recommendedNextActionReason,
    recommended_next_action_reason_code: recommendedNextActionReasonCode,
    artifact_dir: artifactDir,
    output_file: outputFile,
    lines,
    text: lines.join("\n"),
  });
}

module.exports = {
  buildOperatorSummary,
  buildOperatorSummaryLines,
  buildOperatorSummaryText,
  __test: {
    trimOrNull,
    normalizeObject,
    yesNoNa,
    buildArtifactDirCoherenceFlags,
  },
};
