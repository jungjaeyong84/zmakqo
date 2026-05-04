"use strict";

const assert = require("assert");
const {
  collectBinanceMicrostructureFeatures,
  normalizeFundingRate,
  normalizeOrderBookDepth,
} = require("../v2/binanceMicrostructureFeatures");
const {
  collectMarketDataQuality,
  buildDiscoveryCanaryBundleFromIntent,
} = require("../v2/discoveryCanaryServerSignalBridge");

(function normalizesFundingRateToBpsPenalty() {
  const row = normalizeFundingRate([{ symbol: "BTCUSDT", fundingRate: "0.00025", fundingTime: 1, markPrice: "100" }]);
  assert.strictEqual(row.funding_rate, 0.00025);
  assert.strictEqual(row.funding_penalty_bps, 2.5);
})();

(function normalizesDepthImbalance() {
  const row = normalizeOrderBookDepth({
    bids: [["100", "2"], ["99", "1"]],
    asks: [["101", "1"], ["102", "1"]],
  });
  assert.ok(row.orderbook_bid_notional_top5 > row.orderbook_ask_notional_top5);
  assert.ok(row.orderbook_imbalance_top5 > 0);
  assert.ok(row.depth_spread_bps > 0);
})();

async function collectorFetchesFundingOiAndDepth() {
  const calls = [];
  const result = await collectBinanceMicrostructureFeatures({
    symbol: "ETHUSDT",
    fetchJson: async (path, params) => {
      calls.push({ path, params });
      if (path === "/fapi/v1/fundingRate") return [{ fundingRate: "0.0001", fundingTime: 10, markPrice: "2500" }];
      if (path === "/fapi/v1/openInterest") return { openInterest: "1234.5", symbol: "ETHUSDT", time: 11 };
      if (path === "/fapi/v1/depth") return { bids: [["2500", "2"]], asks: [["2501", "1"]] };
      throw new Error(`unexpected ${path}`);
    },
    liquidationSnapshot: {
      liquidation_notional_5m_quote: 12000000,
      liquidation_event_count_5m: 4,
      source: "TEST_FORCE_ORDER_STREAM",
    },
  });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(calls.map((row) => row.path), ["/fapi/v1/fundingRate", "/fapi/v1/openInterest", "/fapi/v1/depth"]);
  assert.strictEqual(result.features.funding_penalty_bps, 1);
  assert.strictEqual(result.features.open_interest, 1234.5);
  assert.strictEqual(result.features.liquidation_notional_5m_quote, 12000000);
  assert.ok(result.features.orderbook_imbalance_top5 > 0);
}

async function marketDataQualityEmbedsMicrostructureFeatures() {
  const result = await collectMarketDataQuality({
    symbol: "ETHUSDT",
    candleCloseMs: 1770000000000,
    nowMs: 1770000060000,
    fetchBookTicker: async () => ({ bidPrice: "2500", askPrice: "2501" }),
    fetchPublicJson: async (path) => {
      if (path === "/fapi/v1/premiumIndex") return { markPrice: "2500", indexPrice: "2500" };
      if (path === "/fapi/v1/ticker/24hr") return { quoteVolume: "10000000" };
      if (path === "/fapi/v1/klines") return [
        [1770000000000, "2400", "2410", "2390", "2400"],
        [1770003600000, "2500", "2510", "2490", "2505"],
      ];
      if (path === "/fapi/v1/fundingRate") return [{ fundingRate: "0.0001", fundingTime: 10, markPrice: "2500" }];
      if (path === "/fapi/v1/openInterest") return { openInterest: "1234.5", time: 11 };
      if (path === "/fapi/v1/depth") return { bids: [["2500", "2"]], asks: [["2501", "1"]] };
      throw new Error(`unexpected ${path}`);
    },
  });
  assert.strictEqual(result.quality.ok, true);
  assert.strictEqual(result.quality.metrics.microstructure_ok, true);
  assert.strictEqual(result.quality.metrics.funding_penalty_bps, 1);
  assert.strictEqual(result.quality.metrics.open_interest, 1234.5);
  assert.strictEqual(result.quality.metrics.btc_1h_trend, "LONG");
  assert.strictEqual(result.quality.metrics.mtf_1h_direction, "LONG");
}

(function bundleIncludesMicrostructureMetricsInFeatureSnapshotAndShadowFilters() {
  const bundle = buildDiscoveryCanaryBundleFromIntent({
    intentRow: {
      signal_id: "SIG__BINANCEFUT__ETHUSDT__15m__1770000000000__LONG",
      symbol: "ETHUSDT",
      event: "LONG",
      tf: "15m",
      features_json: {
        htf_regime: "LONG",
        htf_alignment_score: 0.82,
        mtf_1h_direction: "LONG",
        btc_1h_trend: "LONG",
        setup_type: "PULLBACK_RECLAIM",
        setup_quality_score: 0.8,
        trigger_confirmed: true,
        volume_zscore: 1.4,
        rsi_entry_tf: 58,
        volatility_30m_baseline_ratio: 1.2,
        expected_gross_r: 2.0,
        expected_net_r_after_cost: 0.3,
        expected_alpha_bps: 35,
        total_cost_bps: 12,
        cost_r_equivalent: 1.7,
        market_quality_score: 0.9,
      },
    },
    marketDataQuality: {
      ok: true,
      metrics: {
        spread_bps: 2,
        mark_index_gap_bps: 1,
        funding_penalty_bps: 1,
        open_interest: 1234.5,
        orderbook_imbalance_top5: 0.2,
      },
    },
    nowIso: "2026-04-26T00:00:00.000Z",
  });
  assert.strictEqual(bundle.featureSnapshot.feature_values.open_interest, 1234.5);
  assert.strictEqual(bundle.signalCriteria.shadow_filter_decision.shadow_verdict, "WOULD_PASS");
})();

collectorFetchesFundingOiAndDepth()
  .then(marketDataQualityEmbedsMicrostructureFeatures)
  .then(() => {
    console.log("V2_BINANCE_MICROSTRUCTURE_FEATURES_TEST_OK");
  })
  .catch((error) => {
    console.error(error && error.stack ? error.stack : error);
    process.exitCode = 1;
  });
