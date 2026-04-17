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
  fs.writeFileSync(path.join(tmpRoot, "ops", "daily", "trail_runner_floor_audit_latest.json"), JSON.stringify({
    violation_n: 0,
    violation_total_n: 3,
    live_bar_runner_violation_n: 0,
    live_bar_runner_violation_total_n: 2,
    top_violations_all: [
      { symbol: "ETHUSDT", backfilled: true },
    ],
    top_violations: [],
  }), "utf8");
  fs.writeFileSync(path.join(tmpRoot, "ops", "daily", "trail_runner_floor_live_separation_latest.json"), JSON.stringify({
    live_violation_n: 0,
    historical_backfilled_violation_n: 3,
    overlap_symbols: [],
    live_symbols: [],
    historical_backfilled_symbols: ["ETHUSDT"],
  }), "utf8");
  fs.writeFileSync(path.join(tmpRoot, "ops", "daily", "binance_exit_qty_contract_audit_latest.json"), JSON.stringify({
    fill_count: 12,
    chain_count: 5,
    issue_chain_count: 2,
    issue_chain_total_n: 4,
    issue_chain_backfilled_n: 2,
    issue_code_counts: {
      TP1_ABS_OVER: 1,
      TOTAL_EXIT_OVER_100: 2,
    },
    issue_code_total_counts: {
      TP1_ABS_OVER: 2,
      TOTAL_EXIT_OVER_100: 3,
    },
    top_symbols: [
      { symbol: "BTCUSDT", count: 2 },
      { symbol: "DOGEUSDT", count: 1 },
    ],
    top_symbols_total: [
      { symbol: "BTCUSDT", count: 3 },
      { symbol: "DOGEUSDT", count: 1 },
    ],
    top_issues: [],
  }), "utf8");
  fs.writeFileSync(path.join(tmpRoot, "ops", "daily", "binance_exit_qty_live_separation_latest.json"), JSON.stringify({
    live_issue_chain_n: 2,
    historical_backfilled_issue_chain_n: 4,
    overlap_symbols: ["BTCUSDT"],
    live_symbols: ["BTCUSDT", "DOGEUSDT"],
    historical_backfilled_symbols: ["BTCUSDT", "ETHUSDT"],
  }), "utf8");
  fs.writeFileSync(path.join(tmpRoot, "ops", "daily", "native_trail_protection_gap_latest.json"), JSON.stringify({
    summary: {
      gap_count: 0,
      active_position_count: 2,
      top_symbols: [],
      rows: [],
    },
  }), "utf8");
  fs.writeFileSync(path.join(tmpRoot, "ops", "daily", "binance_exit_integrity_cycle_latest.json"), JSON.stringify({
    summary: {
      status: "WARN",
      live_gate_blocked: false,
      live_issue_count: 0,
      tp1_meta_sync_gap_n: 0,
      tp1_meta_sync_gate: "PASS",
      reasons: [],
    },
  }), "utf8");
  fs.writeFileSync(path.join(tmpRoot, "ops", "daily", "tp1_fail_closed_events_latest.json"), JSON.stringify({
    summary: {
      total_fail_closed_n: 0,
      tp1_native_gap_fail_closed_n: 0,
      tp1_meta_sync_fail_closed_n: 0,
      dispatch_fail_n: 0,
      repeat_symbol_threshold: 2,
      repeat_symbol_n: 0,
      max_symbol_fail_closed_n: 0,
      top_symbols: [],
      repeat_symbols: [],
      quarantine_candidate_n: 0,
      quarantine_candidates: [],
      recent_rows: [],
    },
  }), "utf8");
  fs.writeFileSync(path.join(tmpRoot, "ops", "daily", "regime_lineage_gap_latest.json"), JSON.stringify({
    signals: { missing_n: 1, missing_rate: 0.1 },
    intents: { missing_n: 2, missing_rate: 0.2 },
    fills: { missing_n: 0, missing_rate: 0 },
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
  const trailAudit = dailySystemOpsCheck.__test.loadTrailRunnerFloorAuditHealth({ repoRoot: tmpRoot });
  assert.strictEqual(trailAudit.available, true);
  assert.strictEqual(trailAudit.violation_n, 0);
  assert.strictEqual(trailAudit.violation_total_n, 3);
  const trailLiveSeparation = dailySystemOpsCheck.__test.loadTrailRunnerFloorLiveSeparationHealth({ repoRoot: tmpRoot });
  assert.strictEqual(trailLiveSeparation.available, true);
  assert.strictEqual(trailLiveSeparation.historical_backfilled_violation_n, 3);
  const exitQtyAudit = dailySystemOpsCheck.__test.loadBinanceExitQtyContractAuditHealth({ repoRoot: tmpRoot });
  assert.strictEqual(exitQtyAudit.available, true);
  assert.strictEqual(exitQtyAudit.fill_count, 12);
  assert.strictEqual(exitQtyAudit.chain_count, 5);
  assert.strictEqual(exitQtyAudit.issue_chain_count, 2);
  assert.strictEqual(exitQtyAudit.issue_chain_total_n, 4);
  assert.strictEqual(exitQtyAudit.issue_chain_backfilled_n, 2);
  const exitQtyLiveSeparation = dailySystemOpsCheck.__test.loadBinanceExitQtyLiveSeparationHealth({ repoRoot: tmpRoot });
  assert.strictEqual(exitQtyLiveSeparation.available, true);
  assert.strictEqual(exitQtyLiveSeparation.live_issue_chain_n, 2);
  const nativeTrailGap = dailySystemOpsCheck.__test.loadNativeTrailProtectionGapHealth({ repoRoot: tmpRoot });
  assert.strictEqual(nativeTrailGap.available, true);
  assert.strictEqual(nativeTrailGap.gap_count, 0);
  const exitIntegrity = dailySystemOpsCheck.__test.loadExitIntegrityHealth({ repoRoot: tmpRoot });
  assert.strictEqual(exitIntegrity.available, true);
  assert.strictEqual(exitIntegrity.tp1_meta_sync_gap_n, 0);
  assert.strictEqual(exitIntegrity.tp1_meta_sync_gate, "PASS");
  const tp1FailClosed = dailySystemOpsCheck.__test.loadTp1FailClosedHealth({ repoRoot: tmpRoot });
  assert.strictEqual(tp1FailClosed.available, true);
  assert.strictEqual(tp1FailClosed.total_fail_closed_n, 0);
  assert.strictEqual(tp1FailClosed.repeat_symbol_n, 0);
  assert.strictEqual(tp1FailClosed.quarantine_candidate_n, 0);
  const regimeGap = dailySystemOpsCheck.__test.loadRegimeLineageGapHealth({ repoRoot: tmpRoot });
  assert.strictEqual(regimeGap.available, true);
  assert.strictEqual(regimeGap.signals_missing_n, 1);
  assert.strictEqual(regimeGap.intents_missing_n, 2);

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
    trailRunnerFloorAudit: trailAudit,
    binanceExitQtyContractAudit: exitQtyAudit,
    nativeTrailProtectionGap: nativeTrailGap,
    exitIntegrity,
    tp1FailClosed,
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
    trailRunnerFloorAudit: trailAudit,
    binanceExitQtyContractAudit: exitQtyAudit,
    nativeTrailProtectionGap: nativeTrailGap,
    exitIntegrity,
    tp1FailClosed,
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
    trail_runner_floor_audit: trailAudit,
    trail_runner_floor_live_separation: trailLiveSeparation,
    binance_exit_qty_contract_audit: exitQtyAudit,
    binance_exit_qty_live_separation: exitQtyLiveSeparation,
    native_trail_protection_gap: {
      available: true,
      gap_count: 2,
      top_symbols: [{ symbol: "ETHUSDT", count: 1 }],
    },
    exit_integrity: {
      available: true,
      tp1_meta_sync_gap_n: 2,
      tp1_meta_sync_gate: "BLOCK",
    },
    tp1_fail_closed: {
      available: true,
      total_fail_closed_n: 2,
      tp1_native_gap_fail_closed_n: 1,
      tp1_meta_sync_fail_closed_n: 1,
      repeat_symbol_threshold: 2,
      repeat_symbol_n: 1,
      repeat_symbols: [{ symbol: "ETHUSDT", count: 2 }],
      quarantine_candidate_n: 1,
      quarantine_candidates: [{ symbol: "ETHUSDT", count: 2, severity: "MEDIUM", action: "다음 발생 전 TP1 native/meta trace 선수집 및 quarantine 준비" }],
      top_symbols: [{ symbol: "ETHUSDT", count: 2 }],
    },
    regime_lineage_gap: regimeGap,
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
  assert.ok(issueLines.some((line) => line.includes("trailing floor 과거 위반 3건은 backfill 정리됨")));
  assert.ok(issueLines.some((line) => line.includes("Binance exit 수량 계약 live unresolved 2건")));
  assert.ok(issueLines.some((line) => line.includes("historical backfilled 4건")));
  assert.ok(issueLines.some((line) => line.includes("signal regime missing 1건")));
  assert.ok(issueLines.some((line) => line.includes("intent regime missing 2건")));
  assert.ok(issueLines.some((line) => line.includes("native stop 누락 2건")));
  assert.ok(issueLines.some((line) => line.includes("TP1 meta sync gap 2건")));
  assert.ok(issueLines.some((line) => line.includes("TP1 fail-closed quarantine 후보 1개")));
  assert.ok(issueLines.some((line) => line.includes("ETHUSDT(2,MEDIUM)")));

  const historicalExitQtyLines = dailySystemOpsCheck.__test.buildIssueLines({
    cost_ratio_pct: 0.05,
    cost_limit_pct: 0.2,
    error_count: 0,
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
    trail_runner_floor_audit: trailAudit,
    trail_runner_floor_live_separation: trailLiveSeparation,
    binance_exit_qty_contract_audit: {
      ...exitQtyAudit,
      issue_chain_count: 0,
    },
    binance_exit_qty_live_separation: {
      ...exitQtyLiveSeparation,
      live_issue_chain_n: 0,
    },
    native_trail_protection_gap: {
      available: true,
      gap_count: 0,
      top_symbols: [],
    },
    exit_integrity: {
      available: true,
      tp1_meta_sync_gap_n: 0,
      tp1_meta_sync_gate: "PASS",
    },
    regime_lineage_gap: {
      available: true,
      signals_missing_n: 0,
      intents_missing_n: 0,
    },
    position_writer_authority_24h: {
      occurrence_count: 0,
      top_symbols: [],
    },
  });
  assert.ok(historicalExitQtyLines.some((line) => line.includes("과거 위반 4건은 backfill 정리됨")));
  assert.ok(historicalExitQtyLines.some((line) => line.includes("TOTAL_EXIT_OVER_100(3)")));
  assert.ok(historicalExitQtyLines.some((line) => line.includes("BTCUSDT(3)")));
  assert.ok(historicalExitQtyLines.some((line) => line.includes("TP1 meta sync gap 없음")));

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
    trailRunnerFloorAudit: trailAudit,
    binanceExitQtyContractAudit: exitQtyAudit,
    exitIntegrity,
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
    trailRunnerFloorAudit: trailAudit,
    binanceExitQtyContractAudit: exitQtyAudit,
    exitIntegrity,
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
    trailRunnerFloorAudit: trailAudit,
    binanceExitQtyContractAudit: exitQtyAudit,
    exitIntegrity,
    positionReadModelCutover: cutover,
    activePositionCount: 1,
  });
  assert.strictEqual(writerAuthorityWithActivePositionsStillBlocks.status, "보류");
  assert.ok(writerAuthorityWithActivePositionsStillBlocks.reasons.includes("활성 핵심 오류 1건"));

  const supersededWriterFamily = dailySystemOpsCheck.__test.filterSupersededActiveErrorFamilies([
    {
      family: "POSITION_WRITE_TOKEN_MISMATCH",
      count: 1,
      latest_at: "2026-04-12T04:30:17.436Z",
      symbols: ["SOLUSDT"],
    },
  ], [
    {
      symbol_or_pair_id: "SOLUSDT",
      writer_committed_at: "2026-04-12T05:15:16.534Z",
      meta: {
        exchange_projection_in_sync: true,
        native_protection_refresh_status: "OK",
      },
    },
  ]);
  assert.strictEqual(supersededWriterFamily.effective.length, 0);
  assert.strictEqual(supersededWriterFamily.superseded.length, 1);

  const missingExitQtyAuditBlocks = dailySystemOpsCheck.__test.decideStatus({
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
    trailRunnerFloorAudit: trailAudit,
    binanceExitQtyContractAudit: { available: false },
    exitIntegrity,
    positionReadModelCutover: cutover,
  });
  assert.strictEqual(missingExitQtyAuditBlocks.status, "보류");
  assert.ok(missingExitQtyAuditBlocks.reasons.includes("binance exit 수량 계약 감사 미수집"));

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
    trailRunnerFloorAudit: trailAudit,
    exitIntegrity,
    positionReadModelCutover: {
      available: true,
      latest_ready: false,
      dominant_status: "INDEX_MISSING",
      query_blockers: ["position_read_model_latest:INDEX_MISSING"],
    },
  });
  assert.strictEqual(cutoverBlocked.status, "보류");
  assert.ok(cutoverBlocked.reasons.includes("position read-model 미준비 (INDEX_MISSING)"));

  const trailFloorBlocked = dailySystemOpsCheck.__test.decideStatus({
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
    trailRunnerFloorAudit: {
      available: true,
      violation_n: 2,
      violation_total_n: 5,
      live_bar_runner_violation_n: 2,
      live_bar_runner_violation_total_n: 4,
    },
    exitIntegrity,
    positionReadModelCutover: cutover,
  });
  assert.strictEqual(trailFloorBlocked.status, "보류");
  assert.ok(trailFloorBlocked.reasons.includes("trailing floor 미해결 위반 2건"));

  const tp1MetaSyncBlocked = dailySystemOpsCheck.__test.decideStatus({
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
    trailRunnerFloorAudit: trailAudit,
    binanceExitQtyContractAudit: exitQtyAudit,
    nativeTrailProtectionGap: nativeTrailGap,
    exitIntegrity: {
      available: true,
      tp1_meta_sync_gap_n: 3,
      tp1_meta_sync_gate: "BLOCK",
    },
    tp1FailClosed: {
      available: true,
      total_fail_closed_n: 4,
      quarantine_candidate_n: 1,
    },
    positionReadModelCutover: cutover,
  });
  assert.strictEqual(tp1MetaSyncBlocked.status, "보류");
  assert.ok(tp1MetaSyncBlocked.reasons.includes("TP1 meta sync gap 3건"));
  assert.ok(tp1MetaSyncBlocked.reasons.includes("TP1 fail-closed quarantine 후보 1개"));
  assert.ok(tp1MetaSyncBlocked.reasons.includes("TP1 fail-closed 4건"));

  const fallbackRuntimePath = path.join(tmpRoot, "ops", "runtime", "binance_tick_exit_audit.jsonl");
  fs.mkdirSync(path.dirname(fallbackRuntimePath), { recursive: true });
  fs.unlinkSync(path.join(tmpRoot, "ops", "daily", "tp1_fail_closed_events_latest.json"));
  const fallbackNow = Date.now();
  fs.writeFileSync(fallbackRuntimePath, [
    JSON.stringify({
      ts: new Date(fallbackNow - 60_000).toISOString(),
      event: "tick_exit_tp1_native_gap_fail_closed",
      symbol: "ETHUSDT",
      dispatch_ok: true,
    }),
    JSON.stringify({
      ts: new Date(fallbackNow - 30_000).toISOString(),
      event: "tick_exit_tp1_meta_sync_fail_closed",
      symbol: "ETHUSDT",
      dispatch_ok: false,
    }),
  ].join("\n"), "utf8");
  const fallbackFailClosed = dailySystemOpsCheck.__test.loadTp1FailClosedHealth({ repoRoot: tmpRoot });
  assert.strictEqual(fallbackFailClosed.available, true);
  assert.strictEqual(fallbackFailClosed.fallback_runtime_used, true);
  assert.strictEqual(fallbackFailClosed.total_fail_closed_n, 2);
  assert.strictEqual(fallbackFailClosed.repeat_symbol_n, 1);
  assert.strictEqual(fallbackFailClosed.quarantine_candidate_n, 1);

  console.log("DAILY_SYSTEM_OPS_CHECK_TEST_OK");
})();
