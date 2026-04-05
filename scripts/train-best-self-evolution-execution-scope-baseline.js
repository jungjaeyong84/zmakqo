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
const { buildExecutionScopeBaselineModel } = require("../src/utils/executionScopeBaselineModel");

const INPUTS = Object.freeze({
  executionEntryDataset: path.join(OPS_DAILY_DIR, "execution_model_entry_dataset_latest.json"),
  experimentRegistry: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_experiment_registry_latest.json"),
});

function renderMarkdown(payload = {}) {
  const s = payload.summary || {};
  const test = s.metrics_snapshot && s.metrics_snapshot.test ? s.metrics_snapshot.test : {};
  return [
    "# BEST Self-Evolution Execution Scope Train Run",
    "",
    `- generated_at_kst: ${payload.generated_at_kst || "N/A"}`,
    `- status: ${s.status || "N/A"}`,
    `- train_run_id: ${s.train_run_id || "N/A"}`,
    `- model_artifact_id: ${s.model_artifact_id || "N/A"}`,
    `- model_kind: ${s.model_kind || "N/A"}`,
    `- quality_gate: ${s.quality_gate_status || "N/A"} / ready=${s.quality_gate_ready ? "YES" : "NO"}`,
    `- test_accuracy: ${test.accuracy != null ? test.accuracy : "N/A"}`,
    `- test_macro_recall: ${test.macro_recall != null ? test.macro_recall : "N/A"}`,
    "",
  ].join("\n");
}

function writeLatestPair(baseName, payload, nowMeta) {
  const jsonPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_${baseName}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_${baseName}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, `${baseName}_latest.json`);
  const latestMd = path.join(OPS_DAILY_DIR, `${baseName}_latest.md`);
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  writeJson(latestJson, payload);
  writeText(latestMd, renderMarkdown(payload));
  return { latestJson, latestMd };
}

function main() {
  const nowMeta = nowKstMeta();
  const dataset = readJsonRawSafe(INPUTS.executionEntryDataset, null);
  const registry = readJsonRawSafe(INPUTS.experimentRegistry, null);
  const rows = dataset && Array.isArray(dataset.rows) ? dataset.rows : [];
  const registrySummary = registry && registry.summary && typeof registry.summary === "object" ? registry.summary : (registry || {});
  const trained = buildExecutionScopeBaselineModel({
    rows,
    experimentId: registrySummary.experiment_id || null,
    datasetVersionId: registrySummary.dataset_version_id || null,
    featureStoreVersionId: registrySummary.feature_store_version_id || null,
    executionDatasetVersionId: registrySummary.execution_dataset_version_id || null,
    trainedAtKst: nowMeta.kst,
  });
  const trainRunPayload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary: trained.trainRun };
  const modelPayload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary: trained.modelArtifact, model: trained.modelArtifact.model_params };
  const trainPaths = writeLatestPair("best_self_evolution_ml_train_run_scope_result", trainRunPayload, nowMeta);
  const modelPaths = writeLatestPair("best_self_evolution_execution_scope_model", modelPayload, nowMeta);
  console.log(JSON.stringify({
    ok: true,
    train_run_latest_json: trainPaths.latestJson,
    model_latest_json: modelPaths.latestJson,
    train_run_id: trained.trainRun.train_run_id,
    model_artifact_id: trained.modelArtifact.model_artifact_id,
    quality_gate_status: trained.trainRun.quality_gate_status,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("TRAIN_EXECUTION_SCOPE_BASELINE_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
