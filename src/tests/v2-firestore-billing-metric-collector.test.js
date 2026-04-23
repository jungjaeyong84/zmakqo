"use strict";

const assert = require("assert");
const {
  METRIC_TYPE,
  buildBillingMetricPayload,
  __test,
} = require("../../scripts/collect-v2-firestore-billing-metric");

{
  const payload = buildBillingMetricPayload({
    projectId: "donbeolja-dev",
    startTime: "2026-04-23T00:00:00.000Z",
    endTime: "2026-04-23T02:00:00.000Z",
    generatedAt: "2026-04-23T02:01:00.000Z",
    data: {
      timeSeries: [
        {
          metric: {
            type: METRIC_TYPE,
            labels: { type: "LOOKUP" },
          },
          resource: {
            labels: { project_id: "donbeolja-dev" },
          },
          points: [
            { value: { int64Value: "10" } },
            { value: { int64Value: "20" } },
          ],
        },
      ],
    },
  });
  assert.strictEqual(payload.ok, true);
  assert.strictEqual(payload.reason, "V2_FIRESTORE_BILLING_METRIC_COLLECTED");
  assert.strictEqual(payload.row_n, 1);
  assert.strictEqual(payload.read_ops_total, 30);
  assert.strictEqual(payload.rows[0].read_ops, 30);
  assert.strictEqual(payload.rows[0].source, "cloud_monitoring_firestore_read_count");
  assert.strictEqual(payload.rows[0].labels.type, "LOOKUP");
}

{
  const payload = buildBillingMetricPayload({
    projectId: "donbeolja-dev",
    startTime: "2026-04-23T00:00:00.000Z",
    endTime: "2026-04-23T02:00:00.000Z",
    data: { timeSeries: [] },
  });
  assert.strictEqual(payload.ok, false);
  assert.strictEqual(payload.reason, "V2_FIRESTORE_BILLING_METRIC_EMPTY");
  assert.strictEqual(payload.read_ops_total, 0);
}

{
  assert.strictEqual(__test.extractPointValue({ value: { doubleValue: 1.5 } }), 1.5);
  assert.strictEqual(__test.parsePositiveNumber("25", 10), 25);
  assert.strictEqual(__test.parsePositiveNumber("-1", 10), 10);
}

console.log("V2_FIRESTORE_BILLING_METRIC_COLLECTOR_TEST_OK");
