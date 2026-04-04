"use strict";

const assert = require("assert");
const {
  buildOpenClawMarketRegimeRows,
  buildOpenClawMarketRegimeSummary,
} = require("../../src/utils/openclawMarketRegimeBoard");

(() => {
  const rows = buildOpenClawMarketRegimeRows({
    marketObjectiveScore: {
      by_market: [
        { market: "SOLUSDT", active: true, objective_score: -5.9, objective_band: "SEVERE_DRAG", drop_verdict: "FAVOR_RESCUE", drop_action: "RELAX_EV_POLICY_REVIEW" },
        { market: "ETHUSDT", active: true, objective_score: -2.8, objective_band: "NEGATIVE", drop_verdict: "FAVOR_RESCUE", drop_action: "RELAX_EV_POLICY_REVIEW" },
        { market: "BNBUSDT", active: true, objective_score: 0.14, objective_band: "POSITIVE", drop_verdict: "MIXED", drop_action: "MONITOR_WITH_MORE_SAMPLE" },
        { market: "BTCUSDT", active: true, objective_score: -1.4, objective_band: "NEGATIVE", drop_verdict: "KEEP_DROP", drop_action: "KEEP_DROP_RULE" },
        { market: "AXSUSDT", active: true, objective_score: -8.5, objective_band: "SEVERE_DRAG", drop_verdict: "KEEP_DROP", drop_action: "KEEP_DROP_RULE" },
        { market: "DOGEUSDT", active: true, objective_score: -3.0, objective_band: "NEGATIVE", drop_verdict: "HOLD_SAMPLE", drop_action: "HOLD_SAMPLE" },
      ],
    },
    serverVsPinePerformanceDelta: {
      by_market: [
        { market: "SOLUSDT", active: true, verdict: "SHADOW_GAP_REVIEW", performance_delta_score: -11.2, recommended_action: "RELAX_EV_POLICY_REVIEW", mismatch_count: 1 },
        { market: "ETHUSDT", active: true, verdict: "SHADOW_GAP_REVIEW", performance_delta_score: -6.0, recommended_action: "RELAX_EV_POLICY_REVIEW", mismatch_count: 1 },
        { market: "BNBUSDT", active: true, verdict: "SERVER_EDGE", performance_delta_score: 3.3, recommended_action: "KEEP_SERVER_PRIORITY", mismatch_count: 0 },
        { market: "BTCUSDT", active: true, verdict: "SERVER_EDGE", performance_delta_score: 1.6, recommended_action: "KEEP_SERVER_PRIORITY", mismatch_count: 0 },
        { market: "AXSUSDT", active: true, verdict: "SHADOW_GAP_REVIEW", performance_delta_score: -8.8, recommended_action: "KEEP_DROP_RULE", mismatch_count: 0 },
      ],
    },
    dropValidation: {
      by_market: [
        { market: "SOLUSDT", verdict: "FAVOR_RESCUE", recommended_action: "RELAX_EV_POLICY_REVIEW", dominant_family: "EV_POLICY", dominant_reason: "DROP_EV_GATE_TP1_PROB" },
        { market: "ETHUSDT", verdict: "FAVOR_RESCUE", recommended_action: "RELAX_EV_POLICY_REVIEW", dominant_family: "EV_POLICY", dominant_reason: "DROP_EV_GATE_TP1_PROB" },
        { market: "BNBUSDT", verdict: "MIXED", recommended_action: "MONITOR_WITH_MORE_SAMPLE", dominant_family: "EV_POLICY", dominant_reason: "DROP_EV_GATE_TP1_PROB" },
        { market: "BTCUSDT", verdict: "KEEP_DROP", recommended_action: "KEEP_DROP_RULE", dominant_family: "EV_POLICY", dominant_reason: "DROP_EV_GATE_TP1_PROB" },
        { market: "AXSUSDT", verdict: "KEEP_DROP", recommended_action: "KEEP_DROP_RULE", dominant_family: "EV_POLICY", dominant_reason: "DROP_EV_GATE_TP1_PROB" },
        { market: "DOGEUSDT", verdict: "HOLD_SAMPLE", recommended_action: "HOLD_SAMPLE", dominant_family: "EV_POLICY", dominant_reason: "DROP_EV_GATE_TP1_PROB" },
      ],
    },
    executionQuality: {
      by_market: [
        { market: "AXSUSDT", avg_created_to_fill_ms: 727078.5, partial_fill_rate_pct: 75 },
      ],
    },
    reversePolicy: {
      by_market: [
        { market: "AXSUSDT", verdict: "REVIEW_REVERSE_EXCEPTION_PATH", recommended_action: "REVIEW_REVERSE_EXCEPTION_PATH" },
      ],
    },
    serverMarketCapitalAllocator: {
      summary: {
        by_market: [
          { market: "SOLUSDT", allocation_score: -1.68, recommended_action: "HOLD", execution_quality_penalty: false, reverse_policy_penalty: false, production_slot: true, exploration_slot: false },
          { market: "ETHUSDT", allocation_score: 1.28, recommended_action: "HOLD", execution_quality_penalty: false, reverse_policy_penalty: false, production_slot: true, exploration_slot: false },
          { market: "BNBUSDT", allocation_score: 1.37, recommended_action: "EXPLORE_LIGHT", execution_quality_penalty: false, reverse_policy_penalty: true, production_slot: false, exploration_slot: true },
          { market: "BTCUSDT", allocation_score: -0.09, recommended_action: "HOLD", execution_quality_penalty: false, reverse_policy_penalty: true, production_slot: true, exploration_slot: false },
          { market: "AXSUSDT", allocation_score: -8.57, recommended_action: "QUARANTINE", execution_quality_penalty: true, reverse_policy_penalty: true, production_slot: false, exploration_slot: true },
        ],
      },
    },
    serverMarketQuarantine: {
      summary: {
        by_market: [
          { market: "AXSUSDT", quarantine_reason: "EXECUTION_QUALITY_PENALTY", quarantine_severity: "MEDIUM", recommended_action: "WATCH_ONLY_UNTIL_SERVER_EPOCH_MATURES", execution_quality_penalty: true, reverse_policy_penalty: true, learning_epoch_active: true },
        ],
      },
    },
  });

  const summary = buildOpenClawMarketRegimeSummary({ rows });
  const byMarket = new Map(rows.map((row) => [row.market, row]));
  assert.strictEqual(byMarket.get("SOLUSDT").cohort, "RESCUE");
  assert.strictEqual(byMarket.get("ETHUSDT").cohort, "RESCUE");
  assert.strictEqual(byMarket.get("BNBUSDT").cohort, "MIXED");
  assert.strictEqual(byMarket.get("BTCUSDT").cohort, "KEEP_DROP");
  assert.strictEqual(byMarket.get("AXSUSDT").cohort, "KEEP_DROP");
  assert.strictEqual(byMarket.get("DOGEUSDT").cohort, "HOLD_SAMPLE");
  assert.strictEqual(summary.top_rescue_market, "SOLUSDT");
  assert.strictEqual(summary.top_keep_drop_market, "AXSUSDT");
  assert.strictEqual(summary.rescue_market_n, 2);
  assert.strictEqual(summary.keep_drop_market_n, 2);
  console.log("OPENCLAW_MARKET_REGIME_BOARD_TEST_OK");
})();
