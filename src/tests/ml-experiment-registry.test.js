"use strict";

const assert = require("assert");
const { buildMlExperimentRegistry } = require("../utils/mlExperimentRegistry");

(() => {
  const report = buildMlExperimentRegistry({
    trainingDataset: {
      source_mode: "RAW_CACHE",
      source_cycle_id: "cycle-1",
      source_window: { source: "REFERENCE_DATASET_ROLLING_REFRESH" },
      dataset_version: { version_id: "ML_TRAINING_DATASET__abc123" },
    },
    featureStore: {
      feature_store_version: { version_id: "ML_FEATURE_STORE__def456" },
      summary: { feature_keys_n: 493 },
    },
    modelReadiness: { summary: { status: "MODEL_READINESS_READY", rows_n: 348, realized_n: 16 } },
    executionQuality: { summary: { status: "EXECUTION_QUALITY_REVIEW", top_operational_webhook_delay_cause: "IMMEDIATE_EXEC_WEBHOOK_SAVED_LATE_INTENT" } },
    executionStageLatency: { summary: { status: "EXECUTION_STAGE_LATENCY_READY", top_operational_signal_to_intent_groups: [{ key: "TV_WEBHOOK|EARLY_SHORT|XRPUSDT" }] } },
    executionModelDataset: { summary: { status: "EXECUTION_MODEL_DATASET_READY", version_id: "EXECUTION_MODEL_DATASET__xyz789" } },
    trainRun: { summary: { status: "ML_TRAIN_RUN_NOT_STARTED", model_artifact_id: null } },
    modelContract: { summary: { status: "ML_MODEL_CONTRACT_OFFLINE_ONLY", deployment_stage: "OFFLINE_ONLY", canary_gate_status: "BLOCK_GLOBAL_CANARY", promotion_status: "HOLD_OFFLINE_ONLY" } },
  });

  assert.strictEqual(report.status, "ML_EXPERIMENT_REGISTRY_READY");
  assert.ok(String(report.experiment_id || "").startsWith("ML_BASELINE_ENV__"));
  assert.strictEqual(report.dataset_version_id, "ML_TRAINING_DATASET__abc123");
  assert.strictEqual(report.feature_store_version_id, "ML_FEATURE_STORE__def456");
  assert.strictEqual(report.execution_dataset_version_id, "EXECUTION_MODEL_DATASET__xyz789");
  assert.strictEqual(report.execution_quality_top_operational_webhook_delay_cause, "IMMEDIATE_EXEC_WEBHOOK_SAVED_LATE_INTENT");
  assert.strictEqual(report.execution_stage_latency_top_operational_signal_to_intent_group, "TV_WEBHOOK|EARLY_SHORT|XRPUSDT");
  assert.strictEqual(report.train_run_status, "ML_TRAIN_RUN_NOT_STARTED");
  assert.strictEqual(report.train_run_id, null);
  assert.strictEqual(report.model_contract_status, "ML_MODEL_CONTRACT_OFFLINE_ONLY");
  assert.strictEqual(report.model_contract_deployment_stage, "OFFLINE_ONLY");

  console.log("ML_EXPERIMENT_REGISTRY_TEST_OK");
})();
