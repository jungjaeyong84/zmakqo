#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  nowKstMeta,
  readJsonRawSafe,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { buildExecutionBottleneckDelta } = require("../src/utils/executionBottleneckDelta");

const QUALITY_LATEST = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_quality_latest.json");
const STAGE_LATEST = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_stage_latency_latest.json");
const REGISTRY_LATEST = path.join(OPS_DAILY_DIR, "best_self_evolution_ml_experiment_registry_latest.json");

function listTimestamped(pattern) {
  const matcher = new RegExp(pattern);
  return fs.readdirSync(OPS_DAILY_DIR)
    .filter((name) => matcher.test(name))
    .sort();
}

function previousJson(pattern) {
  const files = listTimestamped(pattern);
  if (files.length < 2) return null;
  return path.join(OPS_DAILY_DIR, files[files.length - 2]);
}

function renderMarkdown(report = {}) {
  const summary = report.summary || {};
  return [
    "# BEST Self-Evolution Execution Bottleneck Delta",
    "",
    `- generated_at_kst: ${report.generated_at_kst || "N/A"}`,
    `- status: ${summary.status || "N/A"}`,
    `- comparable: ${summary.comparable ? "YES" : "NO"}`,
    `- same_experiment: ${summary.same_experiment ? "YES" : "NO"}`,
    `- current_top_operational_webhook_delay_cause: ${summary.current_top_operational_webhook_delay_cause || "N/A"}`,
    `- previous_top_operational_webhook_delay_cause: ${summary.previous_top_operational_webhook_delay_cause || "N/A"}`,
    `- current_top_operational_signal_to_intent_group: ${summary.current_top_operational_signal_to_intent_group || "N/A"}`,
    `- previous_top_operational_signal_to_intent_group: ${summary.previous_top_operational_signal_to_intent_group || "N/A"}`,
    `- signal_to_intent_p95_delta_ms: ${summary.signal_to_intent_p95_delta_ms != null ? summary.signal_to_intent_p95_delta_ms : "N/A"}`,
    `- webhook_saved_to_intent_p95_delta_ms: ${summary.webhook_saved_to_intent_p95_delta_ms != null ? summary.webhook_saved_to_intent_p95_delta_ms : "N/A"}`,
    `- created_to_fill_p95_delta_ms: ${summary.created_to_fill_p95_delta_ms != null ? summary.created_to_fill_p95_delta_ms : "N/A"}`,
    `- top_no_fill_reason: ${summary.top_no_fill_reason || "N/A"} / previous=${summary.previous_top_no_fill_reason || "N/A"}`,
    "",
  ].join("\n");
}

function main() {
  const nowMeta = nowKstMeta();
  const previousQualityPath = previousJson(/^20\d{2}-\d{2}-\d{2}_\d{4}_best_self_evolution_execution_quality\.json$/);
  const previousStagePath = previousJson(/^20\d{2}-\d{2}-\d{2}_\d{4}_best_self_evolution_execution_stage_latency\.json$/);
  const previousRegistryPath = previousJson(/^20\d{2}-\d{2}-\d{2}_\d{4}_best_self_evolution_ml_experiment_registry\.json$/);
  const summary = buildExecutionBottleneckDelta({
    currentExecutionQuality: readJsonRawSafe(QUALITY_LATEST, null),
    previousExecutionQuality: readJsonRawSafe(previousQualityPath, null),
    currentStageLatency: readJsonRawSafe(STAGE_LATEST, null),
    previousStageLatency: readJsonRawSafe(previousStagePath, null),
    currentExperimentRegistry: readJsonRawSafe(REGISTRY_LATEST, null),
    previousExperimentRegistry: readJsonRawSafe(previousRegistryPath, null),
  });
  const payload = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    inputs: {
      current_execution_quality: QUALITY_LATEST,
      previous_execution_quality: previousQualityPath,
      current_stage_latency: STAGE_LATEST,
      previous_stage_latency: previousStagePath,
      current_experiment_registry: REGISTRY_LATEST,
      previous_experiment_registry: previousRegistryPath,
    },
    summary,
  };
  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}_best_self_evolution_execution_bottleneck_delta`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}.md`);
  const latestJson = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_bottleneck_delta_latest.json");
  const latestMd = path.join(OPS_DAILY_DIR, "best_self_evolution_execution_bottleneck_delta_latest.md");
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
    console.error("BEST_SELF_EVOLUTION_EXECUTION_BOTTLENECK_DELTA_FAILED", err && err.stack ? err.stack : err);
    process.exit(1);
  }
}
