"use strict";

const assert = require("assert");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { resolveEntryIntentFromOpenClaw } = require("../v2/signalAuthorityRouter");
const { buildV2ExecutedEntryFromIntent } = require("../v2/entryExecutor");

(function approvedLiveIntentBuildsExecutableBootstrapWithProvenance() {
  const bundle = buildOpenClawDecisionBundle({
    signalSourceMode: "WEBHOOK_ASSISTED",
    signalLineageId: "LINEAGE__BTC__2",
    symbol: "BTCUSDT",
    side: "LONG",
    qualityScore: 0.88,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "LIVE",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "live policy approved webhook signal",
    policyScope: "BTC_15M",
    htfDirection: "LONG",
    htfConfidence: 0.82,
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  const executed = buildV2ExecutedEntryFromIntent({
    entryIntent: routed.entryIntent,
    entryEventId: "ENTRY__BTC__2",
    entryOrderId: "ORDER__BTC__2",
    entryFillGroupId: "FILL_GROUP__BTC__2",
    entryPrice: 101000,
    entryQtyAbs: 0.01,
  });
  assert.strictEqual(executed.positionCycle.entry_intent_id, routed.entryIntent.entry_intent_id);
  assert.strictEqual(executed.positionCycle.status, "PROTECTION_PENDING");
  assert.strictEqual(executed.positionCycle.signal_intent_id, bundle.signalIntent.signal_intent_id);
  assert.strictEqual(executed.positionCycle.openclaw_decision_id, bundle.openclawDecision.openclaw_decision_id);
  assert.strictEqual(executed.entryContract.signal_source_mode, "WEBHOOK_ASSISTED");
  assert.strictEqual(executed.entryContract.policy_scope, "BTC_15M");
})();

(function shadowIntentIsRejectedEvenIfAccidentallyPassedDown() {
  let err = null;
  try {
    buildV2ExecutedEntryFromIntent({
      entryIntent: {
        entry_intent_id: "EINTV2__shadow",
        signal_intent_id: "SIGINTV2__shadow",
        openclaw_decision_id: "OCDV2__shadow",
        signal_source_mode: "WEBHOOK_ASSISTED",
        decision_mode: "SHADOW",
        policy_scope: "ETH_15M",
        symbol: "ETHUSDT",
        side: "SHORT",
      },
      entryEventId: "ENTRY__ETH__SHADOW",
      entryOrderId: "ORDER__ETH__SHADOW",
      entryFillGroupId: "FILL_GROUP__ETH__SHADOW",
      entryPrice: 2000,
      entryQtyAbs: 1,
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "ENTRY_INTENT_DECISION_MODE_NOT_EXECUTABLE");
})();

(function paperIntentIsRejectedBecauseNativeEntryPathMustBeBoundedDeployable() {
  let err = null;
  try {
    buildV2ExecutedEntryFromIntent({
      entryIntent: {
        entry_intent_id: "EINTV2__paper",
        signal_intent_id: "SIGINTV2__paper",
        openclaw_decision_id: "OCDV2__paper",
        signal_source_mode: "SERVER_NATIVE_ML_AI",
        decision_mode: "PAPER",
        policy_scope: "ETH_15M",
        symbol: "ETHUSDT",
        side: "LONG",
      },
      entryEventId: "ENTRY__ETH__PAPER",
      entryOrderId: "ORDER__ETH__PAPER",
      entryFillGroupId: "FILL_GROUP__ETH__PAPER",
      entryPrice: 2000,
      entryQtyAbs: 1,
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "ENTRY_INTENT_DECISION_MODE_NOT_EXECUTABLE");
})();

(function missingOpenClawLineageIsRejectedBeforeBootstrap() {
  let err = null;
  try {
    buildV2ExecutedEntryFromIntent({
      entryIntent: {
        entry_intent_id: "EINTV2__broken",
        signal_intent_id: "SIGINTV2__broken",
        openclaw_decision_id: null,
        signal_source_mode: "WEBHOOK_ASSISTED",
        decision_mode: "LIVE",
        policy_scope: "BTC_15M",
        symbol: "BTCUSDT",
        side: "LONG",
      },
      entryEventId: "ENTRY__BTC__BROKEN",
      entryOrderId: "ORDER__BTC__BROKEN",
      entryFillGroupId: "FILL_GROUP__BTC__BROKEN",
      entryPrice: 100000,
      entryQtyAbs: 0.01,
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "OPENCLAW_DECISION_ID_REQUIRED");
})();

(function missingPolicyScopeIsRejectedBeforeBootstrap() {
  let err = null;
  try {
    buildV2ExecutedEntryFromIntent({
      entryIntent: {
        entry_intent_id: "EINTV2__broken2",
        signal_intent_id: "SIGINTV2__broken2",
        openclaw_decision_id: "OCDV2__broken2",
        signal_source_mode: "SERVER_NATIVE_ML_AI",
        decision_mode: "CANARY",
        policy_scope: null,
        symbol: "ETHUSDT",
        side: "SHORT",
      },
      entryEventId: "ENTRY__ETH__BROKEN2",
      entryOrderId: "ORDER__ETH__BROKEN2",
      entryFillGroupId: "FILL_GROUP__ETH__BROKEN2",
      entryPrice: 2100,
      entryQtyAbs: 0.5,
    });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "POLICY_SCOPE_REQUIRED");
})();

console.log("V2_ENTRY_EXECUTOR_TEST_OK");
