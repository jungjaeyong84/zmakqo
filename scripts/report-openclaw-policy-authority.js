#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const { runOpenClawPolicyTuningReport } = require("../src/services/openclawPolicyTuning");

async function main() {
  const result = await runOpenClawPolicyTuningReport({
    exchange: process.env.ML_OPS_PIPELINE_EXCHANGE || process.env.BEST_SELF_EVOLUTION_PROVIDER || "BINANCEFUT",
  });
  console.log(JSON.stringify(result, null, 2));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("REPORT_OPENCLAW_POLICY_AUTHORITY_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = { main };
