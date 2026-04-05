"use strict";

const assert = require("assert");
const {
  ML_FEATURE_STORE_SCHEMA_VERSION,
  buildMlFeatureStore,
} = require("../utils/mlFeatureStore");

function run() {
  const store = buildMlFeatureStore({
    schema_version: "2026-04-05.v1",
    source_cycle_id: "best_self_evolution_foo",
    dataset_version: { version_id: "ML_TRAINING_DATASET__abc123" },
    rows: [
      {
        row_id: "ROW_1",
        context: { market: "BTCUSDT", tf: "15m", event: "CORE_LONG", source_row_type: "EXECUTED" },
        features: { score: 0.7, action: "ALLOW", partial_fill: false },
      },
      {
        row_id: "ROW_2",
        context: { market: "ETHUSDT", tf: "15m", event: "CORE_SHORT", source_row_type: "DROP" },
        features: { score: 0.3, action: "DROP", partial_fill: true },
      },
    ],
  });

  assert.strictEqual(store.schema_version, ML_FEATURE_STORE_SCHEMA_VERSION);
  assert.strictEqual(store.summary.rows_n, 2);
  assert.strictEqual(store.summary.feature_keys_n, 3);
  assert.strictEqual(store.summary.numeric_feature_keys_n, 1);
  assert.strictEqual(store.summary.boolean_feature_keys_n, 1);
  assert.strictEqual(store.summary.categorical_feature_keys_n, 1);
  assert.strictEqual(store.summary.status, "FEATURE_STORE_READY");
  assert.ok(String(store.feature_store_version.version_id || "").startsWith("ML_FEATURE_STORE__"));
  assert.ok(String(store.source_dataset_version_id || "").startsWith("ML_TRAINING_DATASET__"));
  assert.strictEqual(store.feature_catalog[0].key, "action");
  assert.strictEqual(store.row_index[0].feature_keys_n, 3);

  console.log("ML_FEATURE_STORE_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("ML_FEATURE_STORE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
