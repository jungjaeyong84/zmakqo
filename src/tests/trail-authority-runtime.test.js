"use strict";

const assert = require("assert");
const { buildTrailAuthorityState, __test } = require("../services/trailAuthorityRuntime");

function run() {
  const blocked = buildTrailAuthorityState({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    position: {
      exchange: "BINANCEFUT",
      symbol_or_pair_id: "DOGEUSDT",
      position_side: "SHORT",
      size_pct: 0.375,
      state: "SCALE_OUT",
      meta: { tp_p1_done: true, trail_active: true },
    },
    systemAnomaly: {
      status: "BLOCK",
      reason: "ANOMALY_QTY_PCT_NON_POSITIVE",
      circuit_breaker_open: true,
    },
    activePositions: [],
  });
  assert.strictEqual(blocked.status, "BLOCK");
  assert.strictEqual(blocked.block_synthetic_trail, true);
  assert.strictEqual(blocked.remediation_action, "SYSTEM_ANOMALY_FLATTEN");

  const accelerated = buildTrailAuthorityState({
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    position: {
      exchange: "BINANCEFUT",
      symbol_or_pair_id: "DOGEUSDT",
      position_side: "SHORT",
      size_pct: 0.375,
      state: "SCALE_OUT",
      meta: { tp_p1_done: true, trail_active: true },
    },
    executionQuality: {
      summary: {
        created_to_fill_p95_ms: 4500,
        adverse_slippage_p95_bps: 85,
        partial_fill_rate_pct: 62,
      },
    },
    activePositions: [
      { exchange: "BINANCEFUT", symbol_or_pair_id: "XRPUSDT", position_side: "SHORT", size_pct: 0.9, state: "COMMIT", meta: {} },
      { exchange: "BINANCEFUT", symbol_or_pair_id: "AXSUSDT", position_side: "SHORT", size_pct: 0.8, state: "COMMIT", meta: {} },
      { exchange: "BINANCEFUT", symbol_or_pair_id: "ETHUSDT", position_side: "SHORT", size_pct: 0.7, state: "COMMIT", meta: {} },
    ],
    feedbackState: {
      status: "WARN",
      reason: "TRAIL_AUTHORITY_EXECUTION_REGIME_DEGRADED",
      summary: {
        blocked_rate_pct: 18,
        false_positive_candidate_n: 0,
      },
      tuning: {
        regime: "DEGRADED",
        near_pct_multiplier_bias: 1.15,
        near_pct_multiplier_min: 1.2,
        force_fast_lane_on_warn: true,
      },
    },
  });
  assert.strictEqual(accelerated.status, "WARN");
  assert.strictEqual(accelerated.force_fast_lane, true);
  assert.ok(Number(accelerated.near_pct_multiplier) >= 2);
  assert.ok(accelerated.issues.includes("TRAIL_AUTHORITY_EXECUTION_LATENCY_WARN"));
  assert.ok(accelerated.issues.includes("TRAIL_AUTHORITY_PORTFOLIO_SAME_SIDE_ACCELERATE"));
  assert.ok(accelerated.issues.includes("TRAIL_AUTHORITY_FEEDBACK_REGIME_DEGRADED"));

  const exposure = __test.summarizePortfolioExposure({
    positions: [
      { exchange: "BINANCEFUT", symbol_or_pair_id: "ETHUSDT", position_side: "SHORT", size_pct: 0.8, state: "COMMIT", meta: {} },
      { exchange: "BINANCEFUT", symbol_or_pair_id: "BTCUSDT", position_side: "LONG", size_pct: 0.9, state: "COMMIT", meta: {} },
      { exchange: "BINANCEFUT", symbol_or_pair_id: "AXSUSDT", position_side: "SHORT", size_pct: 0.6, state: "COMMIT", meta: {} },
    ],
    exchange: "BINANCEFUT",
    symbol: "DOGEUSDT",
    desiredSide: "SHORT",
  });
  assert.deepStrictEqual(exposure.sameSideMarkets.sort(), ["AXSUSDT", "ETHUSDT"]);
  assert.strictEqual(exposure.sameSideCount, 2);
  assert.ok(exposure.sameSideExposure > 1);
}

try {
  run();
  console.log("TRAIL_AUTHORITY_RUNTIME_TEST_OK");
} catch (err) {
  console.error("TRAIL_AUTHORITY_RUNTIME_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
