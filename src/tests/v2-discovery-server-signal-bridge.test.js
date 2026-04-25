"use strict";

const assert = require("assert");
const {
  buildDiscoveryCanaryLiveRequestFromIntent,
  buildSignalCriteriaSeedFromIntent,
  __test,
} = require("../v2/discoveryCanaryServerSignalBridge");

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
    DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP: "BTCUSDT:230|ETHUSDT:50|LINKUSDT:50|BNBUSDT:15|XRPUSDT:15|SOLUSDT:15|AXSUSDT:15|DOGEUSDT:15",
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT: "5",
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
  assert.ok(result.request.entrySizingDecision.notional_quote < 50);
  assert.ok(result.request.entrySizingDecision.notional_quote > 49);
}

async function main() {
  await serverSignalRoutesToV2ProductionEntryLiveRequest();
  await dogeLikeServerSignalRoutesDespiteReportOnlyEvDrop();
  await linkStepSafeNotionalCanPassWhenTp1MinNotionalIsSatisfied();
  await marketDataQualityBlockFailsClosed();
  console.log("V2_DISCOVERY_SERVER_SIGNAL_BRIDGE_TEST_OK");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
