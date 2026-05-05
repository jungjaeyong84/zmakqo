"use strict";

const assert = require("assert");
const { evaluateV2OpenClawDecisionGate } = require("../v2/openclawDecisionGate");

function buildBundle({ symbol = "SOLUSDT", side = "LONG", featureValues = {}, marketMetrics = {} } = {}) {
  return {
    signalIntent: {
      symbol,
      side,
    },
    featureSnapshot: {
      feature_values: {
        btc_1h_trend: "LONG",
        mtf_1h_direction: side,
        volatility_30m_baseline_ratio: 1.1,
        expected_alpha_bps: 30,
        total_cost_bps: 10,
        expected_net_r_after_cost: 0.3,
        funding_rate_bps: 1,
        liquidation_notional_5m_quote: 100000,
        open_interest_delta_pct_15m: 2,
        price_change_pct_15m: side === "LONG" ? 0.3 : -0.3,
        orderbook_bid_share_top5: side === "LONG" ? 0.55 : 0.45,
        ...featureValues,
      },
    },
    marketDataQuality: {
      ok: true,
      metrics: {
        spread_bps: 2,
        mark_index_gap_bps: 1,
        ...marketMetrics,
      },
    },
    signalCriteria: {
      present: true,
      verdict: "PASS",
      htf_regime: { regime: side },
      expected_edge_gate: {
        expected_net_r_after_cost: 0.3,
        cost_estimate_bps: 10,
      },
      feature_snapshot_contract: {},
    },
  };
}

function assertBlocked(result, fragment) {
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_OPENCLAW_DECISION_GATE_BLOCKED");
  assert.strictEqual(result.no_sizing_mutation, true);
  assert.ok(result.blockers.some((row) => row.includes(fragment)), JSON.stringify(result.blockers));
}

(function altLongBlocksWhenBtcOneHourTrendIsDown() {
  const result = evaluateV2OpenClawDecisionGate({
    env: { DONBEOLJA_V2_OPENCLAW_DECISION_GATE_ENABLED: "1" },
    bundle: buildBundle({ symbol: "SOLUSDT", side: "LONG", featureValues: { btc_1h_trend: "SHORT" } }),
  });
  assertBlocked(result, "BTC_1H_TREND_ALT_LONG");
})();

(function multiTfOppositionBlocks() {
  const result = evaluateV2OpenClawDecisionGate({
    bundle: buildBundle({ symbol: "XRPUSDT", side: "SHORT", featureValues: { mtf_1h_direction: "LONG" } }),
  });
  assertBlocked(result, "MULTI_TF_1H_ALIGNMENT");
})();

(function volatilityChaosBlocks() {
  const result = evaluateV2OpenClawDecisionGate({
    bundle: buildBundle({ symbol: "BNBUSDT", side: "LONG", featureValues: { volatility_30m_baseline_ratio: 3.4 } }),
  });
  assertBlocked(result, "VOLATILITY_CHAOS_30M");
})();

(function costAfterFeesBlocks() {
  const result = evaluateV2OpenClawDecisionGate({
    bundle: buildBundle({ symbol: "DOGEUSDT", side: "LONG", featureValues: { expected_alpha_bps: 8, total_cost_bps: 10 } }),
  });
  assertBlocked(result, "COST_ADJUSTED_EDGE");
})();

(function liquidationChaosBlocks() {
  const result = evaluateV2OpenClawDecisionGate({
    bundle: buildBundle({ symbol: "LINKUSDT", side: "LONG", featureValues: { liquidation_notional_5m_quote: 15000000 } }),
  });
  assertBlocked(result, "LIQUIDATION_CHAOS_5M");
})();

(function adverseFundingBlocks() {
  const result = evaluateV2OpenClawDecisionGate({
    bundle: buildBundle({ symbol: "ETHUSDT", side: "LONG", featureValues: { funding_rate_bps: 11 } }),
  });
  assertBlocked(result, "FUNDING_ADVERSE");
})();

(function openInterestDivergenceBlocks() {
  const result = evaluateV2OpenClawDecisionGate({
    bundle: buildBundle({
      symbol: "ARBUSDT",
      side: "LONG",
      featureValues: { open_interest_delta_pct_15m: 15, price_change_pct_15m: -1.2 },
    }),
  });
  assertBlocked(result, "OPEN_INTEREST_DIVERGENCE");
})();

(function orderbookAgainstSignalBlocks() {
  const result = evaluateV2OpenClawDecisionGate({
    bundle: buildBundle({ symbol: "SUIUSDT", side: "SHORT", featureValues: { orderbook_bid_share_top5: 0.8 } }),
  });
  assertBlocked(result, "ORDERBOOK_IMBALANCE_TOP5");
})();

(function missingOptionalEvidenceWarnsButDoesNotBlockByDefault() {
  const result = evaluateV2OpenClawDecisionGate({
    bundle: buildBundle({
      symbol: "TAOUSDT",
      side: "LONG",
      featureValues: {
        funding_rate_bps: undefined,
        liquidation_notional_5m_quote: undefined,
        open_interest_delta_pct_15m: undefined,
        price_change_pct_15m: undefined,
        orderbook_bid_share_top5: undefined,
      },
    }),
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_OPENCLAW_DECISION_GATE_PASS");
  assert.ok(result.warnings.length >= 3);
})();

(function observeOnlyModeDoesNotBlock() {
  const result = evaluateV2OpenClawDecisionGate({
    env: { DONBEOLJA_V2_OPENCLAW_DECISION_GATE_MODE: "OBSERVE_ONLY" },
    bundle: buildBundle({ symbol: "SOLUSDT", side: "LONG", featureValues: { btc_1h_trend: "SHORT" } }),
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_OPENCLAW_DECISION_GATE_PASS");
  assert.ok(result.blockers.some((row) => row.includes("BTC_1H_TREND_ALT_LONG")));
})();

(function disabledGateIsExplicitPass() {
  const result = evaluateV2OpenClawDecisionGate({
    env: { DONBEOLJA_V2_OPENCLAW_DECISION_GATE_ENABLED: "0" },
    bundle: buildBundle({ symbol: "SOLUSDT", side: "LONG", featureValues: { btc_1h_trend: "SHORT" } }),
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_OPENCLAW_DECISION_GATE_DISABLED");
  assert.strictEqual(result.enabled, false);
})();

console.log("V2_OPENCLAW_DECISION_GATE_TEST_OK");
