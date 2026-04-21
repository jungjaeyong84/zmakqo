#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { runRepairQueueOperationalCanary } = require("../src/v2/repairQueueOperationalCanary");

const OUTPUT_FILENAME = "v2-repair-queue-operational-canary.json";

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

function resolveArtifactDir(env = process.env) {
  return trimOrNull(env.DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_ARTIFACT_DIR)
    || trimOrNull(env.DONBEOLJA_V2_REPAIR_CANARY_ARTIFACT_DIR)
    || path.join(process.cwd(), "artifacts", "v2-repair-canary");
}

function resolveOutputFilename(env = process.env) {
  return trimOrNull(env.DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_ARTIFACT_FILE) || OUTPUT_FILENAME;
}

async function run(env = process.env, {
  recordedAt = null,
  runRepairQueueOperationalCanaryFn = runRepairQueueOperationalCanary,
} = {}) {
  const artifactDir = resolveArtifactDir(env);
  const outputFilename = resolveOutputFilename(env);
  ensureDir(artifactDir);
  const canary = await runRepairQueueOperationalCanaryFn({
    env,
    recordedAt,
  });
  const output = Object.freeze({
    generated_at: trimOrNull(recordedAt) || canary.generated_at || new Date().toISOString(),
    artifact_dir: artifactDir,
    output_filename: outputFilename,
    reason: canary.ok === true
      ? "V2_REPAIR_QUEUE_OPERATIONAL_CANARY_HEALTHY"
      : "V2_REPAIR_QUEUE_OPERATIONAL_CANARY_FAILED",
    ...canary,
  });
  writeJson(path.join(artifactDir, outputFilename), output);
  return output;
}

async function main(env = process.env) {
  let output;
  try {
    output = await run(env);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_REPAIR_QUEUE_OPERATIONAL_CANARY_THROWN",
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
    console.error("RUN_V2_REPAIR_QUEUE_OPERATIONAL_CANARY_FAIL", error && error.stack ? error.stack : String(error));
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
    },
  };
}
