"use strict";

const assert = require("assert");
const budget = require("../../scripts/lib/cloudbuild-submit-budget");

function dailyLimitBlocks() {
  const result = budget.evaluateCloudBuildSubmitBudget({
    env: {
      DONBEOLJA_V2_CLOUDBUILD_DAILY_SUBMIT_LIMIT: "2",
      DONBEOLJA_V2_CLOUDBUILD_RECENT_BUILDS_JSON: JSON.stringify([{ id: "a" }, { id: "b" }]),
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_CLOUDBUILD_SUBMIT_BUDGET_BLOCKED");
  assert.strictEqual(result.build_n, 2);
  assert.deepStrictEqual(result.blockers, ["CLOUDBUILD_SUBMIT_BUDGET:DAILY_LIMIT_EXCEEDED"]);
}

function explicitOverridePasses() {
  const result = budget.evaluateCloudBuildSubmitBudget({
    env: {
      DONBEOLJA_V2_CLOUDBUILD_DAILY_SUBMIT_LIMIT: "1",
      DONBEOLJA_V2_CLOUDBUILD_RECENT_BUILDS_JSON: JSON.stringify([{ id: "a" }, { id: "b" }]),
      DONBEOLJA_V2_CLOUDBUILD_SUBMIT_BUDGET_OVERRIDE_CONFIRM: budget.CLOUDBUILD_BUDGET_OVERRIDE_PHRASE,
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.override_confirmed, true);
}

function readFailureFailsClosed() {
  const result = budget.evaluateCloudBuildSubmitBudget({
    env: {},
    execFileSyncFn: () => { throw new Error("gcloud unavailable"); },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_CLOUDBUILD_SUBMIT_BUDGET_READ_FAILED");
  assert.ok(result.blockers.includes("CLOUDBUILD_SUBMIT_BUDGET:READ_FAILED"));
}

function assertThrowsWithDetails() {
  assert.throws(() => budget.assertCloudBuildSubmitBudget({
    env: {
      DONBEOLJA_V2_CLOUDBUILD_DAILY_SUBMIT_LIMIT: "1",
      DONBEOLJA_V2_CLOUDBUILD_RECENT_BUILDS_JSON: JSON.stringify([{ id: "a" }]),
    },
  }), (error) => {
    assert.strictEqual(error.code, "V2_CLOUDBUILD_SUBMIT_BUDGET_BLOCKED");
    assert.strictEqual(error.details.build_n, 1);
    return true;
  });
}

dailyLimitBlocks();
explicitOverridePasses();
readFailureFailsClosed();
assertThrowsWithDetails();
console.log("CLOUDBUILD_SUBMIT_BUDGET_TEST_OK");
