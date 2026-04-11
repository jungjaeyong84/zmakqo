#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const { runSystemRuntimeGuardsJob } = require("../src/services/systemRuntimeGuardsJob");

async function main() {
  const exchange = String(process.argv[2] || process.env.SYSTEM_RUNTIME_GUARDS_EXCHANGE || "BINANCEFUT").trim().toUpperCase();
  const remediateOnBlock = String(process.env.SYSTEM_RUNTIME_GUARDS_REMEDIATE_ON_BLOCK || "1").trim() !== "0";
  const dryRun = String(process.env.SYSTEM_RUNTIME_GUARDS_DRY_RUN || "0").trim() === "1";
  const result = await runSystemRuntimeGuardsJob({
    exchange,
    remediateOnBlock,
    dryRun,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("RUN_SYSTEM_RUNTIME_GUARDS_FAILED", err && err.stack ? err.stack : err);
  process.exit(1);
});
