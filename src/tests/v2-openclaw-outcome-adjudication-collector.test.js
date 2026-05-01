"use strict";

const assert = require("assert");
const {
  collectOpenClawOutcomeAdjudicationsFromFills,
  groupRealizedExitFills,
} = require("../v2/openclawOutcomeAdjudicationCollector");
const { buildOpenClawDailyPerformanceReport } = require("../v2/openclawDailyPerformanceReport");

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

console.log("V2_OPENCLAW_OUTCOME_ADJUDICATION_COLLECTOR_TEST_OK");
