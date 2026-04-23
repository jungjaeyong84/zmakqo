"use strict";

const assert = require("assert");
const { summarizeOpenClawOutcomes, buildOpenClawDailyPerformanceReport } = require("../v2/openclawDailyPerformanceReport");

const outcomes = [
  {
    openclaw_outcome_adjudication_id: "oa1",
    openclaw_decision_id: "d1",
    position_cycle_id: "p1",
    adjudication_label: "MODEL_WIN",
    adjudication_family: "MODEL",
    realized_pnl: 12,
    evidence: {
      symbol: "BTCUSDT",
      signal_criteria: {
        signal_score: 91,
        setup_gate: { setup_type: "PULLBACK_RECLAIM" },
        trigger_gate: { trigger_confirmed: true, volume_zscore: 2.2 },
        regime_profile: { structural_regime: "TREND", regime_cohort: "TREND__NORMAL_VOL__ADEQUATE" },
        expected_edge_model: { edge_cohort: "STRONG_EDGE", net_r_multiple: 0.53 },
      },
    },
    adjudicated_at: "2026-04-23T00:00:00.000Z",
  },
  {
    openclaw_outcome_adjudication_id: "oa2",
    openclaw_decision_id: "d2",
    position_cycle_id: "p2",
    adjudication_label: "MODEL_ERROR",
    adjudication_family: "MODEL",
    realized_pnl: -4,
    evidence: {
      symbol: "BTCUSDT",
      signal_criteria: {
        signal_score: 82,
        setup_gate: { setup_type: "BREAKOUT_RETEST" },
        trigger_gate: { trigger_confirmed: true, volume_zscore: 1.1 },
        regime_profile: { structural_regime: "TRANSITION", regime_cohort: "TRANSITION__HIGH_VOL__ADEQUATE" },
        expected_edge_model: { edge_cohort: "MARGINAL_EDGE", net_r_multiple: 0.27 },
      },
    },
    adjudicated_at: "2026-04-23T01:00:00.000Z",
  },
  {
    openclaw_outcome_adjudication_id: "oa3",
    openclaw_decision_id: "d3",
    position_cycle_id: "p3",
    adjudication_label: "MODEL_WIN",
    adjudication_family: "MODEL",
    realized_pnl: 6,
    evidence: {
      symbol: "ETHUSDT",
      signal_criteria: {
        signal_score: 87,
        setup_gate: { setup_type: "PULLBACK_RECLAIM" },
        trigger_gate: { trigger_confirmed: true, volume_zscore: 1.7 },
        regime_profile: { structural_regime: "TREND", regime_cohort: "TREND__NORMAL_VOL__ADEQUATE" },
        expected_edge_model: { edge_cohort: "BUILDABLE_EDGE", net_r_multiple: 0.36 },
      },
    },
    adjudicated_at: "2026-04-23T02:00:00.000Z",
  },
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
  assert.strictEqual(report.outcomes[0].context.setup_type, "PULLBACK_RECLAIM");
  assert.strictEqual(report.cohort_summary.by_setup_type[0].key, "PULLBACK_RECLAIM");
  assert.strictEqual(report.cohort_summary.by_regime_cohort[0].key, "TREND__NORMAL_VOL__ADEQUATE");
  assert.strictEqual(report.cohort_summary.by_edge_cohort[0].key, "STRONG_EDGE");
  assert.strictEqual(report.cohort_summary.top_positive_setup_regime.key, "PULLBACK_RECLAIM__TREND");
}

console.log("V2_OPENCLAW_DAILY_PERFORMANCE_REPORT_TEST_OK");
