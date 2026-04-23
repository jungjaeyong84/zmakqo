#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { evaluateFirestoreCostGuard, resolveFirestoreCostThresholds } = require("../src/v2/firestoreCostGuard");

const OUTPUT_FILENAME = "v2_firestore_cost_guard_latest.json";
const BILLING_METRIC_FILENAME = "v2_firestore_billing_metric_latest.json";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function readJsonIfExists(filePath) {
  const file = trimOrNull(filePath);
  if (!file || !fs.existsSync(path.resolve(file))) return null;
  return JSON.parse(fs.readFileSync(path.resolve(file), "utf8"));
}

function readJsonEnv(value) {
  const text = trimOrNull(value);
  if (!text) return null;
  return JSON.parse(text);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolveArtifactDir(env = process.env) {
  return trimOrNull(env.V2_PROMOTION_ARTIFACT_DIR) || path.resolve("tmp", "v2-promotion-artifacts");
}

function resolveOutputFile(env = process.env) {
  return trimOrNull(env.V2_FIRESTORE_COST_GUARD_OUTPUT_FILE) || path.resolve("ops", "daily", OUTPUT_FILENAME);
}

function loadInputs(env = process.env) {
  const artifactDir = resolveArtifactDir(env);
  const unifiedFile = trimOrNull(env.V2_FIRESTORE_COST_GUARD_UNIFIED_REPORT_FILE)
    || path.join(artifactDir, "unified-promotion-report.json");
  const artifactFiles = [
    trimOrNull(env.V2_FIRESTORE_COST_GUARD_REPAIR_STREAK_FILE) || path.resolve("ops", "daily", "v2_repair_queue_firestore_canary_streak_latest.json"),
    trimOrNull(env.V2_FIRESTORE_COST_GUARD_ENTRY_STREAK_FILE) || path.resolve("ops", "daily", "v2_production_entry_route_canary_streak_latest.json"),
    trimOrNull(env.V2_FIRESTORE_COST_GUARD_EXIT_STREAK_FILE) || path.resolve("ops", "daily", "v2_exit_runtime_canary_streak_latest.json"),
  ];
  const billingMetricFile = trimOrNull(env.V2_FIRESTORE_COST_GUARD_BILLING_METRIC_FILE)
    || path.resolve("ops", "daily", BILLING_METRIC_FILENAME);
  const billingMetric = readJsonEnv(env.V2_FIRESTORE_COST_GUARD_BILLING_METRIC_JSON)
    || readJsonIfExists(billingMetricFile);
  return Object.freeze({
    unifiedReport: readJsonIfExists(unifiedFile),
    artifacts: artifactFiles.map(readJsonIfExists).filter(Boolean),
    billingMetric,
    input_files: Object.freeze([unifiedFile, ...artifactFiles, billingMetricFile].filter(Boolean)),
  });
}

function main(env = process.env) {
  const inputs = loadInputs(env);
  const outputFile = path.resolve(resolveOutputFile(env));
  const payload = {
    ...evaluateFirestoreCostGuard({
      unifiedReport: inputs.unifiedReport,
      artifacts: inputs.artifacts,
      billingMetric: inputs.billingMetric,
      thresholds: resolveFirestoreCostThresholds(env),
    }),
    generated_at: new Date().toISOString(),
    output_file: outputFile,
    input_files: inputs.input_files,
  };
  ensureDir(path.dirname(outputFile));
  writeJson(outputFile, payload);
  const line = JSON.stringify({
    ok: payload.ok,
    reason: payload.reason,
    estimated_total_reads: payload.estimated_total_reads,
    collector_query_limit_total: payload.collector_query_limit_total,
    billing_metric_required: payload.billing_metric_required,
    billing_read_ops_total: payload.billing_read_ops_total,
    blockers: payload.blockers,
    output_file: outputFile,
  });
  if (payload.ok !== true && String(env.V2_FIRESTORE_COST_GUARD_SOFT || "0").trim() !== "1") {
    console.error(line);
    process.exit(1);
  }
  console.log(line);
  return payload;
}

if (require.main === module) {
  try {
    main();
  } catch (error) {
    console.error(JSON.stringify({ ok: false, reason: "V2_FIRESTORE_COST_GUARD_THROWN", error: error && error.message ? error.message : String(error) }));
    process.exit(1);
  }
} else {
  module.exports = { main, loadInputs, __test: { resolveArtifactDir, resolveOutputFile, readJsonIfExists, readJsonEnv } };
}
