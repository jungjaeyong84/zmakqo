#!/usr/bin/env node
"use strict";

const {
  auditWorkspaceV2ProductionRuntimeConfigContract,
} = require("../src/v2/productionRuntimeConfigAudit");

function main() {
  const contract = auditWorkspaceV2ProductionRuntimeConfigContract();
  const payload = {
    ok: contract.ok === true,
    reason: contract.ok === true
      ? "V2_PRODUCTION_RUNTIME_CONFIG_CHECK_PASS"
      : "V2_PRODUCTION_RUNTIME_CONFIG_CHECK_BLOCKED",
    contract,
  };
  if (payload.ok !== true) {
    console.error(JSON.stringify(payload, null, 2));
    process.exitCode = 1;
    return payload;
  }
  console.log(JSON.stringify(payload, null, 2));
  return payload;
}

if (require.main === module) {
  main();
} else {
  module.exports = { main };
}
