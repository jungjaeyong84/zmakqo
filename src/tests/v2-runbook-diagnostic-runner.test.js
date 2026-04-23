"use strict";

const assert = require("assert");
const { classifyBlocker, buildRunbookDiagnosticPlan } = require("../v2/runbookDiagnosticRunner");

{
  const row = classifyBlocker("EXIT_RUNTIME_CANARY_STREAK:COVERAGE_INSUFFICIENT");
  assert.strictEqual(row.family, "EXIT_24H_CANARY");
  assert.ok(row.commands.some((cmd) => cmd.includes("run-binance-active-exit-watchdog")));
}

{
  const plan = buildRunbookDiagnosticPlan({
    blockers: [
      "FIRESTORE_COST_GUARD:BILLING_METRIC_REQUIRED",
      "PERFORMANCE_GATE:SAMPLE_INSUFFICIENT",
      "FIRESTORE_COST_GUARD:BILLING_METRIC_REQUIRED",
    ],
  });
  assert.strictEqual(plan.ok, true);
  assert.strictEqual(plan.blocker_n, 2);
  assert.ok(plan.families.includes("FIRESTORE_COST"));
  assert.ok(plan.families.includes("PERFORMANCE_GATE"));
  assert.ok(plan.commands.includes("npm run collect:v2-firestore-billing-metric"));
}

console.log("V2_RUNBOOK_DIAGNOSTIC_RUNNER_TEST_OK");
