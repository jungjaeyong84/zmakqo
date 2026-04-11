#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const { runMlOpsPipelineJob } = require("../src/services/mlOpsPipeline");

async function main() {
  const result = await runMlOpsPipelineJob();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("RUN_ML_OPS_PIPELINE_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = { main };
