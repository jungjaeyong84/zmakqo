"use strict";

const assert = require("assert");
const audit = require("../../scripts/report-openclaw-executor-drop-audit");

function run() {
  assert.strictEqual(audit.classifyReason("MIN_ORDER_EXCEEDS_BUDGET"), "ENTRY_BUDGET_GUARD");
  assert.strictEqual(audit.classifyReason("OPENCLAW_EXECUTOR_ALPHA_CONTEXT_BLOCK"), "ALPHA_CONTEXT");
  assert.strictEqual(audit.classifyReason("OPENCLAW_EXECUTOR_ALLOCATOR_QUARANTINE"), "ALLOCATOR");
  assert.strictEqual(audit.classifyReason("OPENCLAW_EXECUTOR_CORRELATED_EXPOSURE_BLOCK"), "CORRELATED_EXPOSURE_BLOCK");

  assert.strictEqual(
    audit.classifyLiveIssue({ family: "ENTRY_BUDGET_GUARD", allocatorStale: false }),
    "LIVE_ENTRY_BUDGET_POLICY"
  );
  assert.strictEqual(
    audit.classifyLiveIssue({ family: "ALPHA_CONTEXT", allocatorStale: false }),
    "LIVE_ALPHA_CONTEXT_POLICY"
  );
  assert.strictEqual(
    audit.classifyLiveIssue({ family: "ALLOCATOR", allocatorStale: true }),
    "STALE_ALLOCATOR_AFFECTED"
  );

  console.log("REPORT_OPENCLAW_EXECUTOR_DROP_AUDIT_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("REPORT_OPENCLAW_EXECUTOR_DROP_AUDIT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
