#!/usr/bin/env node
"use strict";

const { auditV2ProductionRuntimeChain } = require("../src/v2/productionRuntimeChainAudit");

function main() {
  const result = auditV2ProductionRuntimeChain();
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  if (result.ok !== true) process.exitCode = 1;
}

if (require.main === module) main();
