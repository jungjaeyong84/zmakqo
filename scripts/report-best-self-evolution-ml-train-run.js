#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { buildMlTrainRun } = require("../src/utils/mlTrainRun");

const INPUTS = Object.freeze({
  trainingDataset: path.join(OPS_DAILY_DIR, "ml_training_dataset_latest.json"),
  featureStore: path.join(OPS_DAILY_DIR, "ml_feature_store_latest.json"),
  experimentRegistry: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_experiment_registry_latest.json"),
  existingTrainRun: path.join(OPS_DAILY_DIR, "best_self_evolution_ml_train_run_manual_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution ML Train Run",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- experiment_id: ${summary.experiment_id || "N/A"}`,
    `- dataset_version_id: ${summary.dataset_version_id || "N/A"}`,
    `- feature_store_version_id: ${summary.feature_store_version_id || "N/A"}`,
    `- train_run_id: ${summary.train_run_id || "N/A"}`,
    `- model_kind: ${summary.model_kind || "N/A"}`,
    `- split_strategy: ${summary.split_strategy || "N/A"}`,
    `- train/val/test: ${summary.train_split_pct != null ? summary.train_split_pct : "N/A"} / ${summary.validation_split_pct != null ? summary.validation_split_pct : "N/A"} / ${summary.test_split_pct != null ? summary.test_split_pct : "N/A"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildMlTrainRun({
    trainingDataset: readJsonRawSafe(INPUTS.trainingDataset, null),
    featureStore: readJsonRawSafe(INPUTS.featureStore, null),
    experimentRegistry: readJsonRawSafe(INPUTS.experimentRegistry, null),
    existingTrainRun: readJsonRawSafe(INPUTS.existingTrainRun, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_ml_train_run`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_train_run_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_train_run_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    status: summary.status,
    experiment_id: summary.experiment_id,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_ML_TRAIN_RUN_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
