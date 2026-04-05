"use strict";

const assert = require("assert");
const { deriveExecutionEntryLabelScope } = require("../utils/executionEntryLabelScope");

(() => {
  const filled = deriveExecutionEntryLabelScope({ labels: { was_filled: true }, execution: {} });
  assert.strictEqual(filled.scope, "FILLED");
  assert.strictEqual(filled.learning_bucket, "FILLABLE");

  const policy = deriveExecutionEntryLabelScope({
    labels: { was_filled: false },
    execution: { no_fill_reason_family: "POLICY_OR_CAPACITY", no_fill_reason: "TOTAL_BUDGET_EXCEEDED" },
  });
  assert.strictEqual(policy.scope, "POLICY_BLOCKED");
  assert.strictEqual(policy.is_blocked_by_policy, true);

  const runtime = deriveExecutionEntryLabelScope({
    labels: { was_filled: false },
    execution: { no_fill_reason_family: "RUNTIME_ERROR", no_fill_subtype: "TIMING_IMMEDIATE_EXEC" },
  });
  assert.strictEqual(runtime.scope, "RUNTIME_EXCEPTION");
  assert.strictEqual(runtime.is_runtime_exception, true);

  const control = deriveExecutionEntryLabelScope({
    labels: { was_filled: false },
    execution: { no_fill_reason_family: "CONTROL_FLOW", no_fill_reason: "INTENT_EXPIRED" },
  });
  assert.strictEqual(control.scope, "CONTROL_FLOW");

  console.log("EXECUTION_ENTRY_LABEL_SCOPE_TEST_OK");
})();
