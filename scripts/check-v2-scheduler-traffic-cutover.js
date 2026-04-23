#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { auditV2SchedulerTrafficCutoverReadiness } = require("../src/v2/schedulerTrafficCutoverAudit");
const { collectV2SchedulerTrafficState } = require("../src/v2/schedulerTrafficStateCollector");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function writeReadinessArtifact(env = process.env, report) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_SCHEDULER_TRAFFIC_CUTOVER_READINESS_FILE);
  const dir = trimOrNull(env.V2_PROMOTION_ARTIFACT_DIR) || trimOrNull(env.DONBEOLJA_V2_SCHEDULER_TRAFFIC_CUTOVER_ARTIFACT_DIR);
  const outputFile = explicit || (dir ? path.join(path.resolve(dir), "v2_scheduler_traffic_cutover_readiness_latest.json") : null);
  if (!outputFile) return null;
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify({
    ...report,
    artifact_file: outputFile,
    generated_at: new Date().toISOString(),
  }, null, 2), "utf8");
  return outputFile;
}

function buildAuditEnv(env = process.env, collectorOptions = {}) {
  if (trimOrNull(env.DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON)) return env;
  if (String(env.DONBEOLJA_V2_SCHEDULER_TRAFFIC_AUTO_COLLECT || "1") === "0") return env;
  const state = collectV2SchedulerTrafficState({
    ...collectorOptions,
    env,
  });
  return Object.freeze({
    ...env,
    DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON: JSON.stringify(state),
  });
}

function runCheck(env = process.env, collectorOptions = {}) {
  return auditV2SchedulerTrafficCutoverReadiness(buildAuditEnv(env, collectorOptions));
}

async function main(env = process.env) {
  const report = runCheck(env);
  const outputFile = writeReadinessArtifact(env, report);
  const payload = {
    ok: report.ok === true,
    reason: report.reason,
    scope: report.scope,
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
    console.error("CHECK_V2_SCHEDULER_TRAFFIC_CUTOVER_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    runCheck,
    writeReadinessArtifact,
    buildAuditEnv,
    __test: {
      trimOrNull,
    },
  };
}
