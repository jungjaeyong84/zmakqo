"use strict";

const assert = require("assert");

const { buildV3PaperBootstrapReport } = require("../v3/paperBootstrap");

function row({
  side,
  setup_type,
  structural_regime,
  edge_cohort,
  entry_grade,
  pnl,
} = {}) {
  return {
    adjudication_family: "MODEL",
    adjudication_label: pnl > 0 ? "MODEL_WIN" : "MODEL_ERROR",
    realized_exit_event: pnl > 0 ? "TP1_REACHED" : "SL_HIT",
    realized_pnl: pnl,
    openclaw_decision_id: `dec_${side}_${setup_type}_${structural_regime}_${edge_cohort}_${entry_grade}`,
    signal_intent_id: `intent_${side}_${setup_type}_${structural_regime}_${edge_cohort}_${entry_grade}`,
    position_cycle_id: `cycle_${side}_${setup_type}_${structural_regime}_${edge_cohort}_${entry_grade}`,
    evidence: {
      side,
      setup_type,
      structural_regime,
      edge_cohort,
      entry_grade,
      signal_intent_id: `intent_${side}_${setup_type}_${structural_regime}_${edge_cohort}_${entry_grade}`,
      position_cycle_id: `cycle_${side}_${setup_type}_${structural_regime}_${edge_cohort}_${entry_grade}`,
      openclaw_decision_id: `dec_${side}_${setup_type}_${structural_regime}_${edge_cohort}_${entry_grade}`,
      market_quality_score: 0.8,
      spread_bps: 2.5,
      funding_rate: 0.0001,
      btc_1h_trend: side === "LONG" ? "LONG" : "SHORT",
      btc_1h_alignment: "ALIGNED",
      mtf_1h_direction: side === "LONG" ? "LONG" : "SHORT",
      mtf_1h_alignment: "ALIGNED",
      feature_lineage_source: "OPENCLAW_DECISION",
    },
  };
}

(() => {
  const report = buildV3PaperBootstrapReport([
    row({
      side: "LONG",
      setup_type: "MOMENTUM_CONTINUATION",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      entry_grade: "CORE",
      pnl: 1.2,
    }),
    row({
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      entry_grade: "CORE",
      pnl: 0.9,
    }),
    row({
      side: "LONG",
      setup_type: "PULLBACK_RECLAIM",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      entry_grade: "CORE",
      pnl: -1.1,
    }),
    row({
      side: "SHORT",
      setup_type: "MOMENTUM_CONTINUATION",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      entry_grade: "CORE",
      pnl: 0.8,
    }),
  ]);

  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.source_sample_n, 4);
  assert.strictEqual(report.retained_sample_n, 3);
  assert.strictEqual(report.shadow_sample_n, 0);
  assert.strictEqual(report.combined_retained_sample_n, 3);
  assert.strictEqual(report.removed_sample_n, 1);
  assert.strictEqual(report.active_allowlist.length, 7);
  assert.strictEqual(report.retained_metrics.win_rate_pct, 100);
  assert.strictEqual(report.shadow_metrics.win_rate_pct, 0);
  assert.strictEqual(report.combined_retained_metrics.win_rate_pct, 100);
  assert.strictEqual(report.removed_reason_counts.V3_PAPER_PULLBACK_RECLAIM_DISABLED, 1);
  assert.strictEqual(report.recommendation, "READY_FOR_PARALLEL_PAPER_LANE");
})();

(() => {
  const report = buildV3PaperBootstrapReport([
    row({
      side: "LONG",
      setup_type: "MOMENTUM_CONTINUATION",
      structural_regime: "TREND",
      edge_cohort: "MARGINAL_EDGE",
      entry_grade: "CORE",
      pnl: 1.2,
    }),
    {
      adjudication_family: "MODEL",
      adjudication_label: "MODEL_WIN",
      realized_exit_event: "TP_HIT",
      realized_pnl: null,
      realized_r: 1.5,
      openclaw_decision_id: "dec_live_long",
      signal_intent_id: "intent_live_long",
      position_cycle_id: "cycle_live_long",
      evidence: {
        side: "LONG",
        setup_type: "BREAKOUT_RETEST",
        structural_regime: "TREND",
        edge_cohort: "MARGINAL_EDGE",
        entry_grade: "CORE",
        signal_intent_id: "intent_live_long",
        position_cycle_id: "cycle_live_long",
        openclaw_decision_id: "dec_live_long",
        market_quality_score: 0.84,
        spread_bps: 1.4,
        funding_rate: 0.00003,
        btc_1h_trend: "LONG",
        btc_1h_alignment: "ALIGNED",
        mtf_1h_direction: "LONG",
        mtf_1h_alignment: "ALIGNED",
        feature_lineage_source: "V3_LOCAL_PAPER",
      },
    },
  ]);

  assert.strictEqual(report.source_sample_n, 2);
  assert.strictEqual(report.retained_sample_n, 2);
  assert.strictEqual(report.retained_metrics.sample_n, 2);
  assert.strictEqual(report.retained_metrics.win_rate_pct, 100);
  assert.strictEqual(report.retained_metrics.static_pnl_sample_n, 1);
  assert.strictEqual(report.retained_metrics.expectancy_usdt, 1.2);
  assert.strictEqual(report.retained_live_metrics_r.sample_n, 1);
  assert.strictEqual(report.retained_live_metrics_r.expectancy_r, 1.5);
  assert.strictEqual(report.retained_metrics.sample_basis, "COMBINED_OUTCOME_ROWS");
  assert.strictEqual(report.retained_metrics.pnl_basis, "STATIC_USDT_ONLY");
})();

console.log("v3-paper-bootstrap.test.js PASS");
