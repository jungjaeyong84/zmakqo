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
const { summarizeExecutionStageLatency } = require("../src/utils/executionStageLatency");

const INPUT_PATH = path.join(OPS_DAILY_DIR, "execution_model_dataset_latest.json");

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  const topSignal = Array.isArray(summary.top_signal_to_intent_groups) ? summary.top_signal_to_intent_groups.slice(0, 5) : [];
  const topOperationalSignal = Array.isArray(summary.top_operational_signal_to_intent_groups) ? summary.top_operational_signal_to_intent_groups.slice(0, 5) : [];
  const topSaved = Array.isArray(summary.top_webhook_saved_to_intent_groups) ? summary.top_webhook_saved_to_intent_groups.slice(0, 5) : [];
  const topOperationalSaved = Array.isArray(summary.top_operational_webhook_saved_to_intent_groups) ? summary.top_operational_webhook_saved_to_intent_groups.slice(0, 5) : [];
  const topFill = Array.isArray(summary.top_intent_to_fill_measured_groups) ? summary.top_intent_to_fill_measured_groups.slice(0, 5) : [];
  return [
    "# BEST Self-Evolution Execution Stage Latency",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- entry_rows_n: ${summary.entry_rows_n != null ? summary.entry_rows_n : "N/A"}`,
    `- signal_to_intent_p95_ms: ${summary.signal_to_intent_p95_ms != null ? summary.signal_to_intent_p95_ms : "N/A"}`,
    `- webhook_saved_to_intent_p95_ms: ${summary.webhook_saved_to_intent_p95_ms != null ? summary.webhook_saved_to_intent_p95_ms : "N/A"}`,
    `- webhook_to_outcome_p95_ms: ${summary.webhook_to_outcome_p95_ms != null ? summary.webhook_to_outcome_p95_ms : "N/A"}`,
    `- intent_to_fill_measured_p95_ms: ${summary.intent_to_fill_measured_p95_ms != null ? summary.intent_to_fill_measured_p95_ms : "N/A"}`,
    `- intent_to_fill_fallback_p95_ms: ${summary.intent_to_fill_fallback_p95_ms != null ? summary.intent_to_fill_fallback_p95_ms : "N/A"}`,
    "",
    "## Top signal->intent",
    ...(topSignal.length ? topSignal.map((row) => `- ${row.key}: p95=${row.p95_ms} / rows=${row.rows_n}`) : ["- none"]),
    "",
    "## Top operational signal->intent",
    ...(topOperationalSignal.length ? topOperationalSignal.map((row) => `- ${row.key}: p95=${row.p95_ms} / rows=${row.rows_n}`) : ["- none"]),
    "",
    "## Top webhook(saved)->intent",
    ...(topSaved.length ? topSaved.map((row) => `- ${row.key}: p95=${row.p95_ms} / rows=${row.rows_n}`) : ["- none"]),
    "",
    "## Top operational webhook(saved)->intent",
    ...(topOperationalSaved.length ? topOperationalSaved.map((row) => `- ${row.key}: p95=${row.p95_ms} / rows=${row.rows_n}`) : ["- none"]),
    "",
    "## Top intent->fill(measured)",
    ...(topFill.length ? topFill.map((row) => `- ${row.key}: p95=${row.p95_ms} / rows=${row.rows_n}`) : ["- none"]),
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const executionModelDataset = readJsonRawSafe(INPUT_PATH, null);
  const summary = summarizeExecutionStageLatency(executionModelDataset);
  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    input_path: INPUT_PATH,
    summary,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_execution_stage_latency`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_stage_latency_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_stage_latency_latest.md");
  writeJson(jsonPath, payload);
  writeText(mdPath, renderMarkdown(payload));
  copyLatest(jsonPath, latestJson);
  copyLatest(mdPath, latestMd);
  console.log(JSON.stringify({ ok: true, latest_json: latestJson, latest_md: latestMd, status: summary.status }));
}

if (require.main === module) {
  try {
    main();
  } catch (err) {
    console.error("BEST_SELF_EVOLUTION_EXECUTION_STAGE_LATENCY_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
