"use strict";

const assert = require("assert");
const { buildMlTrainRun } = require("../utils/mlTrainRun");

(() => {
  const pending = buildMlTrainRun({
    trainingDataset: { dataset_version: { version_id: "ML_TRAINING_DATASET__abc123" } },
    featureStore: { feature_store_version: { version_id: "ML_FEATURE_STORE__def456" } },
    modelReadiness: { summary: { rows_n: 348, realized_n: 16 } },
    executionModelDataset: { summary: { version_id: "EXECUTION_MODEL_DATASET__xyz789" } },
  });
  assert.strictEqual(pending.status, "ML_TRAIN_RUN_NOT_STARTED");
  assert.ok(String(pending.experiment_id || "").startsWith("ML_BASELINE_ENV__"));
  assert.strictEqual(pending.execution_dataset_version_id, "EXECUTION_MODEL_DATASET__xyz789");
  assert.strictEqual(pending.train_run_id, null);

  const reported = buildMlTrainRun({
    trainingDataset: { dataset_version: { version_id: "ML_TRAINING_DATASET__abc123" } },
    featureStore: { feature_store_version: { version_id: "ML_FEATURE_STORE__def456" } },
    executionModelDataset: { summary: { version_id: "EXECUTION_MODEL_DATASET__xyz789" } },
    existingTrainRun: {
      summary: {
        status: "ML_TRAIN_RUN_REPORTED",
        train_run_id: "TRAIN__001",
        model_artifact_id: "MODEL__001",
        model_kind: "LOGISTIC_REGRESSION",
        split_strategy: "TIME_SERIES_HOLDOUT",
        train_split_pct: 70,
        validation_split_pct: 15,
        test_split_pct: 15,
        metrics_snapshot: { brier: 0.18 },
      },
    },
  });
  assert.strictEqual(reported.status, "ML_TRAIN_RUN_REPORTED");
  assert.strictEqual(reported.train_run_id, "TRAIN__001");
  assert.strictEqual(reported.model_artifact_id, "MODEL__001");
  assert.strictEqual(reported.model_kind, "LOGISTIC_REGRESSION");
  assert.strictEqual(reported.metrics_snapshot.brier, 0.18);
  assert.strictEqual(reported.execution_dataset_version_id, "EXECUTION_MODEL_DATASET__xyz789");

  console.log("ML_TRAIN_RUN_TEST_OK");
})();
