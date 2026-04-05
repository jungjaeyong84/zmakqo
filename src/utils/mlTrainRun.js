"use strict";

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  return value.summary && typeof value.summary === "object" ? value.summary : value;
}

function toNum(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildMlTrainRun({
  trainingDataset = null,
  featureStore = null,
  experimentRegistry = null,
  existingTrainRun = null,
} = {}) {
  const dataset = trainingDataset && typeof trainingDataset === "object" ? trainingDataset : {};
  const feature = featureStore && typeof featureStore === "object" ? featureStore : {};
  const registry = readSummary(experimentRegistry);
  const existing = readSummary(existingTrainRun);

  const datasetVersionId = String(
    existing.dataset_version_id
    || registry.dataset_version_id
    || (dataset.dataset_version && dataset.dataset_version.version_id)
    || ""
  ).trim() || null;
  const featureStoreVersionId = String(
    existing.feature_store_version_id
    || registry.feature_store_version_id
    || (feature.feature_store_version && feature.feature_store_version.version_id)
    || (feature.summary && feature.summary.version_id)
    || ""
  ).trim() || null;
  const experimentId = String(existing.experiment_id || registry.experiment_id || "").trim() || null;
  const trainRunId = String(existing.train_run_id || "").trim() || null;
  const modelKind = String(existing.model_kind || "").trim() || null;
  const splitStrategy = String(existing.split_strategy || "").trim() || null;
  const status = String(existing.status || "").trim().toUpperCase()
    || (trainRunId ? "ML_TRAIN_RUN_REPORTED" : "ML_TRAIN_RUN_NOT_STARTED");

  return {
    status,
    experiment_id: experimentId,
    dataset_version_id: datasetVersionId,
    feature_store_version_id: featureStoreVersionId,
    train_run_id: trainRunId,
    model_kind: modelKind,
    split_strategy: splitStrategy,
    train_split_pct: toNum(existing.train_split_pct),
    validation_split_pct: toNum(existing.validation_split_pct),
    test_split_pct: toNum(existing.test_split_pct),
    metrics_snapshot: existing.metrics_snapshot && typeof existing.metrics_snapshot === "object"
      ? existing.metrics_snapshot
      : null,
    trained_at_kst: String(existing.trained_at_kst || "").trim() || null,
  };
}

module.exports = {
  buildMlTrainRun,
};
