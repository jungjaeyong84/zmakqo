"use strict";

const assert = require("assert");
const { auditV2EntryBoundaries } = require("../v2/entryBoundaryAudit");

(function allowedEntryFilesPassBoundaryAudit() {
  const audit = auditV2EntryBoundaries({
    rootDir: "/repo",
    files: [
      {
        path: "/repo/src/v2/binanceEntryOrderTransport.js",
        content: "const { placeFuturesMarketOrder } = require('../exchanges/binanceFuturesPrivate');",
      },
      {
        path: "/repo/src/v2/entrySubmitter.js",
        content: "const { runV2EntryProtectionActivation } = require('./entryProtectionRunner');",
      },
      {
        path: "/repo/src/v2/entryProtectionRunner.js",
        content: "async function runV2EntryProtectionActivation() {}",
      },
      {
        path: "/repo/src/v2/entryBoundaryAudit.js",
        content: "pattern: /\\brunV2EntryProtectionActivation\\b/",
      },
      {
        path: "/repo/src/v2/entryExecutionKernel.js",
        content: "const { runV2EntrySubmitter } = require('./entrySubmitter');",
      },
    ],
  });
  assert.strictEqual(audit.ok, true);
  assert.strictEqual(audit.violation_n, 0);
})();

(function rawMarketOrderOutsideAdapterFailsClosed() {
  const audit = auditV2EntryBoundaries({
    rootDir: "/repo",
    files: [
      {
        path: "/repo/src/v2/someFutureSubmitter.js",
        content: "async function x() { return placeFuturesMarketOrder({}); }",
      },
    ],
  });
  assert.strictEqual(audit.ok, false);
  assert.strictEqual(audit.violation_n, 1);
  assert.strictEqual(audit.violations[0].code, "V2_ENTRY_RAW_MARKET_ORDER_WRITER_FORBIDDEN");
})();

(function directProtectionRunnerOutsideSubmitterFailsClosed() {
  const audit = auditV2EntryBoundaries({
    rootDir: "/repo",
    files: [
      {
        path: "/repo/src/v2/schedulerEntryJob.js",
        content: "module.exports = () => runV2EntryProtectionActivation({});",
      },
    ],
  });
  assert.strictEqual(audit.ok, false);
  assert.strictEqual(audit.violation_n, 1);
  assert.strictEqual(audit.violations[0].code, "V2_ENTRY_PROTECTION_RUNNER_DIRECT_CALL_FORBIDDEN");
})();

(function directSubmitterOutsideExecutionKernelFailsClosed() {
  const audit = auditV2EntryBoundaries({
    rootDir: "/repo",
    files: [
      {
        path: "/repo/src/v2/schedulerEntryJob.js",
        content: "module.exports = () => runV2EntrySubmitter({});",
      },
    ],
  });
  assert.strictEqual(audit.ok, false);
  assert.strictEqual(audit.violation_n, 1);
  assert.strictEqual(audit.violations[0].code, "V2_ENTRY_SUBMITTER_DIRECT_CALL_FORBIDDEN");
})();

console.log("V2_ENTRY_BOUNDARY_AUDIT_TEST_OK");
