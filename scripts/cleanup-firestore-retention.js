#!/usr/bin/env node
/* eslint-disable no-console */

const { cleanupRetention } = require("../src/services/retention.cleanup");

async function main() {
  const limit = Number(process.env.RETENTION_CLEANUP_LIMIT || 500);
  const dryRun = String(process.env.DRY_RUN || "0") === "1";
  const out = await cleanupRetention({ limitPerCollection: limit, dryRun });
  console.log(JSON.stringify(out, null, 2));
  if (!out.ok) process.exit(1);
}

main().catch((e) => {
  console.error("[RETENTION_CLEANUP_ERROR]", e && e.message ? e.message : String(e));
  process.exit(1);
});

