#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  OPS_DAILY_DIR,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const {
  buildMlTrainingRow,
  summarizeMlTrainingRows,
  ML_DATASET_SCHEMA_VERSION,
} = require("../src/utils/mlDatasetSchema");

const DATASET_LATEST_JSON = path.join(OPS_DAILY_DIR, "best_self_evolution_dataset_latest.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const top = (rows) => (Array.isArray(rows) ? rows : []).slice(0, 8).map((row) => `${row.key} ${row.count}`).join(" / ") || "N/A";
  return [
    "# ML Training Dataset",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- schema_version: ${report.schema_version || "N/A"}`,
    `- source_dataset_path: ${report.source_dataset_path || "N/A"}`,
    `- rows: ${summary.rows_n || 0} / valid ${summary.valid_n || 0} / invalid ${summary.invalid_n || 0} / realized ${summary.realized_n || 0}`,
    `- outcome_state: ${top(summary.by_outcome_state)}`,
    `- source_row_type: ${top(summary.by_source_row_type)}`,
    `- market: ${top(summary.by_market)}`,
  ].join("\n") + "\n";
}

function main() {
  const nowMeta = nowKstMeta();
  const dataset = readJsonRawSafe(DATASET_LATEST_JSON, null);
  if (!dataset || !Array.isArray(dataset.rows)) {
    throw new Error(`ML_TRAINING_DATASET_SOURCE_MISSING:${DATASET_LATEST_JSON}`);
  }

  const rows = dataset.rows.map((row) => buildMlTrainingRow(row));
  const summary = summarizeMlTrainingRows(rows);
  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    schema_version: ML_DATASET_SCHEMA_VERSION,
    source_dataset_path: DATASET_LATEST_JSON,
    source_cycle_id: dataset.cycle_id || null,
    summary,
    rows,
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_ml_training_dataset.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_ml_training_dataset.md`);
  const jsonlPath = path.join(OPS_DAILY_DIR, `${base}_ml_training_dataset.jsonl`);
  const latestJson = path.join(OPS_DAILY_DIR, "ml_training_dataset_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "ml_training_dataset_latest.md");
  const latestJsonl = path.join(OPS_DAILY_DIR, "ml_training_dataset_latest.jsonl");

  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  writeText(jsonlPath, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");
  writeJson(latestJson, payload);
  writeText(latestMd, renderMarkdown(payload));
  writeText(latestJsonl, rows.map((row) => JSON.stringify(row)).join("\n") + "\n");

  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    latest_md: latestMd,
    latest_jsonl: latestJsonl,
    rows_n: summary.rows_n,
    valid_n: summary.valid_n,
    invalid_n: summary.invalid_n,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BUILD_ML_TRAINING_DATASET_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}

module.exports = {
  main,
};
