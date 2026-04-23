"use strict";

const assert = require("assert");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { resolveEntryIntentFromOpenClaw } = require("../v2/signalAuthorityRouter");
const { buildV2ExecutedEntryFromIntent } = require("../v2/entryExecutor");
const {
  evaluateOpenClawExecutionSeparation,
  assertOpenClawExecutionSeparation,
} = require("../v2/openclawExecutionSeparationAudit");

function buildBundle(overrides = {}) {
  return buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__ETH__OPENCLAW_SEPARATION",
    symbol: "ETHUSDT",
    side: "LONG",
    qualityScore: 0.82,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "CANARY",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "openclaw separation audit approved",
    policyScope: "ETH_15M",
    htfDirection: "LONG",
    htfConfidence: 0.82,
    timeframe: "15M",
    featureSchemaVersion: "ml_features_v2",
    featureValues: {
      trend_bias: 0.72,
      volatility_rank: 0.41,
    },
    proposalVerdict: "PASS",
    rankScore: 0.69,
    sizeRatio: 0.4,
    riskBand: "MEDIUM",
    featuresHash: "feat_hash_openclaw_separation",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "deterministic router may create canary entry intent",
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
    ...overrides,
  });
}

function buildExecuted(bundle) {
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  assert.strictEqual(routed.ok, true);
  return {
    routed,
    executed: buildV2ExecutedEntryFromIntent({
      entryIntent: routed.entryIntent,
      entryEventId: "ENTRY__ETH__OPENCLAW_SEPARATION",
      entryOrderId: "ORDER__ETH__OPENCLAW_SEPARATION",
      entryFillGroupId: "FILL_GROUP__ETH__OPENCLAW_SEPARATION",
      entryPrice: 2500,
      entryQtyAbs: 0.8,
    }),
  };
}

(function approvedOpenClawDecisionStillRequiresDeterministicRouterAndKernelMatch() {
  const bundle = buildBundle();
  const { routed, executed } = buildExecuted(bundle);
  const audit = evaluateOpenClawExecutionSeparation({
    bundle,
    routedDecision: routed,
    executedEntry: executed,
    now: () => "2026-04-21T04:00:00.000Z",
  });
  assert.strictEqual(audit.ok, true);
  assert.strictEqual(audit.decision_mode, "CANARY");
  assert.strictEqual(audit.deterministic_route_status, "ENTRY_INTENT_CREATED");
  assert.strictEqual(audit.execution_kernel_status, "EXECUTED_ENTRY_PRESENT");
  assert.ok(audit.audit_id.startsWith("OCEXSEPAUDV2__"));
  assertOpenClawExecutionSeparation({ bundle, routedDecision: routed, executedEntry: executed });
})();

(function shadowOpenClawDecisionCannotRouteOrExecute() {
  const bundle = buildBundle({
    signalLineageId: "LINEAGE__ETH__OPENCLAW_SHADOW",
    decisionMode: "SHADOW",
    proposalVerdict: "SHADOW",
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  const audit = evaluateOpenClawExecutionSeparation({ bundle, routedDecision: routed });
  assert.strictEqual(routed.ok, false);
  assert.strictEqual(routed.reason, "SHADOW_ONLY_MODE");
  assert.strictEqual(audit.ok, true);
  assert.strictEqual(audit.deterministic_route_status, "ENTRY_INTENT_BLOCKED");
})();

(function hardGuardBlockedDecisionCannotBeForcedByOpenClawApproval() {
  const bundle = buildBundle({
    signalLineageId: "LINEAGE__ETH__OPENCLAW_MIN_ORDER_BLOCK",
    minOrderCheckResult: "BLOCKED",
  });
  const routed = resolveEntryIntentFromOpenClaw(bundle);
  const audit = evaluateOpenClawExecutionSeparation({ bundle, routedDecision: routed });
  assert.strictEqual(routed.ok, false);
  assert.strictEqual(routed.reason, "MIN_ORDER_GUARD_BLOCKED");
  assert.strictEqual(audit.ok, true);
  assert.strictEqual(audit.deterministic_route_status, "ENTRY_INTENT_BLOCKED");
})();

(function auditDetectsTamperedRouterThatBypassesShadowMode() {
  const bundle = buildBundle({
    signalLineageId: "LINEAGE__ETH__OPENCLAW_SHADOW_TAMPER",
    decisionMode: "SHADOW",
    proposalVerdict: "SHADOW",
  });
  const audit = evaluateOpenClawExecutionSeparation({
    bundle,
    routedDecision: {
      ok: true,
      entryIntent: {
        entry_intent_id: "EINTV2__TAMPERED",
        signal_intent_id: bundle.signalIntent.signal_intent_id,
        openclaw_decision_id: bundle.openclawDecision.openclaw_decision_id,
        decision_mode: "SHADOW",
      },
    },
  });
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("SHADOW_DECISION_NEVER_ROUTES_ENTRY"));
  assert.ok(audit.failed_check_ids.includes("DETERMINISTIC_ROUTER_MATCHES_OPENCLAW_CONTRACT"));
})();

(function auditDetectsExecutionWithoutRoutedEntryIntent() {
  const approvedBundle = buildBundle({
    signalLineageId: "LINEAGE__ETH__OPENCLAW_EXECUTION_WITHOUT_ROUTE_APPROVED",
  });
  const { executed } = buildExecuted(approvedBundle);
  const blockedBundle = buildBundle({
    signalLineageId: "LINEAGE__ETH__OPENCLAW_EXECUTION_WITHOUT_ROUTE_BLOCKED",
    minOrderCheckResult: "BLOCKED",
  });
  const routed = resolveEntryIntentFromOpenClaw(blockedBundle);
  const audit = evaluateOpenClawExecutionSeparation({
    bundle: blockedBundle,
    routedDecision: routed,
    executedEntry: executed,
  });
  assert.strictEqual(audit.ok, false);
  assert.ok(audit.failed_check_ids.includes("EXECUTION_REQUIRES_ROUTED_ENTRY_INTENT"));
  assert.ok(audit.failed_check_ids.includes("EXECUTION_SIGNAL_INTENT_MATCH"));
  assert.ok(audit.failed_check_ids.includes("EXECUTION_OPENCLAW_DECISION_MATCH"));
})();

console.log("V2_OPENCLAW_EXECUTION_SEPARATION_AUDIT_TEST_OK");
