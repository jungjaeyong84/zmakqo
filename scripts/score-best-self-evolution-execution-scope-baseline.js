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
const { deriveExecutionEntryLabelScope } = require("../src/utils/executionEntryLabelScope");
const { scoreExecutionScopeBaselineRows } = require("../src/utils/executionScopeBaselineModel");

const INPUTS = Object.freeze({
  executionEntryDataset: path.join(OPS_DAILY_DIR, "execution_model_entry_dataset_latest.json"),
  modelArtifact: path.join(OPS_DAILY_DIR, "best_self_evolution_execution_scope_model_latest.json"),
});

function summarizeRows(rows = []) {
  const byScope = new Map();
  const falsePositiveGroups = new Map();
  for (const row of rows) {
    const key = row.actual_scope || "UNKNOWN";
    if (!byScope.has(key)) byScope.set(key, []);
    byScope.get(key).push(row);
    if (row.actual_scope && row.pred_class && row.actual_scope !== row.pred_class) {
      const fpKey = [
        row.actual_scope,
        row.pred_class,
        row.source || "UNKNOWN",
        row.event || "UNKNOWN",
        row.market || "UNKNOWN",
      ].join("|");
      falsePositiveGroups.set(fpKey, (falsePositiveGroups.get(fpKey) || 0) + 1);
    }
  }
  const byScopeRows = Array.from(byScope.entries()).map(([key, scopedRows]) => ({
    key,
    rows_n: scopedRows.length,
    top_pred_class: scopedRows.reduce((acc, row) => {
      acc[row.pred_class] = (acc[row.pred_class] || 0) + 1;
      return acc;
    }, {}),
  }));
  return {
    status: "EXECUTION_SCOPE_INFERENCE_READY",
    rows_n: rows.length,
    by_scope: byScopeRows,
    mismatch_n: rows.filter((row) => row.actual_scope !== row.pred_class).length,
    mismatch_rate: rows.length ? rows.filter((row) => row.actual_scope !== row.pred_class).length / rows.length : null,
    top_false_positive_groups: Array.from(falsePositiveGroups.entries())
      .map(([key, rowsN]) => ({ key, rows_n: rowsN }))
      .sort((a, b) => b.rows_n - a.rows_n)
      .slice(0, 10),
  };
}

function renderMarkdown(payload = {}) {
  const s = payload.summary || {};
  return [
    "# BEST Self-Evolution Execution Scope Inference",
    "",
    `- generated_at_kst: ${payload.generated_at_kst || "N/A"}`,
    `- status: ${s.status || "N/A"}`,
    `- model_artifact_id: ${s.model_artifact_id || "N/A"}`,
    `- rows_n: ${s.rows_n != null ? s.rows_n : "N/A"}`,
    `- mismatch_rate: ${s.mismatch_rate != null ? s.mismatch_rate : "N/A"}`,
    `- top_false_positive_group: ${s.top_false_positive_groups && s.top_false_positive_groups[0] ? `${s.top_false_positive_groups[0].key} (${s.top_false_positive_groups[0].rows_n})` : "N/A"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const dataset = readJsonRawSafe(INPUTS.executionEntryDataset, null);
  const modelArtifact = readJsonRawSafe(INPUTS.modelArtifact, null);
  const rows = dataset && Array.isArray(dataset.rows) ? dataset.rows : [];
  const filtered = rows.filter((row) => {
    const scope = deriveExecutionEntryLabelScope(row);
    return scope.scope === "FILLED" || scope.scope === "POLICY_BLOCKED" || scope.scope === "RUNTIME_EXCEPTION";
  });
  const scored = scoreExecutionScopeBaselineRows(filtered, modelArtifact);
  const enriched = filtered.map((row, idx) => {
    const scope = deriveExecutionEntryLabelScope(row);
    const pred = scored[idx] || {};
    return {
      row_id: pred.row_id,
      actual_scope: scope.scope === "FILLED" ? "FILLABLE" : scope.scope,
      pred_class: pred.pred_class,
      pred_class_prob: pred.pred_class_prob,
      class_probs: pred.class_probs,
      market: row && row.context ? row.context.market || null : null,
      source: row && row.context ? row.context.source || null : null,
      event: row && row.context ? row.context.event || null : null,
    };
  });
  const summary = summarizeRows(enriched);
  const modelSummary = modelArtifact && modelArtifact.summary && typeof modelArtifact.summary === "object" ? modelArtifact.summary : (modelArtifact || {});
  summary.model_artifact_id = String(modelSummary.model_artifact_id || "").trim() || null;
  summary.train_run_id = String(modelSummary.train_run_id || "").trim() || null;
  const payload = { ok: true, generated_at_kst: nowMeta.kst, inputs: INPUTS, summary, rows: enriched };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_execution_scope_inference`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_scope_inference_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_scope_inference_latest.md");
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
    console.error("SCORE_EXECUTION_SCOPE_BASELINE_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
