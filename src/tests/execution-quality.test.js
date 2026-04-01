"use strict";

const assert = require("assert");
const { summarizeExecutionQuality } = require("../utils/executionQuality");

(() => {
  const report = summarizeExecutionQuality({
    microstructure: {
      metrics: {
        latency: { created_to_fill_p95_ms: 61000 },
        slippage: { adverse_p95_bps: 82 },
        partial_fill: { partial_fill_rate_pct: 61 },
      },
    },
    bridgeLatency: {
      webhook_to_fill_ms: { p95: 62000 },
    },
    intents: [
      { intent_id: "i1", created_at: "2026-04-01T00:00:00.000Z" },
      { intent_id: "i2", created_at: "2026-04-01T00:10:00.000Z" },
    ],
    fills: [
      { intent_id: "i1", symbol: "SOLUSDT", created_at: "2026-04-01T00:01:00.000Z", slippage_bps: 12 },
      { intent_id: "i1", symbol: "SOLUSDT", created_at: "2026-04-01T00:01:20.000Z", slippage_bps: 16 },
      { intent_id: "i2", symbol: "BTCUSDT", created_at: "2026-04-01T00:12:00.000Z", slippage_bps: 4 },
    ],
  });

  assert.strictEqual(report.summary.status, "EXECUTION_QUALITY_REVIEW");
  assert.ok(report.summary.review_reasons.includes("CREATED_TO_FILL_P95_HIGH"));
  assert.ok(report.summary.review_reasons.includes("ADVERSE_SLIPPAGE_P95_HIGH"));
  assert.ok(report.summary.review_reasons.includes("PARTIAL_FILL_RATE_HIGH"));
  assert.ok(report.summary.review_reasons.includes("WEBHOOK_TO_FILL_P95_HIGH"));
  assert.strictEqual(report.summary.top_partial_market, "SOLUSDT");
  assert.strictEqual(report.by_market[0].market, "BTCUSDT");
  assert.strictEqual(report.by_market[1].market, "SOLUSDT");
})();

console.log("EXECUTION_QUALITY_TEST_OK");
