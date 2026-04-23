"use strict";

const assert = require("assert");
const { buildV2ProductionCutoverGuard } = require("../v2/productionCutoverGuard");

function guard(env) {
  return buildV2ProductionCutoverGuard(env);
}

(function defaultRuntimeAllowsLegacyWebhook() {
  const result = guard({});
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, "V2_PRODUCTION_CUTOVER_GUARD_ALLOW");
  assert.strictEqual(result.context.v2_enabled, false);
  assert.strictEqual(result.context.v2_dry_run, true);
  assert.strictEqual(result.context.v2_canary_only, true);
})();

(function requiredCutoverWithoutV2Blocks() {
  const result = guard({
    DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER: "1",
  });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_CUTOVER_REQUIRED");
  assert.strictEqual(result.httpStatus, 409);
})();

(function requiredCutoverDryRunBlocks() {
  const result = guard({
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "1",
    DONBEOLJA_V2_CANARY_ONLY: "0",
    DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER: "1",
  });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_CUTOVER_DRY_RUN_BLOCKED");
})();

(function requiredCutoverCanaryOnlyBlocks() {
  const result = guard({
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_CANARY_ONLY: "1",
    DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER: "1",
  });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_CUTOVER_CANARY_ONLY_BLOCKED");
})();

(function fullV2CutoverBlocksLegacyWebhookByDefault() {
  const result = guard({
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_CANARY_ONLY: "0",
  });
  assert.strictEqual(result.allowed, false);
  assert.strictEqual(result.reason, "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED");
  assert.strictEqual(result.context.block_legacy_webhook_signal, true);
})();

(function fullV2CutoverOverrideAllowsLegacyWebhook() {
  const result = guard({
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_CANARY_ONLY: "0",
    DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL: "1",
  });
  assert.strictEqual(result.allowed, true);
  assert.strictEqual(result.reason, "V2_PRODUCTION_CUTOVER_GUARD_ALLOW");
  assert.strictEqual(result.context.allow_legacy_webhook_signal, true);
})();

console.log("V2_PRODUCTION_CUTOVER_GUARD_TEST_OK");
