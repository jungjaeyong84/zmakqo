"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  collectOpenClawOutcomeAdjudicationsFromFills,
  groupRealizedExitFills,
} = require("../v2/openclawOutcomeAdjudicationCollector");
const { buildOpenClawDailyPerformanceReport } = require("../v2/openclawDailyPerformanceReport");
const { extractOutcomeContext } = require("../v2/signalCohortReport");
const collectorScript = require("../../scripts/collect-v2-openclaw-outcome-adjudications");

const entry = {
  id: "EXT__BINANCEFUT__SOLUSDT__ENTRY1",
  action: "SYNC_FILL",
  symbol: "SOLUSDT",
  side: "BUY",
  created_at: "2026-05-01T00:00:00.000Z",
  external_order_id: "ENTRY_ORDER_1",
  external_realized_pnl: 0,
  signal_doc_id: "SIG__BINANCEFUT__SOLUSDT__15m__0__V2_PROTECTED_ENTRY",
  canonical_exit_chain_key: "BINANCEFUT__SOLUSDT__SIGNAL__SIG__BINANCEFUT__SOLUSDT__15m__0__V2_PROTECTED_ENTRY",
  features_json: {
    setup_type: "PULLBACK_RECLAIM",
    structural_regime: "TREND",
    regime_cohort: "TREND__NORMAL_VOL__ADEQUATE",
    edge_cohort: "BUILDABLE_EDGE",
    signal_score: 86,
    trigger_confirmed: true,
    trigger_type: "RECLAIM",
    volume_zscore: 1.4,
    expected_net_r_after_cost: 0.33,
  },
};

(function createsPerformanceEligibleWinFromProtectedEntryAndTp1Exit() {
  const result = collectOpenClawOutcomeAdjudicationsFromFills({
    now: "2026-05-01T03:00:00.000Z",
    lookbackHours: 24,
    fills: [
      entry,
      {
        id: "EXT__BINANCEFUT__SOLUSDT__EXIT1",
        action: "EXIT_TP_P1_2.5P",
        symbol: "SOLUSDT",
        side: "SELL",
        created_at: "2026-05-01T01:00:00.000Z",
        external_order_id: "EXIT_ORDER_1",
        external_realized_pnl: 1.25,
        canonical_transition_events: ["TP1_REACHED"],
      },
    ],
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.protected_entry_fill_n, 1);
  assert.strictEqual(result.realized_exit_group_n, 1);
  assert.strictEqual(result.adjudication_n, 1);
  assert.strictEqual(result.skipped_n, 0);
  const doc = result.adjudications[0];
  assert.strictEqual(doc.adjudication_label, "MODEL_WIN");
  assert.strictEqual(doc.adjudication_family, "MODEL");
  assert.strictEqual(doc.realized_exit_event, "TP1_REACHED");
  assert.strictEqual(doc.evidence.lineage_quality, "BROKER_SYNC_RECONCILED");
  assert.strictEqual(doc.evidence.performance_eligibility_basis, "V2_PROTECTED_ENTRY_MATCHED_TO_CANONICAL_EXIT_FILL");
  const report = buildOpenClawDailyPerformanceReport({ outcomes: result.adjudications });
  assert.strictEqual(report.sample_n, 1);
  assert.strictEqual(report.summary.win_n, 1);
})();

(async function implicitCacheDecisionEvidenceIsOptional() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-outcome-collector-cache-"));
  const inputFile = path.join(dir, "fills.json");
  const outputFile = path.join(dir, "collector.json");
  try {
    fs.writeFileSync(inputFile, JSON.stringify({
      docs: [
        entry,
        {
          id: "EXT__BINANCEFUT__SOLUSDT__EXIT_CACHE",
          action: "EXIT_TP_P1_2.5P",
          symbol: "SOLUSDT",
          side: "SELL",
          created_at: "2026-05-01T01:00:00.000Z",
          external_order_id: "EXIT_ORDER_CACHE",
          external_realized_pnl: 1.25,
          canonical_transition_events: ["TP1_REACHED"],
        },
      ],
    }), "utf8");
    const report = await collectorScript.main({
      env: {
        V2_OPENCLAW_OUTCOME_ADJUDICATION_SOURCE: "CACHE",
        V2_OPENCLAW_OUTCOME_ADJUDICATION_INPUT_FILE: inputFile,
        V2_OPENCLAW_OUTCOME_ADJUDICATION_OUTPUT_FILE: outputFile,
        V2_OPENCLAW_OUTCOME_ADJUDICATION_WRITE: "0",
        V2_OPENCLAW_OUTCOME_ADJUDICATION_NOW: "2026-05-01T03:00:00.000Z",
      },
      setProcessExitCode: false,
    });
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.decision_evidence_source, "DISABLED");
    assert.strictEqual(report.summary.adjudication_n, 1);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function createsLossFromProtectedEntryAndSlExit() {
  const result = collectOpenClawOutcomeAdjudicationsFromFills({
    now: "2026-05-01T03:00:00.000Z",
    lookbackHours: 24,
    fills: [
      entry,
      {
        id: "EXT__BINANCEFUT__SOLUSDT__EXIT2",
        action: "EXIT_SL_1.65P",
        symbol: "SOLUSDT",
        side: "SELL",
        created_at: "2026-05-01T02:00:00.000Z",
        external_order_id: "EXIT_ORDER_2",
        external_realized_pnl: -0.83,
        canonical_transition_events: ["SL_HIT"],
      },
    ],
  });
  const doc = result.adjudications[0];
  assert.strictEqual(doc.adjudication_label, "MODEL_ERROR");
  assert.strictEqual(doc.realized_exit_event, "SL_HIT");
  const report = buildOpenClawDailyPerformanceReport({ outcomes: result.adjudications });
  assert.strictEqual(report.sample_n, 1);
  assert.strictEqual(report.summary.loss_n, 1);
})();

(function groupsPartialExitFillsByOrderAndSumsPnl() {
  const groups = groupRealizedExitFills([
    {
      id: "a",
      action: "EXIT_TP_P1_2.5P",
      symbol: "BNBUSDT",
      side: "SELL",
      created_at: "2026-05-01T01:00:00.000Z",
      external_order_id: "O1",
      external_realized_pnl: 0.3,
    },
    {
      id: "b",
      action: "EXIT_TP_P1_2.5P",
      symbol: "BNBUSDT",
      side: "SELL",
      created_at: "2026-05-01T01:00:01.000Z",
      external_order_id: "O1",
      external_realized_pnl: 0.7,
    },
  ]);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].fills.length, 2);
  assert.strictEqual(groups[0].realized_pnl, 1);
})();

(function groupsMultiLegExitFillsByEntryLineageBeforeOrderId() {
  const groups = groupRealizedExitFills([
    {
      id: "tp",
      action: "EXIT_TP_P1_2.5P",
      symbol: "BNBUSDT",
      side: "SELL",
      created_at: "2026-05-01T01:00:00.000Z",
      entry_event_id: "ENTRY_BNB_1",
      external_order_id: "TP_ORDER",
      external_realized_pnl: 0.7,
    },
    {
      id: "trail",
      action: "EXIT_TRAIL_100P",
      symbol: "BNBUSDT",
      side: "SELL",
      created_at: "2026-05-01T01:05:00.000Z",
      entry_event_id: "ENTRY_BNB_1",
      external_order_id: "TRAIL_ORDER",
      external_realized_pnl: 1.3,
    },
  ]);
  assert.strictEqual(groups.length, 1);
  assert.strictEqual(groups[0].fills.length, 2);
  assert.strictEqual(groups[0].realized_pnl, 2);
})();

(function missingProtectedEntryLineageIsSkipped() {
  const result = collectOpenClawOutcomeAdjudicationsFromFills({
    now: "2026-05-01T03:00:00.000Z",
    lookbackHours: 24,
    fills: [
      {
        id: "orphan-exit",
        action: "EXIT_SL_1.65P",
        symbol: "XRPUSDT",
        side: "SELL",
        created_at: "2026-05-01T02:00:00.000Z",
        external_order_id: "ORPHAN",
        external_realized_pnl: -0.2,
      },
    ],
  });
  assert.strictEqual(result.adjudication_n, 0);
  assert.strictEqual(result.skipped_n, 1);
  assert.strictEqual(result.skipped[0].reason, "MISSING_V2_PROTECTED_ENTRY_LINEAGE");
})();

(function operatorExternalSyncIsWrittenButExcludedFromPerformance() {
  const result = collectOpenClawOutcomeAdjudicationsFromFills({
    now: "2026-05-01T03:00:00.000Z",
    lookbackHours: 24,
    fills: [
      entry,
      {
        id: "external-sync",
        action: "EXIT_EXTERNAL_SYNC",
        symbol: "SOLUSDT",
        side: "SELL",
        created_at: "2026-05-01T02:00:00.000Z",
        external_order_id: "EXT",
        external_realized_pnl: 9,
      },
    ],
  });
  assert.strictEqual(result.adjudication_n, 1);
  assert.strictEqual(result.adjudications[0].adjudication_family, "OPERATOR");
  const report = buildOpenClawDailyPerformanceReport({ outcomes: result.adjudications });
  assert.strictEqual(report.sample_n, 0);
  assert.strictEqual(report.outcomes[0].performance_eligible, false);
})();

(function unverifiedLineageGapIsWrittenButExcludedFromPerformance() {
  const result = collectOpenClawOutcomeAdjudicationsFromFills({
    now: "2026-05-01T03:00:00.000Z",
    lookbackHours: 24,
    fills: [
      entry,
      {
        id: "unverified-exit",
        action: "EXIT_UNVERIFIED_SYNC",
        symbol: "SOLUSDT",
        side: "SELL",
        created_at: "2026-05-01T02:00:00.000Z",
        entry_event_id: "ENTRY_SOL_1",
        external_order_id: "UNVERIFIED",
        external_realized_pnl: -1,
        status_reason: "MISSING_CANONICAL_EXIT_TRANSITION",
      },
    ],
  });
  assert.strictEqual(result.adjudication_n, 1);
  const doc = result.adjudications[0];
  assert.strictEqual(doc.adjudication_family, "OPERATOR");
  assert.strictEqual(doc.adjudication_label, "LINEAGE_GAP");
  assert.strictEqual(doc.evidence.lineage_quality, "LINEAGE_GAP_EXCLUDED");
  const report = buildOpenClawDailyPerformanceReport({ outcomes: result.adjudications });
  assert.strictEqual(report.sample_n, 0);
  assert.strictEqual(report.outcomes[0].performance_eligible, false);
})();

(function entryFeaturesPopulateCohortContext() {
  const result = collectOpenClawOutcomeAdjudicationsFromFills({
    now: "2026-05-01T03:00:00.000Z",
    lookbackHours: 24,
    fills: [
      entry,
      {
        id: "feature-exit",
        action: "EXIT_TP_P1_2.5P",
        symbol: "SOLUSDT",
        side: "SELL",
        created_at: "2026-05-01T01:00:00.000Z",
        external_order_id: "FEATURE_EXIT",
        external_realized_pnl: 1,
        canonical_transition_events: ["TP1_REACHED"],
      },
    ],
  });
  const report = buildOpenClawDailyPerformanceReport({ outcomes: result.adjudications });
  assert.strictEqual(report.outcomes[0].context.setup_type, "PULLBACK_RECLAIM");
  assert.strictEqual(report.outcomes[0].context.regime_cohort, "TREND__NORMAL_VOL__ADEQUATE");
  assert.strictEqual(report.outcomes[0].context.edge_cohort, "BUILDABLE_EDGE");
})();

(function openclawDecisionEvidenceRecoversMissingEntryFeatureLineage() {
  const entryWithoutFeatures = {
    ...entry,
    features_json: null,
    openclaw_decision_id: "OCDV2__SOL__1",
    signal_intent_id: "SIGINTV2__SOL__1",
  };
  const decisionEvidenceRows = [
    {
      openclaw_decision_id: "OCDV2__SOL__1",
      signal_intent_id: "SIGINTV2__SOL__1",
      bundle_payload: {
        signalCriteria: {
          verdict: "PASS",
          signal_score: 88,
          setup_gate: { setup_type: "BREAKOUT_RETEST" },
          trigger_gate: { trigger_confirmed: true, trigger_type: "RECLAIM", volume_zscore: 1.9 },
          no_trade_gate: {
            market_quality_score: 0.91,
            spread_bps: 3.1,
            mark_index_gap_bps: 0.8,
            funding_penalty_bps: 1.2,
          },
          expected_edge_gate: {
            expected_net_r_after_cost: 0.42,
          },
          regime_profile: {
            structural_regime: "TREND",
            regime_cohort: "TREND__NORMAL_VOL__ADEQUATE",
          },
          expected_edge_model: {
            edge_cohort: "BUILDABLE_EDGE",
          },
        },
        marketDataQuality: {
          ok: true,
          metrics: {
            mark_index_gap_bps: 0.8,
            market_quality_score: 0.91,
            funding_rate: 0.0002,
            orderbook_imbalance_top5: 0.17,
            open_interest_delta_pct: 0.04,
            liquidation_notional_5m_quote: 120000,
            btc_1h_trend: "LONG",
            mtf_1h_direction: "LONG",
          },
        },
      },
    },
  ];
  const result = collectOpenClawOutcomeAdjudicationsFromFills({
    now: "2026-05-01T03:00:00.000Z",
    lookbackHours: 24,
    decisionEvidenceRows,
    fills: [
      entryWithoutFeatures,
      {
        id: "decision-feature-exit",
        action: "EXIT_TP_P1_2.5P",
        symbol: "SOLUSDT",
        side: "SELL",
        created_at: "2026-05-01T01:00:00.000Z",
        external_order_id: "DECISION_FEATURE_EXIT",
        external_realized_pnl: 1,
        canonical_transition_events: ["TP1_REACHED"],
      },
    ],
  });
  const doc = result.adjudications[0];
  assert.strictEqual(result.decision_evidence_row_n, 1);
  assert.strictEqual(doc.openclaw_decision_id, "OCDV2__SOL__1");
  assert.strictEqual(doc.signal_intent_id, "SIGINTV2__SOL__1");
  assert.strictEqual(doc.evidence.feature_lineage_source, "OPENCLAW_DECISION");
  assert.strictEqual(doc.evidence.feature_lineage_recovered, true);
  assert.strictEqual(doc.evidence.setup_type, "BREAKOUT_RETEST");
  assert.strictEqual(doc.evidence.edge_cohort, "BUILDABLE_EDGE");
  assert.strictEqual(doc.evidence.signal_score, 88);
  assert.strictEqual(doc.evidence.expected_net_r_after_cost, 0.42);
  assert.strictEqual(doc.evidence.funding_penalty_bps, 1.2);
  assert.strictEqual(doc.evidence.market_quality_score, 0.91);
  assert.strictEqual(doc.evidence.spread_bps, 3.1);
  assert.strictEqual(doc.evidence.mark_index_gap_bps, 0.8);
  assert.strictEqual(doc.evidence.funding_rate, 0.0002);
  assert.strictEqual(doc.evidence.orderbook_imbalance_top5, 0.17);
  assert.strictEqual(doc.evidence.btc_1h_trend, "LONG");
  assert.strictEqual(doc.evidence.mtf_1h_direction, "LONG");
  const context = extractOutcomeContext(doc);
  assert.strictEqual(context.setup_type, "BREAKOUT_RETEST");
  assert.strictEqual(context.edge_cohort, "BUILDABLE_EDGE");
  assert.strictEqual(context.signal_score_bucket, "QUALIFIED");
  assert.strictEqual(context.expected_net_r_after_cost, 0.42);
  assert.strictEqual(context.market_quality_bucket, "HIGH");
  assert.strictEqual(context.funding_rate_bucket, "POS");
  assert.strictEqual(context.open_interest_delta_bucket, "UP_LT1");
  assert.strictEqual(context.liquidation_notional_5m_bucket, "MED_100K_1M");
  assert.strictEqual(context.btc_1h_alignment, "ALIGNED");
  assert.strictEqual(context.mtf_1h_alignment, "ALIGNED");
  const report = buildOpenClawDailyPerformanceReport({ outcomes: result.adjudications });
  assert.notStrictEqual(report.cohort_summary.by_setup_type[0].key, "UNKNOWN");
  assert.strictEqual(report.cohort_summary.by_setup_type[0].expected_edge_sample_n, 1);
  assert.strictEqual(report.cohort_summary.by_market_quality_bucket[0].key, "HIGH");
})();

(function positionCycleLineageLinksBrokerSyncFillToDecisionEvidence() {
  const result = collectOpenClawOutcomeAdjudicationsFromFills({
    now: "2026-05-01T03:00:00.000Z",
    lookbackHours: 24,
    decisionEvidenceRows: [
      {
        position_cycle_id: "PCY__BINANCEFUT__SOLUSDT__LONG__abc",
        entry_event_id: "ENTRYV2__SOLUSDT__LONG__abc",
        signal_intent_id: "SIGINTV2__SERVER_NATIVE_ML_AI__SOLUSDT__LONG__abc",
        openclaw_decision_id: "OCDV2__CANARY__APPROVE_ENTRY__abc",
      },
      {
        openclaw_decision_id: "OCDV2__CANARY__APPROVE_ENTRY__abc",
        signal_intent_id: "SIGINTV2__SERVER_NATIVE_ML_AI__SOLUSDT__LONG__abc",
        bundle_payload: {
          signalCriteria: {
            signal_score: 89,
            setup_gate: { setup_type: "PULLBACK_RECLAIM", setup_quality_score: 0.82 },
            trigger_gate: { trigger_confirmed: true, trigger_type: "RECLAIM" },
            expected_edge_gate: { expected_net_r_after_cost: 0.44 },
            entry_grade: "CORE",
          },
        },
      },
    ],
    fills: [
      {
        id: "entry-no-features",
        action: "SYNC_FILL",
        symbol: "SOLUSDT",
        side: "BUY",
        created_at: "2026-05-01T00:00:00.000Z",
        signal_doc_id: "SIG__BINANCEFUT__SOLUSDT__15m__0__V2_PROTECTED_ENTRY",
        entry_event_id: "ENTRYV2__SOLUSDT__LONG__abc",
        features_json: null,
      },
      {
        id: "exit-linked-by-entry-event",
        action: "EXIT_TP_FULL_2.5P",
        symbol: "SOLUSDT",
        side: "SELL",
        created_at: "2026-05-01T01:00:00.000Z",
        external_order_id: "EXIT_ORDER_LINKED_BY_ENTRY_EVENT",
        external_realized_pnl: 1.1,
        entry_event_id: "ENTRYV2__SOLUSDT__LONG__abc",
        canonical_transition_events: ["TP1_FULL_EXIT"],
      },
    ],
  });
  assert.strictEqual(result.adjudications.length, 1);
  const doc = result.adjudications[0];
  const evidence = doc.evidence;
  assert.strictEqual(doc.openclaw_decision_id, "OCDV2__CANARY__APPROVE_ENTRY__abc");
  assert.strictEqual(doc.signal_intent_id, "SIGINTV2__SERVER_NATIVE_ML_AI__SOLUSDT__LONG__abc");
  assert.strictEqual(evidence.openclaw_decision_id, "OCDV2__CANARY__APPROVE_ENTRY__abc");
  assert.strictEqual(evidence.signal_intent_id, "SIGINTV2__SERVER_NATIVE_ML_AI__SOLUSDT__LONG__abc");
  assert.ok(evidence.synthetic_openclaw_decision_id && evidence.synthetic_openclaw_decision_id.startsWith("OCDV2__RECONCILED_BROKER_SYNC__"));
  assert.strictEqual(evidence.feature_lineage_source, "OPENCLAW_DECISION");
  assert.strictEqual(evidence.setup_type, "PULLBACK_RECLAIM");
  assert.strictEqual(evidence.entry_grade, "CORE");
})();

(function missingDecisionEvidenceKeepsExplicitMissingLineageMarker() {
  const result = collectOpenClawOutcomeAdjudicationsFromFills({
    now: "2026-05-01T03:00:00.000Z",
    lookbackHours: 24,
    fills: [
      { ...entry, features_json: null },
      {
        id: "missing-feature-exit",
        action: "EXIT_TP_P1_2.5P",
        symbol: "SOLUSDT",
        side: "SELL",
        created_at: "2026-05-01T01:00:00.000Z",
        external_order_id: "MISSING_FEATURE_EXIT",
        external_realized_pnl: 1,
        canonical_transition_events: ["TP1_REACHED"],
      },
    ],
  });
  assert.strictEqual(result.adjudications[0].evidence.feature_lineage_source, "MISSING");
})();

(async function collectorScriptFallsBackToFirestoreWhenCacheFileMissing() {
  const db = {
    collection(name) {
      assert.ok(name === "fills_paper" || String(name).endsWith("openclaw_decision_bundles_v2") || String(name).endsWith("position_cycles_v2"));
      return {
        orderBy(field, direction) {
          assert.strictEqual(field, "created_at");
          assert.strictEqual(direction, "desc");
          return {
            limit(limit) {
              assert.strictEqual(limit, 1500);
              return {
                async get() {
                  if (String(name).endsWith("openclaw_decision_bundles_v2")) {
                    return {
                      docs: [
                        {
                          id: "BUNDLE_1",
                          data: () => ({
                            openclaw_decision_id: "OCDV2__FIRESTORE__1",
                            signal_intent_id: "SIGINTV2__FIRESTORE__1",
                            bundle_payload: {
                              signalCriteria: {
                                signal_score: 84,
                                setup_gate: { setup_type: "PULLBACK_RECLAIM" },
                                expected_edge_gate: { expected_net_r_after_cost: 0.31 },
                              },
                            },
                          }),
                        },
                      ],
                    };
                  }
                  if (String(name).endsWith("position_cycles_v2")) {
                    return { docs: [] };
                  }
                  return {
                    docs: [
                      { id: entry.id, data: () => ({ ...entry }) },
                      {
                        id: "EXT__BINANCEFUT__SOLUSDT__EXIT_FIRESTORE",
                        data: () => ({
                          action: "EXIT_TP_P1_2.5P",
                          symbol: "SOLUSDT",
                          side: "SELL",
                          created_at: "2026-05-01T01:00:00.000Z",
                          external_order_id: "EXIT_ORDER_FIRESTORE",
                          external_realized_pnl: 0.5,
                          canonical_transition_events: ["TP1_REACHED"],
                        }),
                      },
                    ],
                  };
                },
              };
            },
          };
        },
      };
    },
  };
  const artifact = await collectorScript.runCollector({
    db,
    env: {
      V2_OPENCLAW_OUTCOME_ADJUDICATION_SOURCE: "AUTO",
      V2_OPENCLAW_OUTCOME_ADJUDICATION_INPUT_FILE: path.join(os.tmpdir(), "missing-v2-fills-cache.json"),
      V2_OPENCLAW_OUTCOME_ADJUDICATION_NOW: "2026-05-01T03:00:00.000Z",
    },
  });
  assert.strictEqual(artifact.source, "FIRESTORE");
  assert.strictEqual(artifact.summary.adjudication_n, 1);
  assert.strictEqual(artifact.write_enabled, false);
})();

(async function collectorScriptWritesArtifactFromCacheFile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v2-outcome-collector-"));
  const inputFile = path.join(dir, "fills.json");
  const outputFile = path.join(dir, "collector.json");
  try {
    fs.writeFileSync(inputFile, `${JSON.stringify({ docs: [entry] })}\n`, "utf8");
    const artifact = await collectorScript.main({
      setProcessExitCode: false,
      env: {
      V2_OPENCLAW_OUTCOME_ADJUDICATION_SOURCE: "CACHE",
      V2_OPENCLAW_OUTCOME_ADJUDICATION_DECISION_EVIDENCE_SOURCE: "NONE",
      V2_OPENCLAW_OUTCOME_ADJUDICATION_INPUT_FILE: inputFile,
      V2_OPENCLAW_OUTCOME_ADJUDICATION_OUTPUT_FILE: outputFile,
      V2_OPENCLAW_OUTCOME_ADJUDICATION_NOW: "2026-05-01T03:00:00.000Z",
      },
    });
    assert.strictEqual(artifact.source, "CACHE_FILE");
    assert.strictEqual(fs.existsSync(outputFile), true);
    const stored = JSON.parse(fs.readFileSync(outputFile, "utf8"));
    assert.strictEqual(stored.summary.protected_entry_fill_n, 1);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

console.log("V2_OPENCLAW_OUTCOME_ADJUDICATION_COLLECTOR_TEST_OK");
