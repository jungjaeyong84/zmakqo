"use strict";

const assert = require("assert");
const { buildFeatureLabelDataset } = require("../services/featureLabelDataset");

async function run() {
  const dataset = await buildFeatureLabelDataset({
    exchange: "BINANCEFUT",
    markets: [],
    tf: "15m",
    limitN: 10,
  });

  assert.strictEqual(dataset.schema_version, "FEATURE_LABEL_DATASET_V2");
  assert.strictEqual(dataset.source_collection, "UNIFIED_EVENT_TIMELINE");
  assert.strictEqual(dataset.rows_n, 0);
  assert.deepStrictEqual(dataset.rows, []);
  assert.ok(dataset.created_at);

  console.log("FEATURE_LABEL_DATASET_TEST_OK");
}

run().catch((err) => {
  console.error("FEATURE_LABEL_DATASET_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
