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

function auditV2ProductionCutoverContract({
  routeSource = "",
  guardSource = "",
  productionEntryRouteSource = "",
  productionEntryRouteCanarySource = "",
  entryBoundaryAuditSource = "",
} = {}) {
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
      "V2_PRODUCTION_ENTRY_ROUTE_CANARY_NO_EXCHANGE_WRITE",
      productionEntryRouteCanarySource.includes("runV2ProductionEntryRoute") && productionEntryRouteCanarySource.includes("NO_EXCHANGE_ROUTE_PROOF") && productionEntryRouteCanarySource.includes("exchange_write_performed: false"),
      "production entry route canary must prove route wiring without exchange writes"
    ),
    buildCheck(
      "V2_ENTRY_BOUNDARY_FORBIDS_KERNEL_BYPASS",
      entryBoundaryAuditSource.includes("V2_ENTRY_EXECUTION_KERNEL_DIRECT_CALL_FORBIDDEN") && entryBoundaryAuditSource.includes("src/v2/productionEntryRoute.js"),
      "entry boundary audit must forbid direct entry execution kernel calls outside productionEntryRoute"
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
    guardSource: readTextSafe(path.join(rootDir, "src", "v2", "productionCutoverGuard.js")),
    productionEntryRouteSource: readTextSafe(path.join(rootDir, "src", "v2", "productionEntryRoute.js")),
    productionEntryRouteCanarySource: readTextSafe(path.join(rootDir, "src", "v2", "productionEntryRouteCanary.js")),
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
  },
};
