"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const renderer = require("../../scripts/render-v2-promotion-submit-operator-alert");

(function renderAlertFromArtifactDirUsesEmbeddedPreview() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-alert-"));
  try {
    const filePath = path.join(dir, renderer.__test.DEFAULT_FILENAME);
    const payload = {
      artifact_dir: dir,
      approval_verification: { ok: false },
      operator_summary: {
        status: "BLOCKED",
        lines: ["SUBMIT_BLOCKED | PROVENANCE"],
        text: "SUBMIT_BLOCKED | PROVENANCE",
      },
      submit_trace_summary: {
        failed_submit_check_ids: ["SUBMIT_CHK_08"],
        failed_runbook_checklist: ["16", "17"],
        blocker_families: ["PROVENANCE"],
        primary_blocker_family: "PROVENANCE",
      },
    };
    payload.operator_alert_preview = renderer.__test.buildExpectedPreview(payload, filePath);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
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
    const filePath = path.join(dir, renderer.__test.DEFAULT_FILENAME);
    const payload = {
      artifact_dir: dir,
      approval_verification: { ok: true },
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
    };
    payload.operator_alert_preview = renderer.__test.buildExpectedPreview(payload, filePath);
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
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

(function renderAlertRejectsStaleEmbeddedPreviewFingerprint() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-alert-stale-"));
  try {
    const filePath = path.join(dir, renderer.__test.DEFAULT_FILENAME);
    const payload = {
      artifact_dir: dir,
      approval_verification: { ok: false },
      operator_summary: {
        status: "BLOCKED",
        lines: ["SUBMIT_BLOCKED | PROVENANCE"],
        text: "SUBMIT_BLOCKED | PROVENANCE",
      },
      submit_trace_summary: {
        failed_submit_check_ids: ["SUBMIT_CHK_08"],
        failed_runbook_checklist: ["16", "17"],
        blocker_families: ["PROVENANCE"],
        primary_blocker_family: "PROVENANCE",
      },
    };
    payload.operator_alert_preview = {
      ...renderer.__test.buildExpectedPreview(payload, filePath),
      source_fingerprint: "stale",
    };
    fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
    assert.throws(
      () => renderer.renderAlert({ V2_PROMOTION_ARTIFACT_DIR: dir }),
      /V2_PROMOTION_OPERATOR_ALERT_PREVIEW_STALE/
    );
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

console.log("RENDER_V2_PROMOTION_SUBMIT_OPERATOR_ALERT_TEST_OK");
