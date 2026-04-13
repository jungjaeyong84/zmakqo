"use strict";

const assert = require("assert");
const { buildExecutionQualityWatchReport } = require("../utils/executionQualityWatchReport");

(() => {
  const report = buildExecutionQualityWatchReport({
    executionQuality: {
      summary: {
        top_watch_markets: [
          { market: "DOGEUSDT", avg_created_to_fill_ms: 126181.89, avg_slippage_bps: 7.83, partial_fill_rate_pct: 92.53 },
          { market: "XRPUSDT", avg_created_to_fill_ms: 369844.75, avg_slippage_bps: 1.39, partial_fill_rate_pct: 48.24 },
        ],
        root_cause: {
          partial_fill: { driver_market: "DOGEUSDT" },
          slippage: { driver_market: "DOGEUSDT" },
        },
      },
    },
    executionModelDataset: {
      summary: {
        top_operational_signal_to_intent_groups: [
          { market: "DOGEUSDT", key: "EARLY_LONG|TV_WEBHOOK|DOGEUSDT", rows_n: 12, signal_to_intent_p95_ms: 42000 },
        ],
        top_entry_measured_latency_groups: [
          { market: "DOGEUSDT", key: "EARLY_LONG|UNKNOWN|BINANCE_USER_TRADES|DOGEUSDT", rows_n: 9, created_to_fill_p95_ms: 63152 },
        ],
        top_entry_fallback_latency_groups: [
          { market: "XRPUSDT", key: "CORE_LONG|UNKNOWN|BINANCE_ORDER|XRPUSDT", rows_n: 7, created_to_fill_p95_ms: 75803 },
        ],
        top_no_fill_buckets: [
          { key: "RUNTIME_ERROR|LIVE_EXCEPTION|TIMING_IMMEDIATE_EXEC", family: "RUNTIME_ERROR", reason: "LIVE_EXCEPTION", subtype: "TIMING_IMMEDIATE_EXEC", rows_n: 15 },
        ],
        top_no_fill_market_buckets: [
          { market: "DOGEUSDT", key: "DOGEUSDT|RUNTIME_ERROR|LIVE_EXCEPTION|TIMING_IMMEDIATE_EXEC", family: "RUNTIME_ERROR", reason: "LIVE_EXCEPTION", subtype: "TIMING_IMMEDIATE_EXEC", rows_n: 6 },
        ],
      },
    },
    limit: 2,
  });

  assert.strictEqual(report.summary.status, "EXECUTION_WATCH_MARKETS_REVIEW");
  assert.strictEqual(report.summary.review_market_n, 2);
  assert.strictEqual(report.summary.top_watch_market, "DOGEUSDT");
  assert.strictEqual(report.summary.top_no_fill_bucket.key, "RUNTIME_ERROR|LIVE_EXCEPTION|TIMING_IMMEDIATE_EXEC");
  assert.strictEqual(report.markets[0].market, "DOGEUSDT");
  assert.strictEqual(report.markets[0].slippage_severity, "CRITICAL");
  assert.strictEqual(report.markets[0].partial_fill_severity, "CRITICAL");
  assert.strictEqual(report.markets[0].top_operational_signal_to_intent_group.key, "EARLY_LONG|TV_WEBHOOK|DOGEUSDT");
  assert.strictEqual(report.markets[0].top_no_fill_market_bucket.reason, "LIVE_EXCEPTION");
  assert.ok(report.markets[0].recommended_actions.includes("REDUCE_MULTI_SLICE_FRAGMENTATION"));
  assert.ok(report.markets[0].recommended_actions.includes("LIMIT_CHASING_AND_REPRICE"));
  assert.strictEqual(report.markets[1].market, "XRPUSDT");
  assert.strictEqual(report.markets[1].latency_severity, "CRITICAL");
  assert.ok(report.markets[1].recommended_actions.includes("REDUCE_FALLBACK_MATCH_PATH"));

  console.log("EXECUTION_QUALITY_WATCH_REPORT_TEST_OK");
})();
