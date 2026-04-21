#!/usr/bin/env node
"use strict";

const {
  auditWorkspaceV2ProductionCutoverContract,
  auditV2ProductionCutoverReadiness,
} = require("../src/v2/productionCutoverAudit");

function isEnabled(value) {
  return String(value || "0").trim() === "1";
}

function main(env = process.env) {
  const contract = auditWorkspaceV2ProductionCutoverContract();
  const readiness = isEnabled(env.DONBEOLJA_V2_PRODUCTION_CUTOVER_READINESS_CHECK)
    ? auditV2ProductionCutoverReadiness(env)
    : null;
  const ok = contract.ok === true && (!readiness || readiness.ok === true);
  const payload = {
    ok,
    reason: ok ? "V2_PRODUCTION_CUTOVER_CHECK_PASS" : "V2_PRODUCTION_CUTOVER_CHECK_BLOCKED",
    contract,
    readiness,
  };
  if (!ok) {
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
