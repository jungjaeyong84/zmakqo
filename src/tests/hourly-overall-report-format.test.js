"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-hourly-overall-report");

function run() {
  assert.strictEqual(typeof __test.resolveComparisonLabel, "function", "resolveComparisonLabel export missing");
  assert.strictEqual(typeof __test.formatSignedPercent, "function", "formatSignedPercent export missing");
  assert.strictEqual(typeof __test.positionStatusLabel, "function", "positionStatusLabel export missing");
  assert.strictEqual(typeof __test.buildSystemOpsPrereportCommands, "function", "buildSystemOpsPrereportCommands export missing");
  assert.strictEqual(typeof __test.shouldRunPrereportCommands, "function", "shouldRunPrereportCommands export missing");
  assert.strictEqual(typeof __test.shouldRunSystemOpsCheck, "function", "shouldRunSystemOpsCheck export missing");
  assert.strictEqual(typeof __test.runSystemOpsPrereports, "function", "runSystemOpsPrereports export missing");
  assert.strictEqual(typeof __test.runSystemOpsCheckIfEnabled, "function", "runSystemOpsCheckIfEnabled export missing");
  assert.strictEqual(typeof __test.buildTp1FailClosedQuarantineLines, "function", "buildTp1FailClosedQuarantineLines export missing");

  assert.strictEqual(
    __test.resolveComparisonLabel({
      kind: "previous_hour",
      currentDateKey: "2026-03-19",
      currentHhmm: "1200",
      baselineRef: { dateKey: "2026-03-19", hhmm: "1050" },
    }),
    "전시간 대비"
  );

  assert.strictEqual(
    __test.resolveComparisonLabel({
      kind: "previous_hour",
      currentDateKey: "2026-03-19",
      currentHhmm: "1200",
      baselineRef: { dateKey: "2026-03-19", hhmm: "0840" },
    }),
    "직전 보고 대비"
  );

  assert.strictEqual(
    __test.resolveComparisonLabel({
      kind: "previous_day_latest",
      currentDateKey: "2026-03-19",
      currentHhmm: "1200",
      baselineRef: { dateKey: "2026-03-17", hhmm: "2300" },
    }),
    "직전 보고일 마지막 보고 대비"
  );

  assert.strictEqual(__test.formatSignedPercent(-1.2345, 4), "-1.2345%");
  const prereports = __test.buildSystemOpsPrereportCommands();
  assert.ok(prereports.some((step) => step.command === "node scripts/report-tp1-fail-closed-events.js"));
  assert.strictEqual(prereports[prereports.length - 1].errorCode, "TP1_FAIL_CLOSED_REPORT_FAILED");
  assert.strictEqual(__test.shouldRunPrereportCommands({}), false);
  assert.strictEqual(__test.shouldRunPrereportCommands({ DONBEOLJA_HOURLY_ACCOUNT_REPORT_RUN_PREREPORTS: "1" }), true);
  assert.strictEqual(__test.shouldRunSystemOpsCheck({}), false);
  assert.strictEqual(__test.shouldRunSystemOpsCheck({ DONBEOLJA_HOURLY_ACCOUNT_REPORT_RUN_SYSTEM_OPS_CHECK: "true" }), true);
  assert.deepStrictEqual(
    __test.runSystemOpsPrereports({ env: {} }),
    {
      ok: true,
      skipped: true,
      reason: "HOURLY_ACCOUNT_REPORT_PREREPORTS_SKIPPED",
      command_n: prereports.length,
    }
  );
  assert.deepStrictEqual(
    __test.runSystemOpsCheckIfEnabled({ env: {}, snapshotPath: "/tmp/snapshot.json", reportPath: "/tmp/report.md" }),
    {
      ok: true,
      skipped: true,
      reason: "HOURLY_ACCOUNT_REPORT_SYSTEM_OPS_CHECK_SKIPPED",
    }
  );
  assert.deepStrictEqual(
    __test.buildTp1FailClosedQuarantineLines({
      tp1_fail_closed: {
        quarantine_candidate_n: 1,
        quarantine_candidates: [
          { symbol: "ETHUSDT", count: 2, severity: "MEDIUM" },
        ],
      },
    }),
    [
      "TP1 quarantine 후보 1개",
      "상위 ETHUSDT(2,MEDIUM)",
    ]
  );
  assert.strictEqual(
    __test.positionStatusLabel({
      tp_p1_done: false,
      trail_active: false,
      exit_stage_label: "트레일링",
    }),
    "트레일링"
  );
}

try {
  run();
  console.log("HOURLY_OVERALL_REPORT_FORMAT_TEST_OK");
} catch (err) {
  console.error("HOURLY_OVERALL_REPORT_FORMAT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
