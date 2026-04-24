"use strict";

const assert = require("assert");
const {
  buildDiscoveryCanaryLiveRequestFromIntent,
  buildSignalCriteriaSeedFromIntent,
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
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT: "1",
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY: "1",
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
      ...overrides.features_json,
    },
    ...overrides,
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
  assert.ok(result.request.entrySizingDecision.notional_quote <= 6);
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

async function main() {
  await serverSignalRoutesToV2ProductionEntryLiveRequest();
  await marketDataQualityBlockFailsClosed();
  console.log("V2_DISCOVERY_SERVER_SIGNAL_BRIDGE_TEST_OK");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
