"use strict";

const assert = require("assert");
const {
  isIntentCanceledLikeStatus,
  resolveIntentStatusFamily,
  classifyIntentTerminalStatus,
} = require("../utils/intentStatus");

(() => {
  assert.strictEqual(isIntentCanceledLikeStatus("CANCELED"), true);
  assert.strictEqual(isIntentCanceledLikeStatus("FAILED_INTERNAL"), true);
  assert.strictEqual(isIntentCanceledLikeStatus("PENDING"), false);

  assert.strictEqual(resolveIntentStatusFamily("REJECTED_PROVIDER"), "CANCELED");
  assert.strictEqual(resolveIntentStatusFamily("TIMEOUT_PROVIDER"), "CANCELED");
  assert.strictEqual(resolveIntentStatusFamily("FILLED"), "FILLED");

  const timeout = classifyIntentTerminalStatus("CANCELED", {
    cancel_reason: "API_TIMEOUT",
    status_reason: "LIVE_FAILED",
  });
  assert.strictEqual(timeout.status, "TIMEOUT_PROVIDER");
  assert.strictEqual(timeout.statusFamily, "CANCELED");

  const rejected = classifyIntentTerminalStatus("CANCELED", {
    cancel_reason: "MARGIN_TYPE_SET_FAILED",
  });
  assert.strictEqual(rejected.status, "REJECTED_PROVIDER");

  const internal = classifyIntentTerminalStatus("CANCELED", {
    cancel_reason: "BINANCEFUT_KEYS_MISSING",
  });
  assert.strictEqual(internal.status, "FAILED_INTERNAL");

  const plainCanceled = classifyIntentTerminalStatus("CANCELED", {
    cancel_reason: "DROP_ACTION_FILTER",
  });
  assert.strictEqual(plainCanceled.status, "CANCELED");

  console.log("INTENT_STATUS_TEST_OK");
})();
