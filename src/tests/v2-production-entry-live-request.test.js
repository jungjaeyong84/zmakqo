"use strict";

const assert = require("assert");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { LIVE_CONFIRM_PHRASE } = require("../v2/productionEntryLiveEndpoint");
const { DISCOVERY_CONFIRM_PHRASE } = require("../v2/discoveryCanaryContract");
const { buildV2ProductionEntryLiveRequest, __test } = require("../v2/productionEntryLiveRequest");

function buildBundle(overrides = {}) {
  return buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__ETH__PROD_ENTRY__LIVE_REQUEST",
    symbol: "ETHUSDT",
    side: "LONG",
    qualityScore: 0.86,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "LIVE",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "production live request approved",
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
    featuresHash: "feat_hash_prod_entry_live_request",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "production live request long approved",
    createdAt: "2026-04-22T01:00:00.000Z",
    ...overrides,
  });
}

function buildSizing(overrides = {}) {
  return {
    referencePrice: 2500,
    requestedNotionalQuote: 1000,
    maxNotionalQuote: 1500,
    minNotionalQuote: 5,
    minQtyAbs: 0.001,
    stepSize: 0.001,
    ...overrides,
  };
}

(function liveRequestEmbedsApprovedSizingIntoBundleAndBody() {
  const result = buildV2ProductionEntryLiveRequest({
    bundle: buildBundle(),
    sizing: buildSizing(),
    now: () => "2026-04-22T01:10:00.000Z",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_LIVE_REQUEST_READY");
  assert.strictEqual(result.body.confirm, LIVE_CONFIRM_PHRASE);
  assert.strictEqual(result.entrySizingDecision.ok, true);
  assert.strictEqual(result.entrySizingDecision.status, "APPROVED");
  assert.strictEqual(result.entrySizingDecision.reason, "ML_SIZE_RATIO_CAPPED");
  assert.strictEqual(result.entrySizingDecision.max_size_ratio, 0.4);
  assert.strictEqual(result.entrySizingDecision.notional_quote, 600);
  assert.strictEqual(result.body.bundle.entrySizingDecision.entry_intent_id, result.routedDecision.entryIntent.entry_intent_id);
  assert.strictEqual(result.body.entrySizingDecision.entry_qty_abs, result.body.bundle.entrySizingDecision.entry_qty_abs);
  assert.strictEqual(result.executionPermit.sizing_cap.max_size_ratio, 0.4);
  assert.strictEqual(result.executionPermit.sizing_cap.sizing_cap_notional_quote, 600);
  assert.strictEqual(result.body.request_contract.reason, "V2_PRODUCTION_ENTRY_LIVE_REQUEST_EMBEDS_SIZING");
})();

(function liveRequestUsesBoundedOpenClawExecutionPermitTtl() {
  assert.strictEqual(__test.parseBoundedPermitTtlMinutes({}), 15);
  assert.strictEqual(__test.parseBoundedPermitTtlMinutes({ DONBEOLJA_V2_OPENCLAW_EXECUTION_PERMIT_TTL_MINUTES: "2" }), 5);
  assert.strictEqual(__test.parseBoundedPermitTtlMinutes({ DONBEOLJA_V2_OPENCLAW_EXECUTION_PERMIT_TTL_MINUTES: "120" }), 30);
  const result = buildV2ProductionEntryLiveRequest({
    bundle: buildBundle({ signalLineageId: "LINEAGE__ETH__PROD_ENTRY__TTL" }),
    sizing: buildSizing(),
    env: { DONBEOLJA_V2_OPENCLAW_EXECUTION_PERMIT_TTL_MINUTES: "20" },
    now: () => "2026-04-22T01:10:00.000Z",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.executionPermit.issued_at, "2026-04-22T01:10:00.000Z");
  assert.strictEqual(result.executionPermit.expires_at, "2026-04-22T01:30:00.000Z");
})();

(function discoveryCanaryRequestEmbedsStateWithoutChangingLiveDefault() {
  const result = buildV2ProductionEntryLiveRequest({
    bundle: buildBundle({
      signalLineageId: "LINEAGE__ETH__PROD_ENTRY__DISCOVERY_REQUEST",
      decisionMode: "CANARY",
    }),
    sizing: buildSizing({
      requestedNotionalQuote: 12,
      maxNotionalQuote: 20,
      maxSizeRatio: 1,
    }),
    confirm: DISCOVERY_CONFIRM_PHRASE,
    discoveryCanaryState: {
      active_position_n: 0,
      trade_count_24h: 0,
      daily_loss_quote: 0,
    },
    now: () => "2026-04-22T01:10:00.000Z",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.body.confirm, DISCOVERY_CONFIRM_PHRASE);
  assert.deepStrictEqual(result.body.discoveryCanaryState, {
    active_position_n: 0,
    trade_count_24h: 0,
    daily_loss_quote: 0,
  });
  assert.strictEqual(result.executionPermit.decision_mode, "CANARY");
})();

(function blockedSizingDoesNotCreateEndpointBody() {
  const result = buildV2ProductionEntryLiveRequest({
    bundle: buildBundle({ signalLineageId: "LINEAGE__ETH__PROD_ENTRY__LIVE_REQUEST_BLOCKED" }),
    sizing: buildSizing({
      requestedNotionalQuote: 2000,
      maxNotionalQuote: 100,
    }),
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_LIVE_SIZING_NOT_APPROVED");
  assert.strictEqual(result.body, null);
  assert.strictEqual(result.entrySizingDecision.ok, false);
  assert.strictEqual(result.entrySizingDecision.reason, "REQUESTED_NOTIONAL_EXCEEDS_BUDGET");
})();

(function nonExecutableBundleDoesNotCreateEndpointBody() {
  const result = buildV2ProductionEntryLiveRequest({
    bundle: buildBundle({
      signalLineageId: "LINEAGE__ETH__PROD_ENTRY__LIVE_REQUEST_SHADOW",
      decisionMode: "SHADOW",
      decisionStatus: "SHADOW_ONLY",
    }),
    sizing: buildSizing(),
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_LIVE_ROUTER_NOT_EXECUTABLE");
  assert.strictEqual(result.body, null);
})();

console.log("V2_PRODUCTION_ENTRY_LIVE_REQUEST_TEST_OK");
