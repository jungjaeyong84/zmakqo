"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const sender = require("../../scripts/send-v2-promotion-submit-operator-alert");
const operatorSummary = require("../../scripts/lib/v2-promotion-operator-summary");

async function dryRunDoesNotCallTransport() {
  let called = false;
  const result = await sender.sendOperatorAlert({}, {
    renderAlert() {
      return {
        preview: { title: "V2 Promotion Submit Blocked" },
        telegram_args: {
          title: "V2 Promotion Submit Blocked",
          severity: "WARN",
          sections: [{ header: "정본 요약", lines: ["SUBMIT_BLOCKED"] }],
          provider: "BINANCEFUT",
          dedupeKey: "v2-promotion-submit:BLOCKED:test",
        },
      };
    },
    async sendSummary() {
      called = true;
      return { ok: true };
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.send_enabled, false);
  assert.strictEqual(called, false);
}

async function sendModeUsesRenderedTelegramArgs() {
  let captured = null;
  const result = await sender.sendOperatorAlert({
    V2_PROMOTION_OPERATOR_ALERT_SEND_ENABLED: "1",
  }, {
    renderAlert() {
      return {
        preview: { title: "V2 Promotion Submit Ready" },
        telegram_args: {
          title: "V2 Promotion Submit Ready",
          severity: "INFO",
          sections: [{ header: "정본 요약", lines: ["SUBMIT_READY"] }],
          provider: "BINANCEFUT",
          dedupeKey: "v2-promotion-submit:READY:test",
        },
      };
    },
    async sendSummary(args) {
      captured = args;
      return { ok: true, transport: "fake" };
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.send_enabled, true);
  assert.strictEqual(captured.title, "V2 Promotion Submit Ready");
  assert.strictEqual(captured.severity, "INFO");
  assert.strictEqual(captured.dedupeKey, "v2-promotion-submit:READY:test");
}

async function sendModePreservesExpandedRunbookTraceThroughTransport() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-submit-send-alert-"));
  let captured = null;
  try {
    const filePath = path.join(dir, "promotion-cloudbuild-submit-request.json");
    const submitTrace = {
      ok: false,
      failed_submit_check_ids: ["SUBMIT_CHK_05"],
      failed_submit_check_details: [{
        id: "SUBMIT_CHK_05",
        summary: "runbook review aggregate passed",
        runbook_checklist: ["13E", "24B"],
        reason: "runbook review must be PASS",
        file: path.join(dir, "promotion-runbook-review.json"),
        field: "overall_status",
      }],
      failed_runbook_checklist: ["13E", "24B"],
      blocker_families: ["RUNBOOK"],
      primary_blocker_family: "RUNBOOK",
      runbook_review_summary: {
        ok: false,
        fail_n: 2,
        failed_check_ids: ["CHK_13E", "CHK_24B"],
        file: path.join(dir, "promotion-runbook-review.json"),
      },
      recommended_next_action: "RERUN_CANARY_RUNBOOK_AND_RECHECK_ARTIFACT_COHERENCE",
      recommended_next_action_reason_code: "RUNBOOK_BLOCKER",
    };
    const request = {
      artifact_dir: dir,
      approval_verification: { ok: false },
      submit_trace_summary: submitTrace,
    };
    request.operator_summary = operatorSummary.buildOperatorSummary({
      ok: false,
      output_file: filePath,
      request,
    });
    fs.writeFileSync(filePath, JSON.stringify(request, null, 2), "utf8");
    const result = await sender.sendOperatorAlert({
      V2_PROMOTION_OPERATOR_ALERT_SEND_ENABLED: "1",
      V2_PROMOTION_ARTIFACT_DIR: dir,
    }, {
      async sendSummary(args) {
        captured = args;
        return { ok: true, transport: "fake" };
      },
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.send_enabled, true);
    assert.strictEqual(captured.title, "V2 Promotion Submit Blocked");
    assert.strictEqual(captured.severity, "WARN");
    assert.ok(captured.sections[0].lines.includes("SUBMIT_BLOCKED | RUNBOOK | SUBMIT_CHK_05 | RUNBOOK:13E,24B"));
    assert.ok(captured.sections[1].lines.includes("runbook_checklist=13E,24B"));
    assert.ok(captured.sections[1].lines.includes("runbook_review_failed_checks=CHK_13E,CHK_24B"));
    assert.ok(captured.sections[1].lines.some((line) => (
      line.startsWith("failed_submit_check_details=SUBMIT_CHK_05[")
      && line.includes("RUNBOOK:13E,24B")
      && line.includes("field:overall_status")
    )));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

async function main() {
  await dryRunDoesNotCallTransport();
  await sendModeUsesRenderedTelegramArgs();
  await sendModePreservesExpandedRunbookTraceThroughTransport();
  console.log("SEND_V2_PROMOTION_SUBMIT_OPERATOR_ALERT_TEST_OK");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
