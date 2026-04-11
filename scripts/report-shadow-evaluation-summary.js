#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const { runShadowEvaluationSummaryJob } = require("../src/services/mlOpsPipeline");

async function main() {
  const result = await runShadowEvaluationSummaryJob();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("REPORT_SHADOW_EVALUATION_SUMMARY_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = { main };
