"use strict";

const assert = require("assert");

const { __test } = require("../v2/runbookDiagnosticRunner");

(() => {
  const plan = __test.buildRunbookDiagnosticPlan({
    blockers: [
      "HTF_REGIME:ALIGNMENT_REQUIRED",
      "SETUP:PULLBACK_RECLAIM:BTC_OR_MTF_OPPOSED",
      "HTF_REGIME:ALIGNMENT_REQUIRED",
    ],
  });
  assert.strictEqual(plan.blocker_n, 3);
  assert.deepStrictEqual(plan.families, ["HTF_REGIME", "SETUP"]);
  assert.ok(plan.runbook_refs.includes("RUNBOOK_HTF_ALIGNMENT"));
  assert.ok(plan.runbook_refs.includes("RUNBOOK_SETUP_FILTERS"));
})();

console.log("runbook-diagnostic-runner.test.js PASS");
