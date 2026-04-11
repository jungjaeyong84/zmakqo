#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const { runShadowInferenceCanaryJob } = require("../src/services/mlOpsPipeline");

async function main() {
  const result = await runShadowInferenceCanaryJob({
    exchange: process.env.ML_OPS_PIPELINE_EXCHANGE || process.env.BEST_SELF_EVOLUTION_PROVIDER || null,
    force: String(process.env.BEST_SELF_EVOLUTION_ALLOW_LATEST_WRITE || "").trim() === "1",
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("report-shadow-inference-canary failed:", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}
