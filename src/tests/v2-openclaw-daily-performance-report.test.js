"use strict";

const assert = require("assert");
const { summarizeOpenClawOutcomes, buildOpenClawDailyPerformanceReport } = require("../v2/openclawDailyPerformanceReport");

const outcomes = [
  {
    openclaw_outcome_adjudication_id: "oa1",
    openclaw_decision_id: "d1",
    position_cycle_id: "p1",
    signal_intent_id: "s1",
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
        expected_edge_gate: { funding_penalty_bps: 1 },
        expected_edge_model: { edge_cohort: "STRONG_EDGE", net_r_multiple: 0.53 },
      },
      market_quality_score: 0.9,
      spread_bps: 2.4,
      funding_rate: 0.0002,
      open_interest_delta_pct: 1.2,
      liquidation_notional_5m_quote: 1500000,
      orderbook_imbalance_top5: 0.12,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
      feature_lineage_source: "OPENCLAW_DECISION",
    },
    adjudicated_at: "2026-04-23T00:00:00.000Z",
  },
  {
    openclaw_outcome_adjudication_id: "oa2",
    openclaw_decision_id: "d2",
    position_cycle_id: "p2",
    signal_intent_id: "s2",
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
      market_quality_score: 0.78,
      spread_bps: 3.9,
      funding_rate: -0.00005,
      btc_1h_trend: "LONG",
      mtf_1h_direction: "LONG",
    },
    adjudicated_at: "2026-04-23T01:00:00.000Z",
  },
  {
    openclaw_outcome_adjudication_id: "oa3",
    openclaw_decision_id: "d3",
    position_cycle_id: "p3",
    signal_intent_id: "s3",
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
  assert.strictEqual(summary.performance_eligible_outcome_n, 3);
  assert.strictEqual(summary.performance_excluded_outcome_n, 0);
  assert.strictEqual(summary.full_evidence_sample_n, 2);
  assert.strictEqual(summary.extended_microstructure_evidence_sample_n, 1);
  assert.strictEqual(summary.core_evidence_only_sample_n, 1);
  assert.strictEqual(summary.unknown_evidence_sample_n, 1);
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
  assert.strictEqual(report.full_evidence_sample_n, 2);
  assert.strictEqual(report.extended_microstructure_evidence_sample_n, 1);
  assert.strictEqual(report.core_evidence_only_sample_n, 1);
  assert.strictEqual(report.unknown_evidence_sample_n, 1);
  assert.strictEqual(report.outcomes.length, 3);
  assert.strictEqual(report.summary.label_counts.MODEL_WIN, 2);
  assert.strictEqual(report.outcomes[0].context.setup_type, "PULLBACK_RECLAIM");
  assert.strictEqual(report.outcomes[0].context.market_quality_bucket, "HIGH");
  assert.strictEqual(report.outcomes[0].context.spread_bucket, "TIGHT_LT3");
  assert.strictEqual(report.outcomes[0].context.funding_rate_bucket, "POS");
  assert.strictEqual(report.outcomes[0].context.open_interest_delta_bucket, "UP_1_3");
  assert.strictEqual(report.outcomes[0].context.liquidation_notional_5m_bucket, "HIGH_1M_5M");
  assert.strictEqual(report.outcomes[0].context.btc_1h_alignment, "SELF");
  assert.strictEqual(report.outcomes[0].context.feature_lineage_source, "OPENCLAW_DECISION");
  assert.strictEqual(report.outcomes[0].context.full_evidence, true);
  assert.strictEqual(report.outcomes[0].context.core_evidence_complete, true);
  assert.strictEqual(report.outcomes[0].context.extended_microstructure_evidence_complete, true);
  assert.deepStrictEqual(report.outcomes[0].context.missing_feature_fields, []);
  assert.strictEqual(report.outcomes[1].context.full_evidence, true);
  assert.strictEqual(report.outcomes[1].context.core_evidence_complete, true);
  assert.strictEqual(report.outcomes[1].context.extended_microstructure_evidence_complete, false);
  assert.strictEqual(report.outcomes[1].context.evidence_completeness, "CORE_EVIDENCE_ONLY");
  assert.ok(report.outcomes[1].context.missing_extended_microstructure_fields.includes("open_interest_delta_pct"));
  assert.strictEqual(report.outcomes[2].context.full_evidence, false);
  assert.ok(report.outcomes[2].context.missing_feature_fields.includes("market_quality_score"));
  assert.strictEqual(report.full_evidence_summary.sample_n, undefined);
  assert.strictEqual(report.full_evidence_summary.trade_n, 2);
  assert.strictEqual(report.core_evidence_only_summary.trade_n, 1);
  assert.strictEqual(report.extended_microstructure_evidence_summary.trade_n, 1);
  assert.strictEqual(report.outcomes[0].performance_eligible, true);
  assert.strictEqual(report.outcomes[0].performance_exclusion_reason, null);
  assert.strictEqual(report.cohort_summary.by_setup_type[0].key, "PULLBACK_RECLAIM");
  assert.strictEqual(report.cohort_summary.by_regime_cohort[0].key, "TREND__NORMAL_VOL__ADEQUATE");
  assert.strictEqual(report.cohort_summary.by_edge_cohort[0].key, "STRONG_EDGE");
  assert.strictEqual(report.cohort_summary.by_market_quality_bucket[0].key, "HIGH");
  assert.strictEqual(report.cohort_summary.by_btc_1h_alignment[0].key, "SELF");
  assert.strictEqual(report.cohort_summary.by_evidence_completeness.some((row) => row.key === "FULL_EVIDENCE"), true);
  assert.strictEqual(report.cohort_summary.by_evidence_completeness.some((row) => row.key === "CORE_EVIDENCE_ONLY"), true);
  assert.strictEqual(report.by_extended_microstructure_evidence_completeness.some((row) => row.key === "EXTENDED_MICROSTRUCTURE_MISSING"), true);
  assert.strictEqual(report.by_evidence_completeness.some((row) => row.key === "FULL_EVIDENCE"), true);
  assert.strictEqual(report.by_feature_lineage_source.some((row) => row.key === "OPENCLAW_DECISION"), true);
  assert.strictEqual(report.by_setup_type.length > 0, true);
  assert.strictEqual(report.cohort_summary.top_positive_setup_regime.key, "PULLBACK_RECLAIM__TREND");
}

{
  const sparseOutcome = {
    openclaw_outcome_adjudication_id: "oa_enrich",
    openclaw_decision_id: "OCD__ENRICH",
    position_cycle_id: "p_enrich",
    signal_intent_id: "SIG__ENRICH",
    adjudication_label: "MODEL_WIN",
    adjudication_family: "MODEL",
    realized_pnl: 3,
    evidence: {
      symbol: "SOLUSDT",
      side: "LONG",
      entry_features: {
        signal_intent_id: "SIG__ENRICH",
        position_cycle_id: "p_enrich",
      },
      signal_criteria: null,
      market_quality_score: null,
      spread_bps: null,
      funding_rate: null,
      btc_1h_trend: null,
      mtf_1h_direction: null,
      setup_type: null,
      edge_cohort: null,
    },
    adjudicated_at: "2026-04-23T02:30:00.000Z",
  };
  const decisionEvidence = {
    openclaw_decision_id: "OCD__ENRICH",
    signal_intent_id: "SIG__ENRICH",
    bundle_payload: {
      signalIntent: {
        signal_intent_id: "SIG__ENRICH",
      },
      signalCriteria: {
        signal_score: 84,
        setup_gate: { setup_type: "BREAKOUT_RETEST" },
        trigger_gate: { trigger_confirmed: true, volume_zscore: 1.4, trigger_type: "BREAKOUT" },
        regime_profile: { structural_regime: "TREND", regime_cohort: "TREND__NORMAL_VOL__ADEQUATE" },
        expected_edge_gate: { funding_penalty_bps: 0.5 },
        expected_edge_model: { edge_cohort: "MARGINAL_EDGE", net_r_multiple: 0.31 },
        feature_snapshot_contract: {
          btc_1h_trend: "LONG",
          mtf_1h_direction: "LONG",
        },
      },
      marketDataQuality: {
        metrics: {
          market_quality_score: 0.82,
          spread_bps: 2.6,
          funding_rate: 0.00001,
        },
      },
    },
  };
  const report = buildOpenClawDailyPerformanceReport({
    outcomes: [sparseOutcome],
    decisionEvidenceRows: [decisionEvidence],
    generatedAt: "2026-04-23T03:30:00.000Z",
  });
  assert.strictEqual(report.sample_n, 1);
  assert.strictEqual(report.full_evidence_sample_n, 1);
  assert.strictEqual(report.core_evidence_only_sample_n, 1);
  assert.strictEqual(report.unknown_evidence_sample_n, 0);
  assert.strictEqual(report.outcomes[0].context.setup_type, "BREAKOUT_RETEST");
  assert.strictEqual(report.outcomes[0].context.edge_cohort, "MARGINAL_EDGE");
  assert.strictEqual(report.outcomes[0].context.btc_1h_alignment, "ALIGNED");
  assert.strictEqual(report.outcomes[0].context.market_quality_bucket, "ADEQUATE");
}

{
  const manualRecovery = {
    openclaw_outcome_adjudication_id: "oa4",
    openclaw_decision_id: null,
    position_cycle_id: "p4",
    signal_intent_id: null,
    adjudication_label: "EXTERNAL_SYNC",
    adjudication_family: "OPERATOR",
    realized_exit_event: "EXTERNAL_CLOSE_SYNC",
    realized_pnl: 999,
    evidence: {
      symbol: "SOLUSDT",
      manual_recovery: true,
      status_reason: "EXTERNAL_FILL_RECONCILED",
    },
    adjudicated_at: "2026-04-23T04:00:00.000Z",
  };
  const summary = summarizeOpenClawOutcomes(outcomes.concat(manualRecovery));
  assert.strictEqual(summary.outcome_n, 4);
  assert.strictEqual(summary.performance_eligible_outcome_n, 3);
  assert.strictEqual(summary.performance_excluded_outcome_n, 1);
  assert.strictEqual(summary.trade_n, 3);
  assert.strictEqual(summary.net_pnl_usdt, 14);
  assert.strictEqual(summary.by_symbol.SOLUSDT.outcome_n, 1);
  assert.strictEqual(summary.by_symbol.SOLUSDT.net_pnl_usdt, 0);
  assert.strictEqual(summary.performance_excluded_reason_counts.FAMILY_OPERATOR, 1);
  const report = buildOpenClawDailyPerformanceReport({ outcomes: outcomes.concat(manualRecovery) });
  assert.strictEqual(report.sample_n, 3);
  assert.strictEqual(report.outcomes[3].performance_eligible, false);
  assert.strictEqual(report.outcomes[3].performance_exclusion_reason, "FAMILY_OPERATOR");
}

{
  const lineageGap = {
    openclaw_outcome_adjudication_id: "oa5",
    openclaw_decision_id: "d5",
    position_cycle_id: "p5",
    signal_intent_id: "s5",
    adjudication_label: "LINEAGE_GAP",
    adjudication_family: "OPERATOR",
    realized_exit_event: "BROKER_SYNC_EXIT",
    realized_pnl: -5,
    evidence: {
      symbol: "AXSUSDT",
      lineage_quality: "LINEAGE_GAP_EXCLUDED",
      exit_actions: ["EXIT_UNVERIFIED_SYNC"],
      exit_status_reasons: ["MISSING_CANONICAL_EXIT_TRANSITION"],
    },
    adjudicated_at: "2026-04-23T05:00:00.000Z",
  };
  const summary = summarizeOpenClawOutcomes(outcomes.concat(lineageGap));
  assert.strictEqual(summary.performance_eligible_outcome_n, 3);
  assert.strictEqual(summary.performance_excluded_outcome_n, 1);
  assert.strictEqual(summary.net_pnl_usdt, 14);
  const report = buildOpenClawDailyPerformanceReport({ outcomes: outcomes.concat(lineageGap) });
  assert.strictEqual(report.sample_n, 3);
  assert.strictEqual(report.outcomes[3].performance_eligible, false);
  assert.strictEqual(report.outcomes[3].performance_exclusion_reason, "FAMILY_OPERATOR");
}

{
  const staleOutcome = {
    openclaw_outcome_adjudication_id: "oa_override",
    openclaw_decision_id: "OCD__OVERRIDE",
    position_cycle_id: "p_override",
    signal_intent_id: "SIG__OVERRIDE",
    adjudication_label: "MODEL_WIN",
    adjudication_family: "MODEL",
    realized_pnl: 1,
    evidence: {
      symbol: "ETHUSDT",
      side: "SHORT",
      feature_lineage_source: "ENTRY_FEATURES",
      btc_1h_trend: "SHORT",
      mtf_1h_direction: "SHORT",
      entry_features: {
        signal_intent_id: "SIG__OVERRIDE",
        position_cycle_id: "p_override",
      },
    },
    adjudicated_at: "2026-04-23T06:00:00.000Z",
  };
  const decisionEvidence = {
    openclaw_decision_id: "OCD__OVERRIDE",
    signal_intent_id: "SIG__OVERRIDE",
    bundle_payload: {
      signalCriteria: {
        feature_snapshot_contract: {
          btc_1h_trend: "LONG",
          mtf_1h_direction: "LONG",
        },
      },
    },
  };
  const report = buildOpenClawDailyPerformanceReport({
    outcomes: [staleOutcome],
    decisionEvidenceRows: [decisionEvidence],
  });
  assert.strictEqual(report.outcomes[0].context.btc_1h_trend, "LONG");
  assert.strictEqual(report.outcomes[0].context.mtf_1h_direction, "LONG");
  assert.strictEqual(report.outcomes[0].context.feature_lineage_source, "ENTRY_FEATURES_AND_OPENCLAW_DECISION");
}

console.log("V2_OPENCLAW_DAILY_PERFORMANCE_REPORT_TEST_OK");
