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
  assert.ok(result.check_n >= 20);
  assert.ok(result.checks.some((row) => row.id === "V2_PRODUCTION_ENTRY_ROUTE_CALLS_EXECUTION_KERNEL"));
  assert.ok(result.checks.some((row) => row.id === "V2_PRODUCTION_ENTRY_ROUTE_PRESERVES_KERNEL_FAILURE_CAUSE"));
  assert.ok(result.checks.some((row) => row.id === "V2_PRODUCTION_ENTRY_ROUTE_CANARY_NO_EXCHANGE_WRITE"));
  assert.ok(result.checks.some((row) => row.id === "V2_OPENCLAW_CRON_ROUTE_CANARY_ENDPOINT_EXISTS"));
  assert.ok(result.checks.some((row) => row.id === "V2_OPENCLAW_CRON_ROUTE_CANARY_FORBIDS_ENTRY_BYPASS"));
  assert.ok(result.checks.some((row) => row.id === "V2_OPENCLAW_CRON_ROUTE_LIVE_ENDPOINT_EXISTS"));
  assert.ok(result.checks.some((row) => row.id === "V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_FAILS_CLOSED"));
  assert.ok(result.checks.some((row) => row.id === "V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_USES_PRODUCTION_ROUTE_ONLY"));
  assert.ok(result.checks.some((row) => row.id === "V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_RESOLVES_TRANSPORTS_BEFORE_ROUTE"));
  assert.ok(result.checks.some((row) => row.id === "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_REQUIRE_APPROVED_SIZING"));
  assert.ok(result.checks.some((row) => row.id === "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_BLOCK_DRY_RUN_CFG"));
  assert.ok(result.checks.some((row) => row.id === "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_DO_NOT_EXPOSE_SECRETS"));
  assert.ok(result.checks.some((row) => row.id === "V2_PRODUCTION_ENTRY_ROUTE_CANARY_SCRIPT_FORBIDS_ENTRY_BYPASS"));
  assert.ok(result.checks.some((row) => row.id === "V2_ENTRY_BOUNDARY_FORBIDS_KERNEL_BYPASS"));
})();

(function openclawCronBypassFailsClosed() {
  const result = require("../v2/productionCutoverAudit").auditV2ProductionCutoverContract({
    routeSource: "buildV2ProductionCutoverGuard V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED V2_CUTOVER_GUARD_BLOCK cutoverGuard.allowed decision: \"DROP\" reason: cutoverGuard.reason",
    guardSource: "buildV2ProductionCutoverGuard V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED",
    productionEntryRouteSource: "runV2ProductionEntryRoute V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED runV2EntryExecutionKernel runEntryKernel V2_PRODUCTION_ENTRY_DISABLED V2_PRODUCTION_ENTRY_DRY_RUN_BLOCKED evaluateOpenClawExecutionSeparation V2_PRODUCTION_ENTRY_OPENCLAW_EXECUTION_SEPARATION_BLOCKED if (!kernelResult || kernelResult.ok !== true) let auditLedgerResult = null;",
    productionEntryRouteCanarySource: "runV2ProductionEntryRoute NO_EXCHANGE_ROUTE_PROOF exchange_write_performed: false",
    productionEntryLiveEndpointSource: "DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED V2_PRODUCTION_ENTRY_LIVE_CONFIRM_REQUIRED V2_PRODUCTION_ENTRY_LIVE_CANARY_ONLY_BLOCKED V2_PRODUCTION_ENTRY_LIVE_DECISION_REQUIRED runV2ProductionEntryRoute buildLiveTransports buildV2ProductionEntryLiveTransports V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_BLOCKED runProductionEntryRoute",
    productionEntryLiveTransportsSource: "buildEntryQuantityResolverFromSizingDecision V2_PRODUCTION_ENTRY_LIVE_SIZING_DECISION_REQUIRED quantityResolver({ entryIntent }) V2_PRODUCTION_ENTRY_LIVE_CFG_DRY_RUN_BLOCKED V2_PRODUCTION_ENTRY_LIVE_CFG_NOT_ENABLED api_key_present api_secret_present summarizeLiveCfg",
    openclawCronRouteSource: 'router.post("/api/openclaw/cron/v2-production-entry-route-canary", requireSchedulerToken, async () => runV2EntryExecutionKernel({})) router.post("/api/openclaw/cron/v2-production-entry-live", requireSchedulerToken, async () => runV2ProductionEntryLiveEndpoint({}))',
    productionEntryRouteCanaryScriptSource: "runV2ProductionEntryRouteCanary",
    entryBoundaryAuditSource: "V2_ENTRY_EXECUTION_KERNEL_DIRECT_CALL_FORBIDDEN src/v2/productionEntryRoute.js",
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.failed_check_ids.includes("V2_OPENCLAW_CRON_ROUTE_CANARY_USES_SCRIPT_BOUNDARY"));
  assert.ok(result.failed_check_ids.includes("V2_OPENCLAW_CRON_ROUTE_CANARY_FORBIDS_ENTRY_BYPASS"));
})();

(function liveEndpointMissingFailClosedContractFailsClosed() {
  const result = require("../v2/productionCutoverAudit").auditV2ProductionCutoverContract({
    routeSource: "buildV2ProductionCutoverGuard V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED V2_CUTOVER_GUARD_BLOCK cutoverGuard.allowed decision: \"DROP\" reason: cutoverGuard.reason",
    guardSource: "buildV2ProductionCutoverGuard V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED",
    productionEntryRouteSource: "runV2ProductionEntryRoute V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED runV2EntryExecutionKernel runEntryKernel V2_PRODUCTION_ENTRY_DISABLED V2_PRODUCTION_ENTRY_DRY_RUN_BLOCKED evaluateOpenClawExecutionSeparation V2_PRODUCTION_ENTRY_OPENCLAW_EXECUTION_SEPARATION_BLOCKED if (!kernelResult || kernelResult.ok !== true) let auditLedgerResult = null;",
    productionEntryRouteCanarySource: "runV2ProductionEntryRoute NO_EXCHANGE_ROUTE_PROOF exchange_write_performed: false",
    productionEntryLiveEndpointSource: "runV2ProductionEntryRoute",
    productionEntryLiveTransportsSource: "buildEntryQuantityResolverFromSizingDecision V2_PRODUCTION_ENTRY_LIVE_SIZING_DECISION_REQUIRED quantityResolver({ entryIntent }) V2_PRODUCTION_ENTRY_LIVE_CFG_DRY_RUN_BLOCKED V2_PRODUCTION_ENTRY_LIVE_CFG_NOT_ENABLED api_key_present api_secret_present summarizeLiveCfg",
    openclawCronRouteSource: 'router.post("/api/openclaw/cron/v2-production-entry-route-canary", requireSchedulerToken, async () => { const { main } = require("../../scripts/run-v2-production-entry-route-canary"); return main({ setProcessExitCode: false }); }) router.post("/api/openclaw/cron/v2-production-entry-live", requireSchedulerToken, async () => runV2ProductionEntryLiveEndpoint({}))',
    productionEntryRouteCanaryScriptSource: "runV2ProductionEntryRouteCanary",
    entryBoundaryAuditSource: "V2_ENTRY_EXECUTION_KERNEL_DIRECT_CALL_FORBIDDEN src/v2/productionEntryRoute.js",
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.failed_check_ids.includes("V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_FAILS_CLOSED"));
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
