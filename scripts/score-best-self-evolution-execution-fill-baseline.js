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
const { scoreExecutionFillBaselineRows } = require("../src/utils/executionFillBaselineModel");
const { deriveExecutionEntryLabelScope } = require("../src/utils/executionEntryLabelScope");

const INPUTS = Object.freeze({
  executionEntryDataset: path.join(OPS_DAILY_DIR, "execution_model_entry_dataset_latest.json"),
  modelArtifact: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_fill_model_latest.json"),
});

function mean(values = []) {
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function summarizeRows(rows = []) {
  const byScope = new Map();
  const mismatches = [];
  for (const row of rows) {
    const scope = row.label_scope || "UNKNOWN";
    if (!byScope.has(scope)) byScope.set(scope, []);
    byScope.get(scope).push(row);
    if ((row.actual_was_filled === true) !== (row.pred_fill_label === true)) {
      mismatches.push(row);
    }
  }
  const scopes = Array.from(byScope.entries()).map(([key, scopedRows]) => ({
    key,
    rows_n: scopedRows.length,
    avg_pred_fill_prob: mean(scopedRows.map((row) => row.pred_fill_prob)),
    actual_fill_rate: mean(scopedRows.map((row) => row.actual_was_filled === true ? 1 : 0)),
  })).sort((a, b) => b.rows_n - a.rows_n);
  return {
    status: "EXECUTION_FILL_INFERENCE_READY",
    rows_n: rows.length,
    by_scope: scopes,
    mismatch_n: mismatches.length,
    mismatch_rate: rows.length ? mismatches.length / rows.length : null,
    top_false_positive_scopes: scopes.filter((row) => row.key !== "FILLED").slice(0, 5),
  };
}

function renderMarkdown(payload = {}) {
  const s = payload.summary || {};
  return [
    "# BEST Self-Evolution Execution Fill Inference",
    "",
    `- generated_at_kst: ${payload.generated_at_kst || "N/A"}`,
    `- status: ${s.status || "N/A"}`,
    `- model_artifact_id: ${s.model_artifact_id || "N/A"}`,
    `- rows_n: ${s.rows_n != null ? s.rows_n : "N/A"}`,
    `- mismatch_rate: ${s.mismatch_rate != null ? s.mismatch_rate : "N/A"}`,
    `- top_scope: ${Array.isArray(s.by_scope) && s.by_scope[0] ? `${s.by_scope[0].key} (${s.by_scope[0].rows_n})` : "N/A"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const dataset = readJsonRawSafe(INPUTS.executionEntryDataset, null);
  const modelArtifact = readJsonRawSafe(INPUTS.modelArtifact, null);
  const rows = dataset && Array.isArray(dataset.rows) ? dataset.rows : [];
  const scores = scoreExecutionFillBaselineRows(rows, modelArtifact);
  const enriched = rows.map((row, idx) => {
    const scope = deriveExecutionEntryLabelScope(row);
    const score = scores[idx] || {};
    return {
      row_id: score.row_id,
      label_scope: scope.scope,
      label_scope_detail: scope.scope_detail,
      learning_bucket: scope.learning_bucket,
      actual_was_filled: row && row.labels && row.labels.was_filled === true,
      pred_fill_prob: score.pred_fill_prob,
      pred_fill_label: score.pred_fill_label === true,
      decision_threshold: score.decision_threshold,
      no_fill_reason_family: row && row.execution ? row.execution.no_fill_reason_family || null : null,
      no_fill_reason: row && row.execution ? row.execution.no_fill_reason || null : null,
      no_fill_subtype: row && row.execution ? row.execution.no_fill_subtype || null : null,
      market: row && row.context ? row.context.market || null : null,
      source: row && row.context ? row.context.source || null : null,
      event: row && row.context ? row.context.event || null : null,
    };
  });
  const modelSummary = modelArtifact && modelArtifact.summary && typeof modelArtifact.summary === "object"
    ? modelArtifact.summary
    : (modelArtifact || {});
  const summary = summarizeRows(enriched);
  summary.model_artifact_id = String(modelSummary.model_artifact_id || "").trim() || null;
  summary.train_run_id = String(modelSummary.train_run_id || "").trim() || null;
  summary.decision_threshold = modelSummary.decision_threshold;

  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    inputs: INPUTS,
    summary,
    rows: enriched,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_execution_fill_inference`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_fill_inference_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_fill_inference_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  writeJson(latestJson, payload);
  writeText(latestMd, renderMarkdown(payload));
  console.log(JSON.stringify({
    ok: true,
    latest_json: latestJson,
    rows_n: summary.rows_n,
    mismatch_rate: summary.mismatch_rate,
    model_artifact_id: summary.model_artifact_id,
  }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("SCORE_EXECUTION_FILL_BASELINE_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
