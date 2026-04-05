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
const { deriveModelReadiness } = require("../src/utils/modelReadiness");

const INPUT = path.join(OPS_DAILY_DIR, "ml_training_dataset_latest.json");

function renderMarkdown(payload = {}) {
  const summary = payload.summary || {};
  return [
    "# BEST Self-Evolution Model Readiness",
    "",
    `- generated_at_kst: ${payload.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- schema_version: ${summary.schema_version || "N/A"}`,
    `- rows: ${summary.rows_n || 0} / valid ${summary.valid_n || 0} / invalid ${summary.invalid_n || 0} / realized ${summary.realized_n || 0}`,
    `- thresholds: rows>=${summary.min_rows || "N/A"} / realized>=${summary.min_realized_n || "N/A"}`,
    `- readiness: row=${summary.row_ready ? "YES" : "NO"} / realized=${summary.realized_ready ? "YES" : "NO"} / integrity=${summary.integrity_ready ? "YES" : "NO"}`,
    `- coverage: mfe_mae ${summary.mfe_mae_labeled_n || 0} (${summary.mfe_mae_label_rate == null ? "N/A" : summary.mfe_mae_label_rate.toFixed(4)}) / tp1_time ${summary.tp1_time_labeled_n || 0} (${summary.tp1_time_label_rate == null ? "N/A" : summary.tp1_time_label_rate.toFixed(4)}) / tp0_time ${summary.tp0_time_labeled_n || 0} (${summary.tp0_time_label_rate == null ? "N/A" : summary.tp0_time_label_rate.toFixed(4)})`,
    `- microstructure outcomes: tp0->tp1 ${summary.tp0_to_tp1_converted_n || 0} / pre_tp1_time_stop ${summary.pre_tp1_time_stop_n || 0}`,
  ].join("\n") + "\n";
}

function main() {
  const nowMeta = nowKstMeta();
  const dataset = readJsonRawSafe(INPUT, null);
  const summary = deriveModelReadiness(dataset);
  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    input_path: INPUT,
    summary,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_model_readiness.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_best_self_evolution_model_readiness.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_model_readiness_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_model_readiness_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  writeJson(latestJson, payload);
  writeText(latestMd, renderMarkdown(payload));
  console.log(JSON.stringify({ ok: true, latest_json: latestJson, latest_md: latestMd, status: summary.status }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_MODEL_READINESS_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
