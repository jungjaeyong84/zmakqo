"use strict";

const assert = require("assert");
const contractCheck = require("../../scripts/check-v2-promotion-submit-contract");

(function submitContractPassesInCurrentWorkspace() {
  const result = contractCheck.__test.evaluateSubmitContract();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.fail_n, 0);
  assert.ok(result.check_n >= 6);
})();

(function formatterFixtureProducesCanonicalBlockedHeadline() {
  const summary = contractCheck.__test.buildFormatterFixtureResult();
  assert.strictEqual(summary.status, "BLOCKED");
  assert.strictEqual(summary.headline, "SUBMIT_BLOCKED | PROVENANCE | SUBMIT_CHK_08 | RUNBOOK:16,17");
  assert.strictEqual(summary.text, summary.lines.join("\n"));
})();

(function liveCutoverFormatterFixturePreservesCutoverLines() {
  const summary = contractCheck.__test.buildLiveCutoverFormatterFixtureResult();
  assert.strictEqual(summary.status, "READY");
  assert.ok(summary.lines.includes("live_cutover_ready=YES"));
  assert.ok(summary.lines.includes("live_cutover_auto_apply=NO"));
  assert.ok(summary.lines.includes("live_cutover_mutates_env=NO"));
  assert.ok(summary.lines.includes("live_cutover_env_changes=4"));
  assert.ok(summary.lines.includes("live_cutover_file=/tmp/v2/PCY__LIVE__01/v2_repair_live_cutover_readiness_latest.json"));
  assert.ok(summary.lines.includes("scheduler_collector_preflight=YES"));
  assert.ok(summary.lines.includes("scheduler_collector_project=donbeolja-dev"));
  assert.ok(summary.lines.includes("scheduler_collector_file=/tmp/v2/PCY__LIVE__01/v2_scheduler_traffic_collector_preflight_latest.json"));
  assert.ok(summary.lines.includes("runbook_review=YES"));
  assert.ok(summary.lines.includes("runbook_review_file=/tmp/v2/PCY__LIVE__01/promotion-runbook-review.json"));
})();

(function liveCutoverAlertPreviewFixturePreservesCutoverTraceLines() {
  const preview = contractCheck.__test.buildLiveCutoverAlertPreviewFixtureResult();
  const traceLines = preview.sections[1].lines;
  assert.strictEqual(preview.title, "V2 Promotion Submit Ready");
  assert.ok(traceLines.includes("live_cutover_ready=YES"));
  assert.ok(traceLines.includes("live_cutover_auto_apply=NO"));
  assert.ok(traceLines.includes("live_cutover_mutates_env=NO"));
  assert.ok(traceLines.includes("live_cutover_env_changes=4"));
  assert.ok(traceLines.includes("live_cutover_file=/tmp/v2/PCY__LIVE__01/v2_repair_live_cutover_readiness_latest.json"));
  assert.ok(traceLines.includes("scheduler_collector_preflight=YES"));
  assert.ok(traceLines.includes("scheduler_collector_project=donbeolja-dev"));
  assert.ok(traceLines.includes("scheduler_collector_file=/tmp/v2/PCY__LIVE__01/v2_scheduler_traffic_collector_preflight_latest.json"));
  assert.ok(traceLines.includes("runbook_review=YES"));
  assert.ok(traceLines.includes("runbook_review_file=/tmp/v2/PCY__LIVE__01/promotion-runbook-review.json"));
})();

console.log("CHECK_V2_PROMOTION_SUBMIT_CONTRACT_TEST_OK");
