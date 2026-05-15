#!/usr/bin/env node
"use strict";

const path = require("path");
const { execFileSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");

const STEPS = Object.freeze([
  "report-v3-paper-bootstrap.js",
  "report-v3-paper-performance.js",
  "report-v3-paper-validation.js",
  "report-v3-openclaw-learning-state.js",
]);

function runStep(scriptName) {
  const scriptPath = path.join(REPO_ROOT, "scripts", scriptName);
  const raw = execFileSync(process.execPath, [scriptPath], {
    cwd: REPO_ROOT,
    env: process.env,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  }).trim();
  return raw ? JSON.parse(raw) : { ok: true };
}

async function main() {
  const results = [];
  for (const step of STEPS) {
    results.push({
      step,
      result: runStep(step),
    });
  }
  console.log(JSON.stringify({
    ok: true,
    steps: results,
    latest_learning_state_json: results[results.length - 1] && results[results.length - 1].result
      ? results[results.length - 1].result.latest_json
      : null,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("RUN_V3_OPENCLAW_LEARNING_CYCLE_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
}
