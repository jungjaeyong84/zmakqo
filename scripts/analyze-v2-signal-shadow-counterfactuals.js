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

const DEFAULT_OUTPUT_DIR = path.join(__dirname, "..", "ops", "daily");
const DEFAULT_OUTPUT_FILE = path.join(DEFAULT_OUTPUT_DIR, "v2_signal_shadow_counterfactual_analysis_latest.json");

function resolveOutputFile(env = process.env) {
  const explicit = String(
    (env && env.DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYSIS_FILE) || ""
  ).trim();
  return explicit || DEFAULT_OUTPUT_FILE;
}

function writeArtifact(report, outputFile = DEFAULT_OUTPUT_FILE) {
  const dir = path.dirname(outputFile);
  try {
    fs.mkdirSync(dir, { recursive: true });
  } catch (error) {
    if (!error || error.code !== "EEXIST") throw error;
  }
  fs.writeFileSync(outputFile, JSON.stringify(report, null, 2));
  return outputFile;
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

async function main({
  env = process.env,
  argv = process.argv.slice(2),
  db: providedDb = null,
  generated_at_ms = Date.now(),
  setProcessExitCode = require.main === module,
} = {}) {
  const dryRun = Array.isArray(argv) && (argv.includes("--dry-run") || argv.includes("--no-firestore"));
  const outputFile = resolveOutputFile(env);
  if (dryRun) {
    const report = analyzer.buildAnalyzerReport({ records: [], generated_at_ms });
    const file = writeArtifact(report, outputFile);
    const payload = {
      ok: true,
      reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYSIS_DRY_RUN",
      output_file: file,
      sample_n: 0,
    };
    emit(payload);
    return payload;
  }
  const db = providedDb || await tryLoadFirestore();
  if (!db) {
    const report = analyzer.buildAnalyzerReport({ records: [], generated_at_ms });
    const file = writeArtifact(report, outputFile);
    const payload = {
      ok: false,
      reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYSIS_FIRESTORE_UNAVAILABLE",
      output_file: file,
      sample_n: 0,
    };
    emit(payload);
    return payload;
  }
  let records;
  try {
    records = await analyzer.loadCounterfactualRecords({ db, batchLimit: 5000 });
  } catch (error) {
    const payload = {
      ok: false,
      reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYSIS_LOAD_FAILED",
      error_message: error && error.message ? String(error.message) : String(error),
    };
    emit(payload);
    if (setProcessExitCode) process.exitCode = 1;
    return payload;
  }
  const report = analyzer.buildAnalyzerReport({ records, generated_at_ms });
  const file = writeArtifact(report, outputFile);
  const payload = {
    ok: true,
    reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYSIS_OK",
    output_file: file,
    sample_n: report.sample.total_record_n,
    closed_with_klines_n: report.sample.closed_with_klines_n,
  };
  emit(payload);
  return payload;
}

if (require.main === module) {
  main().catch((error) => {
    emit({
      ok: false,
      reason: "V2_SIGNAL_SHADOW_COUNTERFACTUAL_ANALYSIS_THROWN",
      error_message: error && error.message ? String(error.message) : String(error),
    });
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  __test: {
    resolveOutputFile,
    writeArtifact,
  },
};
