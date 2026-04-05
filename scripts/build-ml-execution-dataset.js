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
} = require("../src/utils/executionModelDataset");

const RECENT_CACHE_DIR = path.join(OPS_DAILY_DIR, "cache", "firestore_recent");
const INTENTS = path.join(RECENT_CACHE_DIR, "order_intents_paper.json");
const FILLS = path.join(RECENT_CACHE_DIR, "fills_paper.json");

function renderMarkdown(payload = {}) {
  const s = payload.summary || {};
  return [
    '# Execution Model Dataset',
    '',
    `- generated_at_kst: ${payload.generated_at_kst || 'N/A'}`,
    `- schema_version: ${payload.schema_version || 'N/A'}`,
    `- status: ${s.status || 'N/A'}`,
    `- rows: ${s.rows_n || 0} / filled ${s.filled_n || 0} / partial ${s.partial_n || 0} / rejected ${s.rejected_n || 0}`,
    `- rates: fill ${s.fill_rate == null ? 'N/A' : s.fill_rate.toFixed(4)} / partial ${s.partial_rate == null ? 'N/A' : s.partial_rate.toFixed(4)} / reject ${s.reject_rate == null ? 'N/A' : s.reject_rate.toFixed(4)}`,
    `- p95: latency ${s.created_to_fill_p95_ms ?? 'N/A'}ms / slippage ${s.slippage_p95_bps ?? 'N/A'}bps`,
    `- feature_keys: ${s.feature_keys_n || 0}`,
  ].join('\n') + '\n';
}

function main() {
  const nowMeta = nowKstMeta();
  const rows = buildExecutionModelRows({
    intents: readJsonRawSafe(INTENTS, null),
    fills: readJsonRawSafe(FILLS, null),
  });
  const summary = summarizeExecutionModelRows(rows);
  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    schema_version: EXECUTION_MODEL_DATASET_SCHEMA_VERSION,
    summary,
    rows,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_execution_model_dataset.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_execution_model_dataset.md`);
  const latestJson = path.join(OPS_DAILY_DIR, 'execution_model_dataset_latest.json');
  const latestMd = path.join(OPS_DAILY_DIR, 'execution_model_dataset_latest.md');
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  writeJson(latestJson, payload);
  writeText(latestMd, renderMarkdown(payload));
  console.log(JSON.stringify({ ok: true, latest_json: latestJson, status: summary.status, rows_n: summary.rows_n }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error('BUILD_EXECUTION_MODEL_DATASET_FAILED', err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
