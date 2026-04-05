#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonSafe,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { buildMlFeatureStore } = require("../src/utils/mlFeatureStore");

loadLocalEnv();

const INPUT_PATH = path.join(OPS_DAILY_DIR, "ml_training_dataset_latest.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const topFeatures = Array.isArray(report.feature_catalog) ? report.feature_catalog.slice(0, 20) : [];
  const lines = [
    "# ML Feature Store",
    "",
    `- 생성 시각: ${report.generated_at_kst || "N/A"}`,
    `- schema_version: ${report.schema_version || "N/A"}`,
    `- source_schema_version: ${report.source_schema_version || "N/A"}`,
    `- rows_n: ${summary.rows_n != null ? summary.rows_n : "N/A"}`,
    `- feature_keys_n: ${summary.feature_keys_n != null ? summary.feature_keys_n : "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    "",
    "## Top Features",
    ...topFeatures.map((item) => `- ${item.key}: presence=${item.presence_n} / type=${item.dominant_type}`),
  ];
  return `${lines.join("\n")}\n`;
}

function main() {
  const nowMeta = nowKstMeta();
  const dataset = readJsonSafe(INPUT_PATH, null);
  const store = buildMlFeatureStore(dataset);
  const output = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    ...store,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_ml_feature_store.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_ml_feature_store.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "ml_feature_store_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "ml_feature_store_latest.md");
  writeJson(jsonPath, output);
  writeText(mdPath, renderMarkdown(output));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJsonPath,
    latest_md: latestMdPath,
    rows_n: output.summary.rows_n,
    feature_keys_n: output.summary.feature_keys_n,
    status: output.summary.status,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BUILD_ML_FEATURE_STORE_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
