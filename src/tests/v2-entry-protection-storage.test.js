"use strict";

const assert = require("assert");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { resolveEntryIntentFromOpenClaw } = require("../v2/signalAuthorityRouter");
const { buildV2ExecutedEntryFromIntent } = require("../v2/entryExecutor");
const { buildEntryProtectionPlacementRequest } = require("../v2/entryProtectionHandoff");
const { buildProtectionRuntimeWriteResult } = require("../v2/protectionRuntimeWriter");
const {
  commitEntryProtectionPendingBootstrap,
  commitProtectedEntryActivation,
  commitEntryProtectionRepairQueue,
} = require("../v2/entryProtectionStorage");

function buildFakeDb(calls) {
  return {
    collection(name) {
      calls.push({ type: "collection", name });
      return {
        doc(id) {
          calls.push({ type: "doc", id });
          return { path: `${name}/${id}` };
        },
      };
    },
    batch() {
      calls.push({ type: "batch" });
      const writes = [];
      return {
        set(ref, payload, options) {
          writes.push({ ref, payload, options });
          calls.push({ type: "batch-set", ref, payload, options });
        },
        async commit() {
          calls.push({ type: "batch-commit", write_n: writes.length });
        },
      };
    },
  };
}

function buildExecutedEntry() {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__ETH__ENTRY_STORAGE",
    symbol: "ETHUSDT",
    side: "LONG",
    qualityScore: 0.83,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "CANARY",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "entry storage approved",
    policyScope: "ETH_15M",
    htfDirection: "LONG",
    htfConfidence: 0.8,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v2",
    featureValues: {
      trend_bias: 0.73,
      volatility_rank: 0.38,
    },
    proposalVerdict: "PASS",
    rankScore: 0.68,
    sizeRatio: 0.4,
    riskBand: "MEDIUM",
    featuresHash: "feat_hash_entry_storage",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "entry storage canary long approved",
    // 2026-04-28 senior audit Step 23 — V2 router added a chain of gates
    // (market_data_quality + signal_criteria) since this fixture was
    // authored. Stamp the canonical evidence so resolveEntryIntentFromOpenClaw
    // returns ok:true past those gates.
    marketDataQuality: { present: true, ok: true, blockers: [], metrics: {} },
    setupType: "BREAKOUT",
    setupQualityScore: 0.75,
    triggerLevel: 2480,
    triggerConfirmed: true,
    volumeZScore: 1.5,
    rsiEntryTf: 55,
    marketQualityScore: 0.7,
    spreadBps: 1.2,
    markIndexGapBps: 0.8,
    expectedGrossR: 1.6,
    expectedNetRAfterCost: 1.4,
    costEstimateBps: 5,
    costREquivalent: 0.2,
    fundingPenaltyBps: 0.5,
    signalScore: 0.75,
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  return buildV2ExecutedEntryFromIntent({
    entryIntent: routed.entryIntent,
    entryEventId: "ENTRY__ETH__ENTRY_STORAGE",
    entryOrderId: "ORDER__ETH__ENTRY_STORAGE",
    entryFillGroupId: "FILL_GROUP__ETH__ENTRY_STORAGE",
    entryPrice: 2500,
    entryQtyAbs: 0.8,
  });
}

async function pendingBootstrapWritesCycleAndProjectionInOneBatch() {
  const calls = [];
  const executed = buildExecutedEntry();
  const result = await commitEntryProtectionPendingBootstrap({
    db: buildFakeDb(calls),
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    executedEntry: executed,
    committedAt: "2026-04-21T03:00:00.000Z",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.write_mode, "BATCH");
  assert.strictEqual(result.position_cycle_status, "PROTECTION_PENDING");
  assert.strictEqual(calls.filter((row) => row.type === "batch-set").length, 2);
  assert.strictEqual(calls.filter((row) => row.type === "batch-commit").length, 1);
  const cycleWrite = calls.find((row) => row.type === "batch-set" && row.payload.position_cycle_id);
  assert.strictEqual(cycleWrite.payload.status, "PROTECTION_PENDING");
  assert.strictEqual(cycleWrite.options.merge, false);
}

async function protectedActivationWritesCycleAndRuntimeInOneBatch() {
  const calls = [];
  const executed = buildExecutedEntry();
  const placementRequest = buildEntryProtectionPlacementRequest(executed);
  const protectionWriteResult = buildProtectionRuntimeWriteResult({
    placementRequest,
    slAck: {
      status: "PLACED",
      order_id: "STOP__ETH__ENTRY_STORAGE",
      trigger_price: placementRequest.sl_trigger_price,
      ack_at: "2026-04-21T03:00:01.000Z",
    },
    tp1Ack: {
      status: "PLACED",
      order_id: "TP1__ETH__ENTRY_STORAGE",
      trigger_price: placementRequest.tp1_trigger_price,
      ack_at: "2026-04-21T03:00:01.100Z",
    },
    observedAt: "2026-04-21T03:00:01.200Z",
  });
  const result = await commitProtectedEntryActivation({
    db: buildFakeDb(calls),
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    executedEntry: executed,
    placementRequest,
    protectionWriteResult,
    activatedAt: "2026-04-21T03:00:01.200Z",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.position_cycle_status, "ACTIVE_PROTECTED");
  assert.strictEqual(result.chainAudit.ok, true);
  assert.strictEqual(calls.filter((row) => row.type === "batch-set").length, 2);
  assert.strictEqual(calls.filter((row) => row.type === "batch-commit").length, 1);
  const cycleWrite = calls.find((row) => row.type === "batch-set" && row.payload.position_cycle_id && row.payload.status);
  const runtimeWrite = calls.find((row) => row.type === "batch-set" && row.payload.health_status === "HEALTHY");
  assert.strictEqual(cycleWrite.payload.status, "ACTIVE_PROTECTED");
  assert.strictEqual(runtimeWrite.payload.health_status, "HEALTHY");
  assert.strictEqual(cycleWrite.options.merge, true);
  assert.strictEqual(runtimeWrite.options.merge, true);
}

async function activationRejectsDegradedProtectionBeforeAnyWrite() {
  const calls = [];
  const executed = buildExecutedEntry();
  const placementRequest = buildEntryProtectionPlacementRequest(executed);
  const protectionWriteResult = buildProtectionRuntimeWriteResult({
    placementRequest,
    slAck: {
      status: "PLACED",
      order_id: "STOP__ETH__DEGRADED",
    },
    tp1Ack: {
      status: "FAILED",
      error_code: "NETWORK",
    },
  });
  let err = null;
  try {
    await commitProtectedEntryActivation({
      db: buildFakeDb(calls),
      executedEntry: executed,
      placementRequest,
      protectionWriteResult,
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "ENTRY_PROTECTION_NOT_READY");
  assert.strictEqual(calls.length, 0);
}

async function activationRejectsLegacyActiveCycleBeforeAnyWrite() {
  const calls = [];
  const executed = buildExecutedEntry();
  const placementRequest = buildEntryProtectionPlacementRequest(executed);
  const protectionWriteResult = buildProtectionRuntimeWriteResult({
    placementRequest,
    slAck: {
      status: "PLACED",
      order_id: "STOP__ETH__LEGACY",
    },
    tp1Ack: {
      status: "PLACED",
      order_id: "TP1__ETH__LEGACY",
    },
  });
  let err = null;
  try {
    await commitProtectedEntryActivation({
      db: buildFakeDb(calls),
      executedEntry: {
        ...executed,
        positionCycle: {
          ...executed.positionCycle,
          status: "ACTIVE",
        },
      },
      placementRequest,
      protectionWriteResult,
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "ENTRY_PROTECTION_PENDING_STATUS_REQUIRED");
  assert.strictEqual(calls.length, 0);
}

async function storageRequiresBatchToAvoidSplitWrites() {
  const executed = buildExecutedEntry();
  let err = null;
  try {
    await commitEntryProtectionPendingBootstrap({
      db: {
        collection() {
          throw new Error("collection should not be called");
        },
      },
      executedEntry: executed,
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_FIRESTORE_BATCH_REQUIRED");
}

async function repairQueueCommitWritesRuntimeAndRequestsInOneBatch() {
  const calls = [];
  const executed = buildExecutedEntry();
  const placementRequest = buildEntryProtectionPlacementRequest(executed);
  const protectionWriteResult = buildProtectionRuntimeWriteResult({
    placementRequest,
    slAck: {
      status: "PLACED",
      order_id: "STOP__ETH__REPAIR",
      trigger_price: placementRequest.sl_trigger_price,
    },
    tp1Ack: {
      status: "FAILED",
      error_code: "MIN_NOTIONAL",
      trigger_price: placementRequest.tp1_trigger_price,
    },
    observedAt: "2026-04-21T03:01:00.000Z",
  });
  const result = await commitEntryProtectionRepairQueue({
    db: buildFakeDb(calls),
    env: { DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__" },
    executedEntry: executed,
    placementRequest,
    protectionWriteResult,
    slAck: {
      status: "PLACED",
      order_id: "STOP__ETH__REPAIR",
      trigger_price: placementRequest.sl_trigger_price,
    },
    tp1Ack: {
      status: "FAILED",
      error_code: "MIN_NOTIONAL",
      trigger_price: placementRequest.tp1_trigger_price,
    },
    committedAt: "2026-04-21T03:01:01.000Z",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.write_mode, "BATCH");
  assert.strictEqual(result.repair_request_n, 1);
  assert.strictEqual(result.repair_requests[0].issue_code, "TP1_ORDER_MISSING");
  assert.strictEqual(result.repair_requests[0].requested_action, "ENSURE_TP1_ORDER");
  assert.strictEqual(calls.filter((row) => row.type === "batch-set").length, 2);
  assert.strictEqual(calls.filter((row) => row.type === "batch-commit").length, 1);
  assert.ok(calls.some((row) => row.type === "batch-set" && row.payload.health_status === "DEGRADED_REPAIRABLE"));
  assert.ok(calls.some((row) => row.type === "batch-set" && row.payload.issue_code === "TP1_ORDER_MISSING"));
}

async function repairQueueCommitSkipsDryRunFailures() {
  const calls = [];
  const executed = buildExecutedEntry();
  const placementRequest = buildEntryProtectionPlacementRequest(executed);
  const slAck = {
    status: "FAILED",
    error_code: "BINANCE_INITIAL_SL_DRY_RUN",
  };
  const tp1Ack = {
    status: "FAILED",
    error_code: "BINANCE_INITIAL_TP1_DRY_RUN",
  };
  const protectionWriteResult = buildProtectionRuntimeWriteResult({
    placementRequest,
    slAck,
    tp1Ack,
    observedAt: "2026-04-21T03:02:00.000Z",
  });
  const result = await commitEntryProtectionRepairQueue({
    db: buildFakeDb(calls),
    executedEntry: executed,
    placementRequest,
    protectionWriteResult,
    slAck,
    tp1Ack,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.write_mode, "SKIPPED");
  assert.strictEqual(result.skip_reason, "DRY_RUN_PROTECTION_ACK");
  assert.strictEqual(result.repair_request_n, 0);
  assert.strictEqual(calls.length, 0);
}

async function main() {
  await pendingBootstrapWritesCycleAndProjectionInOneBatch();
  await protectedActivationWritesCycleAndRuntimeInOneBatch();
  await activationRejectsDegradedProtectionBeforeAnyWrite();
  await activationRejectsLegacyActiveCycleBeforeAnyWrite();
  await storageRequiresBatchToAvoidSplitWrites();
  await repairQueueCommitWritesRuntimeAndRequestsInOneBatch();
  await repairQueueCommitSkipsDryRunFailures();
}

main()
  .then(() => {
    console.log("V2_ENTRY_PROTECTION_STORAGE_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
