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
const {
  EXECUTION_MODEL_DATASET_SCHEMA_VERSION,
  buildExecutionModelRows,
  summarizeExecutionModelRows,
  splitExecutionModelRows,
} = require("../src/utils/executionModelDataset");

const RECENT_CACHE_DIR = path.join(OPS_DAILY_DIR, "cache", "firestore_recent");
const INTENTS = path.join(RECENT_CACHE_DIR, "order_intents_paper.json");
const FILLS = path.join(RECENT_CACHE_DIR, "fills_paper.json");
const WEBHOOKS = path.join(RECENT_CACHE_DIR, "webhook_ledger.json");

function renderMarkdown(payload = {}) {
  const s = payload.summary || {};
  return [
    '# Execution Model Dataset',
    '',
    `- generated_at_kst: ${payload.generated_at_kst || 'N/A'}`,
    `- schema_version: ${payload.schema_version || 'N/A'}`,
    `- status: ${s.status || 'N/A'}`,
    `- rows: ${s.rows_n || 0} / filled ${s.filled_n || 0} / partial ${s.partial_n || 0} / rejected ${s.rejected_n || 0}`,
    `- split: entry ${s.entry_rows_n || 0} / exit ${s.exit_rows_n || 0}`,
    `- time_stop: ${s.time_stop_n || 0} / pre_tp1_time_stop ${s.pre_tp1_time_stop_n || 0}`,
    `- rates: fill ${s.fill_rate == null ? 'N/A' : s.fill_rate.toFixed(4)} / partial ${s.partial_rate == null ? 'N/A' : s.partial_rate.toFixed(4)} / reject ${s.reject_rate == null ? 'N/A' : s.reject_rate.toFixed(4)}`,
    `- p95: latency ${s.created_to_fill_p95_ms ?? 'N/A'}ms / slippage ${s.slippage_p95_bps ?? 'N/A'}bps`,
    `- feature_keys: ${s.feature_keys_n || 0}`,
    `- slippage_zero_top: ${Array.isArray(s.by_primary_fill_source) && s.by_primary_fill_source.length ? s.by_primary_fill_source.slice(0, 4).map((row) => `${row.key} ${row.slippage_zero_n}/${row.rows_n}`).join(' / ') : 'N/A'}`,
  ].join('\n') + '\n';
}

function main() {
  const nowMeta = nowKstMeta();
  const rows = buildExecutionModelRows({
    intents: readJsonRawSafe(INTENTS, null),
    fills: readJsonRawSafe(FILLS, null),
    webhooks: readJsonRawSafe(WEBHOOKS, null),
  });
  const split = splitExecutionModelRows(rows);
  const summary = summarizeExecutionModelRows(rows);
  const entrySummary = summarizeExecutionModelRows(split.entry_rows);
  const exitSummary = summarizeExecutionModelRows(split.exit_rows);
  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    schema_version: EXECUTION_MODEL_DATASET_SCHEMA_VERSION,
    summary,
    rows,
  };
  const entryPayload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    schema_version: EXECUTION_MODEL_DATASET_SCHEMA_VERSION,
    dataset_scope: 'ENTRY_ONLY',
    summary: entrySummary,
    rows: split.entry_rows,
  };
  const exitPayload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    schema_version: EXECUTION_MODEL_DATASET_SCHEMA_VERSION,
    dataset_scope: 'EXIT_ONLY',
    summary: exitSummary,
    rows: split.exit_rows,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_execution_model_dataset.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_execution_model_dataset.md`);
  const latestJson = path.join(OPS_DAILY_DIR, 'execution_model_dataset_latest.json');
  const latestMd = path.join(OPS_DAILY_DIR, 'execution_model_dataset_latest.md');
  const entryLatestJson = path.join(OPS_DAILY_DIR, 'execution_model_entry_dataset_latest.json');
  const exitLatestJson = path.join(OPS_DAILY_DIR, 'execution_model_exit_dataset_latest.json');
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  writeJson(latestJson, payload);
  writeText(latestMd, renderMarkdown(payload));
  writeJson(entryLatestJson, entryPayload);
  writeJson(exitLatestJson, exitPayload);
  console.log(JSON.stringify({ ok: true, latest_json: latestJson, entry_latest_json: entryLatestJson, exit_latest_json: exitLatestJson, status: summary.status, rows_n: summary.rows_n, entry_rows_n: entrySummary.rows_n, exit_rows_n: exitSummary.rows_n }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('BUILD_EXECUTION_MODEL_DATASET_FAILED', err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
