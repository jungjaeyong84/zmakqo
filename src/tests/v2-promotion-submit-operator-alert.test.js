"use strict";

const assert = require("assert");
const alertPreview = require("../../scripts/lib/v2-promotion-submit-operator-alert");

(function blockedPreviewReusesOperatorSummaryLinesAndTrace() {
  const preview = alertPreview.buildOperatorAlertPreview({
    ok: false,
    output_file: "/tmp/fake-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__OPS__01",
      operator_summary: {
        status: "BLOCKED",
        lines: [
          "SUBMIT_BLOCKED | PROVENANCE | SUBMIT_CHK_08 | RUNBOOK:16,17",
          "status=BLOCKED",
          "primary_blocker_family=PROVENANCE",
        ],
        text: [
          "SUBMIT_BLOCKED | PROVENANCE | SUBMIT_CHK_08 | RUNBOOK:16,17",
          "status=BLOCKED",
          "primary_blocker_family=PROVENANCE",
        ].join("\n"),
      },
      submit_trace_summary: {
        failed_submit_check_ids: ["SUBMIT_CHK_08"],
        failed_runbook_checklist: ["16", "17"],
        blocker_families: ["PROVENANCE"],
        primary_blocker_family: "PROVENANCE",
        alert_retry_attention_required: false,
        alert_runbook_refs: [],
        alert_retry_summary: null,
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
        recommended_next_action_reason_code: "PROVENANCE_OR_CONTRACT_BLOCKER",
      },
    },
  });
  assert.strictEqual(preview.required, true);
  assert.strictEqual(preview.severity, "WARN");
  assert.strictEqual(preview.title, "V2 Promotion Submit Blocked");
  assert.strictEqual(preview.summary_text.includes("SUBMIT_BLOCKED"), true);
  assert.deepStrictEqual(preview.sections[0].lines, [
    "SUBMIT_BLOCKED | PROVENANCE | SUBMIT_CHK_08 | RUNBOOK:16,17",
    "status=BLOCKED",
    "primary_blocker_family=PROVENANCE",
  ]);
  assert.ok(preview.sections[1].lines.includes("failed_submit_checks=SUBMIT_CHK_08"));
  assert.ok(preview.sections[1].lines.includes("runbook_checklist=16,17"));
  assert.ok(preview.sections[1].lines.includes("alert_retry_attention=NO"));
  assert.ok(preview.sections[1].lines.includes("alert_runbook_refs=NONE"));
  assert.ok(preview.sections[1].lines.includes("alert_failed=0"));
  assert.ok(preview.sections[1].lines.includes("alert_pending=0"));
  assert.ok(preview.sections[1].lines.includes("artifact_dir_coherence=FAIL"));
  assert.ok(preview.sections[1].lines.includes("artifact_dir_coherence_reason=ARTIFACT_DIR_RESOLVED_DIR_MISMATCH"));
  assert.ok(preview.sections[1].lines.includes("artifact_dir_coherence_flags=dir_resolved:NO|dir_cycle:YES|resolved_cycle:YES|context_cycle:YES"));
  assert.ok(preview.sections[1].lines.includes("artifact_dir_coherence_file=/tmp/v2/PCY__OPS__01/promotion-cloudbuild-context.json"));
  assert.ok(preview.sections[1].lines.includes("reason_code=PROVENANCE_OR_CONTRACT_BLOCKER"));
})();

(function readyPreviewBuildsTelegramArgs() {
  const args = alertPreview.buildTelegramSummaryArgs({
    severity: "INFO",
    title: "V2 Promotion Submit Ready",
    dedupe_key: "v2-promotion-submit:READY:/tmp/v2/PCY__READY__01",
    sections: [
      { header: "정본 요약", lines: ["SUBMIT_READY | NO_BLOCKER_FAMILY | NO_FAILED_SUBMIT_CHECKS | RUNBOOK:NONE"] },
    ],
  });
  assert.strictEqual(args.severity, "INFO");
  assert.strictEqual(args.title, "V2 Promotion Submit Ready");
  assert.strictEqual(args.dedupeKey, "v2-promotion-submit:READY:/tmp/v2/PCY__READY__01");
  assert.deepStrictEqual(args.sections[0].lines, ["SUBMIT_READY | NO_BLOCKER_FAMILY | NO_FAILED_SUBMIT_CHECKS | RUNBOOK:NONE"]);
})();

(function readyWithAlertAttentionPreviewUsesWarnTitleWithoutPretendingBlocked() {
  const preview = alertPreview.buildOperatorAlertPreview({
    ok: true,
    output_file: "/tmp/fake-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__READY__ALERT",
      operator_summary: {
        status: "READY_WITH_ALERT_ATTENTION",
        lines: [
          "SUBMIT_READY_WITH_ALERT_ATTENTION | ALERT_ATTENTION | NO_FAILED_SUBMIT_CHECKS | RUNBOOK:ALERT_RBK_04",
          "status=READY_WITH_ALERT_ATTENTION",
          "primary_blocker_family=NONE",
          "alert_retry_attention=YES",
          "alert_runbook_refs=ALERT_RBK_04",
          "alert_failed=1",
          "alert_pending=1",
        ],
        text: [
          "SUBMIT_READY_WITH_ALERT_ATTENTION | ALERT_ATTENTION | NO_FAILED_SUBMIT_CHECKS | RUNBOOK:ALERT_RBK_04",
          "status=READY_WITH_ALERT_ATTENTION",
          "primary_blocker_family=NONE",
          "alert_retry_attention=YES",
          "alert_runbook_refs=ALERT_RBK_04",
          "alert_failed=1",
          "alert_pending=1",
        ].join("\n"),
      },
      submit_trace_summary: {
        failed_submit_check_ids: [],
        failed_runbook_checklist: [],
        blocker_families: [],
        primary_blocker_family: null,
        alert_retry_attention_required: true,
        alert_runbook_refs: ["ALERT_RBK_04"],
        alert_retry_summary: {
          failed_n: 1,
          pending_n: 1,
        },
        recommended_next_action: "PROCEED_WITH_SUBMIT_WRAPPER",
        recommended_next_action_reason_code: "ALL_CHECKS_PASSED",
      },
    },
  });
  assert.strictEqual(preview.severity, "WARN");
  assert.strictEqual(preview.title, "V2 Promotion Submit Ready With Alert Attention");
  assert.ok(preview.sections[1].lines.includes("alert_retry_attention=YES"));
  assert.ok(preview.sections[1].lines.includes("alert_runbook_refs=ALERT_RBK_04"));
  assert.ok(preview.sections[1].lines.includes("alert_failed=1"));
  assert.ok(preview.sections[1].lines.includes("alert_pending=1"));
})();

(function previewExposesRunbookReviewSummary() {
  const preview = alertPreview.buildOperatorAlertPreview({
    ok: false,
    output_file: "/tmp/fake-submit-request.json",
    request: {
      artifact_dir: "/tmp/v2/PCY__RUNBOOK__FAIL",
      operator_summary: {
        status: "BLOCKED",
        lines: [
          "SUBMIT_BLOCKED | RUNBOOK | SUBMIT_CHK_05 | RUNBOOK:NONE",
          "status=BLOCKED",
          "runbook_review=NO",
          "runbook_review_failures=1",
          "runbook_review_failed_checks=CHK_RUNBOOK_REVIEW_THROWN",
          "runbook_review_file=NONE",
        ],
        text: [
          "SUBMIT_BLOCKED | RUNBOOK | SUBMIT_CHK_05 | RUNBOOK:NONE",
          "status=BLOCKED",
          "runbook_review=NO",
          "runbook_review_failures=1",
          "runbook_review_failed_checks=CHK_RUNBOOK_REVIEW_THROWN",
          "runbook_review_file=NONE",
        ].join("\n"),
      },
      submit_trace_summary: {
        failed_submit_check_ids: ["SUBMIT_CHK_05"],
        failed_runbook_checklist: [],
        blocker_families: ["RUNBOOK"],
        primary_blocker_family: "RUNBOOK",
        runbook_review_summary: {
          ok: false,
          fail_n: 1,
          failed_check_ids: ["CHK_RUNBOOK_REVIEW_THROWN"],
          file: null,
        },
        recommended_next_action: "RERUN_CANARY_RUNBOOK_AND_RECHECK_ARTIFACT_COHERENCE",
        recommended_next_action_reason_code: "RUNBOOK_BLOCKER",
      },
    },
  });
  assert.ok(preview.sections[0].lines.includes("runbook_review=NO"));
  assert.ok(preview.sections[1].lines.includes("runbook_review=NO"));
  assert.ok(preview.sections[1].lines.includes("runbook_review_failures=1"));
  assert.ok(preview.sections[1].lines.includes("runbook_review_failed_checks=CHK_RUNBOOK_REVIEW_THROWN"));
})();

console.log("V2_PROMOTION_SUBMIT_OPERATOR_ALERT_TEST_OK");
