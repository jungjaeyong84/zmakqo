"use strict";

const fs = require("fs");
const path = require("path");
const { buildV2ProductionCutoverGuard } = require("./productionCutoverGuard");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function buildCheck(id, ok, reason, evidence = {}) {
  return Object.freeze({
    id,
    ok: ok === true,
    reason: trimOrNull(reason),
    evidence: Object.freeze({ ...evidence }),
  });
}

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(path.resolve(filePath), "utf8");
  } catch (_error) {
    return "";
  }
}

function appearsBefore(source, earlier, later) {
  const earlierIndex = String(source || "").indexOf(String(earlier || ""));
  const laterIndex = String(source || "").indexOf(String(later || ""));
  return earlierIndex >= 0 && laterIndex >= 0 && earlierIndex < laterIndex;
}

function auditV2ProductionCutoverContract({
  routeSource = "",
  openclawCronRouteSource = "",
  guardSource = "",
  productionEntryRouteSource = "",
  productionEntryRouteCanarySource = "",
  productionEntryLiveEndpointSource = "",
  productionEntryLiveTransportsSource = "",
  productionEntryLiveRequestSource = "",
  productionEntryRouteCanaryScriptSource = "",
  entryBoundaryAuditSource = "",
} = {}) {
  const forbiddenEntryBypassSymbols = [
    "runV2Entry" + "ExecutionKernel",
    "runV2Entry" + "Submitter",
    "runV2Entry" + "ProtectionActivation",
  ];
  const openclawCronBypassesProductionRoute = forbiddenEntryBypassSymbols.some((symbol) => openclawCronRouteSource.includes(symbol));
  const canaryScriptBypassesProductionRoute = forbiddenEntryBypassSymbols.some((symbol) => productionEntryRouteCanaryScriptSource.includes(symbol));
  const liveEndpointBypassesProductionRoute = forbiddenEntryBypassSymbols.some((symbol) => productionEntryLiveEndpointSource.includes(symbol));
  const checks = [
    buildCheck(
      "V2_CUTOVER_GUARD_MODULE_EXISTS",
      guardSource.includes("buildV2ProductionCutoverGuard") && guardSource.includes("V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED"),
      "production cutover guard module must expose legacy webhook block reason"
    ),
    buildCheck(
      "V2_WEBHOOK_SIGNAL_ROUTE_IMPORTS_CUTOVER_GUARD",
      routeSource.includes("buildV2ProductionCutoverGuard"),
      "legacy webhook signal route must import V2 production cutover guard"
    ),
    buildCheck(
      "V2_WEBHOOK_SIGNAL_ROUTE_APPLIES_CUTOVER_GUARD",
      routeSource.includes("V2_CUTOVER_GUARD_BLOCK") && routeSource.includes("cutoverGuard.allowed"),
      "legacy webhook signal route must apply cutover guard before legacy execution"
    ),
    buildCheck(
      "V2_WEBHOOK_SIGNAL_ROUTE_RECORDS_CUTOVER_OUTCOME",
      routeSource.includes("decision: \"DROP\"") && routeSource.includes("reason: cutoverGuard.reason"),
      "cutover block must be recorded through the normal webhook outcome path"
    ),
    buildCheck(
      "V2_PRODUCTION_ENTRY_ROUTE_MODULE_EXISTS",
      productionEntryRouteSource.includes("runV2ProductionEntryRoute") && productionEntryRouteSource.includes("V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED"),
      "production entry route module must expose the single V2 entry route success contract"
    ),
    buildCheck(
      "V2_PRODUCTION_ENTRY_ROUTE_CALLS_EXECUTION_KERNEL",
      productionEntryRouteSource.includes("runV2Entry" + "ExecutionKernel") && productionEntryRouteSource.includes("runEntryKernel"),
      "production entry route must call the entry execution kernel instead of submitter/protection directly"
    ),
    buildCheck(
      "V2_PRODUCTION_ENTRY_ROUTE_BLOCKS_DRY_RUN_AND_DISABLED",
      productionEntryRouteSource.includes("V2_PRODUCTION_ENTRY_DISABLED") && productionEntryRouteSource.includes("V2_PRODUCTION_ENTRY_DRY_RUN_BLOCKED"),
      "production entry route must block when V2 is disabled or dry-run is active"
    ),
    buildCheck(
      "V2_PRODUCTION_ENTRY_ROUTE_AUDITS_OPENCLAW_SEPARATION",
      productionEntryRouteSource.includes("evaluateOpenClawExecutionSeparation") && productionEntryRouteSource.includes("V2_PRODUCTION_ENTRY_OPENCLAW_EXECUTION_SEPARATION_BLOCKED"),
      "production entry route must compare kernel executed entry against OpenClaw/router lineage"
    ),
    buildCheck(
      "V2_PRODUCTION_ENTRY_ROUTE_PRESERVES_KERNEL_FAILURE_CAUSE",
      appearsBefore(productionEntryRouteSource, "if (!kernelResult || kernelResult.ok !== true)", "let auditLedgerResult = null;"),
      "production entry route must return kernel blocked before audit ledger writes can mask the root cause"
    ),
    buildCheck(
      "V2_PRODUCTION_ENTRY_ROUTE_CANARY_NO_EXCHANGE_WRITE",
      productionEntryRouteCanarySource.includes("runV2ProductionEntryRoute") && productionEntryRouteCanarySource.includes("NO_EXCHANGE_ROUTE_PROOF") && productionEntryRouteCanarySource.includes("exchange_write_performed: false"),
      "production entry route canary must prove route wiring without exchange writes"
    ),
    buildCheck(
      "V2_OPENCLAW_CRON_ROUTE_CANARY_ENDPOINT_EXISTS",
      openclawCronRouteSource.includes("/api/openclaw/cron/v2-production-entry-route-canary"),
      "OpenClaw cron route must expose a V2 production entry route canary endpoint"
    ),
    buildCheck(
      "V2_OPENCLAW_CRON_ROUTE_CANARY_REQUIRES_TOKEN",
      openclawCronRouteSource.includes('router.post("/api/openclaw/cron/v2-production-entry-route-canary", requireSchedulerToken'),
      "OpenClaw V2 entry route canary endpoint must require scheduler token auth"
    ),
    buildCheck(
      "V2_OPENCLAW_CRON_ROUTE_CANARY_USES_SCRIPT_BOUNDARY",
      openclawCronRouteSource.includes("run-v2-production-entry-route-canary") && openclawCronRouteSource.includes("main({ setProcessExitCode: false })"),
      "OpenClaw cron endpoint must call the canary script boundary instead of inlining entry execution"
    ),
    buildCheck(
      "V2_OPENCLAW_CRON_EXIT_RUNTIME_CANARY_ENDPOINT_EXISTS",
      openclawCronRouteSource.includes("/api/openclaw/cron/v2-exit-runtime-canary"),
      "OpenClaw cron route must expose a V2 exit runtime canary endpoint"
    ),
    buildCheck(
      "V2_OPENCLAW_CRON_EXIT_RUNTIME_CANARY_REQUIRES_TOKEN",
      openclawCronRouteSource.includes('router.post("/api/openclaw/cron/v2-exit-runtime-canary", requireSchedulerToken'),
      "OpenClaw V2 exit runtime canary endpoint must require scheduler token auth"
    ),
    buildCheck(
      "V2_OPENCLAW_CRON_EXIT_RUNTIME_CANARY_USES_SCRIPT_BOUNDARY",
      openclawCronRouteSource.includes("run-v2-exit-runtime-canary") && openclawCronRouteSource.includes("v2_exit_runtime_canary"),
      "OpenClaw exit runtime canary endpoint must call the canary script boundary"
    ),
    buildCheck(
      "V2_OPENCLAW_CRON_ROUTE_CANARY_FORBIDS_ENTRY_BYPASS",
      !openclawCronBypassesProductionRoute,
      "OpenClaw cron endpoint must not call kernel, submitter, or protection activation directly"
    ),
    buildCheck(
      "V2_OPENCLAW_CRON_ROUTE_LIVE_ENDPOINT_EXISTS",
      openclawCronRouteSource.includes("/api/openclaw/cron/v2-production-entry-live"),
      "OpenClaw cron route must expose the fail-closed V2 production live entry endpoint"
    ),
    buildCheck(
      "V2_OPENCLAW_CRON_ROUTE_LIVE_REQUIRES_TOKEN",
      openclawCronRouteSource.includes('router.post("/api/openclaw/cron/v2-production-entry-live", requireSchedulerToken'),
      "OpenClaw V2 live entry endpoint must require scheduler token auth"
    ),
    buildCheck(
      "V2_OPENCLAW_CRON_ROUTE_LIVE_USES_ENDPOINT_BOUNDARY",
      openclawCronRouteSource.includes("runV2ProductionEntryLiveEndpoint") && !openclawCronBypassesProductionRoute,
      "OpenClaw live endpoint must call the live endpoint boundary instead of entry internals"
    ),
    buildCheck(
      "V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_FAILS_CLOSED",
      productionEntryLiveEndpointSource.includes("DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED")
        && productionEntryLiveEndpointSource.includes("V2_PRODUCTION_ENTRY_LIVE_CONFIRM_REQUIRED")
        && productionEntryLiveEndpointSource.includes("V2_PRODUCTION_ENTRY_LIVE_CANARY_ONLY_BLOCKED")
        && productionEntryLiveEndpointSource.includes("V2_PRODUCTION_ENTRY_LIVE_DECISION_REQUIRED"),
      "V2 production live endpoint must be disabled by default and require explicit live confirmation/runtime checks"
    ),
    buildCheck(
      "V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_USES_PRODUCTION_ROUTE_ONLY",
      productionEntryLiveEndpointSource.includes("runV2ProductionEntryRoute") && !liveEndpointBypassesProductionRoute,
      "V2 production live endpoint must delegate only to productionEntryRoute"
    ),
    buildCheck(
      "V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_RESOLVES_TRANSPORTS_BEFORE_ROUTE",
      productionEntryLiveEndpointSource.includes("buildV2ProductionEntryLiveTransports")
        && productionEntryLiveEndpointSource.includes("V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_BLOCKED")
        && appearsBefore(productionEntryLiveEndpointSource, "buildLiveTransports", "runProductionEntryRoute"),
      "V2 production live endpoint must resolve sizing-backed live transports before route execution"
    ),
    buildCheck(
      "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_REQUIRE_APPROVED_SIZING",
      productionEntryLiveTransportsSource.includes("buildEntryQuantityResolverFromSizingDecision")
        && productionEntryLiveTransportsSource.includes("V2_PRODUCTION_ENTRY_LIVE_SIZING_DECISION_REQUIRED")
        && productionEntryLiveTransportsSource.includes("quantityResolver({ entryIntent })"),
      "V2 live transports must use an approved sizing decision matched to the routed entry intent"
    ),
    buildCheck(
      "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_REJECT_SIZING_CONFLICT",
      productionEntryLiveTransportsSource.includes("V2_PRODUCTION_ENTRY_LIVE_SIZING_DECISION_CONFLICT")
        && productionEntryLiveTransportsSource.includes("sizingDecisionsConflict")
        && productionEntryLiveTransportsSource.includes("bundleDecision || bodyDecision"),
      "V2 live transports must reject body/bundle sizing drift before exchange transport creation"
    ),
    buildCheck(
      "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_BLOCK_DRY_RUN_CFG",
      productionEntryLiveTransportsSource.includes("V2_PRODUCTION_ENTRY_LIVE_CFG_DRY_RUN_BLOCKED")
        && productionEntryLiveTransportsSource.includes("V2_PRODUCTION_ENTRY_LIVE_CFG_NOT_ENABLED"),
      "V2 live transports must reject live config that is disabled or dry-run"
    ),
    buildCheck(
      "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_DO_NOT_EXPOSE_SECRETS",
      productionEntryLiveTransportsSource.includes("api_key_present")
        && productionEntryLiveTransportsSource.includes("api_secret_present")
        && productionEntryLiveTransportsSource.includes("summarizeLiveCfg"),
      "V2 live transport summaries must expose secret presence only, never secret values"
    ),
    buildCheck(
      "V2_PRODUCTION_ENTRY_LIVE_REQUEST_BUILDER_EMBEDS_SIZING",
      productionEntryLiveRequestSource.includes("buildV2ProductionEntryLiveRequest")
        && productionEntryLiveRequestSource.includes("resolveEntryIntentFromOpenClaw")
        && productionEntryLiveRequestSource.includes("buildV2EntrySizingDecision")
        && productionEntryLiveRequestSource.includes("confirm = LIVE_CONFIRM_PHRASE")
        && productionEntryLiveRequestSource.includes("entrySizingDecision")
        && productionEntryLiveRequestSource.includes("V2_PRODUCTION_ENTRY_LIVE_SIZING_NOT_APPROVED"),
      "V2 live request builder must attach approved sizing evidence to the bundle before endpoint submission"
    ),
    buildCheck(
      "V2_PRODUCTION_ENTRY_ROUTE_CANARY_SCRIPT_FORBIDS_ENTRY_BYPASS",
      productionEntryRouteCanaryScriptSource.includes("runV2ProductionEntryRouteCanary") && !canaryScriptBypassesProductionRoute,
      "production entry route canary script must call canary runner only, not kernel/submission/protection internals"
    ),
    buildCheck(
      "V2_ENTRY_BOUNDARY_FORBIDS_KERNEL_BYPASS",
      entryBoundaryAuditSource.includes("V2_ENTRY_EXECUTION_KERNEL_DIRECT_CALL_FORBIDDEN") && entryBoundaryAuditSource.includes("src/v2/productionEntryRoute.js"),
      "entry boundary audit must forbid direct entry execution kernel calls outside productionEntryRoute"
    ),
    buildCheck(
      "V2_ENTRY_BOUNDARY_FORBIDS_TP0_CONTRACT",
      entryBoundaryAuditSource.includes("V2_TP0_EXIT_CONTRACT_FORBIDDEN")
        && entryBoundaryAuditSource.includes("TP0/P0 exit contract names")
        && entryBoundaryAuditSource.includes("EXIT_TP_P0"),
      "entry boundary audit must forbid TP0/P0 exit contract names in V2 production source"
    ),
  ];
  const failed = checks.filter((row) => row.ok !== true);
  return Object.freeze({
    ok: failed.length === 0,
    reason: failed.length === 0 ? "V2_PRODUCTION_CUTOVER_CONTRACT_PASS" : "V2_PRODUCTION_CUTOVER_CONTRACT_BLOCKED",
    check_n: checks.length,
    fail_n: failed.length,
    failed_check_ids: Object.freeze(failed.map((row) => row.id)),
    checks: Object.freeze(checks),
  });
}

function auditV2ProductionCutoverReadiness(env = process.env) {
  const guard = buildV2ProductionCutoverGuard(env);
  const checks = [
    buildCheck("V2_RUNTIME_ENABLED", guard.context.v2_enabled === true, "DONBEOLJA_V2_ENABLED must be 1"),
    buildCheck("V2_RUNTIME_NOT_DRY_RUN", guard.context.v2_dry_run === false, "DONBEOLJA_V2_DRY_RUN must be 0"),
    buildCheck("V2_RUNTIME_NOT_CANARY_ONLY", guard.context.v2_canary_only === false, "DONBEOLJA_V2_CANARY_ONLY must be 0"),
    buildCheck("V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED", trimOrNull(env.DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED) === "1", "DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED must be 1"),
    buildCheck("V2_PRODUCTION_CUTOVER_REQUIRED", guard.context.require_production_cutover === true, "DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER must be 1"),
    buildCheck("V2_LEGACY_WEBHOOK_BLOCK_ENABLED", guard.context.block_legacy_webhook_signal === true, "legacy webhook signal block must be enabled"),
    buildCheck("V2_LEGACY_WEBHOOK_NOT_ALLOWED", guard.context.allow_legacy_webhook_signal === false, "legacy webhook signal override must be off"),
    buildCheck("V2_CUTOVER_GUARD_WOULD_BLOCK_LEGACY", guard.allowed === false && guard.reason === "V2_LEGACY_WEBHOOK_SIGNAL_BLOCKED", "legacy webhook route must be blocked after full V2 cutover", { guard_reason: guard.reason }),
  ];
  const failed = checks.filter((row) => row.ok !== true);
  return Object.freeze({
    ok: failed.length === 0,
    reason: failed.length === 0 ? "V2_PRODUCTION_CUTOVER_READINESS_PASS" : "V2_PRODUCTION_CUTOVER_READINESS_BLOCKED",
    check_n: checks.length,
    fail_n: failed.length,
    failed_check_ids: Object.freeze(failed.map((row) => row.id)),
    guard,
    checks: Object.freeze(checks),
  });
}

function auditWorkspaceV2ProductionCutoverContract({ rootDir = path.resolve(__dirname, "../..") } = {}) {
  return auditV2ProductionCutoverContract({
    routeSource: readTextSafe(path.join(rootDir, "src", "routes", "webhook.routes.js")),
    openclawCronRouteSource: readTextSafe(path.join(rootDir, "src", "routes", "openclaw.cron.routes.js")),
    guardSource: readTextSafe(path.join(rootDir, "src", "v2", "productionCutoverGuard.js")),
    productionEntryRouteSource: readTextSafe(path.join(rootDir, "src", "v2", "productionEntryRoute.js")),
    productionEntryRouteCanarySource: readTextSafe(path.join(rootDir, "src", "v2", "productionEntryRouteCanary.js")),
    productionEntryLiveEndpointSource: readTextSafe(path.join(rootDir, "src", "v2", "productionEntryLiveEndpoint.js")),
    productionEntryLiveTransportsSource: readTextSafe(path.join(rootDir, "src", "v2", "productionEntryLiveTransports.js")),
    productionEntryLiveRequestSource: readTextSafe(path.join(rootDir, "src", "v2", "productionEntryLiveRequest.js")),
    productionEntryRouteCanaryScriptSource: readTextSafe(path.join(rootDir, "scripts", "run-v2-production-entry-route-canary.js")),
    entryBoundaryAuditSource: readTextSafe(path.join(rootDir, "src", "v2", "entryBoundaryAudit.js")),
  });
}

module.exports = {
  auditV2ProductionCutoverContract,
  auditV2ProductionCutoverReadiness,
  auditWorkspaceV2ProductionCutoverContract,
  __test: {
    trimOrNull,
    buildCheck,
    readTextSafe,
    appearsBefore,
  },
};
