"use strict";

const crypto = require("crypto");

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  return value.summary && typeof value.summary === "object" ? value.summary : value;
}

function sha1(value) {
  return crypto.createHash("sha1").update(String(value || "")).digest("hex");
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildMlExperimentIdentity({
  trainingDataset = null,
  featureStore = null,
  modelReadiness = null,
  executionModelDataset = null,
} = {}) {
  const dataset = trainingDataset && typeof trainingDataset === "object" ? trainingDataset : {};
  const feature = featureStore && typeof featureStore === "object" ? featureStore : {};
  const readiness = readSummary(modelReadiness);
  const executionModel = executionModelDataset && typeof executionModelDataset === "object"
    ? readSummary(executionModelDataset)
    : {};

  const datasetVersionId = String(dataset.dataset_version && dataset.dataset_version.version_id || "").trim() || null;
  const featureStoreVersionId = String(feature.feature_store_version && feature.feature_store_version.version_id || feature.summary && feature.summary.version_id || "").trim() || null;
  const executionDatasetVersionId = String(
    executionModel.version_id
    || (executionModelDataset && executionModelDataset.execution_dataset_version && executionModelDataset.execution_dataset_version.version_id)
    || ""
  ).trim() || null;
  const sourceCycleId = String(dataset.source_cycle_id || feature.source_cycle_id || readiness.source_cycle_id || "").trim() || null;
  const sourceWindow = dataset.source_window && typeof dataset.source_window === "object" ? dataset.source_window : null;
  const experimentKey = JSON.stringify({
    dataset_version_id: datasetVersionId,
    feature_store_version_id: featureStoreVersionId,
    execution_dataset_version_id: executionDatasetVersionId,
    source_cycle_id: sourceCycleId,
    source_window_source: sourceWindow && sourceWindow.source ? String(sourceWindow.source).trim().toUpperCase() : null,
    rows_n: readiness.rows_n || null,
    feature_keys_n: feature.summary && feature.summary.feature_keys_n || null,
  });
  const experimentId = `ML_BASELINE_ENV__${sha1(experimentKey).slice(0, 16)}`;

  return {
    datasetVersionId,
    featureStoreVersionId,
    executionDatasetVersionId,
    sourceCycleId,
    sourceWindow,
    experimentId,
  };
}

function buildMlExperimentRegistry({
  trainingDataset = null,
  featureStore = null,
  modelReadiness = null,
  executionQuality = null,
  executionStageLatency = null,
  executionModelDataset = null,
  trainRun = null,
} = {}) {
  const dataset = trainingDataset && typeof trainingDataset === "object" ? trainingDataset : {};
  const feature = featureStore && typeof featureStore === "object" ? featureStore : {};
  const readiness = readSummary(modelReadiness);
  const quality = readSummary(executionQuality);
  const stageLatency = readSummary(executionStageLatency);
  const executionModel = readSummary(executionModelDataset);
  const trainRunSummary = readSummary(trainRun);
  const {
    datasetVersionId,
    featureStoreVersionId,
    executionDatasetVersionId,
    sourceCycleId,
    sourceWindow,
    experimentId,
  } = buildMlExperimentIdentity({
    trainingDataset,
    featureStore,
    modelReadiness,
    executionModelDataset,
  });

  return {
    status: datasetVersionId && featureStoreVersionId ? "ML_EXPERIMENT_REGISTRY_READY" : "ML_EXPERIMENT_REGISTRY_INCOMPLETE",
    experiment_id: experimentId,
    dataset_version_id: datasetVersionId,
    feature_store_version_id: featureStoreVersionId,
    execution_dataset_version_id: executionDatasetVersionId,
    source_cycle_id: sourceCycleId,
    source_mode: String(dataset.source_mode || readiness.source_mode || "").trim().toUpperCase() || null,
    source_window: sourceWindow,
    rows_n: Number.isFinite(Number(readiness.rows_n)) ? Number(readiness.rows_n) : null,
    realized_n: Number.isFinite(Number(readiness.realized_n)) ? Number(readiness.realized_n) : null,
    feature_keys_n: Number.isFinite(Number(feature.summary && feature.summary.feature_keys_n)) ? Number(feature.summary.feature_keys_n) : null,
    model_readiness_status: String(readiness.status || "").trim().toUpperCase() || null,
    execution_quality_status: String(quality.status || "").trim().toUpperCase() || null,
    execution_quality_top_operational_webhook_delay_cause: String(quality.top_operational_webhook_delay_cause || "").trim() || null,
    execution_stage_latency_status: String(stageLatency.status || "").trim().toUpperCase() || null,
    execution_stage_latency_top_operational_signal_to_intent_group: String(stageLatency.top_operational_signal_to_intent_groups && stageLatency.top_operational_signal_to_intent_groups[0] && stageLatency.top_operational_signal_to_intent_groups[0].key || "").trim() || null,
    execution_model_dataset_status: String(executionModel.status || "").trim().toUpperCase() || null,
    train_run_status: String(trainRunSummary.status || "").trim().toUpperCase() || null,
    train_run_id: String(trainRunSummary.train_run_id || "").trim() || null,
    train_run_model_kind: String(trainRunSummary.model_kind || "").trim() || null,
    train_run_split_strategy: String(trainRunSummary.split_strategy || "").trim() || null,
    train_run_train_split_pct: toNum(trainRunSummary.train_split_pct),
    train_run_validation_split_pct: toNum(trainRunSummary.validation_split_pct),
    train_run_test_split_pct: toNum(trainRunSummary.test_split_pct),
    train_run_metrics_snapshot: trainRunSummary.metrics_snapshot && typeof trainRunSummary.metrics_snapshot === "object"
      ? trainRunSummary.metrics_snapshot
      : null,
  };
}

module.exports = {
  buildMlExperimentIdentity,
  buildMlExperimentRegistry,
};
