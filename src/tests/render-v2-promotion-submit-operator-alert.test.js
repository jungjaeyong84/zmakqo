"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const renderer = require("../../scripts/render-v2-promotion-submit-operator-alert");

(function renderAlertFromArtifactDirUsesEmbeddedPreview() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-alert-"));
  try {
    fs.writeFileSync(path.join(dir, renderer.__test.DEFAULT_FILENAME), JSON.stringify({
      operator_alert_preview: {
        required: true,
        severity: "WARN",
        title: "V2 Promotion Submit Blocked",
        summary_text: "SUBMIT_BLOCKED | PROVENANCE",
        sections: [
          { header: "정본 요약", lines: ["SUBMIT_BLOCKED | PROVENANCE"] },
        ],
      },
    }, null, 2), "utf8");
    const result = renderer.renderAlert({
      V2_PROMOTION_ARTIFACT_DIR: dir,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.preview.title, "V2 Promotion Submit Blocked");
    assert.strictEqual(result.telegram_args.title, "V2 Promotion Submit Blocked");
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function renderAlertPreservesReadyWithDeployWarningPreview() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-alert-warning-"));
  try {
    fs.writeFileSync(path.join(dir, renderer.__test.DEFAULT_FILENAME), JSON.stringify({
      operator_summary: {
        status: "READY_WITH_DEPLOY_WARNING",
        lines: [
          "SUBMIT_READY_WITH_DEPLOY_WARNING | DEPLOY_WARNING | NO_FAILED_SUBMIT_CHECKS | RUNBOOK:19",
          "status=READY_WITH_DEPLOY_WARNING",
          "deploy_warning_attention=YES",
          "deploy_warning_runbook=19",
        ],
        text: [
          "SUBMIT_READY_WITH_DEPLOY_WARNING | DEPLOY_WARNING | NO_FAILED_SUBMIT_CHECKS | RUNBOOK:19",
          "status=READY_WITH_DEPLOY_WARNING",
          "deploy_warning_attention=YES",
          "deploy_warning_runbook=19",
        ].join("\n"),
      },
      submit_trace_summary: {
        deploy_warning_attention_required: true,
        deploy_warning_runbook_checklist: ["19"],
        deploy_warning_summary: {
          warning_n: 1,
          top_warnings: ["DEPLOY_DECISION:REPAIR_FIRESTORE_CANARY_STREAK_NOT_READY"],
        },
      },
      operator_alert_preview: {
        required: true,
        severity: "WARN",
        title: "V2 Promotion Submit Ready With Deploy Warning",
        summary_text: "SUBMIT_READY_WITH_DEPLOY_WARNING | DEPLOY_WARNING | NO_FAILED_SUBMIT_CHECKS | RUNBOOK:19",
        sections: [
          { header: "정본 요약", lines: ["SUBMIT_READY_WITH_DEPLOY_WARNING | DEPLOY_WARNING | NO_FAILED_SUBMIT_CHECKS | RUNBOOK:19"] },
          { header: "추적 정보", lines: ["deploy_warning_attention=YES", "deploy_warning_runbook=19"] },
        ],
      },
    }, null, 2), "utf8");
    const result = renderer.renderAlert({
      V2_PROMOTION_ARTIFACT_DIR: dir,
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.preview.severity, "WARN");
    assert.strictEqual(result.preview.title, "V2 Promotion Submit Ready With Deploy Warning");
    assert.ok(result.preview.sections[1].lines.includes("deploy_warning_attention=YES"));
    assert.ok(result.preview.sections[1].lines.includes("deploy_warning_runbook=19"));
    assert.strictEqual(result.telegram_args.title, "V2 Promotion Submit Ready With Deploy Warning");
    assert.strictEqual(result.telegram_args.severity, "WARN");
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

console.log("RENDER_V2_PROMOTION_SUBMIT_OPERATOR_ALERT_TEST_OK");
