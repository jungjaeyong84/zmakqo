"use strict";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeObject(value) {
  return value && typeof value === "object" ? value : null;
}

function buildTraceLines(trace) {
  const row = normalizeObject(trace) || {};
  const failedSubmitCheckIds = Array.isArray(row.failed_submit_check_ids) ? row.failed_submit_check_ids.filter(Boolean) : [];
  const failedRunbookChecklist = Array.isArray(row.failed_runbook_checklist) ? row.failed_runbook_checklist.filter(Boolean) : [];
  const blockerFamilies = Array.isArray(row.blocker_families) ? row.blocker_families.filter(Boolean) : [];
  const alertRunbookRefs = Array.isArray(row.alert_runbook_refs) ? row.alert_runbook_refs.filter(Boolean) : [];
  const alertRetrySummary = normalizeObject(row.alert_retry_summary) || {};
  const deployWarningSummary = normalizeObject(row.deploy_warning_summary) || {};
  const deployWarningRunbookChecklist = Array.isArray(row.deploy_warning_runbook_checklist)
    ? row.deploy_warning_runbook_checklist.filter(Boolean)
    : [];
  const deployTopWarnings = Array.isArray(deployWarningSummary.top_warnings)
    ? deployWarningSummary.top_warnings.filter(Boolean)
    : [];
  const liveCutover = normalizeObject(row.live_cutover_readiness_summary);
  const productionCutover = normalizeObject(row.production_cutover_readiness_summary);
  const schedulerTrafficCollectorPreflight = normalizeObject(row.scheduler_traffic_collector_preflight_summary);
  const schedulerTrafficCutover = normalizeObject(row.scheduler_traffic_cutover_readiness_summary);
  const runbookReview = normalizeObject(row.runbook_review_summary);
  const runbookReviewFailedCheckIds = Array.isArray(runbookReview && runbookReview.failed_check_ids)
    ? runbookReview.failed_check_ids.filter(Boolean)
    : [];
  return Object.freeze([
    `failed_submit_checks=${failedSubmitCheckIds.length ? failedSubmitCheckIds.join(",") : "NONE"}`,
    `runbook_checklist=${failedRunbookChecklist.length ? failedRunbookChecklist.join(",") : "NONE"}`,
    `blocker_families=${blockerFamilies.length ? blockerFamilies.join(",") : "NONE"}`,
    `primary_blocker_family=${trimOrNull(row.primary_blocker_family) || "NONE"}`,
    `alert_retry_attention=${row.alert_retry_attention_required === true ? "YES" : "NO"}`,
    `alert_runbook_refs=${alertRunbookRefs.length ? alertRunbookRefs.join(",") : "NONE"}`,
    `alert_failed=${Number.isFinite(Number(alertRetrySummary.failed_n)) ? Number(alertRetrySummary.failed_n) : 0}`,
    `alert_pending=${Number.isFinite(Number(alertRetrySummary.pending_n)) ? Number(alertRetrySummary.pending_n) : 0}`,
    `deploy_warning_attention=${row.deploy_warning_attention_required === true ? "YES" : "NO"}`,
    `deploy_warning_count=${Number.isFinite(Number(deployWarningSummary.warning_n)) ? Number(deployWarningSummary.warning_n) : 0}`,
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
    `next_action=${trimOrNull(row.recommended_next_action) || "NONE"}`,
    `reason_code=${trimOrNull(row.recommended_next_action_reason_code) || "NONE"}`,
  ]);
}

function buildOperatorAlertPreview(result) {
  const row = normalizeObject(result) || {};
  const request = normalizeObject(row.request) || {};
  const summary = normalizeObject(request.operator_summary);
  const trace = normalizeObject(request.submit_trace_summary);
  if (!summary || !Array.isArray(summary.lines) || !trimOrNull(summary.text)) {
    throw new Error("V2_PROMOTION_OPERATOR_SUMMARY_REQUIRED");
  }
  const status = trimOrNull(summary.status) || (row.ok === true ? "READY" : "BLOCKED");
  const readyWithAlertAttention = status === "READY_WITH_ALERT_ATTENTION";
  const readyWithDeployWarning = status === "READY_WITH_DEPLOY_WARNING";
  const readyWithAttention = status === "READY_WITH_ATTENTION";
  const severity = status === "READY"
    ? "INFO"
    : "WARN";
  let title = "V2 Promotion Submit Ready";
  if (status === "BLOCKED") title = "V2 Promotion Submit Blocked";
  else if (readyWithAttention) title = "V2 Promotion Submit Ready With Attention";
  else if (readyWithDeployWarning) title = "V2 Promotion Submit Ready With Deploy Warning";
  else if (readyWithAlertAttention) title = "V2 Promotion Submit Ready With Alert Attention";
  const artifactDir = trimOrNull(request.artifact_dir);
  const outputFile = trimOrNull(row.output_file);
  return Object.freeze({
    required: true,
    source: "promotion-cloudbuild-submit-request",
    severity,
    title,
    dedupe_key: `v2-promotion-submit:${status}:${artifactDir || outputFile || "NO_ARTIFACT"}`,
    summary_text: trimOrNull(summary.text),
    sections: Object.freeze([
      Object.freeze({
        header: "정본 요약",
        lines: Object.freeze(summary.lines.slice()),
      }),
      Object.freeze({
        header: "추적 정보",
        lines: buildTraceLines(trace),
      }),
    ]),
  });
}

function buildTelegramSummaryArgs(preview, { provider = "BINANCEFUT" } = {}) {
  const row = normalizeObject(preview);
  if (!row) throw new Error("V2_PROMOTION_OPERATOR_ALERT_PREVIEW_REQUIRED");
  return Object.freeze({
    title: trimOrNull(row.title) || "V2 Promotion Submit Status",
    severity: trimOrNull(row.severity) || "WARN",
    sections: Array.isArray(row.sections)
      ? row.sections.map((section) => Object.freeze({
          header: trimOrNull(section && section.header),
          lines: Object.freeze(Array.isArray(section && section.lines) ? section.lines.filter(Boolean) : []),
        }))
      : [],
    provider: trimOrNull(provider) || "BINANCEFUT",
    dedupeKey: trimOrNull(row.dedupe_key),
  });
}

module.exports = {
  buildOperatorAlertPreview,
  buildTelegramSummaryArgs,
  __test: {
    trimOrNull,
    normalizeObject,
    buildTraceLines,
  },
};
