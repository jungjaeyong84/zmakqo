"use strict";

const assert = require("assert");
const { evaluateFirestoreCostGuard, collectBudgetRows } = require("../v2/firestoreCostGuard");

const unifiedReport = {
  bounded_runtime_summary: {
    collector_query_budget: {
      transitionsLimit: 50,
      outboxesLimit: 50,
      repairRequestsLimit: 20,
    },
    selector_query_budget: {
      query_limit: 25,
      recent_window_hours: 168,
    },
  },
};
const artifacts = [
  { artifact_filename: "v2_production_entry_route_canary_streak_latest.json", firestore_read_limit: 48, row_n: 14, artifact_generated_age_minutes: 20 },
  { artifact_filename: "v2_exit_runtime_canary_streak_latest.json", firestore_read_limit: 48, row_n: 14, artifact_generated_age_minutes: 20 },
];

{
  const rows = collectBudgetRows({ unifiedReport, artifacts });
  assert.ok(rows.length >= 4);
  assert.ok(rows.some((row) => row.id === "collector_query_budget"));
}

{
  const result = evaluateFirestoreCostGuard({ unifiedReport, artifacts });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_FIRESTORE_COST_GUARD_PASS");
}

{
  const result = evaluateFirestoreCostGuard({ unifiedReport, artifacts: [{ artifact_filename: "bad.json", firestore_read_limit: 5000 }] });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("FIRESTORE_COST_GUARD:TOTAL_READ_BUDGET_EXCEEDED"));
  assert.ok(result.blockers.includes("FIRESTORE_COST_GUARD:SINGLE_ARTIFACT_READ_BUDGET_EXCEEDED"));
}

console.log("V2_FIRESTORE_COST_GUARD_TEST_OK");
