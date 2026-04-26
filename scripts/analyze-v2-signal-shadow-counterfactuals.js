#!/usr/bin/env node
"use strict";

// F2 leave-one-out analysis CLI.
//
// Reads CLOSED records from `v2__signal_shadow_counterfactuals`,
// computes per-filter precision-proxy and counterfactual PnL drag,
// emits leave-one-out attribution and filter-combination summary,
// and writes the artifact to
// `ops/daily/v2_signal_shadow_counterfactual_analysis_latest.json`.
//
// This script is read-only against Firestore. It performs no live
// decisions and does not write to the counterfactual collection.

const fs = require("fs");
const path = require("path");

const analyzer = require("../src/v2/signalShadowCounterfactualAnalyzer");

const OUTPUT_DIR = path.join(__dirname, "..", "ops", "daily");
const OUTPUT_FILE = path.join(OUTPUT_DIR, "v2_signal_shadow_counterfactual_analysis_latest.json");

function ensureOutputDir() {
  try {
    fs.mkdirSync(OUTPUT_DIR, { recursive: true });
  } catch (error) {
    if (!error || error.code !== "EEXIST") throw error;
  }
}

function writeArtifact(report) {
  ensureOutputDir();
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(report, null, 2));
  return OUTPUT_FILE;
}

function emit(payload) {
  process.stdout.write(JSON.stringify(payload) + "\n");
}

async function tryLoadFirestore() {
  try {
    const { getFirestore } = require("../src/storage/firestore");
    return await getFirestore();
  } catch (error) {
    return null;
  }
}

async function main() {
  const argv = process.argv.slice(2);
  const dryRun = argv.includes("--dry-run") || argv.includes("--no-firestore");
  const generated_at_ms = Date.now();
  if (dryRun) {
    const report = analyzer.buildAnalyzerReport({ records: [], generated_at_ms });
    const file = writeArtifact(report);
    emit({
      ok: true,
      reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYSIS_DRY_RUN",
      output_file: file,
      sample_n: 0,
    });
    return;
  }
  const db = await tryLoadFirestore();
  if (!db) {
    const report = analyzer.buildAnalyzerReport({ records: [], generated_at_ms });
    const file = writeArtifact(report);
    emit({
      ok: false,
      reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYSIS_FIRESTORE_UNAVAILABLE",
      output_file: file,
      sample_n: 0,
    });
    process.exit(0);
  }
  let records;
  try {
    records = await analyzer.loadCounterfactualRecords({ db, batchLimit: 5000 });
  } catch (error) {
    emit({
      ok: false,
      reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYSIS_LOAD_FAILED",
      error_message: error && error.message ? String(error.message) : String(error),
    });
    process.exit(1);
  }
  const report = analyzer.buildAnalyzerReport({ records, generated_at_ms });
  const file = writeArtifact(report);
  emit({
    ok: true,
    reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYSIS_OK",
    output_file: file,
    sample_n: report.sample.total_record_n,
    closed_with_klines_n: report.sample.closed_with_klines_n,
  });
}

main().catch((error) => {
  emit({
    ok: false,
    reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYSIS_THROWN",
    error_message: error && error.message ? String(error.message) : String(error),
  });
  process.exit(1);
});
