"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-automation-watchdog");

(() => {
  const rows = __test.parseLaunchctlList([
    "123\t0\tcom.jeongjaeyong.donbeolja.objectivesupervisor",
    "-\t0\tcom.jeongjaeyong.donbeolja.weeklypine",
    "-\t78\tcom.jeongjaeyong.donbeolja.stageautopilot",
  ].join("\n"));
  assert.strictEqual(rows.get("com.jeongjaeyong.donbeolja.objectivesupervisor").pid, 123);
  assert.strictEqual(rows.get("com.jeongjaeyong.donbeolja.weeklypine").lastExit, 0);
  assert.strictEqual(rows.get("com.jeongjaeyong.donbeolja.stageautopilot").lastExit, 78);

  const passVerdict = __test.computeVerdict(
    [{ issueSeverity: null }, { issueSeverity: null }],
    [{ issueSeverity: null }]
  );
  assert.strictEqual(passVerdict, "PASS");

  const warnVerdict = __test.computeVerdict(
    [{ issueSeverity: "WARN" }],
    [{ issueSeverity: null }]
  );
  assert.strictEqual(warnVerdict, "WARN");

  const failVerdict = __test.computeVerdict(
    [{ issueSeverity: "WARN" }],
    [{ issueSeverity: "FAIL" }]
  );
  assert.strictEqual(failVerdict, "FAIL");

  const signature = __test.buildIssueSignature(
    [
      { issueSeverity: "WARN", issueCode: "A_STALE" },
      { issueSeverity: null, issueCode: null },
    ],
    [
      { issueSeverity: "FAIL", issueCode: "AGENT_EXIT_1" },
    ]
  );
  assert.strictEqual(signature, "FAIL:AGENT_EXIT_1|WARN:A_STALE");

  assert.strictEqual(__test.normalizeRecoveryMode("recover_and_report"), "RECOVER_AND_REPORT");
  assert.strictEqual(__test.normalizeRecoveryMode("bogus"), "REPORT_ONLY");

  assert.strictEqual(__test.isRecoveryExecutionAllowed("RECOVER_AND_REPORT", "1"), true);
  assert.strictEqual(__test.isRecoveryExecutionAllowed("REPORT_ONLY", "1"), false);
  assert.strictEqual(__test.isRecoveryExecutionAllowed("RECOVER_AND_REPORT", "0"), false);

  const snapshot = __test.buildSnapshot(
    [{ issueSeverity: "WARN", issueCode: "ROW_WARN" }],
    [{ issueSeverity: "FAIL", issueCode: "ROW_FAIL" }]
  );
  assert.strictEqual(snapshot.verdict, "FAIL");
  assert.strictEqual(snapshot.issueCount, 2);
  assert.strictEqual(snapshot.issueSignature, "FAIL:ROW_FAIL|WARN:ROW_WARN");

  console.log("AUTOMATION_WATCHDOG_TEST_OK");
})();
