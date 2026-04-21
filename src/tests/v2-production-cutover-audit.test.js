"use strict";

const assert = require("assert");
const {
  auditWorkspaceV2ProductionCutoverContract,
  auditV2ProductionCutoverReadiness,
} = require("../v2/productionCutoverAudit");

(function workspaceContractPasses() {
  const result = auditWorkspaceV2ProductionCutoverContract();
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_PRODUCTION_CUTOVER_CONTRACT_PASS");
  assert.strictEqual(result.fail_n, 0);
  assert.ok(result.check_n >= 9);
  assert.ok(result.checks.some((row) => row.id === "V2_PRODUCTION_ENTRY_ROUTE_CALLS_EXECUTION_KERNEL"));
  assert.ok(result.checks.some((row) => row.id === "V2_PRODUCTION_ENTRY_ROUTE_CANARY_NO_EXCHANGE_WRITE"));
  assert.ok(result.checks.some((row) => row.id === "V2_ENTRY_BOUNDARY_FORBIDS_KERNEL_BYPASS"));
})();

(function fullCutoverReadinessPassesWhenLegacyWouldBeBlocked() {
  const result = auditV2ProductionCutoverReadiness({
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_CANARY_ONLY: "0",
    DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER: "1",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_PRODUCTION_CUTOVER_READINESS_PASS");
  assert.strictEqual(result.fail_n, 0);
  assert.strictEqual(result.guard.allowed, false);
  assert.strictEqual(result.guard.reason, "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED");
})();

(function missingCutoverEnvBlocksReadinessWithTraceableIds() {
  const result = auditV2ProductionCutoverReadiness({});
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_CUTOVER_READINESS_BLOCKED");
  assert.ok(result.failed_check_ids.includes("V2_RUNTIME_ENABLED"));
  assert.ok(result.failed_check_ids.includes("V2_RUNTIME_NOT_DRY_RUN"));
  assert.ok(result.failed_check_ids.includes("V2_RUNTIME_NOT_CANARY_ONLY"));
  assert.ok(result.failed_check_ids.includes("V2_PRODUCTION_CUTOVER_REQUIRED"));
  assert.ok(result.failed_check_ids.includes("V2_LEGACY_WEBHOOK_BLOCK_ENABLED"));
  assert.ok(result.failed_check_ids.includes("V2_CUTOVER_GUARD_WOULD_BLOCK_LEGACY"));
})();

console.log("V2_PRODUCTION_CUTOVER_AUDIT_TEST_OK");
