#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { runRepairQueueFirestoreCanary } = require("../src/v2/repairQueueFirestoreCanary");

const OUTPUT_FILENAME = "v2-repair-queue-firestore-canary.json";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function appendJsonl(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.appendFileSync(filePath, `${JSON.stringify(payload)}\n`, "utf8");
}

function resolveArtifactDir(env = process.env) {
  return trimOrNull(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_DIR)
    || trimOrNull(env.DONBEOLJA_V2_REPAIR_CANARY_ARTIFACT_DIR)
    || path.join(process.cwd(), "artifacts", "v2-repair-canary");
}

function resolveOutputFilename(env = process.env) {
  return trimOrNull(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_FILE) || OUTPUT_FILENAME;
}

function resolveHistoryFile(env = process.env) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_HISTORY_FILE);
  if (explicit) return path.resolve(explicit);
  return path.resolve(resolveArtifactDir(env), "v2_repair_queue_firestore_canary_history.jsonl");
}

async function run(env = process.env, {
  db = null,
  recordedAt = null,
  runRepairQueueFirestoreCanaryFn = runRepairQueueFirestoreCanary,
} = {}) {
  const artifactDir = resolveArtifactDir(env);
  const outputFilename = resolveOutputFilename(env);
  ensureDir(artifactDir);
  const canary = await runRepairQueueFirestoreCanaryFn({
    db,
    env,
    recordedAt,
  });
  const output = Object.freeze({
    generated_at: trimOrNull(recordedAt) || canary.generated_at || new Date().toISOString(),
    artifact_dir: artifactDir,
    output_filename: outputFilename,
    ...canary,
  });
  writeJson(path.join(artifactDir, outputFilename), output);
  appendJsonl(resolveHistoryFile(env), output);
  return output;
}

async function main(env = process.env) {
  let output;
  try {
    output = await run(env);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_REPAIR_QUEUE_FIRESTORE_CANARY_THROWN",
      error: {
        message: error && error.message ? error.message : String(error),
      },
    }));
    process.exit(1);
  }
  const sink = output.ok === true ? console.log : console.error;
  sink(JSON.stringify(output));
  if (output.ok !== true) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("RUN_V2_REPAIR_QUEUE_FIRESTORE_CANARY_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    run,
    __test: {
      OUTPUT_FILENAME,
      trimOrNull,
      resolveArtifactDir,
      resolveOutputFilename,
      resolveHistoryFile,
      appendJsonl,
    },
  };
}
