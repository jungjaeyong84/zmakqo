"use strict";

const assert = require("assert");
const {
  buildDiscoveryCanaryLiveRequestFromIntent,
  buildSignalCriteriaSeedFromIntent,
  __test,
} = require("../v2/discoveryCanaryServerSignalBridge");
const { resolveV2CollectionName } = require("../v2/storage");
const protectedCanary = require("../v2/productionEntryProtectedCanary");

function buildEnv(overrides = {}) {
  return {
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_CANARY_ONLY: "1",
    DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "1",
    DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "1",
    DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: "BTCUSDT|ETHUSDT|BNBUSDT|XRPUSDT|SOLUSDT|AXSUSDT|DOGEUSDT|LINKUSDT",
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT: "8",
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE: "6",
    DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP: "BTCUSDT:155|ETHUSDT:42|LINKUSDT:41|BNBUSDT:13|XRPUSDT:11|SOLUSDT:11|AXSUSDT:12|DOGEUSDT:11",
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT: "8",
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY: "UNLIMITED",
    DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE: "10",
    DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED: "1",
    ML_LIVE_SERVING_ARMED: "0",
    OPENCLAW_AGENT_APPLY_ENABLED: "0",
    DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL: "1",
    DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL: "0",
    ...overrides,
  };
}

function buildIntent(overrides = {}) {
  const { features_json: featureOverrides = {}, ...rowOverrides } = overrides || {};
  return {
    intent_id: "INTENT__BNB__TEST",
    request_id: "REQ__BNB__TEST",
    exchange: "BINANCEFUT",
    symbol_or_pair_id: "BNBUSDT",
    tf: "15m",
    event: "LONG",
    side: "BUY",
    qty_pct: 1,
    signal_price: 600,
    signal_bar_close_time_utc: "2026-04-24T07:15:00.000Z",
    signal_bar_close_time_utc_ms: Date.parse("2026-04-24T07:15:00.000Z"),
    signal_id: "SIG__BINANCEFUT__BNBUSDT__15m__1777001400000__LONG",
    features_json: {
      signal_id: "SIG__BINANCEFUT__BNBUSDT__15m__1777001400000__LONG",
      signal_family: "LONG",
      setup_type: "PULLBACK_RECLAIM",
      trigger_type: "RECLAIM",
      trigger_confirmed: true,
      htf_regime: "LONG",
      htf_alignment_score: 0.62,
      setup_quality_score: 0.72,
      volume_ratio: 1.05,
      rsi_entry_tf: 50.4,
      expected_gross_r: 1.6,
      expected_net_r_after_cost: 0.35,
      cost_r_equivalent: 1.25,
      funding_penalty_bps: 0,
      score_norm: 0.67,
      ...featureOverrides,
    },
    ...rowOverrides,
  };
}

function marketDataQuality(overrides = {}) {
  return {
    ok: true,
    reason: "V2_MARKET_DATA_QUALITY_PASS",
    blockers: [],
    warnings: [],
    metrics: {
      symbol: "BNBUSDT",
      candle_age_ms: 60_000,
      mark_index_divergence_bps: 1.1,
      spread_bps: 2.2,
      volume_quote_24h: 250_000_000,
      gap_bars: 0,
    },
    ...overrides,
  };
}

(function serverSignalEvidenceBuildsPassCriteriaSeed() {
  const seed = buildSignalCriteriaSeedFromIntent({
    intentRow: buildIntent(),
    marketDataQuality: marketDataQuality(),
  });
  assert.strictEqual(seed.htf_regime.regime, "LONG");
  assert.strictEqual(seed.setup_gate.setup_type, "PULLBACK_RECLAIM");
  assert.strictEqual(seed.trigger_gate.trigger_confirmed, true);
  assert.strictEqual(seed.no_trade_gate.spread_bps, 2.2);
  assert.strictEqual(seed.expected_edge_gate.expected_gross_r, 1.6);
  assert.strictEqual(seed.expected_edge_gate.expected_net_r_after_cost, 0.35);
  assert.strictEqual(seed.expected_edge_gate.cost_r_equivalent, 1.25);
})();

(function serverSignalSeedAcceptsTopLevelMarketQualityMetrics() {
  const seed = buildSignalCriteriaSeedFromIntent({
    intentRow: buildIntent({
      features_json: {
        expected_net_r_after_cost: undefined,
        cost_r_equivalent: undefined,
        ev_gate_expected_exit_value_r: 0.2,
        ev_gate_sl_pct: 1.65,
      },
    }),
    marketDataQuality: {
      ok: true,
      spread_bps: 3,
      mark_index_gap_bps: 1.4,
    },
  });
  assert.strictEqual(seed.no_trade_gate.spread_bps, 3);
  assert.strictEqual(seed.no_trade_gate.mark_index_gap_bps, 1.4);
  assert.ok(seed.expected_edge_gate.expected_net_r_after_cost > 1.4);
  assert.ok(seed.expected_edge_gate.cost_r_equivalent > 0);
  assert.ok(seed.expected_edge_gate.cost_estimate_bps >= 11);
})();

(function discoveryStateUsesLiveAccountActivePositionsAsHardSource() {
  const state = __test.mergeDiscoveryCanaryStateWithAccount({
    state: {
      active_position_n: 0,
      trade_count_24h: 0,
      daily_realized_pnl_quote: 0,
    },
    accountSummary: {
      positions: [{ symbol: "SOLUSDT", side: "LONG", qty_abs: 0.12, notional_quote: 10.4 }],
    },
  });
  assert.strictEqual(state.active_position_n, 1);
  assert.strictEqual(state.exchange_active_position_n, 1);
  assert.strictEqual(state.exchange_positions[0].symbol, "SOLUSDT");
})();

(function discoveryStateKeepsTradeEvidenceFailClosedWhenFirestoreFails() {
  const state = __test.mergeDiscoveryCanaryStateWithAccount({
    state: {
      active_position_n: null,
      trade_count_24h: null,
      daily_realized_pnl_quote: null,
      fill_state_error: "FIRESTORE_UNAVAILABLE",
    },
    accountSummary: { positions: [] },
  });
  assert.strictEqual(state.active_position_n, 0);
  assert.strictEqual(state.trade_count_24h, null);
  assert.strictEqual(state.fill_state_error, "FIRESTORE_UNAVAILABLE");
})();

async function dogeLikeServerSignalRoutesDespiteReportOnlyEvDrop() {
  const result = await buildDiscoveryCanaryLiveRequestFromIntent({
    env: buildEnv(),
    intentRow: buildIntent({
      intent_id: "INTENT__DOGE__TEST",
      request_id: "REQ__DOGE__TEST",
      symbol_or_pair_id: "DOGEUSDT",
      signal_price: 0.09768,
      signal_id: "SIG__BINANCEFUT__DOGEUSDT__15m__1777017600000__LONG",
      features_json: {
        signal_family: "LONG",
        setup_type: "PULLBACK_RECLAIM",
        trigger_type: "RECLAIM",
        trigger_confirmed: true,
        htf_regime: "LONG",
        htf_alignment_score: 1,
        setup_quality_score: 0.5861904761904727,
        volume_ratio: 1.8119614036857628,
        rsi_entry_tf: 58.819981858799345,
        expected_gross_r: 1.555555555555534,
        expected_net_r_after_cost: undefined,
        cost_r_equivalent: undefined,
        ev_gate_expected_exit_value_r: 0.20444919329096276,
        ev_gate_report_only_would_drop: true,
        ev_gate_sl_pct: 1.65,
        funding_penalty_bps: 0,
        score_norm: 0.7271203077663227,
      },
    }),
    liveCfg: { maxOrderQuote: 6, minOrderQuote: 5 },
    referencePrice: 0.09768,
    nowMs: Date.parse("2026-04-24T08:01:26.000Z"),
    nowIso: "2026-04-24T08:01:26.000Z",
    marketDataQuality: {
      ok: true,
      reason: "V2_MARKET_DATA_QUALITY_PASS",
      blockers: [],
      spread_bps: 3,
      mark_index_gap_bps: 1,
    },
    exchangeInfo: {
      minNotional: 5,
      minQty: 1,
      stepSize: 1,
    },
    discoveryState: {
      active_position_n: 0,
      trade_count_24h: 0,
      daily_realized_pnl_quote: 0,
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.request.routedDecision.ok, true);
  assert.strictEqual(result.request.routedDecision.entryIntent.symbol, "DOGEUSDT");
  const criteria = result.request.body.bundle.openclawDecision.canonical_evidence_summary.signal_criteria;
  assert.strictEqual(criteria.verdict, "PASS");
  assert.ok(criteria.expected_edge_gate.expected_net_r_after_cost > 1.4);
}

async function dogeLowNotionalBlocksWhenPartialTp1CannotMeetExchangeMinimum() {
  const result = await buildDiscoveryCanaryLiveRequestFromIntent({
    env: buildEnv({
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP: "DOGEUSDT:6",
    }),
    intentRow: buildIntent({
      symbol_or_pair_id: "DOGEUSDT",
      event: "LONG",
      side: "BUY",
      signal_price: 0.1,
      features_json: {
        signal_id: "SIG__BINANCEFUT__DOGEUSDT__15m__1777001400000__LONG",
      },
    }),
    liveCfg: { maxOrderQuote: 6, minOrderQuote: 5 },
    referencePrice: 0.1,
    nowMs: Date.parse("2026-04-24T08:01:26.000Z"),
    nowIso: "2026-04-24T08:01:26.000Z",
    marketDataQuality: {
      ok: true,
      reason: "V2_MARKET_DATA_QUALITY_PASS",
      blockers: [],
      spread_bps: 3,
      mark_index_gap_bps: 1,
    },
    exchangeInfo: {
      minNotional: 5,
      minQty: 1,
      stepSize: 1,
    },
    discoveryState: {
      active_position_n: 0,
      trade_count_24h: 0,
      daily_realized_pnl_quote: 0,
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_PRODUCTION_ENTRY_LIVE_SIZING_NOT_APPROVED");
  assert.strictEqual(result.entrySizingDecision.reason, "PARTIAL_TP1_MIN_NOTIONAL_REQUIRED");
}

async function serverSignalRoutesToV2ProductionEntryLiveRequest() {
  const result = await buildDiscoveryCanaryLiveRequestFromIntent({
    env: buildEnv(),
    intentRow: buildIntent(),
    liveCfg: { maxOrderQuote: 6, minOrderQuote: 5 },
    referencePrice: 600,
    nowMs: Date.parse("2026-04-24T07:16:00.000Z"),
    marketDataQuality: marketDataQuality(),
    exchangeInfo: {
      minNotional: 5,
      minQty: 0.01,
      stepSize: 0.01,
    },
    discoveryState: {
      active_position_n: 0,
      trade_count_24h: 0,
      daily_realized_pnl_quote: 0,
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_DISCOVERY_BRIDGE_REQUEST_READY");
  assert.strictEqual(result.request.body.confirm, "EXECUTE_V2_DISCOVERY_CANARY");
  assert.strictEqual(result.request.body.bundle.openclawDecision.decision_mode, "CANARY");
  assert.strictEqual(result.request.body.bundle.signalIntent.symbol, "BNBUSDT");
  assert.strictEqual(result.request.body.bundle.signalIntent.side, "LONG");
  assert.strictEqual(result.request.routedDecision.ok, true);
  assert.strictEqual(result.request.routedDecision.entryIntent.signal_criteria_verdict, "PASS");
  assert.ok(result.request.entrySizingDecision.notional_quote <= 15);
}

async function bridgePersistsRouteRequiredLedgersBeforeEndpoint() {
  const db = protectedCanary.__test.createMemoryFirestore();
  const env = buildEnv();
  const built = await buildDiscoveryCanaryLiveRequestFromIntent({
    env,
    db,
    intentRow: buildIntent(),
    liveCfg: { maxOrderQuote: 6, minOrderQuote: 5 },
    referencePrice: 600,
    nowMs: Date.parse("2026-04-24T07:16:00.000Z"),
    marketDataQuality: marketDataQuality(),
    exchangeInfo: {
      minNotional: 5,
      minQty: 0.01,
      stepSize: 0.01,
    },
    discoveryState: {
      active_position_n: 0,
      trade_count_24h: 0,
      daily_realized_pnl_quote: 0,
    },
  });
  assert.strictEqual(built.ok, true);
  const persisted = await __test.persistDiscoveryBridgeLedgers({
    db,
    env,
    built,
    nowIso: "2026-04-24T07:16:00.000Z",
  });
  assert.strictEqual(persisted.ok, true);
  assert.strictEqual(persisted.reason, "V2_DISCOVERY_BRIDGE_LEDGER_PERSISTED");

  const permitCollection = resolveV2CollectionName("OPENCLAW_EXECUTION_PERMITS", env);
  const permitSnap = await db.collection(permitCollection)
    .doc(built.request.executionPermit.openclaw_execution_permit_id)
    .get();
  assert.strictEqual(permitSnap.exists, true);
  assert.strictEqual(permitSnap.data().permit_status, "ISSUED");

  const worldCollection = resolveV2CollectionName("OPENCLAW_WORLD_STATES", env);
  const worldSnap = await db.collection(worldCollection)
    .doc(built.request.worldState.openclaw_world_state_id)
    .get();
  assert.strictEqual(worldSnap.exists, true);

  const bundleCollection = resolveV2CollectionName("OPENCLAW_DECISION_BUNDLES", env);
  const bundleSnap = await db.collection(bundleCollection)
    .doc(persisted.decision_bundle.doc.openclaw_decision_bundle_id)
    .get();
  assert.strictEqual(bundleSnap.exists, true);
}

async function bridgeDoesNotReissueAlreadyClaimedPermit() {
  const db = protectedCanary.__test.createMemoryFirestore();
  const env = buildEnv();
  const built = await buildDiscoveryCanaryLiveRequestFromIntent({
    env,
    db,
    intentRow: buildIntent({
      intent_id: "INTENT__BNB__CLAIMED",
      signal_id: "SIG__BINANCEFUT__BNBUSDT__15m__1777002300000__LONG",
      features_json: {
        signal_id: "SIG__BINANCEFUT__BNBUSDT__15m__1777002300000__LONG",
      },
    }),
    liveCfg: { maxOrderQuote: 6, minOrderQuote: 5 },
    referencePrice: 600,
    nowMs: Date.parse("2026-04-24T07:31:00.000Z"),
    marketDataQuality: marketDataQuality(),
    exchangeInfo: {
      minNotional: 5,
      minQty: 0.01,
      stepSize: 0.01,
    },
    discoveryState: {
      active_position_n: 0,
      trade_count_24h: 0,
      daily_realized_pnl_quote: 0,
    },
  });
  assert.strictEqual(built.ok, true);
  const permitCollection = resolveV2CollectionName("OPENCLAW_EXECUTION_PERMITS", env);
  db.__seedDoc(
    permitCollection,
    built.request.executionPermit.openclaw_execution_permit_id,
    {
      ...built.request.executionPermit,
      permit_status: "CLAIMED",
      execution_claim_id: "CLAIM__EXISTING",
    },
  );

  const persisted = await __test.persistDiscoveryBridgeLedgers({
    db,
    env,
    built,
    nowIso: "2026-04-24T07:31:00.000Z",
  });
  assert.strictEqual(persisted.ok, false);
  assert.strictEqual(persisted.reason, "V2_DISCOVERY_BRIDGE_EXECUTION_PERMIT_LEDGER_WRITE_FAILED");
  assert.strictEqual(persisted.execution_permit.reason, "OPENCLAW_EXECUTION_PERMIT_LEDGER_ALREADY_USED");
}

async function marketDataQualityBlockFailsClosed() {
  const result = await buildDiscoveryCanaryLiveRequestFromIntent({
    env: buildEnv(),
    intentRow: buildIntent(),
    liveCfg: { maxOrderQuote: 6, minOrderQuote: 5 },
    referencePrice: 600,
    marketDataQuality: marketDataQuality({
      ok: false,
      reason: "V2_MARKET_DATA_QUALITY_BLOCKED",
      blockers: ["MARKET_DATA:SPREAD_TOO_WIDE"],
    }),
    exchangeInfo: {
      minNotional: 5,
      minQty: 0.01,
      stepSize: 0.01,
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_DISCOVERY_BRIDGE_MARKET_DATA_QUALITY_BLOCKED");
}

async function linkStepSafeNotionalCanPassWhenTp1MinNotionalIsSatisfied() {
  const result = await buildDiscoveryCanaryLiveRequestFromIntent({
    env: buildEnv(),
    intentRow: buildIntent({
      intent_id: "INTENT__LINK__TEST",
      request_id: "REQ__LINK__TEST",
      symbol_or_pair_id: "LINKUSDT",
      signal_price: 9.41018307,
      signal_id: "SIG__BINANCEFUT__LINKUSDT__15m__1777080600000__LONG",
      features_json: {
        signal_id: "SIG__BINANCEFUT__LINKUSDT__15m__1777080600000__LONG",
      },
    }),
    liveCfg: { maxOrderQuote: 6, minOrderQuote: 20 },
    referencePrice: 9.41018307,
    nowMs: Date.parse("2026-04-25T01:31:00.000Z"),
    marketDataQuality: marketDataQuality({
      metrics: {
        symbol: "LINKUSDT",
        candle_age_ms: 60_000,
        mark_index_divergence_bps: 1.1,
        spread_bps: 2.2,
        quality_score: 0.95,
      },
    }),
    exchangeInfo: {
      minNotional: 20,
      minQty: 0.01,
      stepSize: 0.01,
    },
    discoveryState: {
      active_position_n: 0,
      trade_count_24h: 0,
      daily_realized_pnl_quote: 0,
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_DISCOVERY_BRIDGE_REQUEST_READY");
  assert.strictEqual(result.request.entrySizingDecision.symbol, "LINKUSDT");
  assert.ok(result.request.entrySizingDecision.notional_quote < 42);
  assert.ok(result.request.entrySizingDecision.notional_quote > 40);
}

async function shadowCounterfactualWireUpDerivesInputsFromBundle() {
  const env = buildEnv();
  const built = await buildDiscoveryCanaryLiveRequestFromIntent({
    env,
    db: null,
    intentRow: buildIntent(),
    liveCfg: { maxOrderQuote: 6, minOrderQuote: 5 },
    referencePrice: 600,
    nowMs: Date.parse("2026-04-24T07:16:00.000Z"),
    marketDataQuality: marketDataQuality(),
    exchangeInfo: { minNotional: 5, minQty: 0.01, stepSize: 0.01 },
    discoveryState: { active_position_n: 0, trade_count_24h: 0, daily_realized_pnl_quote: 0 },
  });
  assert.strictEqual(built.ok, true);
  const inputs = __test.deriveCounterfactualInputs({
    bundle: built.bundle,
    intentRow: buildIntent(),
    request: built.request,
    body: built.request && built.request.body,
  });
  assert.ok(inputs, "INPUTS_NOT_NULL");
  assert.strictEqual(inputs.symbol, "BNBUSDT");
  assert.strictEqual(inputs.side, "LONG");
  assert.strictEqual(inputs.candle_close_ms, Date.parse("2026-04-24T07:15:00.000Z"));
  assert.ok(typeof inputs.shadow_filter_decision === "object" && inputs.shadow_filter_decision !== null);
  assert.ok(["PASS", "BLOCK"].includes(inputs.signal_verdict));
}

async function shadowCounterfactualWireUpReturnsNullWithoutShadowDecision() {
  const inputs = __test.deriveCounterfactualInputs({
    bundle: { signalIntent: { symbol: "BTCUSDT", side: "LONG" }, signalCriteria: null },
    intentRow: { signal_bar_close_time_utc_ms: 1700000000000 },
    request: null,
    body: null,
  });
  assert.strictEqual(inputs, null);
}

async function shadowCounterfactualWireUpReturnsNullWithoutCandleCloseMs() {
  const inputs = __test.deriveCounterfactualInputs({
    bundle: {
      signalIntent: { symbol: "BTCUSDT", side: "LONG", signal_intent_id: "id" },
      signalCriteria: { shadow_filter_decision: { shadow_verdict: "WOULD_PASS", filters: [] } },
      openclawDecision: { approved: true },
    },
    intentRow: {},
    request: null,
    body: null,
  });
  assert.strictEqual(inputs, null);
}

async function shadowCounterfactualWireUpFiresAndForgetsWhenLedgerEnabled() {
  const db = protectedCanary.__test.createMemoryFirestore();
  const env = buildEnv({ DONBEOLJA_V2_SIGNAL_SHADOW_COUNTERFACTUAL_LEDGER_ENABLED: "1" });
  const built = await buildDiscoveryCanaryLiveRequestFromIntent({
    env,
    db,
    intentRow: buildIntent(),
    liveCfg: { maxOrderQuote: 6, minOrderQuote: 5 },
    referencePrice: 600,
    nowMs: Date.parse("2026-04-24T07:16:00.000Z"),
    marketDataQuality: marketDataQuality(),
    exchangeInfo: { minNotional: 5, minQty: 0.01, stepSize: 0.01 },
    discoveryState: { active_position_n: 0, trade_count_24h: 0, daily_realized_pnl_quote: 0 },
  });
  assert.strictEqual(built.ok, true);
  const persisted = await __test.persistDiscoveryBridgeLedgers({
    db,
    env,
    built,
    intentRow: buildIntent(),
    nowIso: "2026-04-24T07:16:00.000Z",
  });
  assert.strictEqual(persisted.ok, true);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const cfWrites = (db.__v2_canary_writes || []).filter(
    (w) => w && w.ref && w.ref.collectionName === "v2__signal_shadow_counterfactuals",
  );
  assert.ok(cfWrites.length >= 1, "COUNTERFACTUAL_RECORD_WRITTEN");
  const payload = cfWrites[0].payload;
  assert.strictEqual(payload.symbol, "BNBUSDT");
  assert.strictEqual(payload.side, "LONG");
  assert.strictEqual(payload.status, "PENDING");
}

async function shadowCounterfactualWireUpSkipsWhenLedgerDisabled() {
  const db = protectedCanary.__test.createMemoryFirestore();
  const env = buildEnv();
  const built = await buildDiscoveryCanaryLiveRequestFromIntent({
    env,
    db,
    intentRow: buildIntent(),
    liveCfg: { maxOrderQuote: 6, minOrderQuote: 5 },
    referencePrice: 600,
    nowMs: Date.parse("2026-04-24T07:16:00.000Z"),
    marketDataQuality: marketDataQuality(),
    exchangeInfo: { minNotional: 5, minQty: 0.01, stepSize: 0.01 },
    discoveryState: { active_position_n: 0, trade_count_24h: 0, daily_realized_pnl_quote: 0 },
  });
  assert.strictEqual(built.ok, true);
  const persisted = await __test.persistDiscoveryBridgeLedgers({
    db,
    env,
    built,
    intentRow: buildIntent(),
    nowIso: "2026-04-24T07:16:00.000Z",
  });
  assert.strictEqual(persisted.ok, true);
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
  const cfWrites = (db.__v2_canary_writes || []).filter(
    (w) => w && w.ref && w.ref.collectionName === "v2__signal_shadow_counterfactuals",
  );
  assert.strictEqual(cfWrites.length, 0, "COUNTERFACTUAL_RECORD_NOT_WRITTEN_WHEN_DISABLED");
}

async function main() {
  await serverSignalRoutesToV2ProductionEntryLiveRequest();
  await bridgePersistsRouteRequiredLedgersBeforeEndpoint();
  await bridgeDoesNotReissueAlreadyClaimedPermit();
  await dogeLikeServerSignalRoutesDespiteReportOnlyEvDrop();
  await dogeLowNotionalBlocksWhenPartialTp1CannotMeetExchangeMinimum();
  await linkStepSafeNotionalCanPassWhenTp1MinNotionalIsSatisfied();
  await marketDataQualityBlockFailsClosed();
  await shadowCounterfactualWireUpDerivesInputsFromBundle();
  await shadowCounterfactualWireUpReturnsNullWithoutShadowDecision();
  await shadowCounterfactualWireUpReturnsNullWithoutCandleCloseMs();
  await shadowCounterfactualWireUpFiresAndForgetsWhenLedgerEnabled();
  await shadowCounterfactualWireUpSkipsWhenLedgerDisabled();
  console.log("V2_DISCOVERY_SERVER_SIGNAL_BRIDGE_TEST_OK");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
