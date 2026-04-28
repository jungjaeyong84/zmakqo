"use strict";

const assert = require("assert");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { resolveEntryIntentFromOpenClaw } = require("../v2/signalAuthorityRouter");
const { buildV2ExecutedEntryFromIntent } = require("../v2/entryExecutor");
const { buildEntryProtectionPlacementRequest } = require("../v2/entryProtectionHandoff");
const { buildProtectedActivePositionCycleDoc } = require("../v2/entryBootstrap");
const { buildProtectionRuntimeWriteResult } = require("../v2/protectionRuntimeWriter");
const { reduceCanonicalExit } = require("../v2/canonicalExitReducer");
const { prepareExitTransitionAlert } = require("../v2/alertWorker");
const { evaluateRuntimeExecutionChain, assertRuntimeExecutionChain } = require("../v2/runtimeChainAudit");

function buildBaseExecutedEntry() {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__ETH__RUNTIME_CHAIN",
    symbol: "ETHUSDT",
    side: "LONG",
    qualityScore: 0.81,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "CANARY",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "runtime chain audit approved",
    policyScope: "ETH_15M",
    htfDirection: "LONG",
    htfConfidence: 0.78,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v2",
    featureValues: {
      trend_bias: 0.7,
      volatility_rank: 0.39,
    },
    proposalVerdict: "PASS",
    rankScore: 0.66,
    sizeRatio: 0.42,
    riskBand: "MEDIUM",
    featuresHash: "feat_hash_runtime_chain",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "runtime chain canary long approved",
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
    entryEventId: "ENTRY__ETH__RUNTIME_CHAIN",
    entryOrderId: "ORDER__ETH__RUNTIME_CHAIN",
    entryFillGroupId: "FILL_GROUP__ETH__RUNTIME_CHAIN",
    entryPrice: 2500,
    entryQtyAbs: 0.8,
  });
}

function withProtectedActiveCycle(executedEntry, protectionWriteResult) {
  return {
    ...executedEntry,
    positionCycle: buildProtectedActivePositionCycleDoc({
      positionCycle: executedEntry.positionCycle,
      protectionWriteResult,
      activatedAt: "2026-04-21T01:00:02.000Z",
    }),
  };
}

(function healthyRuntimeChainKeepsSingleLineageAcrossModules() {
  const executed = buildBaseExecutedEntry();
  const placementRequest = buildEntryProtectionPlacementRequest(executed);
  const protectionWriteResult = buildProtectionRuntimeWriteResult({
    placementRequest,
    slAck: {
      status: "PLACED",
      order_id: "STOP__ETH__RUNTIME_CHAIN",
      trigger_price: placementRequest.sl_trigger_price,
      ack_at: "2026-04-21T01:00:01.000Z",
    },
    tp1Ack: {
      status: "PLACED",
      order_id: "TP1__ETH__RUNTIME_CHAIN",
      trigger_price: placementRequest.tp1_trigger_price,
      ack_at: "2026-04-21T01:00:01.500Z",
    },
    observedAt: "2026-04-21T01:00:02.000Z",
  });
  const protectedExecuted = withProtectedActiveCycle(executed, protectionWriteResult);
  const reductionResult = reduceCanonicalExit({
    positionCycle: protectedExecuted.positionCycle,
    projection: executed.projection,
    evidence: {
      kind: "TP1_CONFIRMED",
      sourceFillId: "FILL__ETH__TP1__RUNTIME_CHAIN",
      sourceOrderId: "ORDER__ETH__TP1__RUNTIME_CHAIN",
      fillQtyAbs: executed.protectionPlan.tp1_qty_abs,
    },
  });
  const preparedAlert = prepareExitTransitionAlert({
    positionCycle: protectedExecuted.positionCycle,
    transition: reductionResult.transition,
    projection: reductionResult.nextProjection,
  });
  const audit = evaluateRuntimeExecutionChain({
    executedEntry: protectedExecuted,
    placementRequest,
    protectionWriteResult,
    reductionResult,
    preparedAlert,
  });
  assert.strictEqual(audit.ok, true);
  assert.strictEqual(audit.fail_n, 0);
  assert.ok(audit.check_n >= 15);
  assertRuntimeExecutionChain({
    executedEntry: protectedExecuted,
    placementRequest,
    protectionWriteResult,
    reductionResult,
    preparedAlert,
  });
})();

(function degradedProtectionCannotLegallyAdvanceToReducerOrAlert() {
  const executed = buildBaseExecutedEntry();
  const placementRequest = buildEntryProtectionPlacementRequest(executed);
  const protectionWriteResult = buildProtectionRuntimeWriteResult({
    placementRequest,
    slAck: {
      status: "PLACED",
      order_id: "STOP__ETH__DEGRADED",
    },
    tp1Ack: {
      status: "FAILED",
      error_code: "MIN_NOTIONAL",
    },
    observedAt: "2026-04-21T01:05:00.000Z",
  });
  const reductionResult = reduceCanonicalExit({
    positionCycle: executed.positionCycle,
    projection: executed.projection,
    evidence: {
      kind: "TP1_CONFIRMED",
      sourceFillId: "FILL__ETH__TP1__DEGRADED",
      sourceOrderId: "ORDER__ETH__TP1__DEGRADED",
      fillQtyAbs: executed.protectionPlan.tp1_qty_abs,
    },
  });
  const preparedAlert = prepareExitTransitionAlert({
    positionCycle: executed.positionCycle,
    transition: reductionResult.transition,
    projection: reductionResult.nextProjection,
  });
  const audit = evaluateRuntimeExecutionChain({
    executedEntry: executed,
    placementRequest,
    protectionWriteResult,
    reductionResult,
    preparedAlert,
  });
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("RUNTIME_CHAIN_PROTECTION_NOT_READY"));
  assert.ok(audit.failed_check_ids.includes("RUNTIME_CHAIN_PROTECTION_HEALTHY"));
  assert.ok(audit.failed_check_ids.includes("RUNTIME_CHAIN_POSITION_ACTIVE_PROTECTED"));
  let err = null;
  try {
    assertRuntimeExecutionChain({
      executedEntry: executed,
      placementRequest,
      protectionWriteResult,
      reductionResult,
      preparedAlert,
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "RUNTIME_CHAIN_PROTECTION_NOT_READY");
})();

(function alertPayloadMutationFailsDeterministically() {
  const executed = buildBaseExecutedEntry();
  const placementRequest = buildEntryProtectionPlacementRequest(executed);
  const protectionWriteResult = buildProtectionRuntimeWriteResult({
    placementRequest,
    slAck: {
      status: "PLACED",
      order_id: "STOP__ETH__MUTATED",
    },
    tp1Ack: {
      status: "PLACED",
      order_id: "TP1__ETH__MUTATED",
    },
    observedAt: "2026-04-21T01:10:00.000Z",
  });
  const protectedExecuted = withProtectedActiveCycle(executed, protectionWriteResult);
  const reductionResult = reduceCanonicalExit({
    positionCycle: protectedExecuted.positionCycle,
    projection: executed.projection,
    evidence: {
      kind: "TP1_CONFIRMED",
      sourceFillId: "FILL__ETH__TP1__MUTATED",
      sourceOrderId: "ORDER__ETH__TP1__MUTATED",
      fillQtyAbs: executed.protectionPlan.tp1_qty_abs,
    },
  });
  const preparedAlert = prepareExitTransitionAlert({
    positionCycle: protectedExecuted.positionCycle,
    transition: reductionResult.transition,
    projection: reductionResult.nextProjection,
  });
  const mutatedPreparedAlert = {
    ...preparedAlert,
    payload: {
      ...preparedAlert.payload,
      stage: "TRAIL_ACTIVE",
    },
  };
  const audit = evaluateRuntimeExecutionChain({
    executedEntry: protectedExecuted,
    placementRequest,
    protectionWriteResult,
    reductionResult,
    preparedAlert: mutatedPreparedAlert,
  });
  assert.strictEqual(audit.ok, false);
  assert.deepStrictEqual(audit.failed_check_ids, ["ALERT_PAYLOAD_STAGE_MATCH"]);
})();

console.log("V2_RUNTIME_CHAIN_AUDIT_TEST_OK");
