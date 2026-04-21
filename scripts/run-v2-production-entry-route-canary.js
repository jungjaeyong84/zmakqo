#!/usr/bin/env node
"use strict";

const path = require("path");
const { OPS_DAILY_DIR, writeJson } = require("./lib/automation-utils");
const { runV2ProductionEntryRouteCanary } = require("../src/v2/productionEntryRouteCanary");

function resolveOutputFile(env = process.env) {
  const explicit = String(env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FILE || "").trim();
  return explicit || path.join(OPS_DAILY_DIR, "v2_production_entry_route_canary_latest.json");
}

async function main({ env = process.env, setProcessExitCode = require.main === module } = {}) {
  const result = await runV2ProductionEntryRouteCanary({ env });
  const outputFile = resolveOutputFile(env);
  const artifact = Object.freeze({
    ...result,
    output_file: outputFile,
  });
  writeJson(outputFile, artifact);
  // Keep stdout compact for Cloud Scheduler logs. Full evidence is in the artifact.
  console.log(JSON.stringify({
    ok: artifact.ok,
    reason: artifact.reason,
    output_file: artifact.output_file,
    exchange_write_performed: artifact.exchange_write_performed,
    route_reason: artifact.route_result_summary && artifact.route_result_summary.reason,
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
  },
};
