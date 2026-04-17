"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-daily-audit");

(() => {
  const line = __test.buildBestFebtDailyAuditLine({
    mode: "RECOVERY_FIRST",
    tightening_allowed: false,
    recovery_priority: true,
    projected_replacement_ratio: 0.73,
    projected_count_ratio_global: 0.98,
    projected_net_signal_delta_n: -1,
  });
  assert.ok(line.includes("RECOVERY_FIRST"));
  assert.ok(line.includes("tightening BLOCK"));
  assert.ok(line.includes("recovery FIRST"));
  assert.ok(line.includes("0.73"));
  assert.ok(line.includes("0.98x"));

  const prereports = __test.buildSystemOpsPrereportCommands();
  assert.ok(Array.isArray(prereports));
  assert.ok(prereports.some((step) => step.command === "node scripts/report-tp1-fail-closed-events.js"));
  assert.strictEqual(prereports[prereports.length - 1].errorCode, "TP1_FAIL_CLOSED_REPORT_FAILED");

  assert.deepStrictEqual(
    __test.buildTp1FailClosedQuarantineLines({
      tp1_fail_closed: {
        quarantine_candidate_n: 2,
        repeat_symbol_n: 2,
        quarantine_candidates: [
          { symbol: "ETHUSDT", count: 4, severity: "HIGH" },
          { symbol: "XRPUSDT", count: 2, severity: "MEDIUM" },
        ],
      },
    }),
    [
      "TP1 quarantine 후보 2개 / repeat 2개",
      "상위 ETHUSDT(4,HIGH), XRPUSDT(2,MEDIUM)",
    ]
  );

  console.log("DAILY_AUDIT_TEST_OK");
})();
