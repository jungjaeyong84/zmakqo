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
  selfEvolutionSnapshotLatestPath,
} = require("./lib/automation-utils");
const {
  summarizeExecutionScopeFalsePositiveDiagnostics,
} = require("../src/utils/executionScopeFalsePositiveDiagnostics");

const EXECUTION_ENTRY_DATASET_PATH = path.join(OPS_DAILY_DIR, "execution_model_entry_dataset_latest.json");
const EXECUTION_SCOPE_INFERENCE_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_scope_inference_latest.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution Execution Scope False Positive Diagnostics",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- top_false_positive_group: ${summary.top_false_positive_group || "N/A"}`,
    `- top_false_positive_rows_n: ${summary.top_false_positive_rows_n ?? "N/A"}`,
    `- top_shared_feature: ${summary.top_shared_feature || "N/A"}`,
    `- reference_group_mode: ${summary.reference_group_mode || "N/A"}`,
    `- reference_rows_n: ${summary.reference_rows_n ?? "N/A"}`,
    `- reference_top_shared_feature: ${summary.reference_top_shared_feature || "N/A"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const executionEntryDataset = readJsonRawSafe(EXECUTION_ENTRY_DATASET_PATH, null);
  const executionScopeInference = readJsonRawSafe(EXECUTION_SCOPE_INFERENCE_PATH, null);
  const result = summarizeExecutionScopeFalsePositiveDiagnostics({
    executionEntryDataset,
    executionScopeInference,
  });
  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    inputs: {
      execution_entry_dataset_latest_path: EXECUTION_ENTRY_DATASET_PATH,
      execution_scope_inference_latest_path: EXECUTION_SCOPE_INFERENCE_PATH,
    },
    summary: result.summary,
    rows: result.rows,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_execution_scope_fp_diagnostics`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJsonPath = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_scope_fp_diagnostics_latest.json");
  const latestMdPath = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_scope_fp_diagnostics_latest.md");
  writeJson(jsonPath, report);
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, latestJsonPath);
  copyLatest(mdPath, latestMdPath);
  copyLatest(jsonPath, selfEvolutionSnapshotLatestPath("execution_scope_fp_diagnostics_latest.json"));
  copyLatest(mdPath, selfEvolutionSnapshotLatestPath("execution_scope_fp_diagnostics_latest.md"));
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJsonPath,
    status: report.summary.status,
    top_false_positive_group: report.summary.top_false_positive_group,
  }));
}

main();
