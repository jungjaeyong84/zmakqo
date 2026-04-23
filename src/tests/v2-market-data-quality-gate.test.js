"use strict";

const assert = require("assert");
const { evaluateMarketDataQualityGate } = require("../v2/marketDataQualityGate");

const nowMs = Date.parse("2026-04-23T04:00:00.000Z");

{
  const result = evaluateMarketDataQualityGate({
    nowMs,
    snapshot: {
      symbol: "ETHUSDT",
      candle_close_ms: nowMs - 60000,
      mark_price: 2300,
      index_price: 2301,
      best_bid: 2299.9,
      best_ask: 2300.1,
      volume_quote_24h: 50000000,
      gap_bars: 0,
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_MARKET_DATA_QUALITY_PASS");
}

{
  const result = evaluateMarketDataQualityGate({
    nowMs,
    env: {
      DONBEOLJA_V2_MARKET_DATA_MAX_CANDLE_AGE_MS: "120000",
      DONBEOLJA_V2_MARKET_DATA_MAX_SPREAD_BPS: "10",
      DONBEOLJA_V2_MARKET_DATA_MIN_VOLUME_QUOTE_24H: "1000000",
    },
    snapshot: {
      symbol: "THINUSDT",
      candle_close_ms: nowMs - 600000,
      mark_price: 100,
      index_price: 110,
      best_bid: 90,
      best_ask: 100,
      volume_quote_24h: 100,
      gap_bars: 2,
    },
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("MARKET_DATA:STALE_CANDLE"));
  assert.ok(result.blockers.includes("MARKET_DATA:MARK_INDEX_DIVERGENCE"));
  assert.ok(result.blockers.includes("MARKET_DATA:SPREAD_TOO_WIDE"));
  assert.ok(result.blockers.includes("MARKET_DATA:VOLUME_TOO_LOW"));
  assert.ok(result.blockers.includes("MARKET_DATA:CANDLE_GAP_DETECTED"));
}

console.log("V2_MARKET_DATA_QUALITY_GATE_TEST_OK");
