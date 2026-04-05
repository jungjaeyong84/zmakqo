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
const { buildMlExperimentRegistry } = require("../src/utils/mlExperimentRegistry");

const INPUTS = Object.freeze({
  trainingDataset: path.join(OPS_DAILY_DIR, "ml_training_dataset_latest.json"),
  featureStore: path.join(OPS_DAILY_DIR, "ml_feature_store_latest.json"),
  modelReadiness: path.join(OPS_DAILY_DIR, "best_self_evolution_model_readiness_latest.json"),
  executionQuality: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json"),
  executionStageLatency: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_stage_latency_latest.json"),
});

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution ML Experiment Registry",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- experiment_id: ${summary.experiment_id || "N/A"}`,
    `- dataset_version_id: ${summary.dataset_version_id || "N/A"}`,
    `- feature_store_version_id: ${summary.feature_store_version_id || "N/A"}`,
    `- source_cycle_id: ${summary.source_cycle_id || "N/A"}`,
    `- source_mode: ${summary.source_mode || "N/A"}`,
    `- rows_n: ${summary.rows_n != null ? summary.rows_n : "N/A"} / realized_n: ${summary.realized_n != null ? summary.realized_n : "N/A"}`,
    `- feature_keys_n: ${summary.feature_keys_n != null ? summary.feature_keys_n : "N/A"}`,
    `- model_readiness_status: ${summary.model_readiness_status || "N/A"}`,
    `- execution_quality_status: ${summary.execution_quality_status || "N/A"}`,
    `- execution_stage_latency_status: ${summary.execution_stage_latency_status || "N/A"}`,
    `- top_operational_webhook_delay_cause: ${summary.execution_quality_top_operational_webhook_delay_cause || "N/A"}`,
    `- top_operational_signal_to_intent_group: ${summary.execution_stage_latency_top_operational_signal_to_intent_group || "N/A"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const summary = buildMlExperimentRegistry({
    trainingDataset: readJsonRawSafe(INPUTS.trainingDataset, null),
    featureStore: readJsonRawSafe(INPUTS.featureStore, null),
    modelReadiness: readJsonRawSafe(INPUTS.modelReadiness, null),
    executionQuality: readJsonRawSafe(INPUTS.executionQuality, null),
    executionStageLatency: readJsonRawSafe(INPUTS.executionStageLatency, null),
  });
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_ml_experiment_registry`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_experiment_registry_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_experiment_registry_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({ ok: true, latest_json: latestJson, latest_md: latestMd, status: summary.status, experiment_id: summary.experiment_id }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_ML_EXPERIMENT_REGISTRY_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
