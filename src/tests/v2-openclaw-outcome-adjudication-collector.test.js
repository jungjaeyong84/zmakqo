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

(async function collectorScriptFallsBackToFirestoreWhenCacheFileMissing() {
  const db = {
    collection(name) {
      assert.strictEqual(name, "fills_paper");
      return {
        orderBy(field, direction) {
          assert.strictEqual(field, "created_at");
          assert.strictEqual(direction, "desc");
          return {
            limit(limit) {
              assert.strictEqual(limit, 1500);
              return {
                async get() {
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
