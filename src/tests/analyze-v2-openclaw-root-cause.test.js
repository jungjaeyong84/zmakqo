"use strict";

const assert = require("assert");
const { buildAnalysis, renderMarkdown } = require("../../scripts/analyze-v2-openclaw-root-cause");

const outcomes = [
  {
    openclaw_outcome_adjudication_id: "oa1",
    openclaw_decision_id: "d1",
    position_cycle_id: "p1",
    signal_intent_id: "s1",
    adjudication_label: "MODEL_ERROR",
    adjudication_family: "MODEL",
    realized_pnl: -1,
    evidence: {
      symbol: "SOLUSDT",
      side: "SHORT",
      setup_type: "PULLBACK_RECLAIM",
      edge_cohort: "BUILDABLE_EDGE",
      signal_score: 91,
      btc_1h_trend: "LONG",
      market_quality_score: 0.92,
      spread_bps: 2,
    },
    adjudicated_at: "2026-05-01T00:00:00.000Z",
  },
  {
    openclaw_outcome_adjudication_id: "oa2",
    openclaw_decision_id: "d2",
    position_cycle_id: "p2",
    signal_intent_id: "s2",
    adjudication_label: "MODEL_ERROR",
    adjudication_family: "MODEL",
    realized_pnl: -1,
    evidence: {
      symbol: "SOLUSDT",
      side: "SHORT",
      setup_type: "PULLBACK_RECLAIM",
      edge_cohort: "BUILDABLE_EDGE",
      signal_score: 88,
      btc_1h_trend: "LONG",
      market_quality_score: 0.91,
      spread_bps: 2,
    },
    adjudicated_at: "2026-05-01T00:15:00.000Z",
  },
  {
    openclaw_outcome_adjudication_id: "oa3",
    openclaw_decision_id: "d3",
    position_cycle_id: "p3",
    signal_intent_id: "s3",
    adjudication_label: "MODEL_WIN",
    adjudication_family: "MODEL",
    realized_pnl: 1.5,
    evidence: {
      symbol: "BTCUSDT",
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      edge_cohort: "MARGINAL_EDGE",
      signal_score: 62,
      btc_1h_trend: "LONG",
      market_quality_score: 0.8,
      spread_bps: 1,
    },
    adjudicated_at: "2026-05-01T00:30:00.000Z",
  },
];

const expanded = Array.from({ length: 5 }, (_, idx) => outcomes.slice(0, 2).map((row) => ({ ...row, openclaw_outcome_adjudication_id: `_` }))).flat().concat(outcomes[2]);
const analysis = buildAnalysis({ rows: expanded, generatedAt: "2026-05-01T01:00:00.000Z" });
assert.strictEqual(analysis.ok, true);
assert.strictEqual(analysis.sample_n, 11);
assert.strictEqual(analysis.groups.by_setup_type[0].key, "PULLBACK_RECLAIM");
assert.strictEqual(analysis.by_setup_type[0].key, "PULLBACK_RECLAIM");
assert.ok(Array.isArray(analysis.by_feature_lineage_source));
assert.strictEqual(analysis.groups.by_btc_1h_alignment.some((row) => row.key === "OPPOSED"), true);
assert.strictEqual(Array.isArray(analysis.by_extended_microstructure_evidence_completeness), true);
assert.strictEqual(analysis.groups.by_extended_microstructure_evidence_completeness.some((row) => row.key === "EXTENDED_MICROSTRUCTURE_MISSING"), true);
assert.ok(analysis.root_cause_findings.some((row) => row.id === "PULLBACK_RECLAIM_DECAY"));
const markdown = renderMarkdown(analysis);
assert.ok(markdown.includes("V2 OpenClaw Root Cause Analysis"));
assert.ok(markdown.includes("PULLBACK_RECLAIM_DECAY"));

console.log("ANALYZE_V2_OPENCLAW_ROOT_CAUSE_TEST_OK");

{
  const historicalBlindWindowRows = Array.from({ length: 25 }, (_, idx) => ({
    openclaw_outcome_adjudication_id: `oa_hist_${idx}`,
    openclaw_decision_id: `d_hist_${idx}`,
    position_cycle_id: `p_hist_${idx}`,
    signal_intent_id: `s_hist_${idx}`,
    adjudication_label: "MODEL_ERROR",
    adjudication_family: "MODEL",
    realized_pnl: -0.2,
    evidence: {
      symbol: "ETHUSDT",
      side: "LONG",
      setup_type: "BREAKOUT_RETEST",
      edge_cohort: "MARGINAL_EDGE",
      market_quality_score: 0.82,
      spread_bps: 2.5,
      funding_rate: 0.00001,
      mtf_1h_direction: "LONG",
      btc_1h_trend: null,
    },
    adjudicated_at: "2026-05-01T00:00:00.000Z",
  }));
  const blindWindowAnalysis = buildAnalysis({ rows: historicalBlindWindowRows, generatedAt: "2026-05-01T01:30:00.000Z" });
  assert.strictEqual(blindWindowAnalysis.by_historical_blind_window.some((row) => row.key === "HISTORICAL_BLIND_WINDOW"), true);
  assert.strictEqual(blindWindowAnalysis.by_evidence_gap_reason.some((row) => row.key === "HISTORICAL_BTC_CONTEXT_BLIND_WINDOW"), true);
  assert.ok(blindWindowAnalysis.root_cause_findings.some((row) => row.id === "HISTORICAL_BLIND_WINDOW"));
}

{
  const fullLineageGapRows = Array.from({ length: 12 }, (_, idx) => ({
    openclaw_outcome_adjudication_id: `oa_lineage_${idx}`,
    openclaw_decision_id: `d_lineage_${idx}`,
    position_cycle_id: `p_lineage_${idx}`,
    signal_intent_id: `s_lineage_${idx}`,
    adjudication_label: "MODEL_ERROR",
    adjudication_family: "MODEL",
    realized_pnl: -0.3,
    evidence: {
      symbol: "LINKUSDT",
      side: "LONG",
      feature_lineage_source: "MISSING",
      broker_sync_reconciled: true,
      feature_lineage_recovered: false,
    },
    adjudicated_at: "2026-05-04T06:32:49.627Z",
  }));
  const lineageGapAnalysis = buildAnalysis({ rows: fullLineageGapRows, generatedAt: "2026-05-04T07:00:00.000Z" });
  assert.strictEqual(lineageGapAnalysis.sample_n, 0);
  assert.strictEqual(lineageGapAnalysis.by_full_lineage_gap.some((row) => row.key === "FULL_LINEAGE_GAP"), false);
  assert.strictEqual(lineageGapAnalysis.by_evidence_gap_reason.some((row) => row.key === "FULL_LINEAGE_GAP"), false);
  assert.ok(lineageGapAnalysis.root_cause_findings.some((row) => row.id === "FULL_LINEAGE_GAP") === false);
}
