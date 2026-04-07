"use strict";

const assert = require("assert");
const {
  isPendingIntentExpired,
  resolveIntentStatusForView,
  resolveIntentStatusFamilyForView,
  isActivePendingIntent,
} = require("../utils/intentView");

(() => {
  const refMs = Date.parse("2026-03-14T07:00:00.000Z");
  const activePending = {
    status: "PENDING",
    expires_at_ms: refMs + 60_000,
  };
  const expiredPending = {
    status: "PENDING",
    expires_at_ms: refMs - 60_000,
  };
  const canceled = {
    status: "CANCELED",
    expires_at_ms: refMs - 60_000,
  };
  const failedInternal = {
    status: "FAILED_INTERNAL",
  };

  assert.strictEqual(isPendingIntentExpired(activePending, refMs), false);
  assert.strictEqual(isPendingIntentExpired(expiredPending, refMs), true);
  assert.strictEqual(resolveIntentStatusForView(activePending, refMs), "PENDING");
  assert.strictEqual(resolveIntentStatusForView(expiredPending, refMs), "CANCELED");
  assert.strictEqual(resolveIntentStatusForView(canceled, refMs), "CANCELED");
  assert.strictEqual(resolveIntentStatusForView(failedInternal, refMs), "FAILED_INTERNAL");
  assert.strictEqual(resolveIntentStatusFamilyForView(failedInternal, refMs), "CANCELED");
  assert.strictEqual(isActivePendingIntent(activePending, refMs), true);
  assert.strictEqual(isActivePendingIntent(expiredPending, refMs), false);

  console.log("INTENT_VIEW_TEST_OK");
})();
