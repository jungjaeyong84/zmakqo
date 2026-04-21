#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const operatorSummary = require("./lib/v2-promotion-operator-summary");
const operatorAlertPreview = require("./lib/v2-promotion-submit-operator-alert");

const SHARED_FORMATTER_MODULE_PATH = "/Users/jeongjaeyong/Projects/donbeolja/scripts/lib/v2-promotion-operator-summary.js";
const SHARED_ALERT_PREVIEW_MODULE_PATH = "/Users/jeongjaeyong/Projects/donbeolja/scripts/lib/v2-promotion-submit-operator-alert.js";

const FILES = Object.freeze({
  artifactContract: path.resolve(__dirname, "..", "docs", "DONBEOLJA_V2_PROMOTION_ARTIFACT_CONTRACT_2026-04-20.md"),
  runbook: path.resolve(__dirname, "..", "docs", "DONBEOLJA_V2_CANARY_RUNBOOK_2026-04-20.md"),
  runbookChecker: path.resolve(__dirname, "check-v2-canary-runbook.js"),
  cloudbuildWrapper: path.resolve(__dirname, "run-v2-promotion-cloudbuild.js"),
  submitWrapper: path.resolve(__dirname, "submit-v2-promotion-cloudbuild.js"),
  submitTrace: path.resolve(__dirname, "lib", "v2-promotion-submit-trace.js"),
  renderScript: path.resolve(__dirname, "render-v2-promotion-submit-operator-alert.js"),
  sendScript: path.resolve(__dirname, "send-v2-promotion-submit-operator-alert.js"),
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

function evaluateSubmitContract() {
  const artifactContractText = readText(FILES.artifactContract);
  const runbookText = readText(FILES.runbook);
  const runbookCheckerText = readText(FILES.runbookChecker);
  const cloudbuildWrapperText = readText(FILES.cloudbuildWrapper);
  const submitWrapperText = readText(FILES.submitWrapper);
  const submitTraceText = readText(FILES.submitTrace);
  const summary = buildFormatterFixtureResult();
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
  const checks = [
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_01",
      label: "artifact contract references shared operator summary formatter",
      ok: artifactContractText.includes(SHARED_FORMATTER_MODULE_PATH),
      reason: artifactContractText.includes(SHARED_FORMATTER_MODULE_PATH)
        ? "artifact contract points to shared formatter module"
        : "artifact contract must point to shared formatter module",
      file: FILES.artifactContract,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_02",
      label: "runbook references shared operator summary formatter",
      ok: runbookText.includes(SHARED_FORMATTER_MODULE_PATH),
      reason: runbookText.includes(SHARED_FORMATTER_MODULE_PATH)
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
        "failed_submit_checks=SUBMIT_CHK_08",
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
        "failed_submit_checks=SUBMIT_CHK_08",
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
      ok: artifactContractText.includes(SHARED_ALERT_PREVIEW_MODULE_PATH),
      reason: artifactContractText.includes(SHARED_ALERT_PREVIEW_MODULE_PATH)
        ? "artifact contract points to shared operator alert preview module"
        : "artifact contract must point to shared operator alert preview module",
      file: FILES.artifactContract,
    }),
    buildCheck({
      id: "SUBMIT_CONTRACT_CHK_10",
      label: "runbook references shared operator alert preview module",
      ok: runbookText.includes(SHARED_ALERT_PREVIEW_MODULE_PATH),
      reason: runbookText.includes(SHARED_ALERT_PREVIEW_MODULE_PATH)
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
      ok: readText(FILES.sendScript).includes('const renderer = require("./render-v2-promotion-submit-operator-alert");'),
      reason: readText(FILES.sendScript).includes('const renderer = require("./render-v2-promotion-submit-operator-alert");')
        ? "send script consumes rendered preview"
        : "send script must consume rendered preview",
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
      ok: runbookText.includes("| `SUBMIT_CHK_17` | `24` | LIVE scheduler traffic collector preflight can read GCP state |"),
      reason: runbookText.includes("| `SUBMIT_CHK_17` | `24` | LIVE scheduler traffic collector preflight can read GCP state |")
        ? "runbook reverse index maps SUBMIT_CHK_17 to checklist 24"
        : "runbook must map SUBMIT_CHK_17 to checklist 24",
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
