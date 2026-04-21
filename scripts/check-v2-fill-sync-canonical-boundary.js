#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { auditV2FillSyncCanonicalBoundary } = require("../src/v2/fillSyncCanonicalBoundaryAudit");

const ROOT = path.resolve(__dirname, "..");

function readText(filePath) {
  return fs.readFileSync(path.resolve(filePath), "utf8");
}

function main() {
  const audit = auditV2FillSyncCanonicalBoundary({
    fillSyncSource: readText(path.join(ROOT, "src", "services", "binanceFuturesFillsSync.js")),
    shadowExitWriterSource: readText(path.join(ROOT, "src", "v2", "openclawShadowExitWriter.js")),
  });
  if (audit.ok !== true) {
    console.error(JSON.stringify(audit, null, 2));
    process.exitCode = 1;
    return;
  }
  console.log(JSON.stringify({
    ok: true,
    reason: audit.reason,
    check_n: audit.check_n,
  }, null, 2));
}

main();
