#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const { runFeatureLabelDatasetJob } = require("../src/services/mlOpsPipeline");

async function main() {
  const result = await runFeatureLabelDatasetJob();
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("BUILD_FEATURE_LABEL_DATASET_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = { main };
