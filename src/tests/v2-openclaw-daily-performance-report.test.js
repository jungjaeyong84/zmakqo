"use strict";

const assert = require("assert");
const { summarizeOpenClawOutcomes, buildOpenClawDailyPerformanceReport } = require("../v2/openclawDailyPerformanceReport");

const outcomes = [
  { openclaw_outcome_adjudication_id: "oa1", openclaw_decision_id: "d1", position_cycle_id: "p1", adjudication_label: "MODEL_WIN", adjudication_family: "MODEL", realized_pnl: 12, evidence: { symbol: "BTCUSDT" }, adjudicated_at: "2026-04-23T00:00:00.000Z" },
  { openclaw_outcome_adjudication_id: "oa2", openclaw_decision_id: "d2", position_cycle_id: "p2", adjudication_label: "MODEL_ERROR", adjudication_family: "MODEL", realized_pnl: -4, evidence: { symbol: "BTCUSDT" }, adjudicated_at: "2026-04-23T01:00:00.000Z" },
  { openclaw_outcome_adjudication_id: "oa3", openclaw_decision_id: "d3", position_cycle_id: "p3", adjudication_label: "MODEL_WIN", adjudication_family: "MODEL", realized_pnl: 6, evidence: { symbol: "ETHUSDT" }, adjudicated_at: "2026-04-23T02:00:00.000Z" },
];

{
  const summary = summarizeOpenClawOutcomes(outcomes);
  assert.strictEqual(summary.outcome_n, 3);
  assert.strictEqual(summary.trade_n, 3);
  assert.strictEqual(summary.win_n, 2);
  assert.strictEqual(summary.loss_n, 1);
  assert.strictEqual(summary.profit_factor, 4.5);
  assert.strictEqual(summary.net_pnl_usdt, 14);
  assert.strictEqual(summary.by_symbol.BTCUSDT.outcome_n, 2);
}

{
  const report = buildOpenClawDailyPerformanceReport({ outcomes, generatedAt: "2026-04-23T03:00:00.000Z" });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.reason, "V2_OPENCLAW_DAILY_PERFORMANCE_REPORT_GENERATED");
  assert.strictEqual(report.sample_n, 3);
  assert.strictEqual(report.outcomes.length, 3);
  assert.strictEqual(report.summary.label_counts.MODEL_WIN, 2);
}

console.log("V2_OPENCLAW_DAILY_PERFORMANCE_REPORT_TEST_OK");
