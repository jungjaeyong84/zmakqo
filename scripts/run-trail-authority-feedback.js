#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const { runTrailAuthorityFeedbackJob } = require("../src/services/trailAuthorityFeedback");

async function main() {
  const exchange = String(process.argv[2] || process.env.TRAIL_AUTHORITY_FEEDBACK_EXCHANGE || "BINANCEFUT").trim().toUpperCase();
  const lookbackHours = Math.max(1, Number(process.env.TRAIL_AUTHORITY_FEEDBACK_LOOKBACK_HOURS || 24));
  const fetchLimit = Math.max(100, Number(process.env.TRAIL_AUTHORITY_FEEDBACK_FETCH_LIMIT || 3000));
  const result = await runTrailAuthorityFeedbackJob({
    exchange,
    lookbackHours,
    fetchLimit,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((err) => {
  console.error("RUN_TRAIL_AUTHORITY_FEEDBACK_FAILED", err && err.stack ? err.stack : err);
  process.exit(1);
});
