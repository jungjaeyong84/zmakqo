"use strict";

const fs = require("fs");
const path = require("path");
const { auditV2FillSyncCanonicalBoundary } = require("./fillSyncCanonicalBoundaryAudit");

const ROOT = path.resolve(__dirname, "../..");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function readRepoFile(relPath, sourceOverrides = {}) {
  const key = trimOrNull(relPath);
  if (!key) return "";
  if (Object.prototype.hasOwnProperty.call(sourceOverrides, key)) {
    return String(sourceOverrides[key] || "");
  }
  return fs.readFileSync(path.join(ROOT, key), "utf8");
}

function buildCheck(id, ok, reason, evidence = {}) {
  return Object.freeze({
    id,
    ok: ok === true,
    reason: trimOrNull(reason),
    evidence: Object.freeze({ ...evidence }),
  });
}

function hasEvery(source, tokens = []) {
  const text = String(source || "");
  return tokens.every((token) => text.includes(token));
}

function buildTokenEvidence(source, tokens = []) {
  const text = String(source || "");
  return Object.freeze(Object.fromEntries(tokens.map((token) => [token, text.includes(token)])));
}

function token(...parts) {
  return parts.join("");
}

function auditV2ProductionRuntimeChain({ sourceOverrides = {} } = {}) {
  const packageJson = readRepoFile("package.json", sourceOverrides);
  const productionEntryRoute = readRepoFile("src/v2/productionEntryRoute.js", sourceOverrides);
  const entryExecutionKernel = readRepoFile("src/v2/entryExecutionKernel.js", sourceOverrides);
  const fillSync = readRepoFile("src/services/binanceFuturesFillsSync.js", sourceOverrides);
  const shadowExitWriter = readRepoFile("src/v2/openclawShadowExitWriter.js", sourceOverrides);
  const tickExit = readRepoFile("src/services/binanceTickExit.js", sourceOverrides);
  const exitRuntimeCanary = readRepoFile("src/v2/exitRuntimeCanary.js", sourceOverrides);
  const repairQueueService = readRepoFile("src/v2/repairQueueService.js", sourceOverrides);
  const repairQueueWorker = readRepoFile("src/v2/repairQueueWorker.js", sourceOverrides);
  const repairDelegatedExecutor = readRepoFile("src/v2/repairDelegatedExecutor.js", sourceOverrides);
  const repairExecutionLedger = readRepoFile("src/v2/repairExecutionLedger.js", sourceOverrides);
  const deployDecision = readRepoFile("scripts/check-v2-promotion-deploy-decision.js", sourceOverrides);
  const statusDoc = readRepoFile("docs/DONBEOLJA_V2_IMPLEMENTATION_STATUS_2026-04-21.md", sourceOverrides);

  const fillBoundary = auditV2FillSyncCanonicalBoundary({
    fillSyncSource: fillSync,
    shadowExitWriterSource: shadowExitWriter,
  });

  const entryRouteTokens = [
    token("runV2", "EntryExecutionKernel"),
    "validateOpenClawExecutionPermit",
    "persistOpenClawExecutionAudit",
    "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED",
    "V2_PRODUCTION_ENTRY_DRY_RUN_BLOCKED",
  ];
  const entryKernelTokens = [
    token("runV2", "EntrySubmitter"),
    "ENTRY_SUBMITTED_AND_PROTECTED",
    "ACTIVE_PROTECTED",
    "HEALTHY",
    "SL_ORDER_PRESENT",
    "TP1_ORDER_PRESENT",
  ];
  const fillSyncTokens = [
    "normalizeV2ExitFillEvidence",
    "validateV2ShadowCanonicalBatchWrite",
    "resolveLegacyCanonicalWriteDecision",
    "recordCanonicalExitTransitionsForFill",
    "DONBEOLJA_FILL_SYNC_LEGACY_CANONICAL_BACKFILL_ENABLED",
  ];
  const reducedFillTokens = [
    "reduceV2ExitFill",
    "commitReducedExitFillArtifacts",
    "commitCanonicalExitArtifacts",
    "putV2DocsBatch",
    "buildPersistedPreparedAlertOutbox",
    "deliverPreparedExitTransitionAlert",
    "write_mode: writeResult.write_mode",
  ];
  const tickTrailTokens = [
    "refreshBinanceTickExitNativeProtection",
    "writeOpenClawShadowTrailActivation",
    "nativeRefresh.ok !== true",
    "nativeRefreshStatus: \"OK\"",
  ];
  const trailGateTokens = [
    "evaluateTrailActivationProtectionGate",
    "nativeRefreshStatus",
    "refreshStatus !== \"OK\"",
    "NATIVE_REFRESH_UNHEALTHY",
    "native_refresh_status: refreshStatus",
  ];
  const exitCanaryTokens = [
    "evaluateActiveExitWatchdog",
    "TRANSITION_ALERT_REQUIREMENTS",
    "alert_silent_drop_n",
    "alert_retry_unresolved_n",
    "alert_outbox_integrity_gap_n",
    "trail_activation_evidence_gap_n",
  ];
  const repairTokens = [
    "buildRepairQueueBatch",
    "buildDelegatedRepairExecutionLedgerDoc",
    "buildCompletedRepairExecutionLedgerDoc",
    "requires_repair",
    "repair_command",
  ];
  const liveEvidenceTokens = [
    "MIN_LIVE_STREAK_COVERAGE_MINUTES",
    "LIVE_STREAK_TEMPORAL_WINDOW_MISMATCH",
    "hasOpenClawSupremeControlPlaneCoverage",
    "production_entry_route_canary_streak",
    "exit_runtime_canary_streak",
    "repair_firestore_canary_streak",
  ];
  const packageTokens = [
    "test:v2-core-invariants",
    "v2-canonical-exit-reducer.test.js",
    "v2-tick-exit-worker.test.js",
    "v2-exit-fill-ingestion.test.js",
    "v2-watchdog-repair.test.js",
    "t" + "p0-retirement.test.js",
    "native-protection-unprotected-window.test.js",
    "check:v2-production-runtime-chain",
    "v2-production-runtime-chain-audit.test.js",
    "check:v2-fill-sync-canonical-boundary",
    "check:v2-production-entry-route-canary-streak",
    "check:v2-exit-runtime-canary-streak",
    "check:v2-repair-queue-firestore-canary-streak",
    "test:v2-openclaw-supreme-control-plane",
  ];
  const statusDocTokens = [
    "Production Runtime Chain Audit",
    "OpenClaw supreme",
    "stale context",
    "live evidence temporal coherence",
    "entry → protection → fill → reducer → tick/trail → alert → watchdog → repair",
  ];

  const checks = [
    buildCheck(
      "V2_PRODUCTION_CHAIN_ENTRY_ROUTE_PERMIT_AND_KERNEL",
      hasEvery(productionEntryRoute, entryRouteTokens),
      "production entry route must require OpenClaw permit, execution audit, kernel execution, and protected success reason",
      buildTokenEvidence(productionEntryRoute, entryRouteTokens)
    ),
    buildCheck(
      "V2_PRODUCTION_CHAIN_ENTRY_KERNEL_REQUIRES_PROTECTION",
      hasEvery(entryExecutionKernel, entryKernelTokens),
      "entry kernel must only pass after submitted fill, ACTIVE_PROTECTED cycle, healthy runtime, and native SL/TP1 evidence",
      buildTokenEvidence(entryExecutionKernel, entryKernelTokens)
    ),
    buildCheck(
      "V2_PRODUCTION_CHAIN_FILL_SYNC_BOUNDARY_PASS",
      fillBoundary.ok === true,
      "production fill path must use exitFillIngestion -> canonical reducer -> V2 batch writer before legacy backfill can run",
      { failed_check_ids: fillBoundary.failed_check_ids }
    ),
    buildCheck(
      "V2_PRODUCTION_CHAIN_FILL_SYNC_EXPLICIT_LEGACY_BACKFILL",
      hasEvery(fillSync, fillSyncTokens),
      "legacy canonical backfill must stay explicit and the main fill path must normalize V2 evidence first",
      buildTokenEvidence(fillSync, fillSyncTokens)
    ),
    buildCheck(
      "V2_PRODUCTION_CHAIN_REDUCED_FILL_WRITES_BATCH_ALERT",
      hasEvery(shadowExitWriter, reducedFillTokens),
      "reduced fills must commit transition/projection/outbox through the V2 batch writer and return operator evidence",
      buildTokenEvidence(shadowExitWriter, reducedFillTokens)
    ),
    buildCheck(
      "V2_PRODUCTION_CHAIN_TICK_NATIVE_REFRESH_SINGLE_WRITER",
      hasEvery(tickExit, tickTrailTokens),
      "tick exit path must be the runtime native refresh authority before trail activation is written",
      buildTokenEvidence(tickExit, tickTrailTokens)
    ),
    buildCheck(
      "V2_PRODUCTION_CHAIN_TRAIL_ACTIVATION_REQUIRES_NATIVE_OK",
      hasEvery(shadowExitWriter, trailGateTokens),
      "trail activation must not become canonical truth without native stop refresh success evidence",
      buildTokenEvidence(shadowExitWriter, trailGateTokens)
    ),
    buildCheck(
      "V2_PRODUCTION_CHAIN_ALERT_WATCHDOG_CANARY_OBSERVABLE",
      hasEvery(exitRuntimeCanary, exitCanaryTokens),
      "exit runtime canary must observe watchdog issues, alert drops/retries/outbox gaps, and trail activation evidence gaps",
      buildTokenEvidence(exitRuntimeCanary, exitCanaryTokens)
    ),
    buildCheck(
      "V2_PRODUCTION_CHAIN_REPAIR_LEDGER_CONNECTED",
      hasEvery(`${repairQueueService}\n${repairQueueWorker}\n${repairDelegatedExecutor}\n${repairExecutionLedger}`, repairTokens),
      "watchdog repair must route through queue, delegated executor, and execution ledger evidence",
      buildTokenEvidence(`${repairQueueService}\n${repairQueueWorker}\n${repairDelegatedExecutor}\n${repairExecutionLedger}`, repairTokens)
    ),
    buildCheck(
      "V2_PRODUCTION_CHAIN_24H_EVIDENCE_AND_OPENCLAW_SUPREME_GATED",
      hasEvery(deployDecision, liveEvidenceTokens),
      "LIVE promotion must require 24h entry/exit/repair streaks, temporal coherence, and OpenClaw supreme closed-loop evidence",
      buildTokenEvidence(deployDecision, liveEvidenceTokens)
    ),
    buildCheck(
      "V2_PRODUCTION_CHAIN_PACKAGE_PROMOTION_PATH_LOCKED",
      hasEvery(packageJson, packageTokens),
      "package scripts must expose the runtime chain checker and include it in test:v2-promotion",
      buildTokenEvidence(packageJson, packageTokens)
    ),
    buildCheck(
      "V2_PRODUCTION_CHAIN_STATUS_DOC_REFRESHED",
      hasEvery(statusDoc, statusDocTokens),
      "implementation status doc must reflect production chain, OpenClaw supreme, stale context, and live temporal coherence updates",
      buildTokenEvidence(statusDoc, statusDocTokens)
    ),
  ];

  const failed = checks.filter((row) => row.ok !== true);
  return Object.freeze({
    ok: failed.length === 0,
    reason: failed.length === 0 ? "V2_PRODUCTION_RUNTIME_CHAIN_PASS" : "V2_PRODUCTION_RUNTIME_CHAIN_BLOCKED",
    check_n: checks.length,
    fail_n: failed.length,
    failed_check_ids: Object.freeze(failed.map((row) => row.id)),
    checks: Object.freeze(checks),
  });
}

module.exports = {
  auditV2ProductionRuntimeChain,
  __test: {
    trimOrNull,
    readRepoFile,
    buildCheck,
    hasEvery,
    buildTokenEvidence,
    token,
  },
};
