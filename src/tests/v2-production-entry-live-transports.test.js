"use strict";

const assert = require("assert");
const crypto = require("crypto");
const { buildOpenClawDecisionBundle } = require("../v2/openclawControlPlane");
const { buildV2EntrySizingDecision } = require("../v2/entrySizingDecision");
const {
  buildV2ProductionEntryLiveTransports,
  validateLiveCfgForEntry,
  summarizeLiveCfg,
} = require("../v2/productionEntryLiveTransports");
const { buildPassSignalCriteriaSeed } = require("./helpers/passSignalCriteriaSeed");

function buildBundle(overrides = {}) {
  return buildOpenClawDecisionBundle({
    signalSourceMode: "SERVER_NATIVE_ML_AI",
    signalLineageId: "LINEAGE__ETH__PROD_ENTRY__LIVE_TRANSPORTS",
    symbol: "ETHUSDT",
    side: "LONG",
    qualityScore: 0.86,
    budgetCheckResult: "PASS",
    minOrderCheckResult: "PASS",
    decisionStatus: "APPROVED",
    decisionMode: "LIVE",
    recommendedAction: "APPROVE_ENTRY",
    approved: true,
    rationaleSummary: "production live transports approved",
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
    featuresHash: "feat_hash_prod_entry_live_transports",
    modelVersion: "openclaw-ml-v2",
    decisionSummary: "production live transports long approved",
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

function entryIntentIdFor(bundle) {
  return `EINTV2__${crypto.createHash("sha1").update(String(bundle.signalIntent.signal_intent_id)).digest("hex").slice(0, 10)}`;
}

function buildSizingDecision(bundle = buildBundle(), overrides = {}) {
  return buildV2EntrySizingDecision({
    entryIntent: {
      entry_intent_id: entryIntentIdFor(bundle),
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

async function buildsTransportsFromApprovedSizingAndLiveCfg() {
  const bundle = buildBundle();
  const calls = [];
  const entryTransport = { submitEntryOrder: async () => ({}) };
  const protectionTransports = {
    placeInitialSl: async () => ({}),
    placeInitialTp1: async () => ({}),
  };
  const result = await buildV2ProductionEntryLiveTransports({
    bundle,
    body: {
      entrySizingDecision: buildSizingDecision(bundle),
    },
    resolveLiveCfg: async ({ exchange, symbol }) => {
      calls.push({ type: "liveCfg", exchange, symbol });
      return {
        apiKey: "key",
        apiSecret: "secret",
        liveEnabled: true,
        liveDryRun: false,
        executionMode: "LIVE",
      };
    },
    buildEntryTransport: ({ liveCfg, quantityResolver }) => {
      calls.push({
        type: "entryTransport",
        liveCfg,
        qty: quantityResolver({
          entryIntent: {
            entry_intent_id: entryIntentIdFor(bundle),
            symbol: "ETHUSDT",
            side: "LONG",
          },
        }),
      });
      return entryTransport;
    },
    buildProtectionTransports: ({ liveCfg }) => {
      calls.push({ type: "protectionTransports", liveCfg });
      return protectionTransports;
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_READY");
  assert.strictEqual(result.entry_qty_abs, 0.4);
  assert.strictEqual(result.entryTransport, entryTransport);
  assert.strictEqual(result.protectionTransports, protectionTransports);
  assert.deepStrictEqual(calls.map((row) => row.type), ["liveCfg", "entryTransport", "protectionTransports"]);
  assert.strictEqual(calls[0].symbol, "ETHUSDT");
  assert.strictEqual(calls[1].qty, 0.4);
  assert.strictEqual(result.live_cfg_summary.api_secret_present, true);
  assert.strictEqual(result.live_cfg_summary.apiSecret, undefined);
}

async function missingSizingDecisionFailsBeforeTransportFactories() {
  const calls = [];
  await assert.rejects(
    () => buildV2ProductionEntryLiveTransports({
      bundle: buildBundle(),
      resolveLiveCfg: async () => {
        calls.push("liveCfg");
        return {};
      },
    }),
    /V2_PRODUCTION_ENTRY_LIVE_SIZING_DECISION_REQUIRED/
  );
  assert.deepStrictEqual(calls, []);
}

async function dryRunLiveCfgIsRejectedForLiveEndpoint() {
  const bundle = buildBundle();
  await assert.rejects(
    () => buildV2ProductionEntryLiveTransports({
      bundle,
      body: { entrySizingDecision: buildSizingDecision(bundle) },
      resolveLiveCfg: async () => ({
        apiKey: "key",
        apiSecret: "secret",
        liveEnabled: true,
        liveDryRun: true,
      }),
    }),
    /V2_PRODUCTION_ENTRY_LIVE_CFG_DRY_RUN_BLOCKED/
  );
}

async function sizingDecisionMustMatchRoutedIntent() {
  const bundle = buildBundle();
  await assert.rejects(
    () => buildV2ProductionEntryLiveTransports({
      bundle,
      body: {
        entrySizingDecision: buildSizingDecision(bundle, {
          entryIntent: {
            entry_intent_id: "EINTV2__OTHER",
            symbol: "ETHUSDT",
            side: "LONG",
          },
        }),
      },
      resolveLiveCfg: async () => ({
        apiKey: "key",
        apiSecret: "secret",
        liveEnabled: true,
        liveDryRun: false,
      }),
    }),
    /ENTRY_SIZING_INTENT_MISMATCH/
  );
}

async function bodyAndBundleSizingConflictFailsClosed() {
  const bundle = buildBundle({ signalLineageId: "LINEAGE__ETH__PROD_ENTRY__LIVE_TRANSPORTS_CONFLICT" });
  const embeddedSizing = buildSizingDecision(bundle);
  await assert.rejects(
    () => buildV2ProductionEntryLiveTransports({
      bundle: {
        ...bundle,
        entrySizingDecision: embeddedSizing,
      },
      body: {
        entrySizingDecision: {
          ...embeddedSizing,
          entry_qty_abs: embeddedSizing.entry_qty_abs + 0.001,
        },
      },
      resolveLiveCfg: async () => ({
        apiKey: "key",
        apiSecret: "secret",
        liveEnabled: true,
        liveDryRun: false,
      }),
    }),
    /V2_PRODUCTION_ENTRY_LIVE_SIZING_DECISION_CONFLICT/
  );
}

function validationNeverLeaksSecretsInSummary() {
  const cfg = validateLiveCfgForEntry({
    apiKey: "key",
    apiSecret: "secret",
    liveEnabled: true,
    liveDryRun: false,
  });
  const summary = summarizeLiveCfg({
    ...cfg,
    symbol: "ETHUSDT",
  });
  assert.strictEqual(summary.api_key_present, true);
  assert.strictEqual(summary.api_secret_present, true);
  assert.strictEqual(summary.apiKey, undefined);
  assert.strictEqual(summary.apiSecret, undefined);
}

async function main() {
  await buildsTransportsFromApprovedSizingAndLiveCfg();
  await missingSizingDecisionFailsBeforeTransportFactories();
  await dryRunLiveCfgIsRejectedForLiveEndpoint();
  await sizingDecisionMustMatchRoutedIntent();
  await bodyAndBundleSizingConflictFailsClosed();
  validationNeverLeaksSecretsInSummary();
}

main()
  .then(() => {
    console.log("V2_PRODUCTION_ENTRY_LIVE_TRANSPORTS_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
