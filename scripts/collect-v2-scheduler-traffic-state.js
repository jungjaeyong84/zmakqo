#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { collectV2SchedulerTrafficState } = require("../src/v2/schedulerTrafficStateCollector");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function writeStateArtifact(env = process.env, state) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_FILE);
  const dir = trimOrNull(env.V2_PROMOTION_ARTIFACT_DIR) || trimOrNull(env.DONBEOLJA_V2_SCHEDULER_TRAFFIC_CUTOVER_ARTIFACT_DIR);
  const outputFile = explicit || (dir ? path.join(path.resolve(dir), "v2_scheduler_traffic_state_latest.json") : null);
  if (!outputFile) return null;
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify({
    ...state,
    artifact_file: outputFile,
    generated_at: new Date().toISOString(),
  }, null, 2), "utf8");
  return outputFile;
}

function runCollect(env = process.env) {
  return collectV2SchedulerTrafficState({ env });
}

async function main(env = process.env) {
  const state = runCollect(env);
  const outputFile = writeStateArtifact(env, state);
  const payload = {
    ok: true,
    reason: "V2_SCHEDULER_TRAFFIC_STATE_COLLECTED",
    scheduler_sot: state.scheduler_sot,
    project_id: state.project_id,
    region: state.region,
    cloud_run_service_n: Array.isArray(state.cloud_run_services) ? state.cloud_run_services.length : 0,
    openclaw_cron_job_n: Array.isArray(state.openclaw_cron_jobs) ? state.openclaw_cron_jobs.length : 0,
    openclaw_cloud_scheduler_job_n: Array.isArray(state.openclaw_cloud_scheduler_jobs) ? state.openclaw_cloud_scheduler_jobs.length : 0,
    legacy_scheduler_job_n: Array.isArray(state.legacy_scheduler_jobs) ? state.legacy_scheduler_jobs.length : 0,
    output_file: outputFile,
    state_json: outputFile ? null : JSON.stringify(state),
  };
  console.log(JSON.stringify(payload));
  return Object.freeze({ state, outputFile });
}

if (require.main === module) {
  main().catch((error) => {
    console.error("COLLECT_V2_SCHEDULER_TRAFFIC_STATE_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    runCollect,
    writeStateArtifact,
    __test: { trimOrNull },
  };
}
