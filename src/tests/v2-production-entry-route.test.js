"use strict";

const assert = require("assert");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { resolveEntryIntentFromOpenClaw } = require("../v2/signalAuthorityRouter");
const { buildV2ExecutedEntryFromIntent } = require("../v2/entryExecutor");
const {
  runV2ProductionEntryRoute: runV2ProductionEntryRouteImpl,
  __test: productionEntryRouteTest,
} = require("../v2/productionEntryRoute");
const { buildOpenClawWorldState } = require("../v2/openclawWorldState");
const { issueOpenClawExecutionPermit } = require("../v2/openclawExecutionPermit");
const { buildPassSignalCriteriaSeed } = require("./helpers/passSignalCriteriaSeed");

function buildEnv(overrides = {}) {
  return {
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_CANARY_ONLY: "1",
    DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
    ...overrides,
  };
}

function buildBundle(overrides = {}) {
  return buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: `LINEAGE__ETH__PROD_ENTRY__${overrides.decisionMode || "CANARY"}`,
    symbol: "ETHUSDT",
    side: "LONG",
    qualityScore: 0.86,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "CANARY",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "production entry route approved",
    policyScope: "ETH_15M",
    htfDirection: "LONG",
    htfConfidence: 0.82,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v2",
    featureValues: {
      trend_bias: 0.76,
      volatility_rank: 0.35,
    },
    proposalVerdict: "PASS",
    rankScore: 0.7,
    sizeRatio: 0.4,
    riskBand: "MEDIUM",
    featuresHash: `feat_hash_prod_entry_${overrides.decisionMode || "CANARY"}`,
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "production entry route canary long approved",
    marketDataQuality: {
      ok: true,
      reason: "V2_MARKET_DATA_QUALITY_PASS",
      blockers: [],
      metrics: { symbol: "ETHUSDT", spread_bps: 2, mark_index_gap_bps: 1 },
    },
    signalCriteria: buildPassSignalCriteriaSeed("LONG"),
    ...overrides,
  });
}

function buildKernelResultFromBundle(bundle) {
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  assert.strictEqual(routed.ok, true);
  const executedEntry = buildV2ExecutedEntryFromIntent({
    entryIntent: routed.entryIntent,
    entryEventId: "ENTRY__ETH__PROD_ENTRY",
    entryOrderId: "ORDER__ETH__PROD_ENTRY",
    entryFillGroupId: "FILL_GROUP__ETH__PROD_ENTRY",
    entryPrice: 2500,
    entryQtyAbs: 0.8,
  });
  return {
    ok: true,
    reason: "V2_ENTRY_EXECUTION_KERNEL_PROTECTED",
    submitterResult: {
      executedEntry,
    },
    kernelAudit: {
      ok: true,
      fail_n: 0,
      failed_check_ids: [],
    },
  };
}

function buildPermitForBundle(bundle, overrides = {}) {
  const worldState = buildOpenClawWorldState({
    env: buildEnv(),
    mode: overrides.mode || (bundle.openclawDecision && bundle.openclawDecision.decision_mode) || "CANARY",
    runtimeState: { test_scope: "v2-production-entry-route" },
    generatedAt: "2026-04-21T06:00:00.000Z",
  });
  const executionPermit = issueOpenClawExecutionPermit({
    bundle,
    worldState,
    approvalReason: "TEST_OPENCLAW_PERMIT",
    issuedAt: "2026-04-21T06:00:00.000Z",
    ttlMinutes: 5,
    ...overrides,
  });
  return { worldState, executionPermit };
}

function noReplayGuard(calls = null) {
  return async () => {
    if (calls) calls.push({ type: "replay_guard" });
    return {
      ok: true,
      replay: false,
      reason: "OPENCLAW_DECISION_BUNDLE_EXECUTION_NOT_FOUND",
      openclaw_decision_bundle_hash: "test-bundle-hash",
      existing_execution_audit: null,
    };
  };
}

function noSameDirectionCooldown(rows = []) {
  return async () => ({
    ok: true,
    reason: "SAME_DIRECTION_COOLDOWN_RECENT_EXECUTIONS_LOADED",
    rows,
  });
}

function noExecutionClaim(calls = null) {
  return async ({ bundle, executionPermit }) => {
    if (calls) calls.push({ type: "execution_claim" });
    return {
      ok: true,
      claimed: true,
      replay: false,
      reason: "OPENCLAW_EXECUTION_CLAIM_ACQUIRED",
      openclaw_execution_claim_id: productionEntryRouteTest.buildExecutionClaimId({
        bundleHash: bundle.openclawDecisionBundleHash,
        permitId: executionPermit.openclaw_execution_permit_id,
      }),
      openclaw_decision_bundle_hash: bundle.openclawDecisionBundleHash,
      openclaw_execution_permit_id: executionPermit.openclaw_execution_permit_id,
    };
  };
}

function noClaimFinalize(calls = null) {
  return async ({ status, reason }) => {
    if (calls) calls.push({ type: "claim_finalize", status, reason });
    return {
      ok: true,
      reason: "OPENCLAW_EXECUTION_CLAIM_FINALIZED",
      claim_status: String(status || "").toUpperCase(),
    };
  };
}

function runV2ProductionEntryRoute(args = {}) {
  return runV2ProductionEntryRouteImpl({
    claimExecution: noExecutionClaim(),
    finalizeExecutionClaim: noClaimFinalize(),
    ...args,
  });
}

async function disabledRuntimeBlocksBeforeKernel() {
  const calls = [];
  const result = await runV2ProductionEntryRoute({
    env: buildEnv({ DONBEOLJA_V2_ENABLED: "0" }),
    bundle: buildBundle(),
    runEntryKernel: async () => {
      calls.push("kernel");
      return {};
    },
    persistExecutionAudit: async () => {
      calls.push("persist");
      return {};
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_DISABLED");
  assert.deepStrictEqual(calls, []);
}

async function dryRunRuntimeBlocksBeforeKernel() {
  const calls = [];
  const result = await runV2ProductionEntryRoute({
    env: buildEnv({ DONBEOLJA_V2_DRY_RUN: "1" }),
    bundle: buildBundle(),
    runEntryKernel: async () => {
      calls.push("kernel");
      return {};
    },
    persistExecutionAudit: async () => {
      calls.push("persist");
      return {};
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_DRY_RUN_BLOCKED");
  assert.deepStrictEqual(calls, []);
}

async function canaryRouteExecutesOnlyThroughKernelAndPersistsAudit() {
  const calls = [];
  const bundle = buildBundle();
  const permit = buildPermitForBundle(bundle);
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    ...permit,
    findExistingBundleExecution: noReplayGuard(calls),
    findRecentSameDirectionExecutionsFn: noSameDirectionCooldown(),
    runEntryKernel: async ({ entryIntent }) => {
      calls.push({ type: "kernel", entryIntent });
      return buildKernelResultFromBundle(bundle);
    },
    persistExecutionAudit: async ({ audit, positionCycleId, source }) => {
      calls.push({ type: "persist", audit, positionCycleId, source });
      return { ok: true, skipped: false, reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN" };
    },
    now: () => "2026-04-21T06:00:00.000Z",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED");
  assert.deepStrictEqual(calls.map((row) => row.type), ["replay_guard", "kernel", "persist"]);
  assert.strictEqual(result.executionPermitValidation.ok, true);
  assert.strictEqual(result.decisionBundleReplayGuard.replay, false);
  assert.strictEqual(calls[1].entryIntent.decision_mode, "CANARY");
  assert.strictEqual(calls[2].source, "PRODUCTION_ENTRY_ROUTE");
  assert.strictEqual(result.openclawExecutionAudit.ok, true);
  assert.strictEqual(result.openclawExecutionAudit.execution_kernel_status, "EXECUTED_ENTRY_PRESENT");
  assert.ok(result.openclawExecutionAudit.openclaw_decision_bundle_hash);
}

async function liveDecisionIsBlockedWhenRuntimeIsCanaryOnly() {
  const calls = [];
  const result = await runV2ProductionEntryRoute({
    env: buildEnv({ DONBEOLJA_V2_CANARY_ONLY: "1" }),
    bundle: buildBundle({
      signalLineageId: "LINEAGE__ETH__PROD_ENTRY__LIVE",
      decisionMode: "LIVE",
    }),
    runEntryKernel: async () => {
      calls.push("kernel");
      return {};
    },
    persistExecutionAudit: async () => {
      calls.push("persist");
      return {};
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_LIVE_BLOCKED_BY_CANARY_ONLY");
  assert.deepStrictEqual(calls, []);
}

async function missingExecutionPermitBlocksBeforeKernel() {
  const calls = [];
  const bundle = buildBundle();
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    runEntryKernel: async () => {
      calls.push("kernel");
      return buildKernelResultFromBundle(bundle);
    },
    persistExecutionAudit: async () => {
      calls.push("persist");
      return { ok: true };
    },
    now: () => "2026-04-21T06:00:00.000Z",
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_OPENCLAW_EXECUTION_PERMIT_BLOCKED");
  assert.ok(result.executionPermitValidation.failed_check_ids.includes("PERMIT_PRESENT"));
  assert.deepStrictEqual(calls, []);
}

async function expiredExecutionPermitBlocksRetryBeforeKernel() {
  const calls = [];
  const bundle = buildBundle();
  const permit = buildPermitForBundle(bundle, {
    issuedAt: "2026-04-21T06:00:00.000Z",
    ttlMinutes: 5,
  });
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    ...permit,
    findExistingBundleExecution: noReplayGuard(),
    findRecentSameDirectionExecutionsFn: noSameDirectionCooldown(),
    runEntryKernel: async () => {
      calls.push("kernel");
      return buildKernelResultFromBundle(bundle);
    },
    persistExecutionAudit: async () => {
      calls.push("persist");
      return { ok: true };
    },
    now: () => "2026-04-21T06:06:00.000Z",
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_OPENCLAW_EXECUTION_PERMIT_BLOCKED");
  assert.ok(result.executionPermitValidation.failed_check_ids.includes("PERMIT_NOT_EXPIRED"));
  assert.deepStrictEqual(calls, []);
}

async function executionPermitWithoutCurrentWorldStateBlocksBeforeKernel() {
  const calls = [];
  const bundle = buildBundle();
  const permit = buildPermitForBundle(bundle);
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    executionPermit: permit.executionPermit,
    findExistingBundleExecution: noReplayGuard(),
    findRecentSameDirectionExecutionsFn: noSameDirectionCooldown(),
    runEntryKernel: async () => {
      calls.push("kernel");
      return buildKernelResultFromBundle(bundle);
    },
    persistExecutionAudit: async () => {
      calls.push("persist");
      return { ok: true };
    },
    now: () => "2026-04-21T06:00:00.000Z",
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_OPENCLAW_EXECUTION_PERMIT_BLOCKED");
  assert.strictEqual(result.executionPermitValidation.reason, "OPENCLAW_EXECUTION_PERMIT_CURRENT_WORLD_STATE_REQUIRED");
  assert.ok(result.executionPermitValidation.failed_check_ids.includes("PERMIT_CURRENT_WORLD_STATE_REQUIRED"));
  assert.deepStrictEqual(calls, []);
}

async function repeatedDecisionBundleBlocksBeforeKernel() {
  const calls = [];
  const bundle = buildBundle();
  const permit = buildPermitForBundle(bundle);
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    ...permit,
    findExistingBundleExecution: async () => {
      calls.push("replay_guard");
      return {
        ok: true,
        replay: true,
        reason: "OPENCLAW_DECISION_BUNDLE_EXECUTION_ALREADY_EXISTS",
        openclaw_decision_bundle_hash: bundle.openclawDecisionBundleHash,
        existing_execution_audit: {
          openclaw_execution_audit_id: "OCEXSEPAUDV2__existing",
          openclaw_decision_bundle_hash: bundle.openclawDecisionBundleHash,
        },
      };
    },
    runEntryKernel: async () => {
      calls.push("kernel");
      return buildKernelResultFromBundle(bundle);
    },
    persistExecutionAudit: async () => {
      calls.push("persist");
      return { ok: true };
    },
    now: () => "2026-04-21T06:00:00.000Z",
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_DECISION_BUNDLE_REPLAY_BLOCKED");
  assert.strictEqual(result.decisionBundleReplayGuard.replay, true);
  assert.deepStrictEqual(calls, ["replay_guard"]);
}

async function executionClaimReplayBlocksBeforeKernel() {
  const calls = [];
  const bundle = buildBundle();
  const permit = buildPermitForBundle(bundle);
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    ...permit,
    findExistingBundleExecution: noReplayGuard(calls),
    findRecentSameDirectionExecutionsFn: noSameDirectionCooldown(),
    claimExecution: async () => {
      calls.push({ type: "execution_claim" });
      return {
        ok: true,
        claimed: false,
        replay: true,
        reason: "OPENCLAW_EXECUTION_CLAIM_ALREADY_EXISTS",
        openclaw_decision_bundle_hash: bundle.openclawDecisionBundleHash,
        openclaw_execution_permit_id: permit.executionPermit.openclaw_execution_permit_id,
      };
    },
    runEntryKernel: async () => {
      calls.push({ type: "kernel" });
      return buildKernelResultFromBundle(bundle);
    },
    persistExecutionAudit: async () => {
      calls.push({ type: "persist" });
      return { ok: true };
    },
    now: () => "2026-04-21T06:00:00.000Z",
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_EXECUTION_CLAIM_REPLAY_BLOCKED");
  assert.strictEqual(result.executionClaim.reason, "OPENCLAW_EXECUTION_CLAIM_ALREADY_EXISTS");
  assert.deepStrictEqual(calls.map((row) => row.type), ["replay_guard", "execution_claim"]);
}

async function alreadyClaimedPermitBlocksBeforeKernel() {
  const calls = [];
  const bundle = buildBundle();
  const permit = buildPermitForBundle(bundle);
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    ...permit,
    findExistingBundleExecution: noReplayGuard(calls),
    findRecentSameDirectionExecutionsFn: noSameDirectionCooldown(),
    claimExecution: async () => {
      calls.push({ type: "execution_claim" });
      return {
        ok: false,
        claimed: false,
        replay: true,
        reason: "OPENCLAW_EXECUTION_PERMIT_ALREADY_CLAIMED",
        openclaw_decision_bundle_hash: bundle.openclawDecisionBundleHash,
        openclaw_execution_permit_id: permit.executionPermit.openclaw_execution_permit_id,
        permit_status: "CLAIMED",
      };
    },
    runEntryKernel: async () => {
      calls.push({ type: "kernel" });
      return buildKernelResultFromBundle(bundle);
    },
    persistExecutionAudit: async () => {
      calls.push({ type: "persist" });
      return { ok: true };
    },
    now: () => "2026-04-21T06:00:00.000Z",
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_EXECUTION_CLAIM_BLOCKED");
  assert.strictEqual(result.executionClaim.reason, "OPENCLAW_EXECUTION_PERMIT_ALREADY_CLAIMED");
  assert.deepStrictEqual(calls.map((row) => row.type), ["replay_guard", "execution_claim"]);
}

async function executionClaimIsFinalizedAroundAuditLedger() {
  const calls = [];
  const bundle = buildBundle();
  const permit = buildPermitForBundle(bundle);
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    ...permit,
    findExistingBundleExecution: noReplayGuard(calls),
    findRecentSameDirectionExecutionsFn: noSameDirectionCooldown(),
    claimExecution: noExecutionClaim(calls),
    finalizeExecutionClaim: noClaimFinalize(calls),
    runEntryKernel: async () => {
      calls.push({ type: "kernel" });
      return buildKernelResultFromBundle(bundle);
    },
    persistExecutionAudit: async () => {
      calls.push({ type: "persist" });
      return { ok: true, skipped: false, reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN" };
    },
    now: () => "2026-04-21T06:00:00.000Z",
  });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(calls.map((row) => row.type), [
    "replay_guard",
    "execution_claim",
    "kernel",
    "claim_finalize",
    "persist",
    "claim_finalize",
  ]);
  assert.strictEqual(calls[3].status, "EXECUTED_PROTECTED_AUDIT_PENDING");
  assert.strictEqual(calls[5].status, "EXECUTED_PROTECTED");
}

async function sameDirectionCooldownBlocksDuplicateTriggerBeforeKernel() {
  const calls = [];
  const currentBarMs = Date.parse("2026-04-21T06:15:00.000Z");
  const bundle = buildBundle({
    featureValues: {
      trend_bias: 0.76,
      volatility_rank: 0.35,
      trigger_type: "RECLAIM",
      bar_close_time_utc_ms: currentBarMs,
    },
  });
  const permit = buildPermitForBundle(bundle, { issuedAt: "2026-04-21T06:15:00.000Z" });
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    ...permit,
    findExistingBundleExecution: noReplayGuard(calls),
    findRecentSameDirectionExecutionsFn: noSameDirectionCooldown([
      {
        ok: true,
        symbol: "ETHUSDT",
        side: "LONG",
        trigger_type: "RECLAIM",
        entry_grade: "CORE",
        bar_time_ms: currentBarMs - (15 * 60 * 1000),
      },
    ]),
    runEntryKernel: async () => {
      calls.push({ type: "kernel" });
      return buildKernelResultFromBundle(bundle);
    },
    persistExecutionAudit: async () => {
      calls.push({ type: "persist" });
      return { ok: true };
    },
    now: () => "2026-04-21T06:15:00.000Z",
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_SAME_DIRECTION_COOLDOWN_BLOCKED");
  assert.strictEqual(result.sameDirectionCooldownGuard.reason, "SAME_DIRECTION_COOLDOWN_ACTIVE");
  assert.deepStrictEqual(calls.map((row) => row.type), ["replay_guard"]);
}

async function sameDirectionCooldownAllowsChangedTrigger() {
  const calls = [];
  const currentBarMs = Date.parse("2026-04-21T06:15:00.000Z");
  const bundle = buildBundle({
    featureValues: {
      trend_bias: 0.76,
      volatility_rank: 0.35,
      trigger_type: "RECLAIM",
      bar_close_time_utc_ms: currentBarMs,
    },
  });
  const permit = buildPermitForBundle(bundle, { issuedAt: "2026-04-21T06:15:00.000Z" });
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    ...permit,
    findExistingBundleExecution: noReplayGuard(calls),
    findRecentSameDirectionExecutionsFn: noSameDirectionCooldown([
      {
        ok: true,
        symbol: "ETHUSDT",
        side: "LONG",
        trigger_type: "BREAKOUT",
        entry_grade: "CORE",
        bar_time_ms: currentBarMs - (15 * 60 * 1000),
      },
    ]),
    runEntryKernel: async ({ entryIntent }) => {
      calls.push({ type: "kernel", entryIntent });
      return buildKernelResultFromBundle(bundle);
    },
    persistExecutionAudit: async ({ audit }) => {
      calls.push({ type: "persist", audit });
      return { ok: true, skipped: false, reason: "OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITTEN" };
    },
    now: () => "2026-04-21T06:15:00.000Z",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.sameDirectionCooldownGuard.reason, "SAME_DIRECTION_COOLDOWN_CLEAR");
  assert.strictEqual(result.openclawExecutionAudit.symbol, "ETHUSDT");
  assert.strictEqual(result.openclawExecutionAudit.trigger_type, "RECLAIM");
  assert.strictEqual(result.openclawExecutionAudit.bar_time_ms, currentBarMs);
  assert.deepStrictEqual(calls.map((row) => row.type), ["replay_guard", "kernel", "persist"]);
}

async function kernelBlockDoesNotBecomeRouteSuccess() {
  const calls = [];
  const bundle = buildBundle();
  const permit = buildPermitForBundle(bundle);
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    ...permit,
    findExistingBundleExecution: noReplayGuard(),
    findRecentSameDirectionExecutionsFn: noSameDirectionCooldown(),
    runEntryKernel: async () => {
      calls.push("kernel");
      return {
        ok: false,
        reason: "V2_ENTRY_EXECUTION_KERNEL_BLOCKED",
        submitterResult: null,
        kernelAudit: {
          ok: false,
          failed_check_ids: ["ENTRY_KERNEL_TP1_ORDER_PRESENT"],
        },
      };
    },
    persistExecutionAudit: async () => {
      calls.push("persist");
      throw new Error("audit ledger must not mask kernel failure");
    },
    now: () => "2026-04-21T06:00:00.000Z",
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_KERNEL_BLOCKED");
  assert.strictEqual(result.kernelResult.reason, "V2_ENTRY_EXECUTION_KERNEL_BLOCKED");
  assert.strictEqual(result.auditLedgerResult, null);
  assert.deepStrictEqual(calls, ["kernel"]);
}

async function postFillProtectionFailureIsClassifiedCritical() {
  const bundle = buildBundle();
  const permit = buildPermitForBundle(bundle);
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  const executedEntry = buildV2ExecutedEntryFromIntent({
    entryIntent: routed.entryIntent,
    entryEventId: "ENTRY__ETH__POST_FILL",
    entryOrderId: "ORDER__ETH__POST_FILL",
    entryFillGroupId: "FILL_GROUP__ETH__POST_FILL",
    entryPrice: 2500,
    entryQtyAbs: 0.8,
  });
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    ...permit,
    findExistingBundleExecution: noReplayGuard(),
    findRecentSameDirectionExecutionsFn: noSameDirectionCooldown(),
    runEntryKernel: async () => ({
      ok: false,
      reason: "V2_ENTRY_EXECUTION_KERNEL_BLOCKED",
      submitterResult: {
        ok: false,
        reason: "ENTRY_PROTECTION_ACTIVATION_FAILED",
        fill: {
          status: "FILLED",
          entry_order_id: "ORDER__ETH__POST_FILL",
          entry_event_id: "ENTRY__ETH__POST_FILL",
        },
        executedEntry,
        protectionEvidence: {
          ok: false,
          fail_n: 2,
          failed_check_ids: ["ENTRY_KERNEL_SL_ORDER_PRESENT", "ENTRY_KERNEL_TP1_ORDER_PRESENT"],
        },
        recoveryResult: {
          attempted: true,
          ok: false,
          reason: "ENTRY_PROTECTION_RECOVERY_THROWN",
          initialProtectionResult: {
            repairQueueCommit: {
              ok: true,
              reason: "ENTRY_PROTECTION_REPAIR_QUEUED",
              exit_repair_request_id: "RQRV2__ETH__POST_FILL",
            },
          },
        },
      },
      kernelAudit: {
        ok: false,
        failed_check_ids: ["ENTRY_KERNEL_SL_ORDER_PRESENT", "ENTRY_KERNEL_TP1_ORDER_PRESENT"],
      },
    }),
    persistExecutionAudit: async () => {
      throw new Error("must not persist blocked critical post-fill route");
    },
    now: () => "2026-04-21T06:00:00.000Z",
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_KERNEL_BLOCKED");
  assert.strictEqual(result.post_fill_side_effect.exchange_write_performed, true);
  assert.strictEqual(result.post_fill_side_effect.unprotected_position_possible, true);
  assert.strictEqual(result.post_fill_side_effect.severity, "CRITICAL");
  assert.strictEqual(result.post_fill_side_effect.entry_order_id, "ORDER__ETH__POST_FILL");
  assert.strictEqual(result.post_fill_side_effect.protection_recovery_attempted, true);
  assert.strictEqual(result.post_fill_side_effect.protection_recovery_ok, false);
  assert.strictEqual(result.post_fill_side_effect.protection_repair_queued, true);
  assert.strictEqual(result.post_fill_side_effect.protection_repair_queue_ok, true);
  assert.strictEqual(result.post_fill_side_effect.protection_repair_request_id, "RQRV2__ETH__POST_FILL");
}

async function acceptedEntryOrderWithoutFilledReceiptIsClassifiedCritical() {
  const bundle = buildBundle();
  const permit = buildPermitForBundle(bundle);
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    ...permit,
    findExistingBundleExecution: noReplayGuard(),
    findRecentSameDirectionExecutionsFn: noSameDirectionCooldown(),
    runEntryKernel: async () => ({
      ok: false,
      reason: "V2_ENTRY_EXECUTION_KERNEL_BLOCKED",
      submitterResult: {
        ok: false,
        reason: "ENTRY_SUBMITTED_FILL_RECEIPT_INVALID",
        fill: {
          status: "NEW",
          entry_order_id: "ORDER__ETH__ACK_ONLY",
          submitted_order_id: "CLIENT__ETH__ACK_ONLY",
        },
        protectionEvidence: {
          ok: false,
          failed_check_ids: ["ENTRY_FILL_RECEIPT_VALID"],
        },
        protectionResult: null,
        recoveryResult: null,
      },
      kernelAudit: {
        ok: false,
        failed_check_ids: ["ENTRY_KERNEL_FILL_FILLED"],
      },
    }),
    persistExecutionAudit: async () => {
      throw new Error("must not persist ack-only post-submit critical route");
    },
    now: () => "2026-04-21T06:00:00.000Z",
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_KERNEL_BLOCKED");
  assert.strictEqual(result.post_fill_side_effect.exchange_write_performed, true);
  assert.strictEqual(result.post_fill_side_effect.unprotected_position_possible, true);
  assert.strictEqual(result.post_fill_side_effect.entry_order_id, "ORDER__ETH__ACK_ONLY");
}

async function inconsistentKernelOkWithUnprotectedFillIsBlocked() {
  const bundle = buildBundle();
  const permit = buildPermitForBundle(bundle);
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  const executedEntry = buildV2ExecutedEntryFromIntent({
    entryIntent: routed.entryIntent,
    entryEventId: "ENTRY__ETH__INCONSISTENT",
    entryOrderId: "ORDER__ETH__INCONSISTENT",
    entryFillGroupId: "FILL_GROUP__ETH__INCONSISTENT",
    entryPrice: 2500,
    entryQtyAbs: 0.8,
  });
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    ...permit,
    findExistingBundleExecution: noReplayGuard(),
    findRecentSameDirectionExecutionsFn: noSameDirectionCooldown(),
    runEntryKernel: async () => ({
      ok: true,
      reason: "V2_ENTRY_EXECUTION_KERNEL_PROTECTED",
      submitterResult: {
        fill: {
          status: "FILLED",
          entry_order_id: "ORDER__ETH__INCONSISTENT",
        },
        executedEntry,
        protectionEvidence: {
          ok: false,
          fail_n: 1,
          failed_check_ids: ["ENTRY_KERNEL_SL_ORDER_PRESENT"],
        },
      },
      kernelAudit: {
        ok: true,
        failed_check_ids: [],
      },
    }),
    persistExecutionAudit: async () => {
      throw new Error("must not persist inconsistent protected success");
    },
    now: () => "2026-04-21T06:00:00.000Z",
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_POST_FILL_PROTECTION_CRITICAL");
  assert.strictEqual(result.post_fill_side_effect.unprotected_position_possible, true);
}

async function tamperedKernelExecutionLineageBlocksRouteSuccess() {
  const bundle = buildBundle();
  const permit = buildPermitForBundle(bundle);
  const otherBundle = buildBundle({
    signalLineageId: "LINEAGE__ETH__PROD_ENTRY__OTHER",
  });
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    ...permit,
    findExistingBundleExecution: noReplayGuard(),
    findRecentSameDirectionExecutionsFn: noSameDirectionCooldown(),
    runEntryKernel: async () => buildKernelResultFromBundle(otherBundle),
    persistExecutionAudit: async () => ({ ok: true, skipped: true }),
    now: () => "2026-04-21T06:00:00.000Z",
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_OPENCLAW_EXECUTION_SEPARATION_BLOCKED");
  assert.ok(result.openclawExecutionAudit.failed_check_ids.includes("EXECUTION_ENTRY_INTENT_MATCH"));
  assert.ok(result.openclawExecutionAudit.failed_check_ids.includes("EXECUTION_SIGNAL_INTENT_MATCH"));
}

async function auditLedgerFailureDoesNotLookSuccessful() {
  const bundle = buildBundle();
  const permit = buildPermitForBundle(bundle);
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    ...permit,
    findExistingBundleExecution: noReplayGuard(),
    findRecentSameDirectionExecutionsFn: noSameDirectionCooldown(),
    runEntryKernel: async () => buildKernelResultFromBundle(bundle),
    persistExecutionAudit: async () => {
      throw new Error("firestore write denied");
    },
    now: () => "2026-04-21T06:00:00.000Z",
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_AUDIT_LEDGER_FAILED");
  assert.strictEqual(result.auditLedgerResult.reason, "OPENCLAW_EXECUTION_AUDIT_LEDGER_THROWN");
}

async function main() {
  await disabledRuntimeBlocksBeforeKernel();
  await dryRunRuntimeBlocksBeforeKernel();
  await canaryRouteExecutesOnlyThroughKernelAndPersistsAudit();
  await liveDecisionIsBlockedWhenRuntimeIsCanaryOnly();
  await missingExecutionPermitBlocksBeforeKernel();
  await expiredExecutionPermitBlocksRetryBeforeKernel();
  await executionPermitWithoutCurrentWorldStateBlocksBeforeKernel();
  await repeatedDecisionBundleBlocksBeforeKernel();
  await executionClaimReplayBlocksBeforeKernel();
  await alreadyClaimedPermitBlocksBeforeKernel();
  await executionClaimIsFinalizedAroundAuditLedger();
  await sameDirectionCooldownBlocksDuplicateTriggerBeforeKernel();
  await sameDirectionCooldownAllowsChangedTrigger();
  await kernelBlockDoesNotBecomeRouteSuccess();
  await postFillProtectionFailureIsClassifiedCritical();
  await acceptedEntryOrderWithoutFilledReceiptIsClassifiedCritical();
  await inconsistentKernelOkWithUnprotectedFillIsBlocked();
  await tamperedKernelExecutionLineageBlocksRouteSuccess();
  await auditLedgerFailureDoesNotLookSuccessful();
}

main()
  .then(() => {
    console.log("V2_PRODUCTION_ENTRY_ROUTE_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
