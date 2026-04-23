"use strict";

const assert = require("assert");
const { evaluateFirestoreCostGuard, collectBudgetRows, collectBillingMetricRows } = require("../v2/firestoreCostGuard");

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

{
  const rows = collectBillingMetricRows({
    billingMetric: {
      source: "cloud_monitoring_firestore_read_count",
      rows: [
        { id: "read_ops_1", document_read_count: 100 },
        { id: "read_ops_2", read_ops: 200 },
      ],
    },
  });
  assert.strictEqual(rows.length, 2);
  assert.strictEqual(rows[0].read_ops, 100);
  assert.strictEqual(rows[1].read_ops, 200);
}

{
  const result = evaluateFirestoreCostGuard({
    unifiedReport,
    artifacts,
    thresholds: {
      max_total_estimated_reads: 1000,
      max_single_artifact_reads: 300,
      max_collector_query_limit_total: 450,
      max_artifact_age_minutes: 180,
      max_billing_read_ops: 500,
      require_billing_metric: true,
    },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("FIRESTORE_COST_GUARD:BILLING_METRIC_REQUIRED"));
}

{
  const result = evaluateFirestoreCostGuard({
    unifiedReport,
    artifacts,
    billingMetric: {
      rows: [
        { id: "read_ops_spike", read_ops: 900 },
      ],
    },
    thresholds: {
      max_total_estimated_reads: 1000,
      max_single_artifact_reads: 300,
      max_collector_query_limit_total: 450,
      max_artifact_age_minutes: 180,
      max_billing_read_ops: 500,
      require_billing_metric: true,
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.billing_metric_required, true);
  assert.strictEqual(result.billing_read_ops_total, 900);
  assert.ok(result.blockers.includes("FIRESTORE_COST_GUARD:BILLING_READ_OPS_EXCEEDED"));
}

{
  const result = evaluateFirestoreCostGuard({
    unifiedReport,
    artifacts,
    billingMetric: {
      rows: [
        { id: "read_ops_ok", read_ops: 300 },
      ],
    },
    thresholds: {
      max_total_estimated_reads: 1000,
      max_single_artifact_reads: 300,
      max_collector_query_limit_total: 450,
      max_artifact_age_minutes: 180,
      max_billing_read_ops: 500,
      require_billing_metric: true,
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.billing_metric_required, true);
  assert.strictEqual(result.billing_read_ops_total, 300);
}

console.log("V2_FIRESTORE_COST_GUARD_TEST_OK");
