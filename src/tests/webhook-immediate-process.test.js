"use strict";

const assert = require("assert");
const { __test } = require("../routes/webhook.routes");

(() => {
  const allowedShadow = __test.shouldTriggerImmediateWebhookProcess({
    enabled: true,
    savedSignalId: "SIG__1",
    authoritative: false,
    source: "PINE_SHADOW",
  });
  assert.deepStrictEqual(allowedShadow, { ok: true, reason: "ALLOW_PINE_SHADOW_IMMEDIATE" });

  const disabled = __test.shouldTriggerImmediateWebhookProcess({
    enabled: false,
    savedSignalId: "SIG__1",
    authoritative: false,
    source: "PINE_SHADOW",
  });
  assert.deepStrictEqual(disabled, { ok: false, reason: "IMMEDIATE_DISABLED" });

  const missingSignal = __test.shouldTriggerImmediateWebhookProcess({
    enabled: true,
    savedSignalId: null,
    authoritative: false,
    source: "PINE_SHADOW",
  });
  assert.deepStrictEqual(missingSignal, { ok: false, reason: "IMMEDIATE_MISSING_SIGNAL_ID" });

  console.log("WEBHOOK_IMMEDIATE_PROCESS_TEST_OK");
})();
