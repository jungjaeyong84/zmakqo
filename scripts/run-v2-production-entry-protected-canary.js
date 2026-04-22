#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
const { OPS_DAILY_DIR, writeJson } = require("./lib/automation-utils");
const { runV2ProductionEntryProtectedCanary } = require("../src/v2/productionEntryProtectedCanary");

function resolveOutputFile(env = process.env) {
  const explicit = String(env.DONBEOLJA_V2_PRODUCTION_ENTRY_PROTECTED_CANARY_FILE || "").trim();
  return explicit || path.join(OPS_DAILY_DIR, "v2_production_entry_protected_canary_latest.json");
}

function resolveHistoryFile(env = process.env) {
  const explicit = String(env.DONBEOLJA_V2_PRODUCTION_ENTRY_PROTECTED_CANARY_HISTORY_FILE || "").trim();
  return explicit || path.join(OPS_DAILY_DIR, "v2_production_entry_protected_canary_history.jsonl");
}

function appendJsonl(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

async function main({ env = process.env, setProcessExitCode = require.main === module } = {}) {
  const result = await runV2ProductionEntryProtectedCanary({ env });
  const outputFile = resolveOutputFile(env);
  const historyFile = resolveHistoryFile(env);
  const artifact = Object.freeze({
    ...result,
    output_file: outputFile,
    history_file: historyFile,
  });
  writeJson(outputFile, artifact);
  appendJsonl(historyFile, artifact);
  console.log(JSON.stringify({
    ok: artifact.ok,
    reason: artifact.reason,
    output_file: artifact.output_file,
    history_file: artifact.history_file,
    exchange_write_performed: artifact.exchange_write_performed,
    route_reason: artifact.route_result_summary && artifact.route_result_summary.reason,
    memory_firestore_batch_commit_n: artifact.memory_firestore_batch_commit_n,
  }));
  if (!artifact.ok && setProcessExitCode) process.exitCode = 1;
  return artifact;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
}

module.exports = {
  main,
  __test: {
    resolveOutputFile,
    resolveHistoryFile,
    appendJsonl,
  },
};
