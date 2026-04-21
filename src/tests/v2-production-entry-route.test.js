"use strict";

const assert = require("assert");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { resolveEntryIntentFromOpenClaw } = require("../v2/signalAuthorityRouter");
const { buildV2ExecutedEntryFromIntent } = require("../v2/entryExecutor");
const { runV2ProductionEntryRoute } = require("../v2/productionEntryRoute");

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
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
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
  assert.deepStrictEqual(calls.map((row) => row.type), ["kernel", "persist"]);
  assert.strictEqual(calls[0].entryIntent.decision_mode, "CANARY");
  assert.strictEqual(calls[1].source, "PRODUCTION_ENTRY_ROUTE");
  assert.strictEqual(result.openclawExecutionAudit.ok, true);
  assert.strictEqual(result.openclawExecutionAudit.execution_kernel_status, "EXECUTED_ENTRY_PRESENT");
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

async function kernelBlockDoesNotBecomeRouteSuccess() {
  const bundle = buildBundle();
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    runEntryKernel: async () => ({
      ok: false,
      reason: "V2_ENTRY_EXECUTION_KERNEL_BLOCKED",
      submitterResult: null,
      kernelAudit: {
        ok: false,
        failed_check_ids: ["ENTRY_KERNEL_TP1_ORDER_PRESENT"],
      },
    }),
    persistExecutionAudit: async () => ({ ok: true, skipped: true }),
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_KERNEL_BLOCKED");
  assert.strictEqual(result.kernelResult.reason, "V2_ENTRY_EXECUTION_KERNEL_BLOCKED");
}

async function tamperedKernelExecutionLineageBlocksRouteSuccess() {
  const bundle = buildBundle();
  const otherBundle = buildBundle({
    signalLineageId: "LINEAGE__ETH__PROD_ENTRY__OTHER",
  });
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    runEntryKernel: async () => buildKernelResultFromBundle(otherBundle),
    persistExecutionAudit: async () => ({ ok: true, skipped: true }),
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_OPENCLAW_EXECUTION_SEPARATION_BLOCKED");
  assert.ok(result.openclawExecutionAudit.failed_check_ids.includes("EXECUTION_ENTRY_INTENT_MATCH"));
  assert.ok(result.openclawExecutionAudit.failed_check_ids.includes("EXECUTION_SIGNAL_INTENT_MATCH"));
}

async function auditLedgerFailureDoesNotLookSuccessful() {
  const bundle = buildBundle();
  const result = await runV2ProductionEntryRoute({
    env: buildEnv(),
    bundle,
    runEntryKernel: async () => buildKernelResultFromBundle(bundle),
    persistExecutionAudit: async () => {
      throw new Error("firestore write denied");
    },
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
  await kernelBlockDoesNotBecomeRouteSuccess();
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
