#!/usr/bin/env node
"use strict";

const path = require("path");
const fs = require("fs");
const { OPS_DAILY_DIR, writeJson } = require("./lib/automation-utils");
const { runExitRuntimeCanary } = require("../src/v2/exitRuntimeCanary");
const { persistExitRuntimeCanaryHistory } = require("../src/v2/exitRuntimeCanaryHistory");

function resolveOutputFile(env = process.env) {
  const explicit = String(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FILE || "").trim();
  return explicit || path.join(OPS_DAILY_DIR, "v2_exit_runtime_canary_latest.json");
}

function resolveHistoryFile(env = process.env) {
  const explicit = String(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_HISTORY_FILE || "").trim();
  return explicit || path.join(OPS_DAILY_DIR, "v2_exit_runtime_canary_history.jsonl");
}

function appendJsonl(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

function summarizeFirestoreHistoryResult(result) {
  return Object.freeze({
    ok: result && result.ok === true,
    skipped: result && result.skipped === true,
    reason: result && result.reason ? String(result.reason) : null,
    collectionName: result && result.persisted ? result.persisted.collectionName : null,
    docId: result && result.persisted ? result.persisted.docId : null,
  });
}

async function main({ env = process.env, db = null, setProcessExitCode = require.main === module } = {}) {
  const result = await runExitRuntimeCanary({ env, db });
  const outputFile = resolveOutputFile(env);
  const historyFile = resolveHistoryFile(env);
  const baseArtifact = Object.freeze({
    ...result,
    output_file: outputFile,
    history_file: historyFile,
  });
  let firestoreHistoryResult;
  try {
    firestoreHistoryResult = await persistExitRuntimeCanaryHistory({
      artifact: baseArtifact,
      db,
      env,
      recordedAt: baseArtifact.generated_at,
    });
  } catch (error) {
    firestoreHistoryResult = Object.freeze({
      ok: false,
      skipped: false,
      reason: "EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_FAILED",
      error: Object.freeze({ message: error && error.message ? error.message : String(error) }),
    });
  }
  const firestoreSummary = summarizeFirestoreHistoryResult(firestoreHistoryResult);
  const artifact = Object.freeze({
    ...baseArtifact,
    ok: baseArtifact.ok === true && firestoreSummary.ok === true,
    reason: baseArtifact.ok === true && firestoreSummary.ok !== true
      ? "V2_EXIT_RUNTIME_CANARY_FIRESTORE_HISTORY_BLOCKED"
      : baseArtifact.reason,
    firestore_history_result: firestoreSummary,
  });
  writeJson(outputFile, artifact);
  appendJsonl(historyFile, artifact);
  console.log(JSON.stringify({
    ok: artifact.ok,
    reason: artifact.reason,
    output_file: artifact.output_file,
    history_file: artifact.history_file,
    firestore_history_reason: firestoreSummary.reason,
    firestore_history_skipped: firestoreSummary.skipped,
    exchange_write_performed: artifact.exchange_write_performed,
    active_position_n: artifact.active_position_n,
    fail_n: artifact.fail_n,
    alert_silent_drop_n: artifact.alert_silent_drop_n,
    alert_retry_unresolved_n: artifact.alert_retry_unresolved_n,
    blockers: artifact.blockers,
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
    summarizeFirestoreHistoryResult,
  },
};
