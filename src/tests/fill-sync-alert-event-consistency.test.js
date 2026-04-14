"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-fill-sync-alert-event-consistency");

function run() {
  assert.strictEqual(typeof __test.classifyStage, "function", "classifyStage export missing");
  assert.strictEqual(typeof __test.inferForcedEventFromRefs, "function", "inferForcedEventFromRefs export missing");
  assert.strictEqual(typeof __test.buildIssueRows, "function", "buildIssueRows export missing");
  assert.strictEqual(typeof __test.buildReport, "function", "buildReport export missing");

  assert.strictEqual(__test.classifyStage("EXIT_TP_P0_0.8P"), "TP0");
  assert.strictEqual(__test.classifyStage("FORCE_EXIT_ALL"), "FORCE_EXIT_ALL");
  assert.strictEqual(
    __test.inferForcedEventFromRefs("SIG__BINANCEFUT__DOGEUSDT__15m__1776114000000__FORCE_EXIT_ALL"),
    "FORCE_EXIT_ALL"
  );

  const forcedMismatch = __test.buildIssueRows({
    event: "EXIT_TP_P0_0.8P",
    signal_id: "SIG__BINANCEFUT__DOGEUSDT__15m__1776114000000__FORCE_EXIT_ALL",
    decision_reason: "ACTIVE_NATIVE_STOP_MISSING_FORCE_EXIT",
  }, null);
  assert.ok(forcedMismatch.some((row) => row.code === "FORCE_EXIT_REF_EVENT_MISMATCH"));

  const tpStageMismatch = __test.buildIssueRows({
    event: "EXIT_TP_P0_0.8P",
    intent_id: "INTENT__XRP",
  }, "EXIT_TP_P1_1.65P");
  assert.ok(tpStageMismatch.some((row) => row.code === "INTENT_EVENT_STAGE_MISMATCH"));

  const report = __test.buildReport([
    {
      fill_id: "fill-1",
      symbol: "DOGEUSDT",
      created_at: "2026-04-14T00:00:00.000Z",
      intent_id: "INTENT__DOGE",
      intent_event: "FORCE_EXIT_ALL",
      issues: forcedMismatch,
    },
  ]);
  assert.strictEqual(report.issue_fill_n, 1);
  assert.ok(report.top_issue_codes.some((row) => row.code === "FORCE_EXIT_REF_EVENT_MISMATCH"));

  console.log("FILL_SYNC_ALERT_EVENT_CONSISTENCY_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("FILL_SYNC_ALERT_EVENT_CONSISTENCY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
