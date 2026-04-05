#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { buildExecutionFillBaselineModel } = require("../src/utils/executionFillBaselineModel");

const INPUTS = Object.freeze({
  executionEntryDataset: path.join(OPS_DAILY_DIR, "execution_model_entry_dataset_latest.json"),
  experimentRegistry: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_experiment_registry_latest.json"),
});

function renderTrainMarkdown(payload = {}) {
  const s = payload.summary || {};
  const test = s.metrics_snapshot && s.metrics_snapshot.test ? s.metrics_snapshot.test : {};
  return [
    "# BEST Self-Evolution ML Train Run Result",
    "",
    `- generated_at_kst: ${payload.generated_at_kst || "N/A"}`,
    `- status: ${s.status || "N/A"}`,
    `- experiment_id: ${s.experiment_id || "N/A"}`,
    `- train_run_id: ${s.train_run_id || "N/A"}`,
    `- model_artifact_id: ${s.model_artifact_id || "N/A"}`,
    `- model_kind: ${s.model_kind || "N/A"}`,
    `- split_strategy: ${s.split_strategy || "N/A"}`,
    `- test_brier_score: ${test.brier_score != null ? test.brier_score : "N/A"}`,
    `- test_log_loss: ${test.log_loss != null ? test.log_loss : "N/A"}`,
    `- test_accuracy: ${test.accuracy != null ? test.accuracy : "N/A"}`,
    "",
  ].join("\n");
}

function renderModelMarkdown(payload = {}) {
  const s = payload.summary || {};
  const test = s.metrics_snapshot && s.metrics_snapshot.test ? s.metrics_snapshot.test : {};
  return [
    "# BEST Self-Evolution Execution Fill Model",
    "",
    `- generated_at_kst: ${payload.generated_at_kst || "N/A"}`,
    `- status: ${s.status || "N/A"}`,
    `- model_artifact_id: ${s.model_artifact_id || "N/A"}`,
    `- train_run_id: ${s.train_run_id || "N/A"}`,
    `- model_kind: ${s.model_kind || "N/A"}`,
    `- feature_count: ${s.feature_count != null ? s.feature_count : "N/A"}`,
    `- weights_n: ${s.weights_n != null ? s.weights_n : "N/A"}`,
    `- test_brier_score: ${test.brier_score != null ? test.brier_score : "N/A"}`,
    `- test_log_loss: ${test.log_loss != null ? test.log_loss : "N/A"}`,
    "",
  ].join("\n");
}

function writeLatestPair(baseName, payload, markdownRenderer, nowMeta) {
  const jsonPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_${baseName}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_${baseName}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, `${baseName}_latest.json`);
  const latestMd = path.join(OPS_DAILY_DIR, `${baseName}_latest.md`);
  writeJson(jsonPath, payload);
  writeText(mdPath, markdownRenderer(payload));
  writeJson(latestJson, payload);
  writeText(latestMd, markdownRenderer(payload));
  return { latestJson, latestMd };
}

function main() {
  const nowMeta = nowKstMeta();
  const executionEntryDataset = readJsonRawSafe(INPUTS.executionEntryDataset, null);
  const registry = readJsonRawSafe(INPUTS.experimentRegistry, null);
  const rows = executionEntryDataset && Array.isArray(executionEntryDataset.rows) ? executionEntryDataset.rows : [];
  if (!rows.length) {
    throw new Error("EXECUTION_ENTRY_DATASET_EMPTY");
  }
  const registrySummary = registry && registry.summary && typeof registry.summary === "object" ? registry.summary : (registry || {});
  const trained = buildExecutionFillBaselineModel({
    rows,
    experimentId: registrySummary.experiment_id || null,
    datasetVersionId: registrySummary.dataset_version_id || null,
    featureStoreVersionId: registrySummary.feature_store_version_id || null,
    executionDatasetVersionId: registrySummary.execution_dataset_version_id || null,
    trainedAtKst: nowMeta.kst,
  });
  const trainRunPayload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    inputs: INPUTS,
    summary: trained.trainRun,
  };
  const modelPayload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    inputs: INPUTS,
    summary: trained.modelArtifact,
    model: trained.modelArtifact.model_params,
  };
  const trainPaths = writeLatestPair("best_self_evolution_ml_train_run_result", trainRunPayload, renderTrainMarkdown, nowMeta);
  const modelPaths = writeLatestPair("best_self_evolution_execution_fill_model", modelPayload, renderModelMarkdown, nowMeta);
  console.log(JSON.stringify({
    ok: true,
    train_run_latest_json: trainPaths.latestJson,
    model_latest_json: modelPaths.latestJson,
    train_run_id: trained.trainRun.train_run_id,
    model_artifact_id: trained.modelArtifact.model_artifact_id,
    status: trained.trainRun.status,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("TRAIN_EXECUTION_FILL_BASELINE_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
