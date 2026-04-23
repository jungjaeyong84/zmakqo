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
const runtimeChain = require("../v2/runtimeExecutionChain");

function buildHappyPath() {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__ETH__CHAIN",
    symbol: "ETHUSDT",
    side: "LONG",
    qualityScore: 0.82,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "CANARY",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "runtime chain happy path",
    policyScope: "ETH_15M",
    htfDirection: "LONG",
    htfConfidence: 0.81,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v2",
    featureValues: {
      trend_bias: 0.7,
      volatility_rank: 0.38,
    },
    proposalVerdict: "PASS",
    rankScore: 0.65,
    sizeRatio: 0.4,
    riskBand: "MEDIUM",
    featuresHash: "feat_hash_eth_chain",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "runtime chain happy path approved",
    marketDataQuality: {
      ok: true,
      reason: "V2_MARKET_DATA_QUALITY_PASS",
      blockers: [],
      metrics: {
        symbol: "ETHUSDT",
        spread_bps: 2,
        mark_index_gap_bps: 1,
      },
    },
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  const executed = buildV2ExecutedEntryFromIntent({
    entryIntent: routed.entryIntent,
    entryEventId: "ENTRY__ETH__CHAIN",
    entryOrderId: "ORDER__ETH__CHAIN",
    entryFillGroupId: "FILL_GROUP__ETH__CHAIN",
    entryPrice: 2500,
    entryQtyAbs: 0.8,
  });
  const placementRequest = buildEntryProtectionPlacementRequest(executed);
  const protectionWriteResult = buildProtectionRuntimeWriteResult({
    placementRequest,
    slAck: {
      status: "PLACED",
      order_id: "STOP__ETH__CHAIN",
      trigger_price: executed.protectionPlan.sl_trigger_price,
      ack_at: "2026-04-21T00:00:01.000Z",
    },
    tp1Ack: {
      status: "PLACED",
      order_id: "TP1__ETH__CHAIN",
      trigger_price: executed.protectionPlan.tp1_trigger_price,
      ack_at: "2026-04-21T00:00:01.100Z",
    },
    observedAt: "2026-04-21T00:00:01.200Z",
  });
  const protectedExecuted = {
    ...executed,
    positionCycle: buildProtectedActivePositionCycleDoc({
      positionCycle: executed.positionCycle,
      protectionWriteResult,
      activatedAt: "2026-04-21T00:00:01.200Z",
    }),
  };
  const reductionResult = reduceCanonicalExit({
    positionCycle: protectedExecuted.positionCycle,
    projection: executed.projection,
    evidence: {
      kind: "TP1_CONFIRMED",
      sourceFillId: "FILL__TP1__ETH__CHAIN",
      sourceOrderId: "ORDER__TP1__ETH__CHAIN",
      fillQtyAbs: executed.protectionPlan.tp1_qty_abs,
    },
  });
  const preparedAlert = prepareExitTransitionAlert({
    positionCycle: protectedExecuted.positionCycle,
    transition: reductionResult.transition,
    projection: reductionResult.nextProjection,
  });
  return {
    executed: protectedExecuted,
    placementRequest,
    protectionWriteResult,
    reductionResult,
    preparedAlert,
  };
}

(function runtimeExecutionChainPassesOnHappyPath() {
  const ctx = buildHappyPath();
  const result = runtimeChain.evaluateRuntimeExecutionChain({
    executedEntry: ctx.executed,
    placementRequest: ctx.placementRequest,
    protectionWriteResult: ctx.protectionWriteResult,
    reductionResult: ctx.reductionResult,
    preparedAlert: ctx.preparedAlert,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.fail_n, 0);
  assert.ok(result.check_n >= 17);
})();

(function runtimeExecutionChainRejectsReducerAfterDegradedProtection() {
  const ctx = buildHappyPath();
  const degradedProtectionWriteResult = buildProtectionRuntimeWriteResult({
    placementRequest: ctx.placementRequest,
    slAck: {
      status: "PLACED",
      order_id: "STOP__ETH__CHAIN__DEGRADED",
      trigger_price: ctx.executed.protectionPlan.sl_trigger_price,
    },
    tp1Ack: {
      status: "FAILED",
      error_code: "NETWORK",
    },
  });
  const result = runtimeChain.evaluateRuntimeExecutionChain({
    executedEntry: ctx.executed,
    placementRequest: ctx.placementRequest,
    protectionWriteResult: degradedProtectionWriteResult,
    reductionResult: ctx.reductionResult,
    preparedAlert: ctx.preparedAlert,
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.failed_check_ids.includes("RUNTIME_CHAIN_PROTECTION_NOT_READY"));
  assert.ok(result.failed_check_ids.includes("RUNTIME_CHAIN_PROTECTION_HEALTHY"));
})();

(function runtimeExecutionChainRejectsAlertOutboxDivergence() {
  const ctx = buildHappyPath();
  const result = runtimeChain.evaluateRuntimeExecutionChain({
    executedEntry: ctx.executed,
    placementRequest: ctx.placementRequest,
    protectionWriteResult: ctx.protectionWriteResult,
    reductionResult: ctx.reductionResult,
    preparedAlert: {
      ...ctx.preparedAlert,
      outbox: {
        ...ctx.preparedAlert.outbox,
        canonical_transition_id: "CETV2__BROKEN",
      },
    },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.failed_check_ids.includes("ALERT_OUTBOX_TRANSITION_MATCH"));
})();

console.log("V2_RUNTIME_EXECUTION_CHAIN_TEST_OK");
