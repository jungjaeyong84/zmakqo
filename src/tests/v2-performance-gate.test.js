"use strict";

const assert = require("assert");
const { evaluateV2PerformanceGate, normalizePerformanceMetrics } = require("../v2/performanceGate");

const passMetrics = {
  sample_n: 120,
  win_rate_pct: 56,
  profit_factor: 1.42,
  expectancy: 0.018,
  net_pnl_pct: 2.4,
  mdd_pct: -0.8,
  cost_ratio_pct: 0.08,
  latest_error_count_24h: 0,
};

{
  const normalized = normalizePerformanceMetrics({ performance: { interval_win_rate_pct: 52, interval_profit_factor: 1.2, net_pnl_pct: 1.1, mdd_pct: -0.5 }, sample_counts: { intervals: 101 }, expectancy: 0.01 });
  assert.strictEqual(normalized.sample_n, 101);
  assert.strictEqual(normalized.win_rate_pct, 52);
  assert.strictEqual(normalized.profit_factor, 1.2);
}

{
  const result = evaluateV2PerformanceGate({ metrics: passMetrics });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_PERFORMANCE_GATE_PASS");
  assert.deepStrictEqual(result.blockers, []);
}

{
  const result = evaluateV2PerformanceGate({ metrics: { ...passMetrics, sample_n: 12 } });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("PERFORMANCE_GATE:SAMPLE_INSUFFICIENT"));
}

{
  const result = evaluateV2PerformanceGate({ metrics: { ...passMetrics, profit_factor: 0.8, expectancy: -0.01, net_pnl_pct: -0.2, mdd_pct: -3 } });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("PERFORMANCE_GATE:PROFIT_FACTOR_BELOW_FLOOR"));
  assert.ok(result.blockers.includes("PERFORMANCE_GATE:EXPECTANCY_NOT_POSITIVE"));
  assert.ok(result.blockers.includes("PERFORMANCE_GATE:NET_PNL_NOT_POSITIVE"));
  assert.ok(result.blockers.includes("PERFORMANCE_GATE:DRAWDOWN_LIMIT_EXCEEDED"));
}

console.log("V2_PERFORMANCE_GATE_TEST_OK");
