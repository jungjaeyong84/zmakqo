"use strict";

const assert = require("assert");
const { deriveServerMarketCapitalAllocator } = require("../utils/serverMarketCapitalAllocator");

(() => {
  const summary = deriveServerMarketCapitalAllocator({
    marketObjectiveScore: {
      summary: {},
      by_market: [
        { market: "BTCUSDT", active: true, objective_score: 1.4, recovery_priority_score: 1.2, drop_avg_horizon_pnl_quote_proxy: 5, objective_band: "NEUTRAL" },
        { market: "XRPUSDT", active: true, objective_score: 0.8, recovery_priority_score: 0.4, drop_avg_horizon_pnl_quote_proxy: 2, objective_band: "NEUTRAL" },
      ],
    },
    explorationBudget: {
      summary: {
        production_markets: ["BTCUSDT", "XRPUSDT"],
        exploration_markets: [],
        deferred_penalty_markets: [],
      },
    },
    failureLearningLoop: {
      summary: {
        market_breakdown: [
          { market: "BTCUSDT", fail_n: 5, negative_realized_n: 3, avg_realized_ret_net: -0.01, dominant_failure_pattern: "NEGATIVE_REALIZED" },
          { market: "XRPUSDT", fail_n: 2, negative_realized_n: 1, avg_realized_ret_net: -0.002, dominant_failure_pattern: "TP0_NO_TP1_CONVERT" },
        ],
      },
    },
    feePnlKpiAuthority: {
      summary: {
        by_market: [
          { market: "BTCUSDT", evidence_status: "FEE_PNL_MARKET_BLOCK" },
          { market: "XRPUSDT", evidence_status: "FEE_PNL_MARKET_REVIEW" },
        ],
      },
    },
    executionQuality: {
      summary: {
        top_watch_markets: [
          { market: "BTCUSDT", avg_created_to_fill_ms: 700000, partial_fill_rate_pct: 82, avg_slippage_bps: 3 },
          { market: "XRPUSDT", avg_created_to_fill_ms: 460000, partial_fill_rate_pct: 66, avg_slippage_bps: 2 },
        ],
      },
    },
  });

  const btc = summary.by_market.find((row) => row.market === "BTCUSDT");
  const xrp = summary.by_market.find((row) => row.market === "XRPUSDT");
  assert.strictEqual(Boolean(btc && btc.failure_hard_penalty), true);
  assert.strictEqual(Boolean(xrp && xrp.failure_soft_penalty), true);
  assert.strictEqual(Boolean(btc && btc.fee_pnl_hard_penalty), true);
  assert.strictEqual(Boolean(xrp && xrp.fee_pnl_soft_penalty), true);
  assert.strictEqual(Boolean(btc && btc.execution_quality_hard_penalty), true);
  assert.strictEqual(Boolean(xrp && xrp.execution_quality_soft_penalty), true);
  assert.ok(summary.failure_hard_penalty_markets.includes("BTCUSDT"));
  assert.ok(summary.failure_soft_penalty_markets.includes("XRPUSDT"));
  assert.ok(summary.fee_pnl_hard_penalty_markets.includes("BTCUSDT"));
  assert.ok(summary.fee_pnl_soft_penalty_markets.includes("XRPUSDT"));
  assert.ok(summary.execution_hard_penalty_markets.includes("BTCUSDT"));
  assert.ok(summary.execution_soft_penalty_markets.includes("XRPUSDT"));
})();

console.log("SERVER_MARKET_CAPITAL_ALLOCATOR_TEST_OK");
