"use strict";

const assert = require("assert");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { resolveEntryIntentFromOpenClaw } = require("../v2/signalAuthorityRouter");
const { buildV2ExecutedEntryFromIntent } = require("../v2/entryExecutor");
const { buildEntryProtectionPlacementRequest } = require("../v2/entryProtectionHandoff");

(function handoffCarriesSingleWriterPlacementContract() {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__ETH__HANDOFF",
    symbol: "ETHUSDT",
    side: "LONG",
    qualityScore: 0.77,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "CANARY",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "canary entry approved",
    policyScope: "ETH_15M",
    htfDirection: "LONG",
    htfConfidence: 0.8,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v2",
    featureValues: {
      trend_bias: 0.72,
      volatility_rank: 0.41,
    },
    proposalVerdict: "PASS",
    rankScore: 0.67,
    sizeRatio: 0.4,
    riskBand: "MEDIUM",
    featuresHash: "feat_hash_eth_handoff",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "server-native canary long approved",
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  const executed = buildV2ExecutedEntryFromIntent({
    entryIntent: routed.entryIntent,
    entryEventId: "ENTRY__ETH__HANDOFF",
    entryOrderId: "ORDER__ETH__HANDOFF",
    entryFillGroupId: "FILL_GROUP__ETH__HANDOFF",
    entryPrice: 2500,
    entryQtyAbs: 0.8,
  });
  const request = buildEntryProtectionPlacementRequest(executed);
  assert.strictEqual(request.requested_by_service, "V2_ENTRY_EXECUTOR");
  assert.strictEqual(request.position_cycle_id, executed.positionCycle.position_cycle_id);
  assert.strictEqual(request.signal_intent_id, bundle.signalIntent.signal_intent_id);
  assert.strictEqual(request.openclaw_decision_id, bundle.openclawDecision.openclaw_decision_id);
  assert.strictEqual(request.signal_source_mode, "SERVER_NATIVE_ML_AI");
  assert.strictEqual(request.decision_mode, "CANARY");
  assert.strictEqual(request.policy_scope, "ETH_15M");
  assert.strictEqual(request.tp1_qty_abs, executed.protectionPlan.tp1_qty_abs);
  assert.strictEqual(request.runner_remaining_qty_abs, executed.protectionPlan.runner_remaining_qty_abs);
})();

(function handoffRejectsMissingPositionCycleLineage() {
  let err = null;
  try {
    buildEntryProtectionPlacementRequest({
      entryContract: {
        entry_intent_id: "EINTV2__1",
        signal_intent_id: "SIGINTV2__1",
        openclaw_decision_id: "OCDV2__1",
        signal_source_mode: "WEBHOOK_ASSISTED",
        decision_mode: "LIVE",
        policy_scope: "BTC_15M",
      },
      positionCycle: {
        position_cycle_id: null,
        entry_event_id: "ENTRY__1",
        entry_order_id: "ORDER__1",
        entry_fill_group_id: "FILL_GROUP__1",
        symbol: "BTCUSDT",
        position_side: "LONG",
        entry_price: 100000,
        entry_qty_abs: 0.01,
      },
      protectionPlan: {
        exchange: "BINANCEFUT",
        symbol: "BTCUSDT",
        position_side: "LONG",
        close_side: "SELL",
        entry_price: 100000,
        entry_qty_abs: 0.01,
        sl_trigger_price: 98350,
        tp1_trigger_price: 101680,
        tp1_qty_abs: 0.005,
        runner_remaining_qty_abs: 0.005,
      },
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "position_cycle_id_REQUIRED");
})();

console.log("V2_ENTRY_PROTECTION_HANDOFF_TEST_OK");
