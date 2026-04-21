"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { main, __test } = require("../../scripts/run-v2-production-entry-route-canary");

async function writesArtifactAndKeepsExchangeWriteDisabled() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-prod-route-canary-"));
  const outputFile = path.join(dir, "canary.json");
  assert.strictEqual(__test.resolveOutputFile({ DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FILE: outputFile }), outputFile);
  const result = await main({
    env: {
      DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FILE: outputFile,
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.output_file, outputFile);
  assert.strictEqual(result.exchange_write_performed, false);
  assert.ok(fs.existsSync(outputFile));
  const artifact = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  assert.strictEqual(artifact.reason, "V2_PRODUCTION_ENTRY_ROUTE_CANARY_PASS");
  assert.strictEqual(artifact.route_result_summary.reason, "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED");
  assert.strictEqual(artifact.route_result_summary.audit_ledger_reason, "PRODUCTION_ENTRY_ROUTE_CANARY_LEDGER_WRITE_DISABLED");
}

writesArtifactAndKeepsExchangeWriteDisabled()
  .then(() => {
    console.log("RUN_V2_PRODUCTION_ENTRY_ROUTE_CANARY_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
