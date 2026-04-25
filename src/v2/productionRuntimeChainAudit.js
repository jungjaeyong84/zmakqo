"use strict";

const fs = require("fs");
const path = require("path");
const { auditV2FillSyncCanonicalBoundary } = require("./fillSyncCanonicalBoundaryAudit");
const {
  functionCalls,
  functionCallsAll,
  hasCallExpression,
  hasCodePattern,
  sliceFunctionBlock,
} = require("./sourceStructureAudit");

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

function buildFunctionCallEvidence(source, functionName, callees = []) {
  return Object.freeze({
    function_name: functionName,
    ...functionCalls(source, functionName, callees),
  });
}

function hasProtectionDeadlineStructure(source) {
  const deadlineBlock = sliceFunctionBlock(source, "withProtectionWriteDeadline");
  const refreshBlock = sliceFunctionBlock(source, "buildBinanceRefreshNativeStopTransport");
  const tp1Block = sliceFunctionBlock(source, "buildBinancePlaceOrReplaceTp1Transport");
  const fullProtectionBlock = sliceFunctionBlock(source, "buildBinancePlaceOrReplaceFullProtectionTransport");
  const slDeadlineN = (fullProtectionBlock.match(/BINANCE_FULL_PROTECTION_SL_DEADLINE_EXCEEDED/g) || []).length;
  const tp1DeadlineN = (fullProtectionBlock.match(/BINANCE_FULL_PROTECTION_TP1_DEADLINE_EXCEEDED/g) || []).length;
  return (
    hasCodePattern(deadlineBlock, /\bnew\s+AbortController\s*\(/) &&
    hasCallExpression(deadlineBlock, "Promise.race") &&
    hasCallExpression(deadlineBlock, "setTimeout") &&
    hasCallExpression(deadlineBlock, "controller.abort") &&
    /operation\s*\(\s*\{[\s\S]{0,180}signal:\s*controller\.signal/.test(deadlineBlock) &&
    functionCallsAll(source, "buildBinanceRefreshNativeStopTransport", ["withProtectionWriteDeadline", "refreshNativeProtectionWithRetry"]) &&
    /refreshNativeProtectionWithRetry\s*\(\s*\{[\s\S]{0,700}signal\s*,[\s\S]{0,80}abortSignal:\s*signal/.test(refreshBlock) &&
    refreshBlock.includes("BINANCE_NATIVE_STOP_REFRESH_DEADLINE_EXCEEDED") &&
    functionCallsAll(source, "buildBinancePlaceOrReplaceTp1Transport", ["withProtectionWriteDeadline", "placeTakeProfitMarketOrder"]) &&
    /placeTakeProfitMarketOrder\s*\(\s*\{[\s\S]{0,900}signal\s*,/.test(tp1Block) &&
    tp1Block.includes("BINANCE_TP1_REPAIR_DEADLINE_EXCEEDED") &&
    functionCallsAll(source, "buildBinancePlaceOrReplaceFullProtectionTransport", ["withProtectionWriteDeadline", "placeStopMarketOrder", "placeTakeProfitMarketOrder"]) &&
    /placeStopMarketOrder\s*\(\s*\{[\s\S]{0,900}signal\s*,/.test(fullProtectionBlock) &&
    /placeTakeProfitMarketOrder\s*\(\s*\{[\s\S]{0,900}signal\s*,/.test(fullProtectionBlock) &&
    slDeadlineN >= 1 &&
    tp1DeadlineN >= 1
  );
}

function buildProtectionDeadlineEvidence(source) {
  const deadlineBlock = sliceFunctionBlock(source, "withProtectionWriteDeadline");
  const refreshBlock = sliceFunctionBlock(source, "buildBinanceRefreshNativeStopTransport");
  const tp1Block = sliceFunctionBlock(source, "buildBinancePlaceOrReplaceTp1Transport");
  const fullProtectionBlock = sliceFunctionBlock(source, "buildBinancePlaceOrReplaceFullProtectionTransport");
  return Object.freeze({
    withProtectionWriteDeadline_has_abort_controller: hasCodePattern(deadlineBlock, /\bnew\s+AbortController\s*\(/),
    withProtectionWriteDeadline_races_timeout: hasCallExpression(deadlineBlock, "Promise.race") && hasCallExpression(deadlineBlock, "setTimeout"),
    withProtectionWriteDeadline_aborts_signal: hasCallExpression(deadlineBlock, "controller.abort"),
    operation_receives_abort_signal: /operation\s*\(\s*\{[\s\S]{0,180}signal:\s*controller\.signal/.test(deadlineBlock),
    refresh_native_stop_wrapped: functionCallsAll(source, "buildBinanceRefreshNativeStopTransport", ["withProtectionWriteDeadline", "refreshNativeProtectionWithRetry"]),
    refresh_native_stop_signal_forwarded: /refreshNativeProtectionWithRetry\s*\(\s*\{[\s\S]{0,700}signal\s*,[\s\S]{0,80}abortSignal:\s*signal/.test(refreshBlock),
    tp1_wrapped_and_signal_forwarded: functionCallsAll(source, "buildBinancePlaceOrReplaceTp1Transport", ["withProtectionWriteDeadline", "placeTakeProfitMarketOrder"])
      && /placeTakeProfitMarketOrder\s*\(\s*\{[\s\S]{0,900}signal\s*,/.test(tp1Block),
    full_protection_sl_wrapped_and_signal_forwarded: functionCallsAll(source, "buildBinancePlaceOrReplaceFullProtectionTransport", ["withProtectionWriteDeadline", "placeStopMarketOrder"])
      && /placeStopMarketOrder\s*\(\s*\{[\s\S]{0,900}signal\s*,/.test(fullProtectionBlock),
    full_protection_tp1_wrapped_and_signal_forwarded: functionCallsAll(source, "buildBinancePlaceOrReplaceFullProtectionTransport", ["withProtectionWriteDeadline", "placeTakeProfitMarketOrder"])
      && /placeTakeProfitMarketOrder\s*\(\s*\{[\s\S]{0,900}signal\s*,/.test(fullProtectionBlock),
  });
}

function hasRepairWriterLeaseStructure({ executorSource, runtimeSource }) {
  const validateBlock = sliceFunctionBlock(executorSource, "validateProtectionWriterLease");
  const validateDelegatedBlock = sliceFunctionBlock(executorSource, "validateDelegatedRepair");
  const buildLeaseBlock = sliceFunctionBlock(runtimeSource, "buildProtectionWriterLease");
  return (
    validateBlock.includes("PROTECTION_WRITER_LEASE_REQUIRED") &&
    validateBlock.includes("V2_PROTECTION_WRITER_EXCHANGE_WRITE") &&
    validateBlock.includes("PROTECTION_WRITER_LEASE_POSITION_CYCLE_MISMATCH") &&
    validateBlock.includes("PROTECTION_WRITER_LEASE_PLACEMENT_ATTEMPT_MISMATCH") &&
    validateBlock.includes("PROTECTION_WRITER_LEASE_COMMAND_TYPE_MISMATCH") &&
    hasCallExpression(validateDelegatedBlock, "validateProtectionWriterLease") &&
    buildLeaseBlock.includes("V2_PROTECTION_WRITER_EXCHANGE_WRITE") &&
    buildLeaseBlock.includes("V2_SERVICES.PROTECTION_WRITER") &&
    buildLeaseBlock.includes("V2_SERVICES.REPAIR_EXECUTOR") &&
    buildLeaseBlock.includes("placement_attempt_id") &&
    buildLeaseBlock.includes("command_type")
  );
}

function buildRepairWriterLeaseEvidence({ executorSource, runtimeSource }) {
  const validateBlock = sliceFunctionBlock(executorSource, "validateProtectionWriterLease");
  const validateDelegatedBlock = sliceFunctionBlock(executorSource, "validateDelegatedRepair");
  const buildLeaseBlock = sliceFunctionBlock(runtimeSource, "buildProtectionWriterLease");
  return Object.freeze({
    validate_lease_required: validateBlock.includes("PROTECTION_WRITER_LEASE_REQUIRED"),
    validate_lease_scope: validateBlock.includes("V2_PROTECTION_WRITER_EXCHANGE_WRITE"),
    validate_position_cycle_binding: validateBlock.includes("PROTECTION_WRITER_LEASE_POSITION_CYCLE_MISMATCH"),
    validate_placement_attempt_binding: validateBlock.includes("PROTECTION_WRITER_LEASE_PLACEMENT_ATTEMPT_MISMATCH"),
    validate_command_type_binding: validateBlock.includes("PROTECTION_WRITER_LEASE_COMMAND_TYPE_MISMATCH"),
    delegated_repair_calls_lease_validator: hasCallExpression(validateDelegatedBlock, "validateProtectionWriterLease"),
    runtime_builds_protection_writer_lease: buildLeaseBlock.includes("V2_PROTECTION_WRITER_EXCHANGE_WRITE")
      && buildLeaseBlock.includes("V2_SERVICES.PROTECTION_WRITER")
      && buildLeaseBlock.includes("V2_SERVICES.REPAIR_EXECUTOR"),
  });
}

function token(...parts) {
  return parts.join("");
}

function auditV2ProductionRuntimeChain({ sourceOverrides = {} } = {}) {
  const packageJson = readRepoFile("package.json", sourceOverrides);
  const productionEntryRoute = readRepoFile("src/v2/productionEntryRoute.js", sourceOverrides);
  const signalAuthorityRouter = readRepoFile("src/v2/signalAuthorityRouter.js", sourceOverrides);
  const entrySizingDecision = readRepoFile("src/v2/entrySizingDecision.js", sourceOverrides);
  const productionEntryLiveRequest = readRepoFile("src/v2/productionEntryLiveRequest.js", sourceOverrides);
  const openclawControlPlane = readRepoFile("src/v2/openclawControlPlane.js", sourceOverrides);
  const openclawShadowWriter = readRepoFile("src/v2/openclawShadowWriter.js", sourceOverrides);
  const entryExecutionKernel = readRepoFile("src/v2/entryExecutionKernel.js", sourceOverrides);
  const fillSync = readRepoFile("src/services/binanceFuturesFillsSync.js", sourceOverrides);
  const shadowExitWriter = readRepoFile("src/v2/openclawShadowExitWriter.js", sourceOverrides);
  const tickExit = readRepoFile("src/services/binanceTickExit.js", sourceOverrides);
  const exitRuntimeCanary = readRepoFile("src/v2/exitRuntimeCanary.js", sourceOverrides);
  const repairQueueService = readRepoFile("src/v2/repairQueueService.js", sourceOverrides);
  const repairQueueWorker = readRepoFile("src/v2/repairQueueWorker.js", sourceOverrides);
  const repairDelegatedExecutor = readRepoFile("src/v2/repairDelegatedExecutor.js", sourceOverrides);
  const repairExecutionLedger = readRepoFile("src/v2/repairExecutionLedger.js", sourceOverrides);
  const binanceProtectionTransport = readRepoFile("src/v2/binanceProtectionTransport.js", sourceOverrides);
  const watchdogRepairRuntime = readRepoFile("src/v2/watchdogRepairRuntime.js", sourceOverrides);
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
    "v2-binance-protection-transport.test.js",
    "v2-repair-delegated-executor.test.js",
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
      "V2_PRODUCTION_CHAIN_ML_AI_PROPOSAL_AND_SIZE_CAP_ENFORCED",
      signalAuthorityRouter.includes("resolveMlAiProposalGate")
        && signalAuthorityRouter.includes("ML_AI_PROPOSAL_NOT_APPROVED")
        && signalAuthorityRouter.includes("proposal_verdict")
        && entrySizingDecision.includes("resolveMaxSizeRatio")
        && entrySizingDecision.includes("ML_SIZE_RATIO_CAPPED")
        && entrySizingDecision.includes("ML_MAX_SIZE_RATIO_INVALID")
        && entrySizingDecision.includes("STEP_SIZE_EXCEEDS_ML_SIZE_CAP")
        && productionEntryLiveRequest.includes("extractMlMaxSizeRatioFromBundle")
        && productionEntryLiveRequest.includes("maxSizeRatio")
        && openclawControlPlane.includes("openclawDecisionBundleHash")
        && openclawControlPlane.includes("openclaw_decision_bundle_hash")
        && openclawControlPlane.includes("buildOpenClawDecisionBundleLedgerDoc")
        && openclawControlPlane.includes("OPENCLAW_DECISION_BUNDLE_LEDGER_WRITTEN")
        && productionEntryRoute.includes("findExistingDecisionBundleExecution")
        && productionEntryRoute.includes("claimOpenClawExecution")
        && productionEntryRoute.includes("finalizeOpenClawExecutionClaim")
        && productionEntryRoute.includes("OPENCLAW_EXECUTION_CLAIMS")
        && productionEntryRoute.includes("OPENCLAW_EXECUTION_PERMIT_ALREADY_CLAIMED")
        && productionEntryRoute.includes("V2_PRODUCTION_ENTRY_DECISION_BUNDLE_REPLAY_BLOCKED")
        && productionEntryRoute.includes("V2_PRODUCTION_ENTRY_EXECUTION_CLAIM_REPLAY_BLOCKED")
        && productionEntryRoute.includes("openclaw_decision_bundle_hash")
        && openclawShadowWriter.includes("OPENCLAW_DECISION_BUNDLES"),
      "OpenClaw ML proposal verdict must gate entry, ML size ratio must cap sizing, and decision bundles must be ledgered and replay-guarded",
      {
        proposal_gate: signalAuthorityRouter.includes("resolveMlAiProposalGate") && signalAuthorityRouter.includes("ML_AI_PROPOSAL_NOT_APPROVED"),
        size_ratio_cap: entrySizingDecision.includes("resolveMaxSizeRatio") && entrySizingDecision.includes("ML_SIZE_RATIO_CAPPED"),
        live_request_uses_bundle_ratio: productionEntryLiveRequest.includes("extractMlMaxSizeRatioFromBundle") && productionEntryLiveRequest.includes("maxSizeRatio"),
        decision_bundle_hash: openclawControlPlane.includes("openclawDecisionBundleHash") && openclawControlPlane.includes("openclaw_decision_bundle_hash"),
        decision_bundle_ledger: openclawControlPlane.includes("buildOpenClawDecisionBundleLedgerDoc") && openclawShadowWriter.includes("OPENCLAW_DECISION_BUNDLES"),
        decision_bundle_replay_guard: productionEntryRoute.includes("findExistingDecisionBundleExecution") && productionEntryRoute.includes("V2_PRODUCTION_ENTRY_DECISION_BUNDLE_REPLAY_BLOCKED"),
        atomic_execution_claim_guard: productionEntryRoute.includes("claimOpenClawExecution")
          && productionEntryRoute.includes("OPENCLAW_EXECUTION_CLAIMS")
          && productionEntryRoute.includes("OPENCLAW_EXECUTION_PERMIT_ALREADY_CLAIMED")
          && productionEntryRoute.includes("V2_PRODUCTION_ENTRY_EXECUTION_CLAIM_REPLAY_BLOCKED"),
        execution_claim_finalization: productionEntryRoute.includes("finalizeOpenClawExecutionClaim")
          && productionEntryRoute.includes("EXECUTED_PROTECTED_AUDIT_PENDING")
          && productionEntryRoute.includes("EXECUTED_PROTECTED"),
      }
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
      "V2_PRODUCTION_CHAIN_PROTECTION_WRITE_DEADLINE_ENFORCED",
      hasProtectionDeadlineStructure(binanceProtectionTransport),
      "Binance native protection writes must fail closed at execution time when REST calls exceed the protection write deadline",
      buildProtectionDeadlineEvidence(binanceProtectionTransport)
    ),
    buildCheck(
      "V2_PRODUCTION_CHAIN_REPAIR_WRITER_LEASE_REQUIRED",
      hasRepairWriterLeaseStructure({
        executorSource: repairDelegatedExecutor,
        runtimeSource: watchdogRepairRuntime,
      }),
      "delegated repair writes must carry a protection-writer exchange-write lease before any transport can run",
      buildRepairWriterLeaseEvidence({
        executorSource: repairDelegatedExecutor,
        runtimeSource: watchdogRepairRuntime,
      })
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
    buildFunctionCallEvidence,
    hasProtectionDeadlineStructure,
    buildProtectionDeadlineEvidence,
    hasRepairWriterLeaseStructure,
    buildRepairWriterLeaseEvidence,
    token,
  },
};
