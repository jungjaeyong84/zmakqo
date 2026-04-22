#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const operatorSummary = require("./lib/v2-promotion-operator-summary");
const operatorAlertPreview = require("./lib/v2-promotion-submit-operator-alert");

const SHARED_FORMATTER_DOC_PATH = "scripts/lib/v2-promotion-operator-summary.js";
const SHARED_ALERT_PREVIEW_DOC_PATH = "scripts/lib/v2-promotion-submit-operator-alert.js";
const SHARED_FORMATTER_MODULE_PATH = path.resolve(__dirname, "lib", "v2-promotion-operator-summary.js");
const SHARED_ALERT_PREVIEW_MODULE_PATH = path.resolve(__dirname, "lib", "v2-promotion-submit-operator-alert.js");

const FILES = Object.freeze({
  artifactContract: path.resolve(__dirname, "..", "docs", "DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md"),
  runbook: path.resolve(__dirname, "..", "docs", "DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md"),
  runbookChecker: path.resolve(__dirname, "check-v2-canary-runbook.js"),
  cloudbuildWrapper: path.resolve(__dirname, "run-v2-promotion-cloudbuild.js"),
  submitWrapper: path.resolve(__dirname, "submit-v2-promotion-cloudbuild.js"),
  submitTrace: path.resolve(__dirname, "lib", "v2-promotion-submit-trace.js"),
  renderScript: path.resolve(__dirname, "render-v2-promotion-submit-operator-alert.js"),
  sendScript: path.resolve(__dirname, "send-v2-promotion-submit-operator-alert.js"),
  packageJson: path.resolve(__dirname, "..", "package.json"),
  cloudbuild: path.resolve(__dirname, "..", "cloudbuild.yaml"),
  openclawCronRoutes: path.resolve(__dirname, "..", "src", "routes", "openclaw.cron.routes.js"),
  openclawCronManifest: path.resolve(__dirname, "lib", "openclaw-cron-manifest.js"),
  productionCutoverAudit: path.resolve(__dirname, "..", "src", "v2", "productionCutoverAudit.js"),
  productionRuntimeConfigAudit: path.resolve(__dirname, "..", "src", "v2", "productionRuntimeConfigAudit.js"),
  exitRuntimeCanaryRunner: path.resolve(__dirname, "run-v2-exit-runtime-canary.js"),
  exitRuntimeCanaryModule: path.resolve(__dirname, "..", "src", "v2", "exitRuntimeCanary.js"),
  unifiedPromotionReportGenerator: path.resolve(__dirname, "generate-v2-unified-promotion-report.js"),
  deployDecisionChecker: path.resolve(__dirname, "check-v2-promotion-deploy-decision.js"),
  repairFirestoreStreakChecker: path.resolve(__dirname, "check-v2-repair-queue-firestore-canary-streak.js"),
  productionEntryRouteStreakChecker: path.resolve(__dirname, "check-v2-production-entry-route-canary-streak.js"),
  exitRuntimeStreakChecker: path.resolve(__dirname, "check-v2-exit-runtime-canary-streak.js"),
  liveEvidenceReadinessChecker: path.resolve(__dirname, "check-v2-live-evidence-readiness.js"),
  productionRuntimeChainChecker: path.resolve(__dirname, "check-v2-production-runtime-chain.js"),
  productionRuntimeChainAudit: path.resolve(__dirname, "..", "src", "v2", "productionRuntimeChainAudit.js"),
});

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function readText(filePath) {
  return fs.readFileSync(path.resolve(filePath), "utf8");
}

function buildCheck({ id, label, ok, reason, file }) {
  return Object.freeze({
    id,
    label,
    ok: ok === true,
    reason: trimOrNull(reason),
    file: trimOrNull(file),
  });
}

function buildFormatterFixtureResult() {
  return operatorSummary.buildOperatorSummary({
    ok: false,
    output_file: "/tmp/fake-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__OPS__01",
      submit_trace_summary: {
        ok: false,
        primary_blocker_family: "PROVENANCE",
        alert_retry_attention_required: false,
        alert_runbook_refs: [],
        alert_retry_summary: null,
        failed_submit_check_ids: ["SUBMIT_CHK_08"],
        failed_runbook_checklist: ["16", "17"],
        lineage_consistency_summary: {
          ok: false,
          reason: "CLOUDBUILD_CONTEXT_DEPLOY_DECISION_LINEAGE_MISMATCH",
          bounded_lineage_ok: true,
          context_hash_matches_deploy_decision: false,
          context_lineage_ok: true,
        },
        recommended_next_action: "DISCARD_ARTIFACT_DIR_AND_RERUN_FROM_PREFLIGHT",
        recommended_next_action_reason: "bounded lineage or approval contract integrity failed",
        recommended_next_action_reason_code: "PROVENANCE_OR_CONTRACT_BLOCKER",
      },
    },
  });
}

function buildLiveCutoverFormatterFixtureResult() {
  return operatorSummary.buildOperatorSummary({
    ok: true,
    output_file: "/tmp/live-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__LIVE__01",
      submit_trace_summary: {
        ok: true,
        primary_blocker_family: null,
        alert_retry_attention_required: false,
        alert_runbook_refs: [],
        alert_retry_summary: null,
        deploy_warning_attention_required: false,
        deploy_warning_summary: null,
        failed_submit_check_ids: [],
        failed_runbook_checklist: [],
        live_cutover_readiness_summary: {
          ok: true,
          auto_apply: false,
          mutates_environment: false,
          required_env_change_n: 4,
          file: "/tmp/v2/PCY__LIVE__01/v2_repair_live_cutover_readiness_latest.json",
        },
        production_cutover_readiness_summary: {
          ok: true,
          reason: "V2_PRODUCTION_CUTOVER_READINESS_PASS",
          blocker_n: 0,
          guard_reason: "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED",
          legacy_webhook_blocked: true,
          v2_enabled: true,
          v2_dry_run: false,
          v2_canary_only: false,
          require_production_cutover: true,
          block_legacy_webhook_signal: true,
          allow_legacy_webhook_signal: false,
          file: "/tmp/v2/PCY__LIVE__01/v2_production_cutover_readiness_latest.json",
        },
        scheduler_traffic_collector_preflight_summary: {
          ok: true,
          reason: "V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_PASS",
          blocker_n: 0,
          project_id: "donbeolja-dev",
          region: "asia-northeast3",
          service_names: ["donbeolja", "donbeolja-exit-worker"],
          scheduler_job_n: 0,
          required_env_names: [
            "SCHEDULER_AUTOSTART",
            "DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE",
            "DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED",
            "DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE",
          ],
          required_env_exact_match_n: 2,
          required_env_mismatch_n: 0,
          file: "/tmp/v2/PCY__LIVE__01/v2_scheduler_traffic_collector_preflight_latest.json",
        },
        scheduler_traffic_cutover_readiness_summary: {
          ok: true,
          reason: "V2_SCHEDULER_TRAFFIC_CUTOVER_READINESS_PASS",
          blocker_n: 0,
          scheduler_sot: "OPENCLAW_CRON",
          missing_openclaw_job_ids: [],
          active_legacy_scheduler_job_n: 0,
          cloud_run_services: [
            { scheduler_autostart: "0", scheduler_cutover_mode: "OPENCLAW_CRON", traffic_percent: 100, latest_revision_ready: true },
            { scheduler_autostart: "0", scheduler_cutover_mode: "OPENCLAW_CRON", traffic_percent: 100, latest_revision_ready: true },
          ],
          file: "/tmp/v2/PCY__LIVE__01/v2_scheduler_traffic_cutover_readiness_latest.json",
        },
        runbook_review_summary: {
          ok: true,
          overall_status: "PASS",
          fail_n: 0,
          failed_check_ids: [],
          file: "/tmp/v2/PCY__LIVE__01/promotion-runbook-review.json",
        },
        recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
        recommended_next_action_reason: "all bounded submit verification checks passed",
        recommended_next_action_reason_code: "ALL_CHECKS_PASSED",
      },
    },
  });
}

function buildLiveCutoverAlertPreviewFixtureResult() {
  const summary = buildLiveCutoverFormatterFixtureResult();
  return operatorAlertPreview.buildOperatorAlertPreview({
    ok: true,
    output_file: "/tmp/live-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__LIVE__01",
      submit_trace_summary: {
        ok: true,
        primary_blocker_family: null,
        alert_retry_attention_required: false,
        alert_runbook_refs: [],
        alert_retry_summary: null,
        deploy_warning_attention_required: false,
        deploy_warning_summary: null,
        failed_submit_check_ids: [],
        failed_runbook_checklist: [],
        live_cutover_readiness_summary: {
          ok: true,
          auto_apply: false,
          mutates_environment: false,
          required_env_change_n: 4,
          file: "/tmp/v2/PCY__LIVE__01/v2_repair_live_cutover_readiness_latest.json",
        },
        production_cutover_readiness_summary: {
          ok: true,
          reason: "V2_PRODUCTION_CUTOVER_READINESS_PASS",
          blocker_n: 0,
          guard_reason: "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED",
          legacy_webhook_blocked: true,
          v2_enabled: true,
          v2_dry_run: false,
          v2_canary_only: false,
          require_production_cutover: true,
          block_legacy_webhook_signal: true,
          allow_legacy_webhook_signal: false,
          file: "/tmp/v2/PCY__LIVE__01/v2_production_cutover_readiness_latest.json",
        },
        scheduler_traffic_collector_preflight_summary: {
          ok: true,
          reason: "V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_PASS",
          blocker_n: 0,
          project_id: "donbeolja-dev",
          region: "asia-northeast3",
          service_names: ["donbeolja", "donbeolja-exit-worker"],
          scheduler_job_n: 0,
          required_env_names: [
            "SCHEDULER_AUTOSTART",
            "DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE",
            "DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED",
            "DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE",
          ],
          required_env_exact_match_n: 2,
          required_env_mismatch_n: 0,
          file: "/tmp/v2/PCY__LIVE__01/v2_scheduler_traffic_collector_preflight_latest.json",
        },
        scheduler_traffic_cutover_readiness_summary: {
          ok: true,
          reason: "V2_SCHEDULER_TRAFFIC_CUTOVER_READINESS_PASS",
          blocker_n: 0,
          scheduler_sot: "OPENCLAW_CRON",
          missing_openclaw_job_ids: [],
          active_legacy_scheduler_job_n: 0,
          cloud_run_services: [
            { scheduler_autostart: "0", scheduler_cutover_mode: "OPENCLAW_CRON", traffic_percent: 100, latest_revision_ready: true },
            { scheduler_autostart: "0", scheduler_cutover_mode: "OPENCLAW_CRON", traffic_percent: 100, latest_revision_ready: true },
          ],
          file: "/tmp/v2/PCY__LIVE__01/v2_scheduler_traffic_cutover_readiness_latest.json",
        },
        runbook_review_summary: {
          ok: true,
          overall_status: "PASS",
          fail_n: 0,
          failed_check_ids: [],
          file: "/tmp/v2/PCY__LIVE__01/promotion-runbook-review.json",
        },
        recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
        recommended_next_action_reason: "all bounded submit verification checks passed",
        recommended_next_action_reason_code: "ALL_CHECKS_PASSED",
      },
      operator_summary: summary,
    },
  });
}

function buildDeployWarningFormatterFixtureResult() {
  return operatorSummary.buildOperatorSummary({
    ok: true,
    output_file: "/tmp/warning-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__WARNING__01",
      submit_trace_summary: {
        ok: true,
        primary_blocker_family: null,
        alert_retry_attention_required: false,
        alert_runbook_refs: [],
        alert_retry_summary: null,
        deploy_warning_attention_required: true,
        deploy_warning_runbook_checklist: ["26"],
        deploy_warning_summary: {
          warning_n: 1,
          top_warnings: ["DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"],
          has_live_readiness_warning: true,
          has_repair_firestore_canary_streak_warning: false,
          has_production_entry_route_canary_streak_warning: true,
        },
        failed_submit_check_ids: [],
        failed_runbook_checklist: [],
        recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
        recommended_next_action_reason: "all bounded submit verification checks passed",
        recommended_next_action_reason_code: "ALL_CHECKS_PASSED",
      },
    },
  });
}

function buildDeployWarningAlertPreviewFixtureResult() {
  const summary = buildDeployWarningFormatterFixtureResult();
  return operatorAlertPreview.buildOperatorAlertPreview({
    ok: true,
    output_file: "/tmp/warning-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__WARNING__01",
      submit_trace_summary: {
        ok: true,
        primary_blocker_family: null,
        alert_retry_attention_required: false,
        alert_runbook_refs: [],
        alert_retry_summary: null,
        deploy_warning_attention_required: true,
        deploy_warning_runbook_checklist: ["26"],
        deploy_warning_summary: {
          warning_n: 1,
          top_warnings: ["DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"],
          has_live_readiness_warning: true,
          has_repair_firestore_canary_streak_warning: false,
          has_production_entry_route_canary_streak_warning: true,
        },
        failed_submit_check_ids: [],
        failed_runbook_checklist: [],
        recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
        recommended_next_action_reason: "all bounded submit verification checks passed",
        recommended_next_action_reason_code: "ALL_CHECKS_PASSED",
      },
      operator_summary: summary,
    },
  });
}

function evaluateSubmitContract({ textOverrides = {} } = {}) {
  const overrides = new Map(Object.entries(textOverrides || {}).map(([filePath, value]) => [path.resolve(filePath), String(value)]));
  const readContractText = (filePath) => {
    const resolved = path.resolve(filePath);
    return overrides.has(resolved) ? overrides.get(resolved) : readText(resolved);
  };
  const artifactContractText = readContractText(FILES.artifactContract);
  const runbookText = readContractText(FILES.runbook);
  const runbookCheckerText = readContractText(FILES.runbookChecker);
  const cloudbuildWrapperText = readContractText(FILES.cloudbuildWrapper);
  const submitWrapperText = readContractText(FILES.submitWrapper);
  const submitTraceText = readContractText(FILES.submitTrace);
  const packageJsonText = readContractText(FILES.packageJson);
  const cloudbuildText = readContractText(FILES.cloudbuild);
  const openclawCronRoutesText = readContractText(FILES.openclawCronRoutes);
  const openclawCronManifestText = readContractText(FILES.openclawCronManifest);
  const productionCutoverAuditText = readContractText(FILES.productionCutoverAudit);
  const productionRuntimeConfigAuditText = readContractText(FILES.productionRuntimeConfigAudit);
  const exitRuntimeCanaryRunnerText = readContractText(FILES.exitRuntimeCanaryRunner);
  const exitRuntimeCanaryModuleText = readContractText(FILES.exitRuntimeCanaryModule);
  const unifiedPromotionReportGeneratorText = readContractText(FILES.unifiedPromotionReportGenerator);
  const deployDecisionCheckerText = readContractText(FILES.deployDecisionChecker);
  const repairFirestoreStreakCheckerText = readContractText(FILES.repairFirestoreStreakChecker);
  const productionEntryRouteStreakCheckerText = readContractText(FILES.productionEntryRouteStreakChecker);
  const exitRuntimeStreakCheckerText = readContractText(FILES.exitRuntimeStreakChecker);
  const liveEvidenceReadinessCheckerText = readContractText(FILES.liveEvidenceReadinessChecker);
  const operatorSummaryText = readText(SHARED_FORMATTER_MODULE_PATH);
  const operatorAlertPreviewText = readText(SHARED_ALERT_PREVIEW_MODULE_PATH);
  const summary = buildFormatterFixtureResult();
  const summaryPreview = operatorAlertPreview.buildOperatorAlertPreview({
    ok: false,
    output_file: "/tmp/fake-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__OPS__01",
      submit_trace_summary: {
        ok: false,
        primary_blocker_family: "PROVENANCE",
        failed_submit_check_ids: ["SUBMIT_CHK_08"],
        failed_runbook_checklist: ["16", "17"],
        lineage_consistency_summary: {
          ok: false,
          reason: "CLOUDBUILD_CONTEXT_DEPLOY_DECISION_LINEAGE_MISMATCH",
          bounded_lineage_ok: true,
          context_hash_matches_deploy_decision: false,
          context_lineage_ok: true,
        },
      },
      operator_summary: summary,
    },
  });
  const alertPreviewTraceLines = Array.isArray(summaryPreview.sections && summaryPreview.sections[1] && summaryPreview.sections[1].lines)
    ? summaryPreview.sections[1].lines
    : [];
  const liveCutoverSummary = buildLiveCutoverFormatterFixtureResult();
  const liveCutoverPreview = buildLiveCutoverAlertPreviewFixtureResult();
  const liveCutoverPreviewTraceLines = Array.isArray(liveCutoverPreview.sections && liveCutoverPreview.sections[1] && liveCutoverPreview.sections[1].lines)
    ? liveCutoverPreview.sections[1].lines
    : [];
  const deployWarningSummary = buildDeployWarningFormatterFixtureResult();
  const deployWarningPreview = buildDeployWarningAlertPreviewFixtureResult();
  const deployWarningPreviewTraceLines = Array.isArray(deployWarningPreview.sections && deployWarningPreview.sections[1] && deployWarningPreview.sections[1].lines)
    ? deployWarningPreview.sections[1].lines
    : [];
  const artifactDirCoherenceFixtureTrace = Object.freeze({
    ok: false,
    primary_blocker_family: "PROVENANCE",
    failed_submit_check_ids: ["SUBMIT_CHK_01A"],
    failed_runbook_checklist: ["1", "5", "9"],
    artifact_dir_coherence_summary: {
      ok: false,
      reason: "ARTIFACT_DIR_RESOLVED_DIR_MISMATCH",
      artifact_dir_matches_resolved_artifact_dir: false,
      artifact_dir_contains_position_cycle_id: true,
      resolved_artifact_dir_contains_position_cycle_id: true,
      context_cycle_matches_deploy_decision: true,
      file: "/tmp/v2/PCY__OPS__01/promotion-cloudbuild-context.json",
    },
    recommended_next_action: "DISCARD_ARTIFACT_DIR_AND_RERUN_FROM_PREFLIGHT",
    recommended_next_action_reason: "artifact dir self-check failed",
    recommended_next_action_reason_code: "PROVENANCE_BLOCKER",
  });
  const artifactDirCoherenceSummary = operatorSummary.buildOperatorSummary({
    ok: false,
    output_file: "/tmp/fake-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__OPS__01",
      submit_trace_summary: artifactDirCoherenceFixtureTrace,
    },
  });
  const artifactDirCoherencePreview = operatorAlertPreview.buildOperatorAlertPreview({
    ok: false,
    output_file: "/tmp/fake-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__OPS__01",
      submit_trace_summary: artifactDirCoherenceFixtureTrace,
      operator_summary: artifactDirCoherenceSummary,
    },
  });
  const artifactDirCoherencePreviewTraceLines = Array.isArray(
    artifactDirCoherencePreview.sections
    && artifactDirCoherencePreview.sections[1]
    && artifactDirCoherencePreview.sections[1].lines
  )
    ? artifactDirCoherencePreview.sections[1].lines
    : [];
  const staleArtifactProvenanceTrace = Object.freeze({
    ok: false,
    primary_blocker_family: "STALE_ARTIFACT_PROVENANCE",
    blocker_families: ["STALE_ARTIFACT_PROVENANCE", "BOUNDED_RUNTIME"],
    failed_submit_check_ids: ["SUBMIT_CHK_11"],
    failed_runbook_checklist: ["19"],
    recommended_next_action: "DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE",
    recommended_next_action_reason: "required canary or streak evidence is stale",
    recommended_next_action_reason_code: "STALE_ARTIFACT_PROVENANCE_BLOCKER",
  });
  const staleArtifactProvenanceSummary = operatorSummary.buildOperatorSummary({
    ok: false,
    output_file: "/tmp/stale-artifact-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__STALE__01",
      submit_trace_summary: staleArtifactProvenanceTrace,
    },
  });
  const staleArtifactProvenancePreview = operatorAlertPreview.buildOperatorAlertPreview({
    ok: false,
    output_file: "/tmp/stale-artifact-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__STALE__01",
      submit_trace_summary: staleArtifactProvenanceTrace,
      operator_summary: staleArtifactProvenanceSummary,
    },
  });
  const staleArtifactProvenancePreviewTraceLines = Array.isArray(
    staleArtifactProvenancePreview.sections
    && staleArtifactProvenancePreview.sections[1]
    && staleArtifactProvenancePreview.sections[1].lines
  )
    ? staleArtifactProvenancePreview.sections[1].lines
    : [];
  const liveEvidenceCycleTrace = Object.freeze({
    ok: false,
    primary_blocker_family: "LIVE_EVIDENCE_CYCLE",
    blocker_families: ["LIVE_EVIDENCE_CYCLE", "CONTEXT"],
    failed_submit_check_ids: ["SUBMIT_CHK_07"],
    failed_runbook_checklist: ["13"],
    recommended_next_action: "DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE",
    recommended_next_action_reason: "LIVE evidence artifacts disagree on the selected position cycle",
    recommended_next_action_reason_code: "LIVE_EVIDENCE_CYCLE_BLOCKER",
  });
  const liveEvidenceCycleSummary = operatorSummary.buildOperatorSummary({
    ok: false,
    output_file: "/tmp/live-evidence-cycle-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__LIVE_EVIDENCE__01",
      submit_trace_summary: liveEvidenceCycleTrace,
    },
  });
  const liveEvidenceCyclePreview = operatorAlertPreview.buildOperatorAlertPreview({
    ok: false,
    output_file: "/tmp/live-evidence-cycle-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__LIVE_EVIDENCE__01",
      submit_trace_summary: liveEvidenceCycleTrace,
      operator_summary: liveEvidenceCycleSummary,
    },
  });
  const liveEvidenceCyclePreviewTraceLines = Array.isArray(
    liveEvidenceCyclePreview.sections
    && liveEvidenceCyclePreview.sections[1]
    && liveEvidenceCyclePreview.sections[1].lines
  )
    ? liveEvidenceCyclePreview.sections[1].lines
    : [];
  const openClawSupremeTrace = Object.freeze({
    ok: false,
    primary_blocker_family: "OPENCLAW_SUPREME_CONTROL_PLANE",
    blocker_families: ["OPENCLAW_SUPREME_CONTROL_PLANE"],
    failed_submit_check_ids: ["SUBMIT_CHK_23"],
    failed_runbook_checklist: ["31"],
    recommended_next_action: "FIX_OPENCLAW_SUPREME_CONTROL_PLANE_AND_RECHECK_DEPLOY_DECISION",
    recommended_next_action_reason: "OpenClaw supreme closed-loop evidence is missing or inconsistent",
    recommended_next_action_reason_code: "OPENCLAW_SUPREME_CONTROL_PLANE_BLOCKER",
  });
  const openClawSupremeSummary = operatorSummary.buildOperatorSummary({
    ok: false,
    output_file: "/tmp/openclaw-supreme-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__OPENCLAW_SUPREME__01",
      submit_trace_summary: openClawSupremeTrace,
    },
  });
  const openClawSupremePreview = operatorAlertPreview.buildOperatorAlertPreview({
    ok: false,
    output_file: "/tmp/openclaw-supreme-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__OPENCLAW_SUPREME__01",
      submit_trace_summary: openClawSupremeTrace,
      operator_summary: openClawSupremeSummary,
    },
  });
  const openClawSupremePreviewTraceLines = Array.isArray(
    openClawSupremePreview.sections
    && openClawSupremePreview.sections[1]
    && openClawSupremePreview.sections[1].lines
  )
    ? openClawSupremePreview.sections[1].lines
    : [];
  const staleSourceTrace = {
    ok: false,
    failed_submit_check_ids: ["SUBMIT_CHK_08"],
    failed_runbook_checklist: ["16", "17"],
    primary_blocker_family: "PROVENANCE",
  };
  const staleSourceSummary = operatorSummary.buildOperatorSummary({
    ok: false,
    output_file: "/tmp/fingerprint-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__FINGERPRINT__01",
      submit_trace_summary: staleSourceTrace,
    },
  });
  const staleSourcePreview = operatorAlertPreview.buildOperatorAlertPreview({
    ok: false,
    output_file: "/tmp/fingerprint-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__FINGERPRINT__01",
      submit_trace_summary: staleSourceTrace,
      operator_summary: staleSourceSummary,
    },
  });
  const changedSourcePreview = operatorAlertPreview.buildOperatorAlertPreview({
    ok: false,
    output_file: "/tmp/fingerprint-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__FINGERPRINT__01",
      submit_trace_summary: {
        ...staleSourceTrace,
        failed_submit_check_ids: ["SUBMIT_CHK_01A"],
      },
      operator_summary: staleSourceSummary,
    },
  });
  const checks = [
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_01",
      label: "artifact contract references shared operator summary formatter",
      ok: artifactContractText.includes(SHARED_FORMATTER_DOC_PATH),
      reason: artifactContractText.includes(SHARED_FORMATTER_DOC_PATH)
        ? "artifact contract points to shared formatter module"
        : "artifact contract must point to shared formatter module",
      file: FILES.artifactContract,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_02",
      label: "runbook references shared operator summary formatter",
      ok: runbookText.includes(SHARED_FORMATTER_DOC_PATH),
      reason: runbookText.includes(SHARED_FORMATTER_DOC_PATH)
        ? "runbook points to shared formatter module"
        : "runbook must point to shared formatter module",
      file: FILES.runbook,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_03",
      label: "submit wrapper imports shared operator summary formatter",
      ok: submitWrapperText.includes('const operatorSummary = require("./lib/v2-promotion-operator-summary");'),
      reason: submitWrapperText.includes('const operatorSummary = require("./lib/v2-promotion-operator-summary");')
        ? "submit wrapper imports shared formatter module"
        : "submit wrapper must import shared formatter module",
      file: FILES.submitWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_04",
      label: "submit wrapper does not redefine operator summary builders",
      ok: !/function\s+buildOperatorSummary(Text|Lines)?\s*\(/.test(submitWrapperText),
      reason: !/function\s+buildOperatorSummary(Text|Lines)?\s*\(/.test(submitWrapperText)
        ? "submit wrapper has no local operator summary builder"
        : "submit wrapper must not redefine operator summary builders",
      file: FILES.submitWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_05",
      label: "shared formatter line order is stable",
      ok: JSON.stringify(summary.lines) === JSON.stringify([
        "SUBMIT_BLOCKED | PROVENANCE | SUBMIT_CHK_08 | RUNBOOK:16,17",
        "status=BLOCKED",
        "primary_blocker_family=PROVENANCE",
        "protected_entry_canary_blocker=NO",
        "stale_artifact_provenance_blocker=NO",
        "live_evidence_cycle_blocker=NO",
        "openclaw_supreme_blocker=NO",
        "alert_retry_attention=NO",
        "alert_runbook_refs=NONE",
        "alert_failed=0",
        "alert_pending=0",
        "deploy_warning_attention=NO",
        "deploy_warning_count=0",
        "deploy_warning_runbook=NONE",
        "deploy_top_warnings=NONE",
        "live_cutover_ready=N/A",
        "live_cutover_auto_apply=N/A",
        "live_cutover_mutates_env=N/A",
        "live_cutover_env_changes=0",
        "live_cutover_file=NONE",
        "production_cutover_ready=N/A",
        "production_cutover_legacy_blocked=N/A",
        "production_cutover_guard_reason=NONE",
        "production_cutover_file=NONE",
        "scheduler_collector_preflight=N/A",
        "scheduler_collector_project=NONE",
        "scheduler_collector_file=NONE",
        "scheduler_traffic_ready=N/A",
        "scheduler_traffic_sot=NONE",
        "scheduler_traffic_legacy_active=0",
        "scheduler_traffic_file=NONE",
        "runbook_review=N/A",
        "runbook_review_failures=0",
        "runbook_review_failed_checks=NONE",
        "runbook_review_file=NONE",
        "artifact_dir_coherence=N/A",
        "artifact_dir_coherence_reason=NONE",
        "artifact_dir_coherence_flags=N/A",
        "artifact_dir_coherence_file=NONE",
        "lineage_consistency=FAIL",
        "lineage_consistency_reason=CLOUDBUILD_CONTEXT_DEPLOY_DECISION_LINEAGE_MISMATCH",
        "lineage_bounded_ok=YES",
        "lineage_context_hash_match=NO",
        "lineage_context_ok=YES",
        "failed_submit_checks=SUBMIT_CHK_08",
        "failed_submit_check_details=NONE",
        "runbook_checklist=16,17",
        "next_action=DISCARD_ARTIFACT_DIR_AND_RERUN_FROM_PREFLIGHT",
        "reason_code=PROVENANCE_OR_CONTRACT_BLOCKER",
        "reason=bounded lineage or approval contract integrity failed",
        "artifact_dir=/tmp/v2/PCY__OPS__01",
        "output_file=/tmp/fake-submit-request.json",
      ]),
      reason: JSON.stringify(summary.lines) === JSON.stringify([
        "SUBMIT_BLOCKED | PROVENANCE | SUBMIT_CHK_08 | RUNBOOK:16,17",
        "status=BLOCKED",
        "primary_blocker_family=PROVENANCE",
        "protected_entry_canary_blocker=NO",
        "stale_artifact_provenance_blocker=NO",
        "live_evidence_cycle_blocker=NO",
        "openclaw_supreme_blocker=NO",
        "alert_retry_attention=NO",
        "alert_runbook_refs=NONE",
        "alert_failed=0",
        "alert_pending=0",
        "deploy_warning_attention=NO",
        "deploy_warning_count=0",
        "deploy_warning_runbook=NONE",
        "deploy_top_warnings=NONE",
        "live_cutover_ready=N/A",
        "live_cutover_auto_apply=N/A",
        "live_cutover_mutates_env=N/A",
        "live_cutover_env_changes=0",
        "live_cutover_file=NONE",
        "production_cutover_ready=N/A",
        "production_cutover_legacy_blocked=N/A",
        "production_cutover_guard_reason=NONE",
        "production_cutover_file=NONE",
        "scheduler_collector_preflight=N/A",
        "scheduler_collector_project=NONE",
        "scheduler_collector_file=NONE",
        "scheduler_traffic_ready=N/A",
        "scheduler_traffic_sot=NONE",
        "scheduler_traffic_legacy_active=0",
        "scheduler_traffic_file=NONE",
        "runbook_review=N/A",
        "runbook_review_failures=0",
        "runbook_review_failed_checks=NONE",
        "runbook_review_file=NONE",
        "artifact_dir_coherence=N/A",
        "artifact_dir_coherence_reason=NONE",
        "artifact_dir_coherence_flags=N/A",
        "artifact_dir_coherence_file=NONE",
        "lineage_consistency=FAIL",
        "lineage_consistency_reason=CLOUDBUILD_CONTEXT_DEPLOY_DECISION_LINEAGE_MISMATCH",
        "lineage_bounded_ok=YES",
        "lineage_context_hash_match=NO",
        "lineage_context_ok=YES",
        "failed_submit_checks=SUBMIT_CHK_08",
        "failed_submit_check_details=NONE",
        "runbook_checklist=16,17",
        "next_action=DISCARD_ARTIFACT_DIR_AND_RERUN_FROM_PREFLIGHT",
        "reason_code=PROVENANCE_OR_CONTRACT_BLOCKER",
        "reason=bounded lineage or approval contract integrity failed",
        "artifact_dir=/tmp/v2/PCY__OPS__01",
        "output_file=/tmp/fake-submit-request.json",
      ])
        ? "shared formatter line order matches contract"
        : "shared formatter line order drifted from contract",
      file: SHARED_FORMATTER_MODULE_PATH,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_06",
      label: "shared formatter exposes LIVE cutover readiness values",
      ok: [
        "live_cutover_ready=YES",
        "live_cutover_auto_apply=NO",
        "live_cutover_mutates_env=NO",
        "live_cutover_env_changes=4",
        "live_cutover_file=/tmp/v2/PCY__LIVE__01/v2_repair_live_cutover_readiness_latest.json",
        "production_cutover_ready=YES",
        "production_cutover_legacy_blocked=YES",
        "production_cutover_guard_reason=V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED",
        "production_cutover_file=/tmp/v2/PCY__LIVE__01/v2_production_cutover_readiness_latest.json",
        "scheduler_collector_preflight=YES",
        "scheduler_collector_project=donbeolja-dev",
        "scheduler_collector_file=/tmp/v2/PCY__LIVE__01/v2_scheduler_traffic_collector_preflight_latest.json",
        "scheduler_traffic_ready=YES",
        "scheduler_traffic_sot=OPENCLAW_CRON",
        "scheduler_traffic_legacy_active=0",
        "scheduler_traffic_file=/tmp/v2/PCY__LIVE__01/v2_scheduler_traffic_cutover_readiness_latest.json",
        "runbook_review=YES",
        "runbook_review_failures=0",
        "runbook_review_failed_checks=NONE",
        "runbook_review_file=/tmp/v2/PCY__LIVE__01/promotion-runbook-review.json",
      ].every((line) => liveCutoverSummary.lines.includes(line)),
      reason: [
        "live_cutover_ready=YES",
        "live_cutover_auto_apply=NO",
        "live_cutover_mutates_env=NO",
        "live_cutover_env_changes=4",
        "live_cutover_file=/tmp/v2/PCY__LIVE__01/v2_repair_live_cutover_readiness_latest.json",
        "production_cutover_ready=YES",
        "production_cutover_legacy_blocked=YES",
        "production_cutover_guard_reason=V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED",
        "production_cutover_file=/tmp/v2/PCY__LIVE__01/v2_production_cutover_readiness_latest.json",
        "scheduler_collector_preflight=YES",
        "scheduler_collector_project=donbeolja-dev",
        "scheduler_collector_file=/tmp/v2/PCY__LIVE__01/v2_scheduler_traffic_collector_preflight_latest.json",
        "scheduler_traffic_ready=YES",
        "scheduler_traffic_sot=OPENCLAW_CRON",
        "scheduler_traffic_legacy_active=0",
        "scheduler_traffic_file=/tmp/v2/PCY__LIVE__01/v2_scheduler_traffic_cutover_readiness_latest.json",
        "runbook_review=YES",
        "runbook_review_failures=0",
        "runbook_review_failed_checks=NONE",
        "runbook_review_file=/tmp/v2/PCY__LIVE__01/promotion-runbook-review.json",
      ].every((line) => liveCutoverSummary.lines.includes(line))
        ? "shared formatter preserves LIVE cutover readiness line values"
        : "shared formatter must preserve LIVE cutover readiness line values",
      file: SHARED_FORMATTER_MODULE_PATH,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_07",
      label: "shared alert preview exposes LIVE cutover readiness values",
      ok: [
        "live_cutover_ready=YES",
        "live_cutover_auto_apply=NO",
        "live_cutover_mutates_env=NO",
        "live_cutover_env_changes=4",
        "live_cutover_file=/tmp/v2/PCY__LIVE__01/v2_repair_live_cutover_readiness_latest.json",
        "production_cutover_ready=YES",
        "production_cutover_legacy_blocked=YES",
        "production_cutover_guard_reason=V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED",
        "production_cutover_file=/tmp/v2/PCY__LIVE__01/v2_production_cutover_readiness_latest.json",
        "scheduler_collector_preflight=YES",
        "scheduler_collector_project=donbeolja-dev",
        "scheduler_collector_file=/tmp/v2/PCY__LIVE__01/v2_scheduler_traffic_collector_preflight_latest.json",
        "scheduler_traffic_ready=YES",
        "scheduler_traffic_sot=OPENCLAW_CRON",
        "scheduler_traffic_legacy_active=0",
        "scheduler_traffic_file=/tmp/v2/PCY__LIVE__01/v2_scheduler_traffic_cutover_readiness_latest.json",
        "runbook_review=YES",
        "runbook_review_failures=0",
        "runbook_review_failed_checks=NONE",
        "runbook_review_file=/tmp/v2/PCY__LIVE__01/promotion-runbook-review.json",
      ].every((line) => liveCutoverPreviewTraceLines.includes(line)),
      reason: [
        "live_cutover_ready=YES",
        "live_cutover_auto_apply=NO",
        "live_cutover_mutates_env=NO",
        "live_cutover_env_changes=4",
        "live_cutover_file=/tmp/v2/PCY__LIVE__01/v2_repair_live_cutover_readiness_latest.json",
        "production_cutover_ready=YES",
        "production_cutover_legacy_blocked=YES",
        "production_cutover_guard_reason=V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED",
        "production_cutover_file=/tmp/v2/PCY__LIVE__01/v2_production_cutover_readiness_latest.json",
        "scheduler_collector_preflight=YES",
        "scheduler_collector_project=donbeolja-dev",
        "scheduler_collector_file=/tmp/v2/PCY__LIVE__01/v2_scheduler_traffic_collector_preflight_latest.json",
        "scheduler_traffic_ready=YES",
        "scheduler_traffic_sot=OPENCLAW_CRON",
        "scheduler_traffic_legacy_active=0",
        "scheduler_traffic_file=/tmp/v2/PCY__LIVE__01/v2_scheduler_traffic_cutover_readiness_latest.json",
        "runbook_review=YES",
        "runbook_review_failures=0",
        "runbook_review_failed_checks=NONE",
        "runbook_review_file=/tmp/v2/PCY__LIVE__01/promotion-runbook-review.json",
      ].every((line) => liveCutoverPreviewTraceLines.includes(line))
        ? "shared alert preview preserves LIVE cutover readiness trace values"
        : "shared alert preview must preserve LIVE cutover readiness trace values",
      file: SHARED_ALERT_PREVIEW_MODULE_PATH,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_08",
      label: "shared formatter text is canonical line join",
      ok: summary.text === summary.lines.join("\n"),
      reason: summary.text === summary.lines.join("\n")
        ? "shared formatter text matches joined line set"
        : "shared formatter text must equal joined line set",
      file: SHARED_FORMATTER_MODULE_PATH,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_09",
      label: "artifact contract references shared operator alert preview module",
      ok: artifactContractText.includes(SHARED_ALERT_PREVIEW_DOC_PATH),
      reason: artifactContractText.includes(SHARED_ALERT_PREVIEW_DOC_PATH)
        ? "artifact contract points to shared operator alert preview module"
        : "artifact contract must point to shared operator alert preview module",
      file: FILES.artifactContract,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_10",
      label: "runbook references shared operator alert preview module",
      ok: runbookText.includes(SHARED_ALERT_PREVIEW_DOC_PATH),
      reason: runbookText.includes(SHARED_ALERT_PREVIEW_DOC_PATH)
        ? "runbook points to shared operator alert preview module"
        : "runbook must point to shared operator alert preview module",
      file: FILES.runbook,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_11",
      label: "render script imports shared operator alert preview module",
      ok: readText(FILES.renderScript).includes('const alertPreview = require("./lib/v2-promotion-submit-operator-alert");'),
      reason: readText(FILES.renderScript).includes('const alertPreview = require("./lib/v2-promotion-submit-operator-alert");')
        ? "render script imports shared operator alert preview module"
        : "render script must import shared operator alert preview module",
      file: FILES.renderScript,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_12",
      label: "send script uses preview renderer instead of rebuilding message",
      ok: readText(FILES.sendScript).includes('const renderer = require("./render-v2-promotion-submit-operator-alert");')
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("submitRequestFailsClosedWhenOperatorAlertDeliveryFails")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("V2_PROMOTION_CLOUDBUILD_SUBMIT_ALERT_FAILED")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("buildCliResultPayload(result)")
        && runbookText.includes("DELIVERY_FAILED")
        && artifactContractText.includes("operator_delivery_summary"),
      reason: readText(FILES.sendScript).includes('const renderer = require("./render-v2-promotion-submit-operator-alert");')
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("submitRequestFailsClosedWhenOperatorAlertDeliveryFails")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("buildCliResultPayload(result)")
        ? "send script consumes rendered preview and submit fails closed when operator alert delivery fails"
        : "send script must consume rendered preview, and failed operator alert delivery must fail closed with DELIVERY_FAILED evidence",
      file: FILES.sendScript,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_13",
      label: "runbook maps V2 entry boundary submit check",
      ok: runbookText.includes("| `SUBMIT_CHK_13` | `21` | V2 entry boundary audit complete |"),
      reason: runbookText.includes("| `SUBMIT_CHK_13` | `21` | V2 entry boundary audit complete |")
        ? "runbook reverse index maps SUBMIT_CHK_13 to checklist 21"
        : "runbook must map SUBMIT_CHK_13 to checklist 21",
      file: FILES.runbook,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_14",
      label: "artifact contract requires V2 entry boundary audit",
      ok: artifactContractText.includes("approval_contract.entry_boundary_audit_required")
        && artifactContractText.includes("approval_evidence_sources.entry_boundary_audit"),
      reason: artifactContractText.includes("approval_contract.entry_boundary_audit_required")
        && artifactContractText.includes("approval_evidence_sources.entry_boundary_audit")
        ? "artifact contract includes entry boundary approval contract and evidence source"
        : "artifact contract must include entry boundary approval contract and evidence source",
      file: FILES.artifactContract,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_15",
      label: "runbook maps V2 production cutover submit check",
      ok: runbookText.includes("| `SUBMIT_CHK_14` | `22` | V2 production cutover audit complete |"),
      reason: runbookText.includes("| `SUBMIT_CHK_14` | `22` | V2 production cutover audit complete |")
        ? "runbook reverse index maps SUBMIT_CHK_14 to checklist 22"
        : "runbook must map SUBMIT_CHK_14 to checklist 22",
      file: FILES.runbook,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_16",
      label: "artifact contract requires V2 production cutover audit",
      ok: artifactContractText.includes("approval_contract.production_cutover_audit_required")
        && artifactContractText.includes("approval_evidence_sources.production_cutover_audit"),
      reason: artifactContractText.includes("approval_contract.production_cutover_audit_required")
        && artifactContractText.includes("approval_evidence_sources.production_cutover_audit")
        ? "artifact contract includes production cutover approval contract and evidence source"
        : "artifact contract must include production cutover approval contract and evidence source",
      file: FILES.artifactContract,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_16A",
      label: "runbook maps V2 production live entry sizing submit check",
      ok: runbookText.includes("| `SUBMIT_CHK_20` | `27` | V2 production live entry sizing contract complete |"),
      reason: runbookText.includes("| `SUBMIT_CHK_20` | `27` | V2 production live entry sizing contract complete |")
        ? "runbook reverse index maps SUBMIT_CHK_20 to checklist 27"
        : "runbook must map SUBMIT_CHK_20 to checklist 27",
      file: FILES.runbook,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_16B",
      label: "artifact contract requires V2 production live entry sizing contract",
      ok: artifactContractText.includes("approval_contract.production_live_entry_sizing_contract_required")
        && artifactContractText.includes("approval_evidence_sources.production_live_entry_sizing_contract"),
      reason: artifactContractText.includes("approval_contract.production_live_entry_sizing_contract_required")
        && artifactContractText.includes("approval_evidence_sources.production_live_entry_sizing_contract")
        ? "artifact contract includes production live entry sizing approval contract and evidence source"
        : "artifact contract must include production live entry sizing approval contract and evidence source",
      file: FILES.artifactContract,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_16C",
      label: "submit wrapper verifies V2 production live entry sizing contract",
      ok: submitWrapperText.includes("SUBMIT_CHK_20")
        && submitWrapperText.includes("hasProductionLiveEntrySizingContract")
        && submitWrapperText.includes("production_live_entry_sizing_contract_required")
        && submitTraceText.includes("SUBMIT_CHK_20"),
      reason: submitWrapperText.includes("SUBMIT_CHK_20")
        && submitWrapperText.includes("hasProductionLiveEntrySizingContract")
        && submitTraceText.includes("SUBMIT_CHK_20")
        ? "submit wrapper verifies production live entry sizing contract and trace mapping"
        : "submit wrapper must verify production live entry sizing contract and trace mapping",
      file: FILES.submitWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_17",
      label: "runbook maps LIVE production cutover readiness submit check",
      ok: runbookText.includes("| `SUBMIT_CHK_15` | `23` | LIVE production cutover readiness blocks legacy webhook |"),
      reason: runbookText.includes("| `SUBMIT_CHK_15` | `23` | LIVE production cutover readiness blocks legacy webhook |")
        ? "runbook reverse index maps SUBMIT_CHK_15 to checklist 23"
        : "runbook must map SUBMIT_CHK_15 to checklist 23",
      file: FILES.runbook,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_18",
      label: "artifact contract requires LIVE production cutover readiness summary",
      ok: artifactContractText.includes("approval_contract.production_cutover_readiness_summary_required")
        && artifactContractText.includes("approval_evidence_sources.production_cutover_readiness_summary"),
      reason: artifactContractText.includes("approval_contract.production_cutover_readiness_summary_required")
        && artifactContractText.includes("approval_evidence_sources.production_cutover_readiness_summary")
        ? "artifact contract includes production cutover readiness approval contract and evidence source"
        : "artifact contract must include production cutover readiness approval contract and evidence source",
      file: FILES.artifactContract,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_19",
      label: "runbook maps LIVE scheduler traffic cutover submit check",
      ok: runbookText.includes("| `SUBMIT_CHK_16` | `24` | LIVE scheduler traffic cutover uses OpenClaw cron only |"),
      reason: runbookText.includes("| `SUBMIT_CHK_16` | `24` | LIVE scheduler traffic cutover uses OpenClaw cron only |")
        ? "runbook reverse index maps SUBMIT_CHK_16 to checklist 24"
        : "runbook must map SUBMIT_CHK_16 to checklist 24",
      file: FILES.runbook,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_20",
      label: "artifact contract requires LIVE scheduler traffic cutover readiness summary",
      ok: artifactContractText.includes("approval_contract.scheduler_traffic_cutover_readiness_summary_required")
        && artifactContractText.includes("approval_evidence_sources.scheduler_traffic_cutover_readiness_summary"),
      reason: artifactContractText.includes("approval_contract.scheduler_traffic_cutover_readiness_summary_required")
        && artifactContractText.includes("approval_evidence_sources.scheduler_traffic_cutover_readiness_summary")
        ? "artifact contract includes scheduler traffic cutover readiness approval contract and evidence source"
        : "artifact contract must include scheduler traffic cutover readiness approval contract and evidence source",
      file: FILES.artifactContract,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_21",
      label: "runbook maps LIVE scheduler traffic collector preflight submit check",
      ok: runbookText.includes("| `SUBMIT_CHK_17` | `24A` | LIVE scheduler traffic collector preflight can read GCP state |"),
      reason: runbookText.includes("| `SUBMIT_CHK_17` | `24A` | LIVE scheduler traffic collector preflight can read GCP state |")
        ? "runbook reverse index maps SUBMIT_CHK_17 to checklist 24A"
        : "runbook must map SUBMIT_CHK_17 to checklist 24A",
      file: FILES.runbook,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_22",
      label: "artifact contract requires LIVE scheduler traffic collector preflight summary",
      ok: artifactContractText.includes("approval_contract.scheduler_traffic_collector_preflight_summary_required")
        && artifactContractText.includes("approval_evidence_sources.scheduler_traffic_collector_preflight_summary"),
      reason: artifactContractText.includes("approval_contract.scheduler_traffic_collector_preflight_summary_required")
        && artifactContractText.includes("approval_evidence_sources.scheduler_traffic_collector_preflight_summary")
        ? "artifact contract includes scheduler traffic collector preflight approval contract and evidence source"
        : "artifact contract must include scheduler traffic collector preflight approval contract and evidence source",
      file: FILES.artifactContract,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_23",
      label: "runbook maps V2 fill sync canonical boundary submit check",
      ok: runbookText.includes("| `SUBMIT_CHK_18` | `25` | V2 fill sync canonical boundary audit complete |"),
      reason: runbookText.includes("| `SUBMIT_CHK_18` | `25` | V2 fill sync canonical boundary audit complete |")
        ? "runbook reverse index maps SUBMIT_CHK_18 to checklist 25"
        : "runbook must map SUBMIT_CHK_18 to checklist 25",
      file: FILES.runbook,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_24",
      label: "artifact contract requires V2 fill sync canonical boundary audit",
      ok: artifactContractText.includes("approval_contract.fill_sync_canonical_boundary_audit_required")
        && artifactContractText.includes("approval_evidence_sources.fill_sync_canonical_boundary_audit"),
      reason: artifactContractText.includes("approval_contract.fill_sync_canonical_boundary_audit_required")
        && artifactContractText.includes("approval_evidence_sources.fill_sync_canonical_boundary_audit")
        ? "artifact contract includes fill sync canonical boundary approval contract and evidence source"
        : "artifact contract must include fill sync canonical boundary approval contract and evidence source",
      file: FILES.artifactContract,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_25",
      label: "submit wrapper verifies V2 fill sync canonical boundary audit",
      ok: submitWrapperText.includes("SUBMIT_CHK_18")
        && submitWrapperText.includes("hasFillSyncCanonicalBoundaryAudit")
        && submitWrapperText.includes("fill_sync_canonical_boundary_audit"),
      reason: submitWrapperText.includes("SUBMIT_CHK_18")
        && submitWrapperText.includes("hasFillSyncCanonicalBoundaryAudit")
        && submitWrapperText.includes("fill_sync_canonical_boundary_audit")
        ? "submit wrapper verifies fill sync canonical boundary evidence"
        : "submit wrapper must verify fill sync canonical boundary evidence",
      file: FILES.submitWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_26",
      label: "artifact contract requires deploy warning streak classifiers",
      ok: artifactContractText.includes("has_live_readiness_warning")
        && artifactContractText.includes("has_repair_firestore_canary_streak_warning")
        && artifactContractText.includes("has_production_entry_route_canary_streak_warning"),
      reason: artifactContractText.includes("has_live_readiness_warning")
        && artifactContractText.includes("has_repair_firestore_canary_streak_warning")
        && artifactContractText.includes("has_production_entry_route_canary_streak_warning")
        ? "artifact contract includes deploy warning streak classifier fields"
        : "artifact contract must include deploy warning streak classifier fields",
      file: FILES.artifactContract,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_27",
      label: "submit wrapper maps streak warnings to runbook checklist",
      ok: submitWrapperText.includes("has_repair_firestore_canary_streak_warning")
        && submitWrapperText.includes("has_production_entry_route_canary_streak_warning")
        && submitWrapperText.includes('refs.add("19")')
        && submitWrapperText.includes('refs.add("26")'),
      reason: submitWrapperText.includes("has_repair_firestore_canary_streak_warning")
        && submitWrapperText.includes("has_production_entry_route_canary_streak_warning")
        && submitWrapperText.includes('refs.add("19")')
        && submitWrapperText.includes('refs.add("26")')
        ? "submit wrapper maps repair and production streak warnings to runbook refs"
        : "submit wrapper must map repair and production streak warnings to runbook refs",
      file: FILES.submitWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_28",
      label: "operator summary and alert preserve production streak warning runbook",
      ok: deployWarningSummary.lines.includes("deploy_warning_runbook=26")
        && deployWarningSummary.lines.includes("deploy_top_warnings=DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY")
        && deployWarningPreview.title === "V2 Promotion Submit Ready With Deploy Warning"
        && deployWarningPreviewTraceLines.includes("deploy_warning_runbook=26")
        && deployWarningPreviewTraceLines.includes("deploy_top_warnings=DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY"),
      reason: deployWarningSummary.lines.includes("deploy_warning_runbook=26")
        && deployWarningSummary.lines.includes("deploy_top_warnings=DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY")
        && deployWarningPreview.title === "V2 Promotion Submit Ready With Deploy Warning"
        && deployWarningPreviewTraceLines.includes("deploy_warning_runbook=26")
        && deployWarningPreviewTraceLines.includes("deploy_top_warnings=DEPLOY_DECISION:PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_NOT_READY")
        ? "operator summary and alert preserve production streak warning trace"
        : "operator summary and alert must preserve production streak warning trace",
      file: SHARED_ALERT_PREVIEW_MODULE_PATH,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_29",
      label: "artifact contract requires context warning trace fields",
      ok: artifactContractText.includes("submit_trace.deploy_warning_attention_required")
        && artifactContractText.includes("submit_trace.deploy_warning_summary")
        && artifactContractText.includes("submit_trace.deploy_warning_runbook_checklist"),
      reason: artifactContractText.includes("submit_trace.deploy_warning_attention_required")
        && artifactContractText.includes("submit_trace.deploy_warning_summary")
        && artifactContractText.includes("submit_trace.deploy_warning_runbook_checklist")
        ? "artifact contract includes context deploy warning trace fields"
        : "artifact contract must include context deploy warning trace fields",
      file: FILES.artifactContract,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_30",
      label: "cloudbuild context submit trace preserves warning runbook refs",
      ok: cloudbuildWrapperText.includes("deploy_warning_attention_required")
        && cloudbuildWrapperText.includes("deploy_warning_summary")
        && cloudbuildWrapperText.includes("deploy_warning_runbook_checklist")
        && cloudbuildWrapperText.includes("collectContextDeployWarningRunbookChecklist"),
      reason: cloudbuildWrapperText.includes("deploy_warning_attention_required")
        && cloudbuildWrapperText.includes("deploy_warning_summary")
        && cloudbuildWrapperText.includes("deploy_warning_runbook_checklist")
        && cloudbuildWrapperText.includes("collectContextDeployWarningRunbookChecklist")
        ? "cloudbuild context submit trace preserves deploy warning runbook refs"
        : "cloudbuild context submit trace must preserve deploy warning runbook refs",
      file: FILES.cloudbuildWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_31",
      label: "runbook candidate selection checklist requires runtime chain contract",
      ok: runbookText.includes("selected_runtime_chain_ok")
        && runbookText.includes("| `SUBMIT_CHK_09` | `15` | candidate selection contract complete |"),
      reason: runbookText.includes("selected_runtime_chain_ok")
        && runbookText.includes("| `SUBMIT_CHK_09` | `15` | candidate selection contract complete |")
        ? "runbook maps SUBMIT_CHK_09 to checklist 15 and names selected_runtime_chain_ok"
        : "runbook must map SUBMIT_CHK_09 to checklist 15 and require selected_runtime_chain_ok",
      file: FILES.runbook,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_32",
      label: "artifact contract and cloudbuild context preserve selected runtime chain",
      ok: artifactContractText.includes("selected_runtime_chain_ok")
        && cloudbuildWrapperText.includes("selected_runtime_chain_ok: candidateSelectionSummary.selection_contract.selected_runtime_chain_ok === true"),
      reason: artifactContractText.includes("selected_runtime_chain_ok")
        && cloudbuildWrapperText.includes("selected_runtime_chain_ok: candidateSelectionSummary.selection_contract.selected_runtime_chain_ok === true")
        ? "artifact contract and cloudbuild context preserve selected_runtime_chain_ok"
        : "artifact contract and cloudbuild context must preserve selected_runtime_chain_ok",
      file: FILES.artifactContract,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_33",
      label: "submit wrapper verifies runtime chain audit contract",
      ok: submitWrapperText.includes("SUBMIT_CHK_04B")
        && submitWrapperText.includes("hasRuntimeChainAuditCoverage")
        && submitWrapperText.includes("approval_contract.runtime_chain_audit_summary_required")
        && submitWrapperText.includes("approval_evidence_sources.runtime_chain_audit_summary")
        && runbookText.includes("| `SUBMIT_CHK_04B` | `14A` | runtime chain audit complete |"),
      reason: submitWrapperText.includes("SUBMIT_CHK_04B")
        && submitWrapperText.includes("hasRuntimeChainAuditCoverage")
        && submitWrapperText.includes("approval_contract.runtime_chain_audit_summary_required")
        && submitWrapperText.includes("approval_evidence_sources.runtime_chain_audit_summary")
        && runbookText.includes("| `SUBMIT_CHK_04B` | `14A` | runtime chain audit complete |")
        ? "submit wrapper maps runtime chain audit to SUBMIT_CHK_04B and runbook 14A"
        : "submit wrapper must verify runtime chain audit and map SUBMIT_CHK_04B to runbook 14A",
      file: FILES.submitWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_34",
      label: "submit approval contract verifies auto-select contract flags",
      ok: submitWrapperText.includes('typeof row.candidate_selection_ready_required === "boolean"')
        && submitWrapperText.includes('typeof row.selected_preflight_required === "boolean"')
        && artifactContractText.includes("approval_contract.candidate_selection_ready_required")
        && artifactContractText.includes("approval_contract.selected_preflight_required"),
      reason: submitWrapperText.includes('typeof row.candidate_selection_ready_required === "boolean"')
        && submitWrapperText.includes('typeof row.selected_preflight_required === "boolean"')
        && artifactContractText.includes("approval_contract.candidate_selection_ready_required")
        && artifactContractText.includes("approval_contract.selected_preflight_required")
        ? "submit approval contract verifies auto-select conditional flags"
        : "submit approval contract must verify candidate_selection_ready_required and selected_preflight_required",
      file: FILES.submitWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_35",
      label: "submit wrapper verifies resolved artifact dir coherence",
      ok: submitWrapperText.includes("SUBMIT_CHK_01A")
        && submitWrapperText.includes("hasResolvedArtifactDirCoherence")
        && submitWrapperText.includes("artifact_dir_coherence")
        && submitTraceText.includes("SUBMIT_CHK_01A")
        && runbookText.includes("| `SUBMIT_CHK_01A` | `1`, `5`, `9` | resolved artifact dir matches selected cycle |")
        && artifactContractText.includes("approval_evidence_sources.resolved_artifact_dir"),
      reason: submitWrapperText.includes("SUBMIT_CHK_01A")
        && submitWrapperText.includes("hasResolvedArtifactDirCoherence")
        && submitWrapperText.includes("artifact_dir_coherence")
        && submitTraceText.includes("SUBMIT_CHK_01A")
        && runbookText.includes("| `SUBMIT_CHK_01A` | `1`, `5`, `9` | resolved artifact dir matches selected cycle |")
        && artifactContractText.includes("approval_evidence_sources.resolved_artifact_dir")
        ? "submit wrapper maps resolved artifact dir and context self-check coherence to SUBMIT_CHK_01A and runbook 1/5/9"
        : "submit wrapper must verify resolved artifact dir and artifact_dir_coherence and map SUBMIT_CHK_01A to runbook 1/5/9",
      file: FILES.submitWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_36",
      label: "runbook verifier checks resolved artifact dir coherence before submit",
      ok: runbookCheckerText.includes("CHK_01A")
        && runbookCheckerText.includes("hasContextArtifactDirCoherence")
        && runbookCheckerText.includes("artifact_dir_coherence")
        && runbookText.includes("| 1A | `SUBMIT_CHK_01A`")
        && runbookText.includes("automated verifier `CHK_01A`"),
      reason: runbookCheckerText.includes("CHK_01A")
        && runbookCheckerText.includes("hasContextArtifactDirCoherence")
        && runbookCheckerText.includes("artifact_dir_coherence")
        && runbookText.includes("| 1A | `SUBMIT_CHK_01A`")
        && runbookText.includes("automated verifier `CHK_01A`")
        ? "runbook verifier enforces resolved artifact dir and context self-check coherence before submit"
        : "runbook verifier must enforce resolved artifact dir and artifact_dir_coherence with CHK_01A",
      file: FILES.runbookChecker,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_37",
      label: "cloudbuild context records artifact dir coherence at write time",
      ok: cloudbuildWrapperText.includes("buildArtifactDirCoherence")
        && cloudbuildWrapperText.includes("artifact_dir_coherence")
        && cloudbuildWrapperText.includes("ARTIFACT_DIR_RESOLVED_DIR_MISMATCH")
        && cloudbuildWrapperText.includes("SUBMIT_CHK_01A")
        && cloudbuildWrapperText.includes("buildContextRecommendedNextAction")
        && artifactContractText.includes("artifact_dir_coherence")
        && artifactContractText.includes("artifact_dir_coherence.ok")
        && artifactContractText.includes("submit_trace.checks[] must include `SUBMIT_CHK_01A`")
        && runbookText.includes("artifact_dir_coherence"),
      reason: cloudbuildWrapperText.includes("buildArtifactDirCoherence")
        && cloudbuildWrapperText.includes("artifact_dir_coherence")
        && cloudbuildWrapperText.includes("ARTIFACT_DIR_RESOLVED_DIR_MISMATCH")
        && cloudbuildWrapperText.includes("SUBMIT_CHK_01A")
        && cloudbuildWrapperText.includes("buildContextRecommendedNextAction")
        && artifactContractText.includes("artifact_dir_coherence")
        && artifactContractText.includes("artifact_dir_coherence.ok")
        && artifactContractText.includes("submit_trace.checks[] must include `SUBMIT_CHK_01A`")
        && runbookText.includes("artifact_dir_coherence")
        ? "cloudbuild context self-reports artifact dir coherence and maps it to submit trace before runbook and submit checks"
        : "cloudbuild context must include artifact_dir_coherence, map it to SUBMIT_CHK_01A, and docs must require it",
      file: FILES.cloudbuildWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_38",
      label: "operator summary and alert preserve artifact dir coherence trace",
      ok: artifactDirCoherenceSummary.lines.includes("failed_submit_checks=SUBMIT_CHK_01A")
        && artifactDirCoherenceSummary.lines.includes("runbook_checklist=1,5,9")
        && artifactDirCoherenceSummary.lines.includes("artifact_dir_coherence=FAIL")
        && artifactDirCoherenceSummary.lines.includes("artifact_dir_coherence_reason=ARTIFACT_DIR_RESOLVED_DIR_MISMATCH")
        && artifactDirCoherenceSummary.lines.includes("artifact_dir_coherence_flags=dir_resolved:NO|dir_cycle:YES|resolved_cycle:YES|context_cycle:YES")
        && artifactDirCoherencePreviewTraceLines.includes("artifact_dir_coherence=FAIL")
        && artifactDirCoherencePreviewTraceLines.includes("artifact_dir_coherence_reason=ARTIFACT_DIR_RESOLVED_DIR_MISMATCH")
        && artifactDirCoherencePreviewTraceLines.includes("artifact_dir_coherence_flags=dir_resolved:NO|dir_cycle:YES|resolved_cycle:YES|context_cycle:YES")
        && artifactContractText.includes("operator_summary.artifact_dir_coherence_summary")
        && artifactContractText.includes("artifact_dir_coherence_flags"),
      reason: artifactDirCoherenceSummary.lines.includes("failed_submit_checks=SUBMIT_CHK_01A")
        && artifactDirCoherenceSummary.lines.includes("runbook_checklist=1,5,9")
        && artifactDirCoherenceSummary.lines.includes("artifact_dir_coherence=FAIL")
        && artifactDirCoherenceSummary.lines.includes("artifact_dir_coherence_reason=ARTIFACT_DIR_RESOLVED_DIR_MISMATCH")
        && artifactDirCoherenceSummary.lines.includes("artifact_dir_coherence_flags=dir_resolved:NO|dir_cycle:YES|resolved_cycle:YES|context_cycle:YES")
        && artifactDirCoherencePreviewTraceLines.includes("artifact_dir_coherence=FAIL")
        && artifactDirCoherencePreviewTraceLines.includes("artifact_dir_coherence_reason=ARTIFACT_DIR_RESOLVED_DIR_MISMATCH")
        && artifactDirCoherencePreviewTraceLines.includes("artifact_dir_coherence_flags=dir_resolved:NO|dir_cycle:YES|resolved_cycle:YES|context_cycle:YES")
        && artifactContractText.includes("operator_summary.artifact_dir_coherence_summary")
        && artifactContractText.includes("artifact_dir_coherence_flags")
        ? "operator summary and alert preserve SUBMIT_CHK_01A artifact dir coherence reason and flags"
        : "operator summary and alert must preserve SUBMIT_CHK_01A artifact dir coherence reason and flags",
      file: SHARED_FORMATTER_MODULE_PATH,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_39",
      label: "operator summary and alert preserve stale artifact provenance blocker",
      ok: staleArtifactProvenanceSummary.lines.includes("stale_artifact_provenance_blocker=YES")
        && staleArtifactProvenanceSummary.lines.includes("reason_code=STALE_ARTIFACT_PROVENANCE_BLOCKER")
        && staleArtifactProvenancePreviewTraceLines.includes("stale_artifact_provenance_blocker=YES")
        && staleArtifactProvenancePreviewTraceLines.includes("reason_code=STALE_ARTIFACT_PROVENANCE_BLOCKER")
        && artifactContractText.includes("5. `has_stale_artifact_provenance_blocker`\n6. `has_live_evidence_cycle_blocker`")
        && artifactContractText.includes("9. `has_production_entry_protected_canary_blocker`\n10. `has_openclaw_supreme_control_plane_blocker`")
        && artifactContractText.includes("`recommended_next_action` 은 `DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE`")
        && submitWrapperText.includes("has_stale_artifact_provenance_blocker"),
      reason: staleArtifactProvenanceSummary.lines.includes("stale_artifact_provenance_blocker=YES")
        && staleArtifactProvenancePreviewTraceLines.includes("stale_artifact_provenance_blocker=YES")
        && artifactContractText.includes("5. `has_stale_artifact_provenance_blocker`\n6. `has_live_evidence_cycle_blocker`")
        && artifactContractText.includes("9. `has_production_entry_protected_canary_blocker`\n10. `has_openclaw_supreme_control_plane_blocker`")
        && submitWrapperText.includes("has_stale_artifact_provenance_blocker")
        ? "operator summary, approval verification contract, and submit wrapper preserve stale artifact provenance blocker"
        : "operator summary, approval verification contract, and submit wrapper must expose stale artifact provenance blocker explicitly",
      file: SHARED_FORMATTER_MODULE_PATH,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_39A",
      label: "operator summary and alert preserve LIVE evidence cycle blocker",
      ok: liveEvidenceCycleSummary.lines.includes("live_evidence_cycle_blocker=YES")
        && liveEvidenceCycleSummary.lines.includes("reason_code=LIVE_EVIDENCE_CYCLE_BLOCKER")
        && liveEvidenceCyclePreviewTraceLines.includes("live_evidence_cycle_blocker=YES")
        && liveEvidenceCyclePreviewTraceLines.includes("reason_code=LIVE_EVIDENCE_CYCLE_BLOCKER")
        && artifactContractText.includes("has_live_evidence_cycle_blocker=true")
        && artifactContractText.includes("live_evidence_cycle=BLOCKED")
        && submitWrapperText.includes("has_live_evidence_cycle_blocker")
        && runbookCheckerText.includes("hasConsistentLiveEvidenceCycleBlockerTrace")
        && runbookCheckerText.includes("CHK_13E")
        && runbookText.includes("13E"),
      reason: liveEvidenceCycleSummary.lines.includes("live_evidence_cycle_blocker=YES")
        && liveEvidenceCyclePreviewTraceLines.includes("live_evidence_cycle_blocker=YES")
        && artifactContractText.includes("has_live_evidence_cycle_blocker=true")
        && submitWrapperText.includes("has_live_evidence_cycle_blocker")
        && runbookCheckerText.includes("hasConsistentLiveEvidenceCycleBlockerTrace")
        && runbookCheckerText.includes("CHK_13E")
        && runbookText.includes("13E")
        ? "operator summary, approval verification contract, runbook verifier, and submit wrapper preserve LIVE evidence cycle blocker"
        : "LIVE evidence cycle blocker must be visible in operator summary, alert preview, contract, runbook verifier, and submit wrapper",
      file: SHARED_FORMATTER_MODULE_PATH,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_40",
      label: "package and CloudBuild require V2 promotion test path",
      ok: packageJsonText.includes('"test:v2-promotion"')
        && packageJsonText.includes("v2-production-cutover-audit.test.js")
        && packageJsonText.includes("v2-fill-sync-canonical-boundary-audit.test.js")
        && packageJsonText.includes('"test:v2-scheduler-traffic-cutover"')
        && packageJsonText.includes('"test:v2-repair-queue-runtime"')
        && packageJsonText.includes("npm run test:v2-repair-queue-runtime")
        && packageJsonText.includes("run-v2-repair-queue-service.test.js")
        && packageJsonText.includes("v2-repair-queue-live-worker.test.js")
        && packageJsonText.includes("check-v2-repair-queue-canary-preflight.test.js")
        && artifactContractText.includes("test:v2-repair-queue-runtime")
        && runbookText.includes("12C")
        && packageJsonText.includes("v2-scheduler-traffic-collector-preflight.test.js")
        && packageJsonText.includes("v2-scheduler-traffic-cutover-audit.test.js")
        && packageJsonText.includes("v2-scheduler-traffic-state-collector.test.js")
        && packageJsonText.includes("check-v2-exit-runtime-canary-streak.test.js")
        && packageJsonText.includes("v2-openclaw-protected-entry-exit-fixture.test.js")
        && packageJsonText.includes("check:v2-exit-runtime-canary-streak")
        && packageJsonText.includes("npm run test:v2-scheduler-traffic-cutover")
        && packageJsonText.includes("check:v2-promotion-submit-contract")
        && packageJsonText.includes("check:v2-production-cutover")
        && cloudbuildText.includes("npm run test:v2-promotion")
        && cloudbuildText.includes("npm run check:v2-production-cutover"),
      reason: packageJsonText.includes('"test:v2-promotion"')
        && packageJsonText.includes("v2-production-cutover-audit.test.js")
        && packageJsonText.includes("v2-fill-sync-canonical-boundary-audit.test.js")
        && packageJsonText.includes("npm run test:v2-repair-queue-runtime")
        && packageJsonText.includes("run-v2-repair-queue-service.test.js")
        && artifactContractText.includes("test:v2-repair-queue-runtime")
        && runbookText.includes("12C")
        && packageJsonText.includes('"test:v2-scheduler-traffic-cutover"')
        && packageJsonText.includes("v2-scheduler-traffic-collector-preflight.test.js")
        && packageJsonText.includes("v2-scheduler-traffic-cutover-audit.test.js")
        && packageJsonText.includes("v2-scheduler-traffic-state-collector.test.js")
        && packageJsonText.includes("check-v2-exit-runtime-canary-streak.test.js")
        && packageJsonText.includes("v2-openclaw-protected-entry-exit-fixture.test.js")
        && packageJsonText.includes("check:v2-exit-runtime-canary-streak")
        && packageJsonText.includes("npm run test:v2-scheduler-traffic-cutover")
        && packageJsonText.includes("check:v2-promotion-submit-contract")
        && packageJsonText.includes("check:v2-production-cutover")
        && cloudbuildText.includes("npm run test:v2-promotion")
        && cloudbuildText.includes("npm run check:v2-production-cutover")
        ? "package and CloudBuild execute V2 promotion, fill sync boundary, repair queue runtime, production cutover, scheduler traffic, exit runtime streak, and OpenClaw E2E regression paths"
        : "package.json and cloudbuild.yaml must require test:v2-promotion plus fill sync boundary, repair queue runtime, production cutover, scheduler traffic, exit runtime streak, and OpenClaw E2E audits",
      file: FILES.packageJson,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_41",
      label: "LIVE approval contract flags require true values",
      ok: submitWrapperText.includes("mustBeLiveTrue")
        && submitWrapperText.includes("upper(promotionMode) === \"LIVE\"")
        && submitWrapperText.includes("scheduler_traffic_collector_preflight_summary_required")
        && submitWrapperText.includes("production_entry_route_canary_streak_required")
        && submitWrapperText.includes("exit_runtime_canary_streak_required"),
      reason: submitWrapperText.includes("mustBeLiveTrue")
        && submitWrapperText.includes("upper(promotionMode) === \"LIVE\"")
        ? "submit wrapper enforces true-valued LIVE required approval flags"
        : "submit wrapper must not accept false boolean LIVE required flags",
      file: FILES.submitWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_42",
      label: "artifact dir cycle checks use exact path segment matching",
      ok: cloudbuildWrapperText.includes("function pathHasExactSegment")
        && runbookCheckerText.includes("function pathHasExactSegment")
        && submitWrapperText.includes("function pathHasExactSegment")
        && !cloudbuildWrapperText.includes(".includes(positionCycleId)")
        && !cloudbuildWrapperText.includes(".includes(decisionCycleId)")
        && !submitWrapperText.includes(".includes(decisionCycleId)")
        && !runbookCheckerText.includes(".includes(expectedCycleId)")
        && !runbookCheckerText.includes(".includes(expectedPositionCycleId)"),
      reason: cloudbuildWrapperText.includes("function pathHasExactSegment")
        && runbookCheckerText.includes("function pathHasExactSegment")
        && submitWrapperText.includes("function pathHasExactSegment")
        ? "cloudbuild, runbook, and submit checks use exact path segment matching"
        : "cycle-bound artifact dir validation must reject substring-only matches",
      file: FILES.cloudbuildWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_43",
      label: "operator alert preview has stale-source fingerprint",
      ok: staleSourcePreview.source_fingerprint_version === "V2_PROMOTION_OPERATOR_ALERT_PREVIEW_SHA256_V1"
        && trimOrNull(staleSourcePreview.source_fingerprint)
        && staleSourcePreview.source_fingerprint !== changedSourcePreview.source_fingerprint
        && readText(FILES.renderScript).includes("V2_PROMOTION_OPERATOR_ALERT_PREVIEW_STALE"),
      reason: staleSourcePreview.source_fingerprint_version === "V2_PROMOTION_OPERATOR_ALERT_PREVIEW_SHA256_V1"
        && trimOrNull(staleSourcePreview.source_fingerprint)
        && staleSourcePreview.source_fingerprint !== changedSourcePreview.source_fingerprint
        ? "operator preview fingerprint changes when source trace changes and renderer rejects stale previews"
        : "operator preview must carry source fingerprint and renderer must reject stale embedded previews",
      file: SHARED_ALERT_PREVIEW_MODULE_PATH,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_44",
      label: "runbook verifier has separate LIVE scheduler collector preflight check",
      ok: runbookCheckerText.includes("CHK_24A")
        && runbookCheckerText.includes("hasSchedulerTrafficCollectorPreflightPlan")
        && runbookText.includes("| 24A | `SUBMIT_CHK_17`")
        && submitTraceText.includes("runbookChecklist: Object.freeze([\"24A\"])"),
      reason: runbookCheckerText.includes("CHK_24A")
        && runbookText.includes("| 24A | `SUBMIT_CHK_17`")
        ? "collector preflight is independently verified and trace-linked to SUBMIT_CHK_17"
        : "runbook verifier must independently validate collector preflight as CHK_24A",
      file: FILES.runbookChecker,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_45",
      label: "context SUBMIT_CHK_08 uses lineage consistency summary",
      ok: cloudbuildWrapperText.includes("lineage_consistency_summary")
        && cloudbuildWrapperText.includes("buildLineageConsistencySummary")
        && runbookCheckerText.includes("hasContextLineageConsistency")
        && !cloudbuildWrapperText.includes("cloudbuild lineage hash present for bounded provenance trace"),
      reason: cloudbuildWrapperText.includes("lineage_consistency_summary")
        && runbookCheckerText.includes("hasContextLineageConsistency")
        ? "context SUBMIT_CHK_08 is tied to lineage consistency instead of hash presence"
        : "context SUBMIT_CHK_08 must fail on lineage inconsistency, not only missing hash",
      file: FILES.cloudbuildWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_46",
      label: "submit SUBMIT_CHK_08 exposes lineage consistency to operator trace",
      ok: submitWrapperText.includes("context_hash_matches_deploy_decision")
        && submitWrapperText.includes("hasContextLineageConsistency")
        && submitWrapperText.includes("field: \"lineage_consistency_summary\"")
        && operatorSummaryText.includes("lineage_consistency=")
        && operatorSummaryText.includes("lineage_context_hash_match=")
        && alertPreviewTraceLines.includes("lineage_consistency=FAIL")
        && alertPreviewTraceLines.includes("lineage_context_hash_match=NO"),
      reason: submitWrapperText.includes("context_hash_matches_deploy_decision")
        && operatorSummaryText.includes("lineage_consistency=")
        ? "submit wrapper and operator preview surface the real lineage consistency verdict"
        : "submit SUBMIT_CHK_08 must not hide lineage consistency details from operator trace",
      file: FILES.submitWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_47",
      label: "LIVE exit runtime canary streak is submit and runbook gated",
      ok: runbookText.includes("| `SUBMIT_CHK_21` | `28` | LIVE exit runtime canary streak complete |")
        && artifactContractText.includes("approval_contract.exit_runtime_canary_streak_required")
        && artifactContractText.includes("approval_evidence_sources.exit_runtime_canary_streak")
        && artifactContractText.includes("bounded_runtime_summary.exit_runtime_canary_streak")
        && submitWrapperText.includes("SUBMIT_CHK_21")
        && submitWrapperText.includes("hasExitRuntimeCanaryStreak")
        && submitWrapperText.includes("exit_runtime_canary_streak_required")
        && submitTraceText.includes("SUBMIT_CHK_21")
        && submitTraceText.includes("runbookChecklist: Object.freeze([\"28\"])")
        && cloudbuildWrapperText.includes("exit_runtime_canary_streak")
        && readText(path.resolve(__dirname, "run-v2-promotion-pipeline.js")).includes("refreshExitRuntimeCanaryStreak")
        && readText(path.resolve(__dirname, "run-v2-promotion-pipeline.js")).includes("DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE")
        && exitRuntimeStreakCheckerText.includes("EXIT_RUNTIME_CANARY_STREAK:FIRESTORE_SOURCE_REQUIRED")
        && exitRuntimeStreakCheckerText.includes("EXIT_RUNTIME_CANARY_STREAK:ALERT_RETRY_UNRESOLVED")
        && exitRuntimeStreakCheckerText.includes("EXIT_RUNTIME_CANARY_STREAK:ALERT_OUTBOX_INTEGRITY_GAP")
        && exitRuntimeStreakCheckerText.includes("EXIT_RUNTIME_CANARY_STREAK:TRAIL_ACTIVATION_EVIDENCE_GAP")
        && exitRuntimeStreakCheckerText.includes("long_run_quality_summary")
        && artifactContractText.includes("alert_retry_unresolved_n")
        && artifactContractText.includes("alert_outbox_integrity_gap_n")
        && artifactContractText.includes("trail_activation_evidence_gap_n")
        && runbookText.includes("alert_retry_unresolved_n")
        && runbookText.includes("alert_outbox_integrity_gap_n")
        && runbookText.includes("trail_activation_evidence_gap_n")
        && exitRuntimeCanaryModuleText.includes("_TRANSITION_ALERT_OUTBOX_LINEAGE")
        && exitRuntimeCanaryModuleText.includes("EXIT_RUNTIME_CANARY_ALERT_OUTBOX_SINGLETON_PER_TRANSITION")
        && exitRuntimeCanaryModuleText.includes("EXIT_RUNTIME_CANARY_TRAIL_ACTIVATION_EVIDENCE_PRESENT")
        && exitRuntimeCanaryModuleText.includes("EXIT_RUNTIME_CANARY_TRAIL_PROTECTION_EVIDENCE_PRESENT")
        && exitRuntimeCanaryModuleText.includes("EXIT_RUNTIME_CANARY_TRAIL_NATIVE_STOP_MATCHES_PROJECTION")
        && readText(path.resolve(__dirname, "check-v2-promotion-deploy-decision.js")).includes("DEPLOY_DECISION:EXIT_RUNTIME_CANARY_STREAK_REQUIRED")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveWithJsonlExitRuntimeStreakStillFailsClosed")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveWithStaleExitRuntimeStreakProvenanceFailsClosed"),
      reason: runbookText.includes("| `SUBMIT_CHK_21` | `28` | LIVE exit runtime canary streak complete |")
        && artifactContractText.includes("approval_contract.exit_runtime_canary_streak_required")
        && submitWrapperText.includes("SUBMIT_CHK_21")
        ? "exit runtime streak is trace-linked through runbook, artifact contract, deploy decision, submit wrapper, and pipeline refresh"
        : "exit runtime streak must be trace-linked through runbook, artifact contract, deploy decision, submit wrapper, and pipeline refresh",
      file: FILES.submitWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_48",
      label: "exit runtime canary producer exists and is bounded read-only",
      ok: packageJsonText.includes('"run:v2-exit-runtime-canary"')
        && packageJsonText.includes('"test:v2-exit-runtime-canary"')
        && packageJsonText.includes("npm run test:v2-exit-runtime-canary")
        && exitRuntimeCanaryRunnerText.includes("runExitRuntimeCanary")
        && exitRuntimeCanaryRunnerText.includes("persistExitRuntimeCanaryHistory")
        && exitRuntimeCanaryRunnerText.includes("exchange_write_performed")
        && exitRuntimeCanaryModuleText.includes("queryV2DocsByField")
        && exitRuntimeCanaryModuleText.includes("activePositionLimit")
        && exitRuntimeCanaryModuleText.includes("EXIT_RUNTIME_CANARY_TP1_ORDER_MISSING")
        && exitRuntimeCanaryModuleText.includes("EXIT_RUNTIME_CANARY_NATIVE_REFRESH_UNHEALTHY")
        && exitRuntimeCanaryModuleText.includes("EXIT_RUNTIME_CANARY_UNPROTECTED_WINDOW_VIOLATION")
        && exitRuntimeCanaryModuleText.includes("EXIT_RUNTIME_CANARY_ALERT_SILENT_DROP")
        && exitRuntimeCanaryModuleText.includes("EXIT_RUNTIME_CANARY_TRAIL_ACTIVATION_EVIDENCE_GAP")
        && !exitRuntimeCanaryModuleText.includes("listV2Docs("),
      reason: packageJsonText.includes('"run:v2-exit-runtime-canary"')
        && exitRuntimeCanaryRunnerText.includes("persistExitRuntimeCanaryHistory")
        && exitRuntimeCanaryModuleText.includes("activePositionLimit")
        ? "exit runtime canary producer generates bounded read-only observations feeding Firestore-backed streak history"
        : "exit runtime streak must have a bounded read-only producer, not only a checker",
      file: FILES.exitRuntimeCanaryRunner,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_49",
      label: "exit runtime canary producer is scheduler and CloudBuild wired",
      ok: openclawCronRoutesText.includes("/api/openclaw/cron/v2-exit-runtime-canary")
        && openclawCronRoutesText.includes("requireSchedulerToken")
        && openclawCronRoutesText.includes("run-v2-exit-runtime-canary")
        && openclawCronRoutesText.includes("v2_exit_runtime_canary")
        && openclawCronManifestText.includes("v2_exit_runtime_canary")
        && openclawCronManifestText.includes("/api/openclaw/cron/v2-exit-runtime-canary")
        && packageJsonText.includes('"test:v2-openclaw-scheduler-binding"')
        && packageJsonText.includes("npm run test:v2-openclaw-scheduler-binding")
        && readText(path.resolve(__dirname, "..", "src", "tests", "openclaw-cron-routes.test.js")).includes("run-v2-exit-runtime-canary")
        && readText(path.resolve(__dirname, "..", "src", "tests", "openclaw-cron-routes.test.js")).includes("POST /api/openclaw/cron/v2-exit-runtime-canary")
        && readText(path.resolve(__dirname, "..", "src", "tests", "openclaw-cron-manifest.test.js")).includes("v2_exit_runtime_canary")
        && readText(path.resolve(__dirname, "..", "src", "tests", "openclaw-cron-manifest.test.js")).includes("LIVE_EXIT_RUNTIME_OBSERVATION")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-submit-contract.test.js")).includes("schedulerBindingContractFailsWhenPromotionScriptIsMissing")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-submit-contract.test.js")).includes("schedulerBindingContractFailsWhenExitRuntimeCronRouteIsMissing")
        && cloudbuildText.includes("_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED")
        && cloudbuildText.includes("_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED")
        && cloudbuildText.includes("_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE")
        && cloudbuildText.includes("_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE")
        && submitWrapperText.includes("_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED")
        && submitWrapperText.includes("_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED")
        && submitWrapperText.includes("_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE")
        && submitWrapperText.includes("_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE")
        && productionRuntimeConfigAuditText.includes("DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED")
        && productionRuntimeConfigAuditText.includes("DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED")
        && productionRuntimeConfigAuditText.includes("DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE")
        && productionRuntimeConfigAuditText.includes("DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE")
        && runbookText.includes("test:v2-openclaw-scheduler-binding")
        && artifactContractText.includes("test:v2-openclaw-scheduler-binding"),
      reason: openclawCronRoutesText.includes("/api/openclaw/cron/v2-exit-runtime-canary")
        && cloudbuildText.includes("_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED")
        && submitWrapperText.includes("_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE")
        && packageJsonText.includes("npm run test:v2-openclaw-scheduler-binding")
        ? "exit runtime canary producer is reachable through OpenClaw cron, promotion-tested scheduler binding, and CloudBuild submit/runtime env"
        : "exit runtime canary producer must not exist without scheduler, promotion CI, and CloudBuild runtime wiring",
      file: FILES.openclawCronRoutes,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_50",
      label: "scheduler traffic cutover requires Cloud Scheduler canary jobs",
      ok: cloudbuildWrapperText.includes("openclaw_cloud_scheduler_jobs")
        && submitWrapperText.includes("openclaw_cloud_scheduler_jobs")
        && submitWrapperText.includes("v2_exit_runtime_canary")
        && submitWrapperText.includes("v2_production_entry_route_canary")
        && runbookCheckerText.includes("openclaw_cloud_scheduler_jobs")
        && runbookCheckerText.includes("v2_exit_runtime_canary")
        && runbookCheckerText.includes("v2_production_entry_route_canary")
        && readText(path.resolve(__dirname, "..", "src", "v2", "schedulerTrafficCutoverAudit.js")).includes("OPENCLAW_CLOUD_SCHEDULER_JOBS")
        && readText(path.resolve(__dirname, "..", "src", "v2", "schedulerTrafficStateCollector.js")).includes("buildOpenClawCloudSchedulerJobs")
        && readText(path.resolve(__dirname, "..", "src", "v2", "schedulerTrafficCollectorPreflight.js")).includes("SCHEDULER_TRAFFIC_COLLECTOR_REQUIRED_ENV_MISSING")
        && readText(path.resolve(__dirname, "..", "src", "tests", "v2-scheduler-traffic-collector-preflight.test.js")).includes("preflightBlocksWhenSchedulerCutoverEnvIsNotVisible"),
      reason: cloudbuildWrapperText.includes("openclaw_cloud_scheduler_jobs")
        && submitWrapperText.includes("v2_exit_runtime_canary")
        && runbookCheckerText.includes("v2_production_entry_route_canary")
        ? "scheduler traffic readiness verifies required Cloud Scheduler canary jobs as part of LIVE cutover"
        : "scheduler traffic readiness must not only verify launchd jobs; required Cloud Scheduler canary jobs must be explicit evidence",
      file: path.resolve(__dirname, "..", "src", "v2", "schedulerTrafficCutoverAudit.js"),
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_51",
      label: "LIVE streak artifacts require generated freshness provenance",
      ok: repairFirestoreStreakCheckerText.includes("generated_at: new Date(Number(nowMs)).toISOString()")
        && repairFirestoreStreakCheckerText.includes("hasFirestoreBackedRepairEvidence")
        && repairFirestoreStreakCheckerText.includes("FIRESTORE_CANARY_STREAK:FIRESTORE_EVIDENCE_MISSING")
        && deployDecisionCheckerText.includes("firestore_evidence_missing_n")
        && packageJsonText.includes("check-v2-repair-queue-firestore-canary-streak.test.js")
        && packageJsonText.includes("check-v2-promotion-deploy-decision.test.js")
        && productionEntryRouteStreakCheckerText.includes("generated_at: new Date(Number(nowMs)).toISOString()")
        && productionEntryRouteStreakCheckerText.includes("position_cycle_id: positionCycleIds.length === 1 ? positionCycleIds[0] : null")
        && productionEntryRouteStreakCheckerText.includes("PRODUCTION_ENTRY_ROUTE_CANARY_STREAK:FIRESTORE_SOURCE_REQUIRED")
        && exitRuntimeStreakCheckerText.includes("generated_at: new Date(Number(nowMs)).toISOString()")
        && exitRuntimeStreakCheckerText.includes("position_cycle_id: positionCycleIds.length === 1 ? positionCycleIds[0] : null")
        && exitRuntimeStreakCheckerText.includes("EXIT_RUNTIME_CANARY_STREAK:FIRESTORE_SOURCE_REQUIRED")
        && unifiedPromotionReportGeneratorText.includes("artifact_generated_age_minutes")
        && unifiedPromotionReportGeneratorText.includes("artifact_generated_at")
        && deployDecisionCheckerText.includes("artifact_generated_age_minutes")
        && artifactContractText.includes("artifact_generated_age_minutes")
        && runbookText.includes("artifact_generated_age_minutes"),
      reason: repairFirestoreStreakCheckerText.includes("generated_at: new Date(Number(nowMs)).toISOString()")
        && repairFirestoreStreakCheckerText.includes("hasFirestoreBackedRepairEvidence")
        && unifiedPromotionReportGeneratorText.includes("artifact_generated_age_minutes")
        && deployDecisionCheckerText.includes("artifact_generated_age_minutes")
        ? "LIVE streak evidence now proves both 24h history coverage and current artifact freshness"
        : "streak pass must not be accepted from a copied current-dir file without generated freshness evidence",
      file: FILES.deployDecisionChecker,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_52",
      label: "protected entry canary requires generated freshness provenance",
      ok: unifiedPromotionReportGeneratorText.includes("production_entry_protected_canary")
        && unifiedPromotionReportGeneratorText.includes("artifact_generated_age_minutes")
        && deployDecisionCheckerText.includes("MAX_PROTECTED_CANARY_ARTIFACT_AGE_MINUTES")
        && deployDecisionCheckerText.includes("hasFreshProtectedCanaryArtifact")
        && deployDecisionCheckerText.includes("hasStaleArtifactFreshness")
        && deployDecisionCheckerText.includes("artifact_generated_age_minutes")
        && artifactContractText.includes("production_entry_protected_canary")
        && artifactContractText.includes("artifact_generated_age_minutes")
        && runbookText.includes("SUBMIT_CHK_20A")
        && runbookText.includes("artifact_generated_age_minutes"),
      reason: deployDecisionCheckerText.includes("hasFreshProtectedCanaryArtifact")
        && runbookText.includes("artifact_generated_age_minutes")
        ? "protected entry canary pass now requires current-dir provenance and bounded generated freshness"
        : "protected entry canary must not pass CANARY/LIVE from a copied stale PASS artifact",
      file: FILES.deployDecisionChecker,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_53",
      label: "protected entry stale freshness reaches submit trace fixture",
      ok: readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("submitRequestClassifiesStaleProtectedEntryCanaryFreshnessAsStaleArtifact")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("STALE_ARTIFACT_PROVENANCE")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("DISCARD_ARTIFACT_DIR_AND_RERUN_FRESH_PROMOTION_PIPELINE")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveWithStaleRepairFirestoreStreakGeneratedAtFailsClosedAsStaleArtifact"),
      reason: readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("submitRequestClassifiesStaleProtectedEntryCanaryFreshnessAsStaleArtifact")
        ? "generated freshness staleness is verified through deploy decision and final submit trace fixtures"
        : "generated freshness staleness must be tested end-to-end, not only by static string checks",
      file: path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js"),
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_54",
      label: "LIVE readiness summaries require fresh artifact provenance",
      ok: cloudbuildWrapperText.includes("buildArtifactProvenance")
        && cloudbuildWrapperText.includes("LIVE_CUTOVER_READINESS_FILENAME")
        && cloudbuildWrapperText.includes("PRODUCTION_CUTOVER_READINESS_FILENAME")
        && cloudbuildWrapperText.includes("SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_FILENAME")
        && cloudbuildWrapperText.includes("SCHEDULER_TRAFFIC_CUTOVER_READINESS_FILENAME")
        && submitWrapperText.includes("hasFreshCurrentReadinessArtifact")
        && submitWrapperText.includes("LIVE_READINESS_ARTIFACT_MAX_AGE_MINUTES")
        && submitWrapperText.includes("LIVE production cutover readiness has stale artifact provenance")
        && submitWrapperText.includes("collectRunbookReviewChecklist")
        && runbookCheckerText.includes("hasFreshLiveReadinessArtifacts")
        && runbookCheckerText.includes("CHK_24B")
        && readText(path.resolve(__dirname, "..", "src", "tests", "run-v2-promotion-cloudbuild.test.js")).includes("artifact_generated_age_minutes")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("liveSubmitClassifiesStaleProductionCutoverReadinessFreshnessAsStaleArtifact")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("submitTraceSummaryExpandsRunbookAggregateFailures")
        && readText(path.resolve(__dirname, "..", "src", "tests", "v2-promotion-submit-operator-alert.test.js")).includes("previewExposesExpandedRunbookAggregateChecklist")
        && readText(path.resolve(__dirname, "..", "src", "tests", "send-v2-promotion-submit-operator-alert.test.js")).includes("sendModePreservesExpandedRunbookTraceThroughTransport")
        && artifactContractText.includes("LIVE readiness artifact")
        && runbookText.includes("LIVE readiness artifact")
        && runbookText.includes("CHK_24B"),
      reason: submitWrapperText.includes("hasFreshCurrentReadinessArtifact")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("liveSubmitClassifiesStaleProductionCutoverReadinessFreshnessAsStaleArtifact")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("submitTraceSummaryExpandsRunbookAggregateFailures")
        && readText(path.resolve(__dirname, "..", "src", "tests", "v2-promotion-submit-operator-alert.test.js")).includes("previewExposesExpandedRunbookAggregateChecklist")
        && readText(path.resolve(__dirname, "..", "src", "tests", "send-v2-promotion-submit-operator-alert.test.js")).includes("sendModePreservesExpandedRunbookTraceThroughTransport")
        && runbookCheckerText.includes("hasFreshLiveReadinessArtifacts")
        ? "LIVE cutover readiness summaries now require current-dir provenance, bounded generated freshness, and expanded runbook failure trace through operator alert send payload"
        : "LIVE readiness summaries must not pass submit or runbook review from copied or stale PASS artifacts, and runbook aggregate failures must expand to checklist IDs through operator alert send payload",
      file: FILES.submitWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_55",
      label: "LIVE submit forces V2 production cutover substitutions",
      ok: submitWrapperText.includes("function buildV2RuntimeCutoverSubstitutions")
        && submitWrapperText.includes("_DONBEOLJA_V2_ENABLED: live ? \"1\"")
        && submitWrapperText.includes("_DONBEOLJA_V2_DRY_RUN: live ? \"0\"")
        && submitWrapperText.includes("_DONBEOLJA_V2_CANARY_ONLY: live ? \"0\"")
        && submitWrapperText.includes("_DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER: live ? \"1\"")
        && submitWrapperText.includes("_DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL: \"0\"")
        && submitWrapperText.includes("_DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE: \"OPENCLAW_CRON\"")
        && submitWrapperText.includes("_DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: row.promotionMode === \"LIVE\" ? \"1\"")
        && submitWrapperText.includes("_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED: enablesProductionEntryRouteCanaryFirestore ? \"1\"")
        && submitWrapperText.includes("_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE: enablesProductionEntryRouteCanaryFirestore ? \"FIRESTORE\"")
        && submitWrapperText.includes("_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE: requiresCanaryStreakFirestore ? \"1\"")
        && cloudbuildText.includes("DONBEOLJA_V2_ENABLED=$_DONBEOLJA_V2_ENABLED")
        && cloudbuildText.includes("DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER=$_DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER")
        && cloudbuildText.includes("DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED=$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED")
        && cloudbuildText.includes("DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE=$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE")
        && cloudbuildText.includes("DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED=$_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED")
        && cloudbuildText.includes("DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE=$_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE")
        && productionRuntimeConfigAuditText.includes("CLOUDBUILD_PROMOTION_RUNTIME_FORWARDS_V2_CUTOVER_ENV")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("liveSubmitForcesProductionCutoverSubstitutionsEvenWhenEnvIsUnsafe"),
      reason: submitWrapperText.includes("function buildV2RuntimeCutoverSubstitutions")
        && cloudbuildText.includes("DONBEOLJA_V2_ENABLED=$_DONBEOLJA_V2_ENABLED")
        ? "LIVE submit overrides safe CloudBuild defaults with explicit V2 production cutover values and forwards them to readiness checks"
        : "LIVE submit must not rely on safe CloudBuild defaults for V2 enabled/dry-run/canary-only/cutover flags",
      file: FILES.submitWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_56",
      label: "submit wrapper independently gates production runtime config",
      ok: submitWrapperText.includes("productionRuntimeConfigAudit")
        && submitWrapperText.includes("auditWorkspaceV2ProductionRuntimeConfigContract")
        && submitWrapperText.includes("SUBMIT_CHK_22")
        && submitWrapperText.includes("has_production_runtime_config_blocker")
        && submitTraceText.includes("SUBMIT_CHK_22")
        && runbookText.includes("| 29 | `SUBMIT_CHK_22`")
        && runbookText.includes("| `SUBMIT_CHK_22` | `29` | V2 production runtime config contract complete |")
        && artifactContractText.includes("approval_evidence_sources.production_runtime_config_contract")
        && artifactContractText.includes("approval_verification.production_runtime_config_summary")
        && artifactContractText.includes("submit_trace_summary.production_runtime_config_summary")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("submitRequestBlocksWhenProductionRuntimeConfigContractFails"),
      reason: submitWrapperText.includes("SUBMIT_CHK_22")
        && submitTraceText.includes("SUBMIT_CHK_22")
        ? "submit wrapper now re-runs production runtime config audit and maps failures to runbook 29"
        : "submit wrapper must not rely only on CloudBuild validation for production runtime config contract",
      file: FILES.submitWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_57",
      label: "promotion CI requires production route canary history contract",
      ok: packageJsonText.includes('"test:v2-production-entry-route-canary-history": "node src/tests/v2-production-entry-route-canary-history.test.js"')
        && packageJsonText.includes("npm run test:v2-production-entry-route-canary-history")
        && artifactContractText.includes("v2-production-entry-route-canary-history.test.js")
        && artifactContractText.includes("history_source=FIRESTORE")
        && runbookText.includes("v2-production-entry-route-canary-history.test.js")
        && runbookText.includes("test:v2-production-entry-route-canary-history"),
      reason: packageJsonText.includes("npm run test:v2-production-entry-route-canary-history")
        ? "promotion CI now checks production entry route canary history append/source contract before accepting 24h streak evidence"
        : "promotion CI must not accept 24h route streak evidence without running the durable history append/source contract",
      file: FILES.packageJson,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_58",
      label: "V2 promotion forbids TP0 contract reintroduction",
      ok: readText(path.resolve(__dirname, "..", "src", "v2", "entryBoundaryAudit.js")).includes("V2_TP0_EXIT_CONTRACT_FORBIDDEN")
        && readText(path.resolve(__dirname, "..", "src", "v2", "productionCutoverAudit.js")).includes("V2_ENTRY_BOUNDARY_FORBIDS_TP0_CONTRACT")
        && packageJsonText.includes("node src/tests/v2-entry-boundary-audit.test.js")
        && readText(path.resolve(__dirname, "..", "src", "tests", "v2-entry-boundary-audit.test.js")).includes("tp0ContractNamesInV2SourceFailClosed")
        && artifactContractText.includes("V2_TP0_EXIT_CONTRACT_FORBIDDEN")
        && artifactContractText.includes("EXIT_TP_P0")
        && runbookText.includes("V2_TP0_EXIT_CONTRACT_FORBIDDEN")
        && runbookText.includes("EXIT_TP_P0"),
      reason: readText(path.resolve(__dirname, "..", "src", "v2", "entryBoundaryAudit.js")).includes("V2_TP0_EXIT_CONTRACT_FORBIDDEN")
        && packageJsonText.includes("node src/tests/v2-entry-boundary-audit.test.js")
        ? "V2 promotion now fails closed if TP0/P0 exit contract names re-enter V2 production source"
        : "V2 promotion must not allow TP0/P0 exit contract names to re-enter V2 production source",
      file: path.resolve(__dirname, "..", "src", "v2", "entryBoundaryAudit.js"),
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_59",
      label: "promotion CI requires exit runtime canary history contract",
      ok: packageJsonText.includes('"test:v2-exit-runtime-canary-history": "node src/tests/v2-exit-runtime-canary-history.test.js"')
        && packageJsonText.includes("npm run test:v2-exit-runtime-canary-history")
        && readText(path.resolve(__dirname, "..", "src", "tests", "v2-exit-runtime-canary-history.test.js")).includes("enabledWriteUsesV2PrefixedCollectionAndCanBeLoaded")
        && readText(path.resolve(__dirname, "..", "src", "tests", "v2-exit-runtime-canary-history.test.js")).includes("secretLeakGuardRejectsSuspiciousArtifacts")
        && artifactContractText.includes("v2-exit-runtime-canary-history.test.js")
        && artifactContractText.includes("secret-leak guard")
        && runbookText.includes("v2-exit-runtime-canary-history.test.js")
        && runbookText.includes("test:v2-exit-runtime-canary-history"),
      reason: packageJsonText.includes("npm run test:v2-exit-runtime-canary-history")
        ? "promotion CI now checks exit runtime canary history append/source and secret-leak contracts before accepting 24h streak evidence"
        : "promotion CI must not accept 24h exit runtime streak evidence without running the durable history append/source contract",
      file: path.resolve(__dirname, "..", "src", "tests", "v2-exit-runtime-canary-history.test.js"),
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_60",
      label: "deploy decision enforces promotion position lineage consistency",
      ok: deployDecisionCheckerText.includes("buildPromotionPositionLineageBlockers")
        && runbookCheckerText.includes("hasPromotionPositionLineageConsistency")
        && runbookCheckerText.includes("selector_meta.position_cycle_id,candidate_selection_summary.selected_position_cycle_id,candidate_selection_summary.selected_preflight.position_cycle_id,position_cycle_id")
        && deployDecisionCheckerText.includes("DEPLOY_DECISION:SELECTOR_META_POSITION_CYCLE_MISMATCH")
        && deployDecisionCheckerText.includes("DEPLOY_DECISION:CANDIDATE_SELECTION_PREFLIGHT_POSITION_CYCLE_MISMATCH")
        && deployDecisionCheckerText.includes("DEPLOY_DECISION:SELECTOR_CANDIDATE_POSITION_CYCLE_MISMATCH")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("canaryWithSelectorMetaPositionMismatchFailsClosed")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("canaryWithSelectedPreflightPositionMismatchFailsClosed")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-canary-runbook.test.js")).includes("runbookCheckFailsWhenPromotionPositionLineageDrifts")
        && artifactContractText.includes("SELECTOR_META_POSITION_CYCLE_MISMATCH")
        && runbookText.includes("SELECTOR_META_POSITION_CYCLE_MISMATCH"),
      reason: deployDecisionCheckerText.includes("buildPromotionPositionLineageBlockers")
        && runbookCheckerText.includes("hasPromotionPositionLineageConsistency")
        ? "deploy decision and runbook verifier now block selector/candidate/preflight position cycle drift before submit"
        : "deploy decision and runbook verifier must not approve when selector, candidate, and selected preflight point to different position cycles",
      file: FILES.deployDecisionChecker,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_61",
      label: "submit trace carries actionable failed check details",
      ok: submitWrapperText.includes("failed_submit_check_details")
        && submitWrapperText.includes("collectSubmitCheckTraceDetails")
        && submitTraceText.includes("buildSubmitCheckTraceDetail")
        && submitTraceText.includes("collectSubmitCheckTraceDetails")
        && submitTraceText.includes("formatSubmitCheckDetails")
        && submitTraceText.includes(";file:")
        && submitTraceText.includes(";field:")
        && readText(path.resolve(__dirname, "..", "scripts", "lib", "v2-promotion-operator-summary.js")).includes('require("./v2-promotion-submit-trace")')
        && readText(path.resolve(__dirname, "..", "scripts", "lib", "v2-promotion-operator-summary.js")).includes("failed_submit_check_details=")
        && readText(path.resolve(__dirname, "..", "scripts", "lib", "v2-promotion-submit-operator-alert.js")).includes('require("./v2-promotion-submit-trace")')
        && readText(path.resolve(__dirname, "..", "scripts", "lib", "v2-promotion-submit-operator-alert.js")).includes("failed_submit_check_details=")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("failed_submit_check_details[0]")
        && readText(path.resolve(__dirname, "..", "src", "tests", "v2-promotion-submit-operator-alert.test.js")).includes("failed_submit_check_details=SUBMIT_CHK_08"),
      reason: submitWrapperText.includes("failed_submit_check_details")
        && submitTraceText.includes("collectSubmitCheckTraceDetails")
        && submitTraceText.includes(";file:")
        && submitTraceText.includes(";field:")
        ? "submit blockers now carry id, meaning, runbook checklist, reason, file, and field into operator summary and alert preview"
        : "submit blockers must be actionable without manually cross-referencing SUBMIT_CHK ids",
      file: FILES.submitWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_62",
      label: "runbook verifier enforces submit trace field lineage",
      ok: runbookCheckerText.includes("CONTEXT_SUBMIT_TRACE_FIELDS")
        && runbookCheckerText.includes("arraysEqual(normalizeArray(row.fields), CONTEXT_SUBMIT_TRACE_FIELDS[id] || [])")
        && cloudbuildWrapperText.includes("CONTEXT_SUBMIT_TRACE_FIELDS")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-canary-runbook.test.js")).includes("contextSubmitTraceHelperRejectsFieldTraceDrift"),
      reason: runbookCheckerText.includes("CONTEXT_SUBMIT_TRACE_FIELDS")
        && runbookCheckerText.includes("normalizeArray(row.fields)")
        ? "runbook verifier now blocks submit trace checks when their evidence fields drift from the CloudBuild context contract"
        : "runbook verifier must not accept submit trace checks that omit or alter the field-level evidence map",
      file: FILES.runbookChecker,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_63",
      label: "deploy decision enforces LIVE evidence cycle consistency",
      ok: deployDecisionCheckerText.includes("collectLiveEvidenceCycleConsistencyBlockers")
        && deployDecisionCheckerText.includes("DEPLOY_DECISION:LIVE_EVIDENCE_ARTIFACT_CYCLE_MISMATCH")
        && deployDecisionCheckerText.includes("DEPLOY_DECISION:LIVE_STREAK_POSITION_CYCLE_MISMATCH")
        && deployDecisionCheckerText.includes("DEPLOY_DECISION:LIVE_PROTECTED_ENTRY_POSITION_CYCLE_MISMATCH")
        && cloudbuildWrapperText.includes("LIVE_STREAK_POSITION_CYCLE_MISMATCH")
        && submitWrapperText.includes("LIVE_STREAK_POSITION_CYCLE_MISMATCH")
        && readText(path.resolve(__dirname, "..", "src", "tests", "run-v2-promotion-cloudbuild.test.js")).includes("liveStreakPositionCycleMismatchIsLiveEvidenceCycleBlocker")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("DEPLOY_DECISION:LIVE_STREAK_POSITION_CYCLE_MISMATCH")
        && repairFirestoreStreakCheckerText.includes("position_cycle_id: positionCycleIds.length === 1 ? positionCycleIds[0] : null")
        && productionEntryRouteStreakCheckerText.includes("position_cycle_id: positionCycleIds.length === 1 ? positionCycleIds[0] : null")
        && exitRuntimeStreakCheckerText.includes("position_cycle_id: positionCycleIds.length === 1 ? positionCycleIds[0] : null")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveEvidenceCycleMismatchFailsClosed")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveStreakPositionCycleMismatchFailsClosed")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveProtectedEntryPositionCycleMismatchFailsClosed")
        && artifactContractText.includes("DEPLOY_DECISION:LIVE_STREAK_POSITION_CYCLE_MISMATCH")
        && runbookText.includes("DEPLOY_DECISION:LIVE_STREAK_POSITION_CYCLE_MISMATCH"),
      reason: deployDecisionCheckerText.includes("collectLiveEvidenceCycleConsistencyBlockers")
        ? "LIVE promotion now fails closed when long-run canaries and protected-entry proof point at different artifact or position cycles"
        : "LIVE promotion must not approve when evidence artifacts, streak position lineage, or protected-entry position lineage are from different cycles",
      file: FILES.deployDecisionChecker,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_64",
      label: "repair evidence summary requires concrete order evidence",
      ok: deployDecisionCheckerText.includes("orderEvidenceCount > 0")
        && cloudbuildWrapperText.includes("REPAIR_EVIDENCE_SUMMARY_REQUIRED")
        && submitWrapperText.includes("REPAIR_EVIDENCE_SUMMARY_REQUIRED")
        && readText(path.resolve(__dirname, "..", "src", "tests", "run-v2-promotion-cloudbuild.test.js")).includes("repairEvidenceSummaryRequiredIsBoundedRuntimeBlocker")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("repairEvidenceSummaryRequiredIsBoundedRuntimeSubmitBlocker")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("canaryWithRepairCompletionButNoOrderEvidenceFailsClosed"),
      reason: deployDecisionCheckerText.includes("orderEvidenceCount > 0")
        && cloudbuildWrapperText.includes("REPAIR_EVIDENCE_SUMMARY_REQUIRED")
        && submitWrapperText.includes("REPAIR_EVIDENCE_SUMMARY_REQUIRED")
        ? "repair request completion cannot satisfy promotion evidence without concrete SL/TP1 order evidence, and missing repair evidence is classified as bounded runtime evidence"
        : "promotion must not accept or misclassify repair completion summaries that omit concrete exchange order evidence",
      file: FILES.deployDecisionChecker,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_65",
      label: "lineage and runtime-chain deploy blockers are classified",
      ok: cloudbuildWrapperText.includes("LINEAGE_CONTRACT")
        && cloudbuildWrapperText.includes("RUNTIME_CHAIN_AUDIT_REQUIRED")
        && submitWrapperText.includes("LINEAGE_CONTRACT")
        && submitWrapperText.includes("RUNTIME_CHAIN_AUDIT_REQUIRED")
        && readText(path.resolve(__dirname, "..", "src", "tests", "run-v2-promotion-cloudbuild.test.js")).includes("lineageContractMismatchIsProvenanceBlocker")
        && readText(path.resolve(__dirname, "..", "src", "tests", "run-v2-promotion-cloudbuild.test.js")).includes("runtimeChainAuditRequiredIsBoundedRuntimeBlocker")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("lineageContractMismatchIsProvenanceSubmitBlocker")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("runtimeChainAuditRequiredIsBoundedRuntimeSubmitBlocker"),
      reason: cloudbuildWrapperText.includes("LINEAGE_CONTRACT")
        && submitWrapperText.includes("RUNTIME_CHAIN_AUDIT_REQUIRED")
        ? "lineage contract blockers now route to provenance repair, and runtime-chain blockers route to bounded runtime evidence regeneration"
        : "deploy submit wrappers must not leave lineage or runtime-chain blockers as generic context/manual review failures",
      file: FILES.cloudbuildWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_66",
      label: "production cutover audit enforces webhook guard ordering",
      ok: productionCutoverAuditText.includes("V2_WEBHOOK_CUTOVER_GUARD_PRECEDES_OPENCLAW_LEGACY_AUTHORITY")
        && productionCutoverAuditText.includes("V2_WEBHOOK_CUTOVER_GUARD_PRECEDES_LEGACY_SIGNAL_WRITE")
        && productionCutoverAuditText.includes("V2_WEBHOOK_CUTOVER_GUARD_PRECEDES_LEGACY_IMMEDIATE_PROCESS")
        && productionCutoverAuditText.includes("webhookSignalRouteSlice")
        && readText(path.resolve(__dirname, "..", "src", "tests", "v2-production-cutover-audit.test.js")).includes("webhookCutoverGuardAfterLegacySideEffectsFailsClosed")
        && artifactContractText.includes("V2_WEBHOOK_CUTOVER_GUARD_PRECEDES_LEGACY_SIGNAL_WRITE")
        && runbookText.includes("V2_WEBHOOK_CUTOVER_GUARD_PRECEDES_LEGACY_SIGNAL_WRITE"),
      reason: productionCutoverAuditText.includes("V2_WEBHOOK_CUTOVER_GUARD_PRECEDES_LEGACY_SIGNAL_WRITE")
        && readText(path.resolve(__dirname, "..", "src", "tests", "v2-production-cutover-audit.test.js")).includes("webhookCutoverGuardAfterLegacySideEffectsFailsClosed")
        ? "production cutover audit now proves the legacy webhook guard executes before legacy authority, persistence, or immediate process side effects"
        : "production cutover audit must fail closed when the legacy webhook guard is placed after legacy authority, persistence, or immediate process side effects",
      file: FILES.productionCutoverAudit,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_67",
      label: "LIVE evidence cycle must match actual deploy artifact dir",
      ok: deployDecisionCheckerText.includes("artifactDir = null")
        && deployDecisionCheckerText.includes("artifactDirs[0] !== expectedArtifactDir")
        && deployDecisionCheckerText.includes("buildDeployDecision(unifiedReport, { artifactDir })")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveEvidenceArtifactDirMustMatchDeployArtifactDirFailsClosed")
        && artifactContractText.includes("V2_PROMOTION_ARTIFACT_DIR")
        && runbookText.includes("V2_PROMOTION_ARTIFACT_DIR"),
      reason: deployDecisionCheckerText.includes("artifactDirs[0] !== expectedArtifactDir")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveEvidenceArtifactDirMustMatchDeployArtifactDirFailsClosed")
        ? "LIVE deploy decision now rejects evidence rows that agree with each other but point outside the actual promotion artifact dir"
        : "LIVE deploy decision must compare long-run/protected-entry evidence artifact_dir values against the actual V2_PROMOTION_ARTIFACT_DIR",
      file: FILES.deployDecisionChecker,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_68",
      label: "LIVE exit runtime streak must include matching long-run quality summary",
      ok: deployDecisionCheckerText.includes("hasExitRuntimeLongRunQualitySummary")
        && deployDecisionCheckerText.includes("streak.firestore_source_required === true")
        && deployDecisionCheckerText.includes("numericFieldsMatch(quality, row")
        && deployDecisionCheckerText.includes("numericFieldsMatch(defectCounts, row")
        && deployDecisionCheckerText.includes("defect_counts")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveWithExitRuntimeMissingLongRunQualitySummaryFailsClosed")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveWithExitRuntimeLongRunQualityDriftFailsClosed")
        && artifactContractText.includes("long_run_quality_summary")
        && artifactContractText.includes("top-level streak fields")
        && runbookText.includes("long_run_quality_summary")
        && runbookText.includes("top-level streak fields"),
      reason: deployDecisionCheckerText.includes("numericFieldsMatch(defectCounts, row")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveWithExitRuntimeLongRunQualityDriftFailsClosed")
        ? "LIVE deploy decision now rejects exit runtime streak evidence when the long-run quality summary is missing or drifts from top-level counters"
        : "LIVE exit runtime streak must not pass from top-level counters alone; long-run quality summary must be present and match the top-level evidence",
      file: FILES.deployDecisionChecker,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_69",
      label: "LIVE scheduler collector preflight requires exact Firestore canary env",
      ok: readText(path.resolve(__dirname, "..", "src", "v2", "schedulerTrafficCollectorPreflight.js")).includes("REQUIRED_LIVE_COLLECTOR_ENV")
        && readText(path.resolve(__dirname, "..", "src", "v2", "schedulerTrafficCollectorPreflight.js")).includes("DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED")
        && readText(path.resolve(__dirname, "..", "src", "v2", "schedulerTrafficCollectorPreflight.js")).includes("DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE")
        && readText(path.resolve(__dirname, "..", "src", "v2", "schedulerTrafficCollectorPreflight.js")).includes("SCHEDULER_TRAFFIC_COLLECTOR_REQUIRED_ENV_VALUE_MISMATCH")
        && runbookCheckerText.includes("required_env_exact_match_n")
        && runbookCheckerText.includes("required_env_mismatch_n")
        && runbookText.includes("required_env_exact_match_n")
        && runbookText.includes("required_env_mismatch_n")
        && artifactContractText.includes("required_env_exact_match_n")
        && artifactContractText.includes("required_env_mismatch_n")
        && readText(path.resolve(__dirname, "..", "src", "tests", "v2-scheduler-traffic-collector-preflight.test.js")).includes("preflightBlocksWhenCanaryFirestoreEnvIsWrong"),
      reason: readText(path.resolve(__dirname, "..", "src", "v2", "schedulerTrafficCollectorPreflight.js")).includes("SCHEDULER_TRAFFIC_COLLECTOR_REQUIRED_ENV_VALUE_MISMATCH")
        && runbookCheckerText.includes("required_env_exact_match_n")
        ? "scheduler collector preflight now proves Cloud Run canary Firestore env exact values before LIVE evidence is trusted"
        : "scheduler collector preflight must not pass from readable Cloud Run service state unless LIVE canary Firestore env values are exact",
      file: path.resolve(__dirname, "..", "src", "v2", "schedulerTrafficCollectorPreflight.js"),
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_70",
      label: "LIVE long-run streaks require collector execution summaries",
      ok: productionEntryRouteStreakCheckerText.includes("collector_execution_summary")
        && productionEntryRouteStreakCheckerText.includes("producer_script: \"run-v2-production-entry-route-canary\"")
        && exitRuntimeStreakCheckerText.includes("collector_execution_summary")
        && exitRuntimeStreakCheckerText.includes("producer_script: \"run-v2-exit-runtime-canary\"")
        && deployDecisionCheckerText.includes("hasProductionEntryRouteCollectorExecutionSummary")
        && deployDecisionCheckerText.includes("hasExitRuntimeCollectorExecutionSummary")
        && deployDecisionCheckerText.includes("numericFieldsMatch(collector, row")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveWithProductionEntryRouteMissingCollectorExecutionSummaryFailsClosed")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveWithProductionEntryRouteCollectorExecutionDriftFailsClosed")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveWithExitRuntimeMissingCollectorExecutionSummaryFailsClosed")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveWithExitRuntimeCollectorExecutionDriftFailsClosed")
        && artifactContractText.includes("Long-run collector execution summary contract")
        && runbookText.includes("collector_execution_summary.status=PASS"),
      reason: deployDecisionCheckerText.includes("hasProductionEntryRouteCollectorExecutionSummary")
        && deployDecisionCheckerText.includes("hasExitRuntimeCollectorExecutionSummary")
        && artifactContractText.includes("Long-run collector execution summary contract")
        ? "LIVE deploy decision now verifies that long-run streaks came from the expected scheduler producer, not only from top-level PASS counters"
        : "LIVE long-run streaks must include collector_execution_summary and deploy decision must fail closed on missing or drifted producer evidence",
      file: FILES.deployDecisionChecker,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_71",
      label: "LIVE submit requires OpenClaw supreme closed-loop evidence",
      ok: runbookText.includes("| `SUBMIT_CHK_23` | `31` | LIVE OpenClaw supreme control plane closed loop complete |")
        && runbookText.includes("| 31 | `SUBMIT_CHK_23`")
        && artifactContractText.includes("approval_contract.openclaw_supreme_control_plane_closed_loop_required")
        && artifactContractText.includes("approval_evidence_sources.openclaw_supreme_control_plane_closed_loop")
        && artifactContractText.includes("bounded_runtime_summary.openclaw_supreme_control_plane_summary")
        && artifactContractText.includes("lineage_consistency_summary.ok=true")
        && artifactContractText.includes("learner_shadow_summary.stale_evaluation_n=0")
        && artifactContractText.includes("learner_shadow_summary.max_observed_evaluation_age_minutes")
        && artifactContractText.includes("learner_shadow_summary.latest_evaluated_at")
        && artifactContractText.includes("collector_execution_summary.status=PASS")
        && artifactContractText.includes("producer_script=collect-v2-promotion-runtime-snapshot")
        && artifactContractText.includes("producer_scope=openclaw_supreme_control_plane")
        && artifactContractText.includes("has_openclaw_supreme_control_plane_blocker")
        && artifactContractText.includes("openclaw_supreme_blocker=YES")
        && runbookText.includes("openclaw_supreme_blocker=YES")
        && operatorSummaryText.includes("openclaw_supreme_blocker=")
        && operatorAlertPreviewText.includes("openclaw_supreme_blocker=")
        && openClawSupremeSummary.lines.includes("openclaw_supreme_blocker=YES")
        && openClawSupremePreviewTraceLines.includes("openclaw_supreme_blocker=YES")
        && submitWrapperText.includes("SUBMIT_CHK_23")
        && submitWrapperText.includes("hasOpenClawSupremeControlPlaneCoverage")
        && submitWrapperText.includes("openclaw_supreme_control_plane_closed_loop_required")
        && submitWrapperText.includes("OPENCLAW_SUPREME_CONTROL_PLANE_BLOCKER")
        && submitTraceText.includes("SUBMIT_CHK_23")
        && submitTraceText.includes("runbookChecklist: Object.freeze([\"31\"])")
        && deployDecisionCheckerText.includes("DEPLOY_DECISION:OPENCLAW_SUPREME_CONTROL_PLANE_CLOSED_LOOP_REQUIRED")
        && deployDecisionCheckerText.includes("hasOpenClawSupremeControlPlaneCoverage")
        && deployDecisionCheckerText.includes("expected_openclaw_decision_id")
        && deployDecisionCheckerText.includes("stale_evaluation_n")
        && deployDecisionCheckerText.includes("max_observed_evaluation_age_minutes")
        && deployDecisionCheckerText.includes("latest_evaluated_at")
        && deployDecisionCheckerText.includes("collector_execution_summary")
        && deployDecisionCheckerText.includes("collect-v2-promotion-runtime-snapshot")
        && deployDecisionCheckerText.includes("openclaw_supreme_control_plane")
        && deployDecisionCheckerText.includes("learner_lineage_mismatch_n")
        && runbookText.includes("learner_lineage_mismatch_n")
        && runbookText.includes("max_evaluation_age_minutes")
        && runbookText.includes("max_observed_evaluation_age_minutes")
        && runbookText.includes("collector_execution_summary.status=PASS")
        && readText(path.resolve(__dirname, "..", "src", "tests", "v2-openclaw-supreme-control-plane.test.js")).includes("supremeSummaryRequiresSingleLineageAcrossPermitOutcomeAndLearner")
        && readText(path.resolve(__dirname, "..", "src", "tests", "v2-openclaw-supreme-control-plane.test.js")).includes("supremeSummaryRejectsExpiredPermitAndStaleLearnerEvidence")
        && readText(path.resolve(__dirname, "..", "src", "tests", "v2-openclaw-supreme-control-plane.test.js")).includes("supremeSummaryRejectsMissingCollectorProvenance")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveOpenClawSupremeLineageMismatchFailsClosed")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveOpenClawSupremeStaleLearnerEvidenceFailsClosed")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveOpenClawSupremeMissingLearnerFreshnessContractFailsClosed")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveOpenClawSupremeMissingCollectorProvenanceFailsClosed")
        && packageJsonText.includes("test:v2-openclaw-supreme-control-plane")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("liveSubmitBlocksWithoutOpenClawSupremeClosedLoopEvidence")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("openclaw_supreme_blocker=YES")
        && readText(path.resolve(__dirname, "..", "src", "tests", "v2-promotion-submit-operator-alert.test.js")).includes("openClawSupremeBlockerIsVisibleInSummaryAndTrace"),
      reason: submitWrapperText.includes("SUBMIT_CHK_23")
        && submitWrapperText.includes("hasOpenClawSupremeControlPlaneCoverage")
        && openClawSupremePreviewTraceLines.includes("openclaw_supreme_blocker=YES")
        ? "LIVE submit now blocks and operator-visible traces OpenClaw world state, permit, outcome, and learner shadow closed-loop evidence gaps"
        : "LIVE submit must expose SUBMIT_CHK_23/runbook 31 and fail closed without OpenClaw supreme closed-loop evidence",
      file: FILES.submitWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_72",
      label: "LIVE long-run streak artifacts require temporal coherence",
      ok: deployDecisionCheckerText.includes("MAX_LIVE_STREAK_ARTIFACT_SKEW_MINUTES")
        && deployDecisionCheckerText.includes("collectLiveStreakTemporalCoherenceBlockers")
        && deployDecisionCheckerText.includes("DEPLOY_DECISION:LIVE_STREAK_TEMPORAL_WINDOW_MISMATCH")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveWithMismatchedLongRunStreakArtifactWindowFailsClosed")
        && artifactContractText.includes("LIVE_STREAK_TEMPORAL_WINDOW_MISMATCH")
        && artifactContractText.includes("30분을 초과")
        && runbookText.includes("DEPLOY_DECISION:LIVE_STREAK_TEMPORAL_WINDOW_MISMATCH")
        && runbookText.includes("artifact_generated_at` 시각은 서로 30분 이내"),
      reason: deployDecisionCheckerText.includes("collectLiveStreakTemporalCoherenceBlockers")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("liveWithMismatchedLongRunStreakArtifactWindowFailsClosed")
        ? "LIVE deploy decision now rejects mixing 24h repair, entry, and exit streak PASS artifacts from different generation windows"
        : "LIVE 24h canary streaks must not pass from individually fresh but mutually stale artifact windows",
      file: FILES.deployDecisionChecker,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_73",
      label: "CloudBuild context traces OpenClaw supreme blockers independently",
      ok: runbookText.includes("| 13F | `SUBMIT_CHK_06`, `SUBMIT_CHK_07`, `SUBMIT_CHK_23`")
        && runbookText.includes("openclaw_supreme=BLOCKED")
        && cloudbuildWrapperText.includes("has_openclaw_supreme_control_plane_blocker")
        && cloudbuildWrapperText.includes("openclaw_supreme=BLOCKED")
        && cloudbuildWrapperText.includes("SUBMIT_CHK_23")
        && cloudbuildWrapperText.includes("OPENCLAW_SUPREME_CONTROL_PLANE")
        && cloudbuildWrapperText.includes("OPENCLAW_SUPREME_CONTROL_PLANE_BLOCKER")
        && runbookCheckerText.includes("hasConsistentOpenClawSupremeBlockerTrace")
        && runbookCheckerText.includes("CHK_13F")
        && runbookCheckerText.includes("SUBMIT_CHK_23")
        && runbookCheckerText.includes("OPENCLAW_SUPREME_CONTROL_PLANE")
        && readText(path.resolve(__dirname, "..", "src", "tests", "run-v2-promotion-cloudbuild.test.js")).includes("openClawSupremeBlockerHasSpecificCloudbuildAction")
        && readText(path.resolve(__dirname, "..", "src", "tests", "run-v2-promotion-cloudbuild.test.js")).includes("contextSubmitTraceIncludesOpenClawSupremeCheckAndRunbook")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-canary-runbook.test.js")).includes("contextSubmitTraceHelperAcceptsOpenClawSupremeBlocker")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-canary-runbook.test.js")).includes("contextSubmitTraceHelperRejectsOpenClawSupremeStatusLineDrift"),
      reason: cloudbuildWrapperText.includes("openclaw_supreme=BLOCKED")
        && runbookCheckerText.includes("hasConsistentOpenClawSupremeBlockerTrace")
        && readText(path.resolve(__dirname, "..", "src", "tests", "run-v2-promotion-cloudbuild.test.js")).includes("contextSubmitTraceIncludesOpenClawSupremeCheckAndRunbook")
        ? "CloudBuild context now has an independent contract for OpenClaw supreme blocker family, status line, submit trace, and runbook checklist linkage"
        : "OpenClaw supreme CloudBuild context blockers must not be hidden inside the generic submit evidence contract",
      file: FILES.cloudbuildWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_74",
      label: "submit wrapper rejects stale CloudBuild deploy summaries",
      ok: submitWrapperText.includes("hasCloudbuildContextDeployDecisionSummaryMatch")
        && submitWrapperText.includes("cloudbuild deploy decision summary drifted from current deploy decision")
        && submitWrapperText.includes("LIVE_STREAK_TEMPORAL_WINDOW_MISMATCH")
        && cloudbuildWrapperText.includes("LIVE_STREAK_TEMPORAL_WINDOW_MISMATCH")
        && runbookText.includes("context의 deploy decision 요약이 현재 `promotion-deploy-decision.json`에서 재계산한 deploy 상태/카운터/계열 요약과 같고")
        && artifactContractText.includes("context에 들어 있는 `deploy_decision_summary` 를 신뢰만 하지 않고")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("approvalVerificationRejectsCloudbuildContextDeployDecisionSummaryDrift"),
      reason: submitWrapperText.includes("hasCloudbuildContextDeployDecisionSummaryMatch")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("approvalVerificationRejectsCloudbuildContextDeployDecisionSummaryDrift")
        ? "submit wrapper now recomputes deploy summary from the current deploy decision and rejects stale context summaries"
        : "submit wrapper must not approve a stale promotion-cloudbuild-context.json when promotion-deploy-decision.json has changed",
      file: FILES.submitWrapper,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_75",
      label: "V2 production runtime chain is locked into promotion",
      ok: packageJsonText.includes("check:v2-production-runtime-chain")
        && packageJsonText.includes("v2-production-runtime-chain-audit.test.js")
        && readText(FILES.productionRuntimeChainChecker).includes("auditV2ProductionRuntimeChain")
        && readText(FILES.productionRuntimeChainAudit).includes("V2_PRODUCTION_CHAIN_ENTRY_ROUTE_PERMIT_AND_KERNEL")
        && readText(FILES.productionRuntimeChainAudit).includes("V2_PRODUCTION_CHAIN_FILL_SYNC_BOUNDARY_PASS")
        && readText(FILES.productionRuntimeChainAudit).includes("V2_PRODUCTION_CHAIN_TRAIL_ACTIVATION_REQUIRES_NATIVE_OK")
        && readText(FILES.productionRuntimeChainAudit).includes("V2_PRODUCTION_CHAIN_24H_EVIDENCE_AND_OPENCLAW_SUPREME_GATED")
        && readText(FILES.productionRuntimeChainAudit).includes("DONBEOLJA_FILL_SYNC_LEGACY_CANONICAL_BACKFILL_ENABLED")
        && readText(path.resolve(__dirname, "..", "src", "tests", "v2-production-runtime-chain-audit.test.js")).includes("missingOpenClawPermitFailsClosed")
        && readText(path.resolve(__dirname, "..", "src", "tests", "v2-production-runtime-chain-audit.test.js")).includes("missingReducedFillReducerFailsClosed")
        && readText(path.resolve(__dirname, "..", "src", "tests", "v2-production-runtime-chain-audit.test.js")).includes("missingTrailNativeRefreshGateFailsClosed")
        && readText(path.resolve(__dirname, "..", "src", "tests", "v2-production-runtime-chain-audit.test.js")).includes("missingLiveTemporalCoherenceFailsClosed")
        && readText(path.resolve(__dirname, "..", "docs", "DONBEOLJA_V2_IMPLEMENTATION_STATUS_2026-04-21.md")).includes("Production Runtime Chain Audit"),
      reason: packageJsonText.includes("check:v2-production-runtime-chain")
        && packageJsonText.includes("v2-production-runtime-chain-audit.test.js")
        ? "promotion now has a source-level chain audit for entry/protection/fill/reducer/tick/alert/watchdog/repair plus 24h/OpenClaw evidence"
        : "V2 production runtime chain audit must be exposed as a checker and included in test:v2-promotion",
      file: FILES.productionRuntimeChainAudit,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_76",
      label: "deploy decision and submit wrapper require production runtime chain audit",
      ok: deployDecisionCheckerText.includes("buildV2ProductionRuntimeChainAuditSummary")
        && deployDecisionCheckerText.includes("hasProductionRuntimeChainAudit")
        && deployDecisionCheckerText.includes("DEPLOY_DECISION:V2_PRODUCTION_RUNTIME_CHAIN_AUDIT_REQUIRED")
        && deployDecisionCheckerText.includes("production_runtime_chain_audit: productionRuntimeChainAudit")
        && submitWrapperText.includes("production_runtime_chain_audit_required")
        && submitWrapperText.includes("approval_evidence_sources.production_runtime_chain_audit")
        && submitWrapperText.includes("SUBMIT_CHK_04C")
        && submitTraceText.includes("SUBMIT_CHK_04C")
        && runbookText.includes("| 14B | `SUBMIT_CHK_04C` |")
        && artifactContractText.includes("approval_contract.production_runtime_chain_audit_required")
        && artifactContractText.includes("approval_evidence_sources.production_runtime_chain_audit")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-promotion-deploy-decision.test.js")).includes("canaryWithoutProductionRuntimeChainAuditFailsClosed")
        && readText(path.resolve(__dirname, "..", "src", "tests", "submit-v2-promotion-cloudbuild.test.js")).includes("production_runtime_chain_audit_required"),
      reason: deployDecisionCheckerText.includes("DEPLOY_DECISION:V2_PRODUCTION_RUNTIME_CHAIN_AUDIT_REQUIRED")
        && submitWrapperText.includes("SUBMIT_CHK_04C")
        ? "deploy decision and submit wrapper now require the production runtime chain source audit as first-class approval evidence"
        : "production runtime chain audit must be a deploy decision blocker and submit approval evidence source, not only a package-level test",
      file: FILES.deployDecisionChecker,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_77",
      label: "LIVE evidence readiness checker summarizes all deploy axes",
      ok: packageJsonText.includes("check:v2-live-evidence-readiness")
        && packageJsonText.includes("check-v2-live-evidence-readiness.test.js")
        && liveEvidenceReadinessCheckerText.includes("V2_LIVE_EVIDENCE_READY")
        && liveEvidenceReadinessCheckerText.includes("v2_live_evidence_readiness_latest.json")
        && liveEvidenceReadinessCheckerText.includes("production_runtime_chain")
        && liveEvidenceReadinessCheckerText.includes("repair_firestore_canary_streak")
        && liveEvidenceReadinessCheckerText.includes("production_entry_route_canary_streak")
        && liveEvidenceReadinessCheckerText.includes("exit_runtime_canary_streak")
        && liveEvidenceReadinessCheckerText.includes("production_entry_protected_canary")
        && liveEvidenceReadinessCheckerText.includes("openclaw_supreme_closed_loop")
        && liveEvidenceReadinessCheckerText.includes("collectLiveEvidenceCycleConsistencyBlockers")
        && liveEvidenceReadinessCheckerText.includes("collectLiveStreakTemporalCoherenceBlockers")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-live-evidence-readiness.test.js")).includes("missingExitRuntimeStreakFailsWithRunbook28")
        && readText(path.resolve(__dirname, "..", "src", "tests", "check-v2-live-evidence-readiness.test.js")).includes("temporalMismatchFailsWithRunbook30")
        && runbookText.includes("v2_live_evidence_readiness_latest.json")
        && artifactContractText.includes("v2_live_evidence_readiness_latest.json")
        && artifactContractText.includes("failed_axis_ids")
        && artifactContractText.includes("temporal_coherence")
        && readText(path.resolve(__dirname, "..", "docs", "DONBEOLJA_V2_IMPLEMENTATION_STATUS_2026-04-21.md")).includes("LIVE Evidence Readiness Checker"),
      reason: liveEvidenceReadinessCheckerText.includes("V2_LIVE_EVIDENCE_READY")
        && liveEvidenceReadinessCheckerText.includes("collectLiveStreakTemporalCoherenceBlockers")
        ? "LIVE promotion now has a single diagnostic readiness artifact that maps missing evidence axes to submit checks and runbook refs"
        : "LIVE promotion must expose one checker for production runtime, 24h streaks, protected entry, OpenClaw, and temporal coherence evidence",
      file: FILES.liveEvidenceReadinessChecker,
    }),
  ];
  const failed = checks.filter((row) => row.ok !== true);
  return Object.freeze({
    ok: failed.length === 0,
    check_n: checks.length,
    fail_n: failed.length,
    failed_check_ids: Object.freeze(failed.map((row) => row.id)),
    checks: Object.freeze(checks),
  });
}

function assertSubmitContract() {
  const result = evaluateSubmitContract();
  if (result.ok === true) return result;
  const error = new Error(`V2_PROMOTION_SUBMIT_CONTRACT_BROKEN:${result.failed_check_ids.join(",")}`);
  error.details = result;
  throw error;
}

async function main() {
  const result = evaluateSubmitContract();
  if (result.ok !== true) {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_PROMOTION_SUBMIT_CONTRACT_BROKEN",
      failed_check_ids: result.failed_check_ids,
      checks: result.checks,
    }));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    reason: "V2_PROMOTION_SUBMIT_CONTRACT_OK",
    check_n: result.check_n,
  }));
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("CHECK_V2_PROMOTION_SUBMIT_CONTRACT_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    assertSubmitContract,
    __test: {
      SHARED_FORMATTER_MODULE_PATH,
      FILES,
      trimOrNull,
      readText,
      buildCheck,
      buildFormatterFixtureResult,
      buildLiveCutoverFormatterFixtureResult,
      buildLiveCutoverAlertPreviewFixtureResult,
      buildDeployWarningFormatterFixtureResult,
      buildDeployWarningAlertPreviewFixtureResult,
      evaluateSubmitContract,
    },
  };
}
