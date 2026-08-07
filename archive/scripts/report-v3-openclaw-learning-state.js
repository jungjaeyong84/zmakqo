#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const { buildV3OpenClawLearningState } = require("../src/v3/openclawLearningState");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY = path.join(REPO_ROOT, "ops", "daily");
const BOOTSTRAP_PATH = path.join(OPS_DAILY, "v3_paper_bootstrap_latest.json");
const PERFORMANCE_PATH = path.join(OPS_DAILY, "v3_paper_performance_latest.json");
const VALIDATION_PATH = path.join(OPS_DAILY, "v3_paper_validation_latest.json");
const OUTPUT_PATH = path.join(OPS_DAILY, "v3_openclaw_learning_state_latest.json");

function readJsonSafe(filePath, fallback = {}) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return fallback;
  }
}

async function main() {
  fs.mkdirSync(OPS_DAILY, { recursive: true });
  const bootstrap = readJsonSafe(BOOTSTRAP_PATH, {});
  const performance = readJsonSafe(PERFORMANCE_PATH, {});
  const validation = readJsonSafe(VALIDATION_PATH, {});
  const summary = buildV3OpenClawLearningState({
    bootstrap,
    performance,
    validation,
  });
  const payload = {
    generated_at: new Date().toISOString(),
    bootstrap_path: BOOTSTRAP_PATH,
    performance_path: PERFORMANCE_PATH,
    validation_path: VALIDATION_PATH,
    ...summary,
  };
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(payload, null, 2));
  console.log(JSON.stringify({
    ok: true,
    latest_json: OUTPUT_PATH,
    learning_scope: payload.learning_scope,
    status: payload.status,
    reason: payload.reason,
    shadow_ready: payload.shadow_ready,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("REPORT_V3_OPENCLAW_LEARNING_STATE_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
