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
      {
        path: "/repo/src/v2/productionEntryRoute.js",
        content: "const { runV2EntryExecutionKernel } = require('./entryExecutionKernel');",
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

(function directEntryKernelOutsideProductionRouteFailsClosed() {
  const audit = auditV2EntryBoundaries({
    rootDir: "/repo",
    files: [
      {
        path: "/repo/src/v2/schedulerEntryJob.js",
        content: "module.exports = () => runV2EntryExecutionKernel({});",
      },
    ],
  });
  assert.strictEqual(audit.ok, false);
  assert.strictEqual(audit.violation_n, 1);
  assert.strictEqual(audit.violations[0].code, "V2_ENTRY_EXECUTION_KERNEL_DIRECT_CALL_FORBIDDEN");
})();

(function tp0ContractNamesInV2SourceFailClosed() {
  const audit = auditV2EntryBoundaries({
    rootDir: "/repo",
    files: [
      {
        path: "/repo/src/v2/futureExitRuntime.js",
        content: "const event = 'EXIT_TP_P0_0_8P'; const stage = 'TP0';",
      },
    ],
  });
  assert.strictEqual(audit.ok, false);
  assert.strictEqual(audit.violation_n, 1);
  assert.strictEqual(audit.violations[0].code, "V2_TP0_EXIT_CONTRACT_FORBIDDEN");
})();

console.log("V2_ENTRY_BOUNDARY_AUDIT_TEST_OK");
