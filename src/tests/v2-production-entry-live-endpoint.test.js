"use strict";

const assert = require("assert");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const {
  DISCOVERY_CONFIRM_PHRASE,
} = require("../v2/discoveryCanaryContract");
const {
  LIVE_CONFIRM_PHRASE,
  runV2ProductionEntryLiveEndpoint,
} = require("../v2/productionEntryLiveEndpoint");
const { buildV2EntrySizingDecision } = require("../v2/entrySizingDecision");

function buildEnv(overrides = {}) {
  return {
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_CANARY_ONLY: "0",
    DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "1",
    ...overrides,
  };
}

function buildBundle(overrides = {}) {
  return buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__ETH__PROD_ENTRY__LIVE_ENDPOINT",
    symbol: "ETHUSDT",
    side: "LONG",
    qualityScore: 0.86,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "LIVE",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "production live endpoint approved",
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
    featuresHash: "feat_hash_prod_entry_live_endpoint",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "production live endpoint long approved",
    ...overrides,
  });
}

function buildSizingDecision(bundle = buildBundle(), overrides = {}) {
  const routedIntentId = require("crypto")
    .createHash("sha1")
    .update(String(bundle.signalIntent.signal_intent_id))
    .digest("hex")
    .slice(0, 10);
  return buildV2EntrySizingDecision({
    entryIntent: {
      entry_intent_id: `EINTV2__${routedIntentId}`,
      symbol: bundle.signalIntent.symbol,
      side: bundle.signalIntent.side,
    },
    referencePrice: 2500,
    requestedNotionalQuote: 1000,
    maxNotionalQuote: 1500,
    minNotionalQuote: 5,
    minQtyAbs: 0.001,
    stepSize: 0.001,
    createdAt: "2026-04-22T01:00:00.000Z",
    ...overrides,
  });
}

async function disabledEndpointBlocksBeforeRoute() {
  const calls = [];
  const result = await runV2ProductionEntryLiveEndpoint({
    env: buildEnv({ DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "0" }),
    body: {
      confirm: LIVE_CONFIRM_PHRASE,
      bundle: buildBundle(),
    },
    runProductionEntryRoute: async () => {
      calls.push("route");
      return { ok: true };
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_DISABLED");
  assert.strictEqual(result.route_called, false);
  assert.deepStrictEqual(calls, []);
}

async function missingConfirmBlocksBeforeRoute() {
  const calls = [];
  const result = await runV2ProductionEntryLiveEndpoint({
    env: buildEnv(),
    body: {
      confirm: "YES",
      bundle: buildBundle(),
    },
    runProductionEntryRoute: async () => {
      calls.push("route");
      return { ok: true };
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_LIVE_CONFIRM_REQUIRED");
  assert.strictEqual(result.route_called, false);
  assert.deepStrictEqual(calls, []);
}

async function canaryOnlyRuntimeBlocksBeforeRoute() {
  const calls = [];
  const result = await runV2ProductionEntryLiveEndpoint({
    env: buildEnv({ DONBEOLJA_V2_CANARY_ONLY: "1" }),
    body: {
      confirm: LIVE_CONFIRM_PHRASE,
      bundle: buildBundle(),
    },
    runProductionEntryRoute: async () => {
      calls.push("route");
      return { ok: true };
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_LIVE_CANARY_ONLY_BLOCKED");
  assert.strictEqual(result.route_called, false);
  assert.deepStrictEqual(calls, []);
}

async function canaryDecisionBlocksBeforeRoute() {
  const calls = [];
  const result = await runV2ProductionEntryLiveEndpoint({
    env: buildEnv(),
    body: {
      confirm: LIVE_CONFIRM_PHRASE,
      bundle: buildBundle({
        signalLineageId: "LINEAGE__ETH__PROD_ENTRY__CANARY_ENDPOINT",
        decisionMode: "CANARY",
      }),
    },
    runProductionEntryRoute: async () => {
      calls.push("route");
      return { ok: true };
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_LIVE_DECISION_REQUIRED");
  assert.strictEqual(result.decision_mode, "CANARY");
  assert.strictEqual(result.route_called, false);
  assert.deepStrictEqual(calls, []);
}

async function liveEndpointDelegatesOnlyToProductionRoute() {
  const calls = [];
  const bundle = buildBundle();
  const entryTransport = { submitEntryOrder: async () => ({}) };
  const protectionTransports = {
    placeInitialSl: async () => ({}),
    placeInitialTp1: async () => ({}),
  };
  const result = await runV2ProductionEntryLiveEndpoint({
    env: buildEnv(),
    body: {
      confirm: LIVE_CONFIRM_PHRASE,
      bundle,
      entrySizingDecision: buildSizingDecision(bundle),
    },
    requestId: "REQ__LIVE_ENDPOINT__1",
    buildLiveTransports: async () => ({
      ok: true,
      reason: "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_READY",
      entry_intent_id: "EINTV2__TEST",
      symbol: "ETHUSDT",
      side: "LONG",
      entry_qty_abs: 0.4,
      live_cfg_summary: {
        exchange: "BINANCEFUT",
        symbol: "ETHUSDT",
        live_enabled: true,
        live_dry_run: false,
      },
      entryTransport,
      protectionTransports,
    }),
    runProductionEntryRoute: async ({ bundle: routedBundle, entryTransport: routedEntryTransport, protectionTransports: routedProtectionTransports }) => {
      calls.push({ type: "route", routedBundle, routedEntryTransport, routedProtectionTransports });
      return {
        ok: true,
        reason: "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED",
      };
    },
    now: () => "2026-04-22T01:00:00.000Z",
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_LIVE_EXECUTED_AND_PROTECTED");
  assert.strictEqual(result.request_id, "REQ__LIVE_ENDPOINT__1");
  assert.strictEqual(result.route_called, true);
  assert.strictEqual(result.route_result.reason, "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED");
  assert.strictEqual(result.transport_resolution.reason, "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_READY");
  assert.strictEqual(result.transport_resolution.entry_qty_abs, 0.4);
  assert.strictEqual(calls.length, 1);
  assert.strictEqual(calls[0].routedBundle.openclawDecision.decision_mode, "LIVE");
  assert.strictEqual(calls[0].routedEntryTransport, entryTransport);
  assert.strictEqual(calls[0].routedProtectionTransports, protectionTransports);
}

async function routeFailureIsNotReclassifiedAsSuccess() {
  const bundle = buildBundle();
  const result = await runV2ProductionEntryLiveEndpoint({
    env: buildEnv(),
    body: {
      confirm: LIVE_CONFIRM_PHRASE,
      bundle,
      entrySizingDecision: buildSizingDecision(bundle),
    },
    buildLiveTransports: async () => ({
      ok: true,
      reason: "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_READY",
      entryTransport: { submitEntryOrder: async () => ({}) },
      protectionTransports: {
        placeInitialSl: async () => ({}),
        placeInitialTp1: async () => ({}),
      },
    }),
    runProductionEntryRoute: async () => ({
      ok: false,
      reason: "V2_PRODUCTION_ENTRY_KERNEL_BLOCKED",
    }),
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_LIVE_ROUTE_BLOCKED");
  assert.strictEqual(result.route_called, true);
  assert.strictEqual(result.route_result.reason, "V2_PRODUCTION_ENTRY_KERNEL_BLOCKED");
}

async function transportFailureBlocksBeforeRoute() {
  const calls = [];
  const result = await runV2ProductionEntryLiveEndpoint({
    env: buildEnv(),
    body: {
      confirm: LIVE_CONFIRM_PHRASE,
      bundle: buildBundle(),
    },
    buildLiveTransports: async () => {
      throw new Error("V2_PRODUCTION_ENTRY_LIVE_SIZING_DECISION_REQUIRED");
    },
    runProductionEntryRoute: async () => {
      calls.push("route");
      return { ok: true };
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_BLOCKED");
  assert.strictEqual(result.transport_resolution.reason, "V2_PRODUCTION_ENTRY_LIVE_SIZING_DECISION_REQUIRED");
  assert.strictEqual(result.route_called, false);
  assert.deepStrictEqual(calls, []);
}

async function discoveryCanaryAllowsOnlyBoundedCanaryLiveWritePath() {
  const calls = [];
  const bundle = buildBundle({
    signalLineageId: "LINEAGE__ETH__DISCOVERY__CANARY_ENDPOINT",
    decisionMode: "CANARY",
  });
  const sizingDecision = buildSizingDecision(bundle, {
    requestedNotionalQuote: 12,
    maxNotionalQuote: 20,
    maxSizeRatio: 1,
  });
  const result = await runV2ProductionEntryLiveEndpoint({
    env: buildEnv({
      DONBEOLJA_V2_CANARY_ONLY: "1",
      DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "1",
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: "ETHUSDT",
      DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE: "20",
      DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT: "1",
      DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY: "1",
      DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE: "5",
    }),
    body: {
      confirm: DISCOVERY_CONFIRM_PHRASE,
      bundle,
      entrySizingDecision: sizingDecision,
      discoveryCanaryState: {
        active_position_n: 0,
        trade_count_24h: 0,
        daily_loss_quote: 0,
      },
    },
    buildLiveTransports: async () => ({
      ok: true,
      reason: "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_READY",
      entry_intent_id: sizingDecision.entry_intent_id,
      symbol: "ETHUSDT",
      side: "LONG",
      entry_qty_abs: sizingDecision.entry_qty_abs,
      entryTransport: { submitEntryOrder: async () => ({}) },
      protectionTransports: {
        placeInitialSl: async () => ({}),
        placeInitialTp1: async () => ({}),
      },
    }),
    runProductionEntryRoute: async ({ bundle: routedBundle }) => {
      calls.push(routedBundle.openclawDecision.decision_mode);
      return { ok: true, reason: "V2_PRODUCTION_ENTRY_EXECUTED_AND_PROTECTED" };
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_LIVE_EXECUTED_AND_PROTECTED");
  assert.strictEqual(result.discovery_canary_contract.ok, true);
  assert.deepStrictEqual(calls, ["CANARY"]);
}

async function discoveryCanaryBlocksUnsafeContractBeforeRoute() {
  const calls = [];
  const bundle = buildBundle({
    signalLineageId: "LINEAGE__ETH__DISCOVERY__CANARY_BLOCKED",
    decisionMode: "CANARY",
  });
  const sizingDecision = buildSizingDecision(bundle, {
    requestedNotionalQuote: 30,
    maxNotionalQuote: 40,
    maxSizeRatio: 1,
  });
  const result = await runV2ProductionEntryLiveEndpoint({
    env: buildEnv({
      DONBEOLJA_V2_CANARY_ONLY: "1",
      DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "1",
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: "ETHUSDT",
      DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE: "20",
    }),
    body: {
      confirm: DISCOVERY_CONFIRM_PHRASE,
      bundle,
      entrySizingDecision: sizingDecision,
      discoveryCanaryState: {
        active_position_n: 0,
        trade_count_24h: 0,
        daily_loss_quote: 0,
      },
    },
    buildLiveTransports: async () => ({
      ok: true,
      reason: "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_READY",
      symbol: "ETHUSDT",
      side: "LONG",
      entry_qty_abs: sizingDecision.entry_qty_abs,
      entryTransport: { submitEntryOrder: async () => ({}) },
      protectionTransports: {
        placeInitialSl: async () => ({}),
        placeInitialTp1: async () => ({}),
      },
    }),
    runProductionEntryRoute: async () => {
      calls.push("route");
      return { ok: true };
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_DISCOVERY_CANARY_CONTRACT_BLOCKED");
  assert.ok(result.discovery_canary_contract.blockers.includes("DISCOVERY_CANARY:MAX_NOTIONAL_EXCEEDED"));
  assert.deepStrictEqual(calls, []);
}

async function main() {
  await disabledEndpointBlocksBeforeRoute();
  await missingConfirmBlocksBeforeRoute();
  await canaryOnlyRuntimeBlocksBeforeRoute();
  await canaryDecisionBlocksBeforeRoute();
  await liveEndpointDelegatesOnlyToProductionRoute();
  await routeFailureIsNotReclassifiedAsSuccess();
  await transportFailureBlocksBeforeRoute();
  await discoveryCanaryAllowsOnlyBoundedCanaryLiveWritePath();
  await discoveryCanaryBlocksUnsafeContractBeforeRoute();
}

main()
  .then(() => {
    console.log("V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
