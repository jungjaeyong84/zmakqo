"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");

const dailySystemOpsCheck = require("../../scripts/daily-system-ops-check.js");

(() => {
  const tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), "daily-system-ops-check-"));
  const recentDir = path.join(tmpRoot, "ops", "daily", "cache", "firestore_recent");
  fs.mkdirSync(recentDir, { recursive: true });

  fs.writeFileSync(path.join(recentDir, "signals.json"), JSON.stringify({
    docs: [
      { created_at: "2026-04-02T00:00:14.348Z", id: "SIG1" },
      { created_at: "2026-04-01T14:45:14.348Z", id: "SIG0" },
    ],
  }), "utf8");
  fs.writeFileSync(path.join(recentDir, "order_intents_paper.json"), JSON.stringify({
    docs: [
      { created_at: "2026-04-02T00:01:14.348Z", id: "INTENT1" },
    ],
  }), "utf8");
  fs.writeFileSync(path.join(recentDir, "fills_paper.json"), JSON.stringify({
    docs: [
      { created_at: "2026-04-02T00:02:14.348Z", id: "FILL1" },
    ],
  }), "utf8");
  fs.writeFileSync(path.join(recentDir, "trades_paper.json"), JSON.stringify({
    docs: [
      { created_at: "2026-04-02T00:03:14.348Z", id: "TRADE1" },
    ],
  }), "utf8");
  fs.writeFileSync(path.join(tmpRoot, "ops", "daily", "position_read_model_cutover_latest.json"), JSON.stringify({
    summary: {
      latest_ready: true,
      dominant_status: "LATEST_READY",
      position_read_model_latest_count: 8,
      positions_paper_count: 8,
      position_events_count: 21,
      unified_position_timeline_count: 21,
      latest_coverage_pct: 1,
      timeline_coverage_pct: 1,
      query_blockers: [],
    },
  }), "utf8");

  const health = dailySystemOpsCheck.__test.loadExecutionHealth({
    repoRoot: tmpRoot,
    dateKey: "2026-04-02",
  });

  assert.strictEqual(health.available, true);
  assert.strictEqual(health.signals_count, 1);
  assert.strictEqual(health.intents_count, 1);
  assert.strictEqual(health.fills_count, 1);
  assert.strictEqual(health.trades_count, 1);
  assert.strictEqual(dailySystemOpsCheck.__test.hasExecutionFlowCoverage(health), true);
  const cutover = dailySystemOpsCheck.__test.loadPositionReadModelCutoverHealth({ repoRoot: tmpRoot });
  assert.strictEqual(cutover.available, true);
  assert.strictEqual(cutover.latest_ready, true);
  assert.strictEqual(cutover.dominant_status, "LATEST_READY");

  fs.writeFileSync(path.join(tmpRoot, "ops", "daily", "objective_retrospective_latest.json"), JSON.stringify({
    display: {
      periods: {
        DAILY: {
          execution_microstructure: {
            tp0_hit_rate: 0.86,
          },
        },
      },
    },
  }), "utf8");
  fs.writeFileSync(path.join(tmpRoot, "ops", "daily", "best_self_evolution_server_primary_learning_epoch_latest.json"), JSON.stringify({
    summary: {
      status: "SERVER_PRIMARY_EPOCH_ACTIVE",
      active: true,
    },
  }), "utf8");

  const relaxed = dailySystemOpsCheck.__test.resolveRelaxedCostLimitPct({
    repoRoot: tmpRoot,
    baseCostLimitPct: 0.2,
  });
  assert.strictEqual(relaxed.relaxed, true);
  assert.strictEqual(relaxed.learning_epoch_active, true);
  assert.strictEqual(relaxed.microstructure_active, true);
  assert.strictEqual(relaxed.cost_limit_pct, 0.4);

  const proceed = dailySystemOpsCheck.__test.decideStatus({
    netPnlPct: 0.8,
    costRatioPct: 0.05,
    errorCount: 0,
    costLimitPct: 0.2,
    lossStopPct: -1.5,
    stopErrorCount: 2,
    executionHealth: {
      available: true,
      signals_count: 1,
      fills_count: 1,
      firestore_dns_ok: true,
      drop_tp1_pending_count: 0,
      qty_pct_non_positive_count: 0,
    },
    positionReadModelCutover: cutover,
  });
  assert.strictEqual(proceed.status, "진행");
  assert.deepStrictEqual(proceed.reasons, ["핵심 리스크 신호 없음"]);

  const stopped = dailySystemOpsCheck.__test.decideStatus({
    netPnlPct: 0.8,
    costRatioPct: 0.05,
    errorCount: 2,
    activeErrorCount: 2,
    costLimitPct: 0.2,
    lossStopPct: -1.5,
    stopErrorCount: 2,
    executionHealth: {
      available: true,
      signals_count: 1,
      fills_count: 1,
      firestore_dns_ok: true,
      drop_tp1_pending_count: 0,
      qty_pct_non_positive_count: 0,
    },
    positionReadModelCutover: cutover,
  });
  assert.strictEqual(stopped.status, "중단");
  assert.ok(stopped.reasons.includes("활성 핵심 오류 2건 >= 2건"));

  const issueLines = dailySystemOpsCheck.__test.buildIssueLines({
    cost_ratio_pct: 0.05,
    cost_limit_pct: 0.2,
    error_count: 1,
    active_error_count: 0,
    execution_health: {
      available: true,
      signals_count: 1,
      fills_count: 1,
      firestore_dns_ok: true,
      drop_tp1_pending_count: 0,
      qty_pct_non_positive_count: 0,
    },
    position_read_model_cutover: cutover,
    position_writer_authority_24h: {
      occurrence_count: 3,
      top_symbols: [
        { symbol: "XRPUSDT", count: 2 },
        { symbol: "DOGEUSDT", count: 1 },
      ],
    },
  });
  assert.ok(issueLines.some((line) => line.includes("positions_paper writer authority 경합 3건")));
  assert.ok(issueLines.some((line) => line.includes("XRPUSDT(2)")));

  const writerCandidates = dailySystemOpsCheck.__test.buildWriterAuthorityRemediationCandidates({
    top_symbols: [
      { symbol: "XRPUSDT", count: 5 },
      { symbol: "DOGEUSDT", count: 3 },
      { symbol: "ETHUSDT", count: 1 },
    ],
  });
  assert.strictEqual(writerCandidates.length, 3);
  assert.strictEqual(writerCandidates[0].symbol, "XRPUSDT");
  assert.strictEqual(writerCandidates[0].severity, "HIGH");
  assert.strictEqual(writerCandidates[1].severity, "MEDIUM");
  assert.strictEqual(writerCandidates[2].severity, "LOW");

  const historicalOnly = dailySystemOpsCheck.__test.decideStatus({
    netPnlPct: 0.8,
    costRatioPct: 0.05,
    errorCount: 2,
    activeErrorCount: 0,
    costLimitPct: 0.2,
    lossStopPct: -1.5,
    stopErrorCount: 2,
    executionHealth: {
      available: true,
      signals_count: 1,
      fills_count: 1,
      firestore_dns_ok: true,
      drop_tp1_pending_count: 0,
      qty_pct_non_positive_count: 0,
    },
    positionReadModelCutover: cutover,
  });
  assert.strictEqual(historicalOnly.status, "진행");
  assert.deepStrictEqual(historicalOnly.reasons, ["핵심 리스크 신호 없음"]);

  const writerAuthorityOnlyWithoutActivePositions = dailySystemOpsCheck.__test.decideStatus({
    netPnlPct: 0.8,
    costRatioPct: 0.05,
    errorCount: 2,
    activeErrorCount: 1,
    activeErrorFamilies: [
      { family: "POSITION_WRITE_TOKEN_MISMATCH", count: 8 },
    ],
    costLimitPct: 0.2,
    lossStopPct: -1.5,
    stopErrorCount: 2,
    executionHealth: {
      available: true,
      signals_count: 1,
      fills_count: 1,
      firestore_dns_ok: true,
      drop_tp1_pending_count: 0,
      qty_pct_non_positive_count: 0,
    },
    positionReadModelCutover: cutover,
    activePositionCount: 0,
  });
  assert.strictEqual(writerAuthorityOnlyWithoutActivePositions.status, "진행");
  assert.deepStrictEqual(writerAuthorityOnlyWithoutActivePositions.reasons, ["핵심 리스크 신호 없음"]);

  const writerAuthorityWithActivePositionsStillBlocks = dailySystemOpsCheck.__test.decideStatus({
    netPnlPct: 0.8,
    costRatioPct: 0.05,
    errorCount: 2,
    activeErrorCount: 1,
    activeErrorFamilies: [
      { family: "POSITION_WRITE_TOKEN_MISMATCH", count: 8 },
    ],
    costLimitPct: 0.2,
    lossStopPct: -1.5,
    stopErrorCount: 2,
    executionHealth: {
      available: true,
      signals_count: 1,
      fills_count: 1,
      firestore_dns_ok: true,
      drop_tp1_pending_count: 0,
      qty_pct_non_positive_count: 0,
    },
    positionReadModelCutover: cutover,
    activePositionCount: 1,
  });
  assert.strictEqual(writerAuthorityWithActivePositionsStillBlocks.status, "보류");
  assert.ok(writerAuthorityWithActivePositionsStillBlocks.reasons.includes("활성 핵심 오류 1건"));

  const cutoverBlocked = dailySystemOpsCheck.__test.decideStatus({
    netPnlPct: 0.8,
    costRatioPct: 0.05,
    errorCount: 0,
    costLimitPct: 0.2,
    lossStopPct: -1.5,
    stopErrorCount: 2,
    executionHealth: {
      available: true,
      signals_count: 1,
      fills_count: 1,
      firestore_dns_ok: true,
      drop_tp1_pending_count: 0,
      qty_pct_non_positive_count: 0,
    },
    positionReadModelCutover: {
      available: true,
      latest_ready: false,
      dominant_status: "INDEX_MISSING",
      query_blockers: ["position_read_model_latest:INDEX_MISSING"],
    },
  });
  assert.strictEqual(cutoverBlocked.status, "보류");
  assert.ok(cutoverBlocked.reasons.includes("position read-model 미준비 (INDEX_MISSING)"));

  console.log("DAILY_SYSTEM_OPS_CHECK_TEST_OK");
})();
