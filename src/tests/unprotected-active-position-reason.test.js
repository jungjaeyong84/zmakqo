"use strict";

// 2026-04-18 P1-2 (audit re-verified): `refreshBinanceNativeProtection`
// is cancel-first. When placement throws AFTER the cancel succeeded,
// the position on Binance is momentarily naked. We introduced the
// `UNPROTECTED_ACTIVE_POSITION` reason code to distinguish that case
// from a benign `NATIVE_PLACE_FAIL` (e.g. cancel-failed). These tests
// lock in the classification contract — getting either direction wrong
// silently degrades the alert routing or the retry loop.

const assert = require("assert");
const {
  isProviderRejectedReason,
  isInternalFailureReason,
} = require("../utils/intentStatus");
const { __test: paperTest } = require("../engine/paperBinanceRunner");

(function unprotectedActivePositionIsProviderRejected() {
  assert.strictEqual(isProviderRejectedReason("UNPROTECTED_ACTIVE_POSITION"), true,
    "UNPROTECTED_ACTIVE_POSITION must route through the provider-rejection path so operators see it");
  assert.strictEqual(isInternalFailureReason("UNPROTECTED_ACTIVE_POSITION"), false,
    "UNPROTECTED_ACTIVE_POSITION originates from exchange interaction, not internal logic — must not be classified as internal");
})();

(function unprotectedActivePositionIsRetryable() {
  assert.strictEqual(
    paperTest.isRetryableNativeProtectionReason("UNPROTECTED_ACTIVE_POSITION"),
    true,
    "UNPROTECTED_ACTIVE_POSITION is strictly more urgent than NATIVE_PLACE_FAIL — retry must be immediate");
  assert.strictEqual(
    paperTest.isRetryableNativeProtectionReason("NATIVE_PLACE_FAIL"),
    true,
    "NATIVE_PLACE_FAIL retry must remain intact (regression guard)");
  assert.strictEqual(
    paperTest.isRetryableNativeProtectionReason("NATIVE_PROTECTION_DISABLED"),
    false,
    "disabled mode is not retryable — guard against accidental loosening");
})();

console.log("UNPROTECTED_ACTIVE_POSITION_REASON_TEST_OK");
