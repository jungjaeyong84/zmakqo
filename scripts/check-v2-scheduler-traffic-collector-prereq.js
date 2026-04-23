#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { runV2SchedulerTrafficCollectorPreflight } = require("../src/v2/schedulerTrafficCollectorPreflight");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function writePreflightArtifact(env = process.env, report) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_FILE);
  const dir = trimOrNull(env.V2_PROMOTION_ARTIFACT_DIR) || trimOrNull(env.DONBEOLJA_V2_SCHEDULER_TRAFFIC_CUTOVER_ARTIFACT_DIR);
  const outputFile = explicit || (dir ? path.join(path.resolve(dir), "v2_scheduler_traffic_collector_preflight_latest.json") : null);
  if (!outputFile) return null;
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify({
    ...report,
    artifact_file: outputFile,
    generated_at: new Date().toISOString(),
  }, null, 2), "utf8");
  return outputFile;
}

function runCheck(env = process.env, options = {}) {
  return runV2SchedulerTrafficCollectorPreflight({
    ...options,
    env,
  });
}

async function main(env = process.env) {
  const report = runCheck(env);
  const outputFile = writePreflightArtifact(env, report);
  const payload = {
    ok: report.ok === true,
    reason: report.reason,
    fail_n: report.fail_n,
    failed_check_ids: report.failed_check_ids,
    output_file: outputFile,
  };
  if (report.ok !== true) {
    console.error(JSON.stringify(payload));
    process.exit(1);
  }
  console.log(JSON.stringify(payload));
  return Object.freeze({ report, outputFile });
}

if (require.main === module) {
  main().catch((error) => {
    console.error("CHECK_V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    runCheck,
    writePreflightArtifact,
    __test: { trimOrNull },
  };
}
