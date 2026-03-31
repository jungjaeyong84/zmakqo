"use strict";

const assert = require("assert");
const {
  normalizePlanStatus,
  isPendingAuthorityPlanStatus,
  isAppliedConfirmedLike,
  isAppliedPendingSignalConfirmationLike,
  isAppliedPendingBundleActivationLike,
} = require("../utils/selfEvolutionPlanStatus");

(() => {
  assert.strictEqual(normalizePlanStatus("APPLIED_ACTIVE_AUTHORITY_BYPASS"), "APPLIED_ACTIVE_PENDING_AUTHORITY");
  assert.strictEqual(normalizePlanStatus("APPLIED_PENDING_BUNDLE_ACTIVATION_AUTHORITY_BYPASS"), "APPLIED_PENDING_BUNDLE_ACTIVATION_PENDING_AUTHORITY");
  assert.strictEqual(isPendingAuthorityPlanStatus("APPLIED_CONFIRMED_AUTHORITY_BYPASS"), true);
  assert.strictEqual(isAppliedConfirmedLike("APPLIED_ACTIVE_AUTHORITY_BYPASS"), true);
  assert.strictEqual(isAppliedPendingSignalConfirmationLike("APPLIED_PENDING_SIGNAL_CONFIRMATION_AUTHORITY_BYPASS"), true);
  assert.strictEqual(isAppliedPendingBundleActivationLike("APPLIED_PENDING_BUNDLE_ACTIVATION_PENDING_AUTHORITY"), true);
  console.log("SELF_EVOLUTION_PLAN_STATUS_TEST_OK");
})();
