#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { runBinanceLiveStateSelfHeal } = require("../src/services/binanceLiveStateSelfHeal");
const { runBinanceActiveExitWatchdog } = require("../src/services/binanceActiveExitWatchdog");
const { STOP_DIVERGENCE_CODES } = require("../src/utils/exitIntegrityPolicy");
const { generateNativeTrailProtectionGapReport } = require("./report-native-trail-protection-gap");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");

function isoDate(value = new Date()) {
  return new Date(value).toISOString().slice(0, 10);
}

function envBool(value, fallback = false) {
  const normalized = String(value == null ? "" : value).trim().toLowerCase();
  if (!normalized) return fallback;
  return ["1", "true", "yes", "y", "on"].includes(normalized);
}

function extractJson(stdout = "") {
  const raw = String(stdout || "").trim();
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch (_err) {
    // fall through
  }
  const lines = raw.split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
  for (let i = lines.length - 1; i >= 0; i -= 1) {
    try {
      return JSON.parse(lines[i]);
    } catch (_err) {
      // continue
    }
  }
  return null;
}

function runScript(script, env = {}) {
  const scriptPath = path.join(REPO_ROOT, "scripts", script);
  const child = spawnSync(process.execPath, [scriptPath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024 * 16,
  });
  return {
    ok: child.status === 0,
    exit_code: child.status,
    parsed: extractJson(child.stdout),
    stdout_tail: String(child.stdout || "").trim().split(/\r?\n/).filter(Boolean).slice(-10),
    stderr_tail: String(child.stderr || "").trim().split(/\r?\n/).filter(Boolean).slice(-10),
  };
}

function buildMarkdown(report = {}) {
  const lines = [];
  const summary = report.summary || {};
  lines.push("# Binance Exit Integrity Cycle");
  lines.push("");
  lines.push(`- generated_at: ${report.generated_at || "N/A"}`);
  lines.push(`- apply: ${report.apply === true ? "YES" : "NO"}`);
  lines.push(`- status: ${summary.status || "UNKNOWN"}`);
  lines.push(`- live_issue_count: ${summary.live_issue_count ?? "N/A"}`);
  lines.push(`- native_gap_before: ${summary.native_gap_before ?? "N/A"}`);
  lines.push(`- native_gap_after: ${summary.native_gap_after ?? "N/A"}`);
  lines.push(`- stage_issue_symbol_n: ${summary.stage_issue_symbol_n ?? "N/A"}`);
  lines.push(`- watchdog_issue_symbol_n: ${summary.watchdog_issue_symbol_n ?? "N/A"}`);
  lines.push(`- watchdog_repaired_symbol_n: ${summary.watchdog_repaired_symbol_n ?? "N/A"}`);
  lines.push(`- exit_qty_live_issue_chain_n: ${summary.exit_qty_live_issue_chain_n ?? "N/A"}`);
  lines.push(`- trail_floor_live_violation_n: ${summary.trail_floor_live_violation_n ?? "N/A"}`);
  lines.push(`- fill_sync_duplicate_group_n: ${summary.fill_sync_duplicate_group_n ?? "N/A"}`);
  lines.push(`- fill_sync_alert_event_issue_n: ${summary.fill_sync_alert_event_issue_n ?? "N/A"}`);
  lines.push(`- trade_execution_alert_missing_fill_n: ${summary.trade_execution_alert_missing_fill_n ?? "N/A"}`);
  lines.push(`- duplication_live_group_n: ${summary.duplication_live_group_n ?? "N/A"}`);
  lines.push(`- authority_live_issue_position_n: ${summary.authority_live_issue_position_n ?? "N/A"}`);
  lines.push(`- canonical_exit_stage_fail_n: ${summary.canonical_exit_stage_fail_n ?? "N/A"}`);
  lines.push(`- canonical_exit_stage_gate: ${summary.canonical_exit_stage_gate || "N/A"}`);
  lines.push(`- canonical_transition_backfill_ok: ${summary.canonical_transition_backfill_ok === true ? "YES" : "NO"}`);
  lines.push(`- canonical_transition_backfill_created_transition_n: ${summary.canonical_transition_backfill_created_transition_n ?? "N/A"}`);
  lines.push(`- stop_divergence_symbol_n: ${summary.stop_divergence_symbol_n ?? "N/A"}`);
  lines.push(`- stop_divergence_gate: ${summary.stop_divergence_gate || "N/A"}`);
  lines.push(`- live_gate_blocked: ${summary.live_gate_blocked === true ? "YES" : "NO"}`);
  lines.push("");
  lines.push("## Reasons");
  const reasons = Array.isArray(summary.reasons) ? summary.reasons : [];
  if (!reasons.length) {
    lines.push("- none");
  } else {
    for (const reason of reasons) lines.push(`- ${reason}`);
  }
  lines.push("");
  lines.push("## Self Heal");
  const selfHeal = report.self_heal || {};
  lines.push(`- scanned: ${selfHeal.scanned ?? "N/A"}`);
  lines.push(`- healed_n: ${selfHeal.healed_n ?? "N/A"}`);
  lines.push(`- skipped_n: ${selfHeal.skipped_n ?? "N/A"}`);
  lines.push("");
  return lines.join("\n");
}

function countStopDivergenceSymbols(watchdog = {}) {
  const rows = Array.isArray(watchdog.actionable_rows)
    ? watchdog.actionable_rows
    : (Array.isArray(watchdog.rows) ? watchdog.rows : []);
  const seen = new Set();
  for (const row of rows) {
    const codes = Array.isArray(row && row.actionable_issue_codes) ? row.actionable_issue_codes : [];
    if (!codes.some((code) => STOP_DIVERGENCE_CODES.has(String(code || "").trim().toUpperCase()))) continue;
    const symbol = String(row && row.symbol || "").trim().toUpperCase();
    if (symbol) seen.add(symbol);
  }
  return seen.size;
}

function buildSummary(report = {}) {
  const beforeGap = Number(report.native_trail_gap_before && report.native_trail_gap_before.summary && report.native_trail_gap_before.summary.gap_count || 0);
  const afterGap = Number(report.native_trail_gap_after && report.native_trail_gap_after.summary && report.native_trail_gap_after.summary.gap_count || 0);
  const stageIssueSymbolN = Number(report.active_exit_stage_backfill && report.active_exit_stage_backfill.parsed && report.active_exit_stage_backfill.parsed.issue_symbol_n || 0);
  const watchdogIssueSymbolN = Number(report.active_exit_watchdog && report.active_exit_watchdog.issue_symbol_n || 0);
  const watchdogRepairedSymbolN = Number(report.active_exit_watchdog && report.active_exit_watchdog.repaired_symbol_n || 0);
  const exitQtyLiveIssueChainN = Number(report.binance_exit_qty_live_separation && report.binance_exit_qty_live_separation.parsed && report.binance_exit_qty_live_separation.parsed.live_issue_chain_n || 0);
  const trailFloorLiveViolationN = Number(report.trail_runner_floor_live_separation && report.trail_runner_floor_live_separation.parsed && report.trail_runner_floor_live_separation.parsed.live_violation_n || 0);
  const fillSyncDuplicateGroupN = Number(report.fill_sync_alert_duplication && report.fill_sync_alert_duplication.parsed && report.fill_sync_alert_duplication.parsed.report && report.fill_sync_alert_duplication.parsed.report.duplicate_group_n || report.fill_sync_alert_duplication && report.fill_sync_alert_duplication.parsed && report.fill_sync_alert_duplication.parsed.duplicate_group_n || 0);
  const fillSyncAlertEventIssueN = Number(report.fill_sync_alert_event_consistency && report.fill_sync_alert_event_consistency.parsed && report.fill_sync_alert_event_consistency.parsed.issue_n || 0);
  const tradeExecutionAlertCoverageReady = !!(report.trade_execution_alert_cross_audit && report.trade_execution_alert_cross_audit.parsed && report.trade_execution_alert_cross_audit.parsed.coverage_ready === true);
  const tradeExecutionAlertMissingFillN = tradeExecutionAlertCoverageReady
    ? Number(report.trade_execution_alert_cross_audit && report.trade_execution_alert_cross_audit.parsed && report.trade_execution_alert_cross_audit.parsed.missing_alert_fill_n || 0)
    : 0;
  const duplicationLiveGroupN = Number(report.fill_sync_alert_duplication_live_separation && report.fill_sync_alert_duplication_live_separation.parsed && report.fill_sync_alert_duplication_live_separation.parsed.live_duplicate_group_n || 0);
  const authorityLiveIssuePositionN = Number(report.binance_exit_authority_live_board && report.binance_exit_authority_live_board.parsed && report.binance_exit_authority_live_board.parsed.live_issue_position_n || 0);
  const authorityActionableLiveIssuePositionN = Number(report.binance_exit_authority_live_board && report.binance_exit_authority_live_board.parsed && report.binance_exit_authority_live_board.parsed.actionable_live_issue_position_n || 0);
  const authorityArtifactOnlyLiveIssuePositionN = Number(report.binance_exit_authority_live_board && report.binance_exit_authority_live_board.parsed && report.binance_exit_authority_live_board.parsed.artifact_only_live_issue_position_n || 0);
  const canonicalExitStageFailN = Number(report.binance_canonical_exit_stage_qa && report.binance_canonical_exit_stage_qa.parsed && report.binance_canonical_exit_stage_qa.parsed.fail_n || 0);
  const canonicalTransitionBackfillOk = !!(report.canonical_exit_transition_backfill && report.canonical_exit_transition_backfill.ok === true);
  const canonicalTransitionBackfillCreatedTransitionN = Number(report.canonical_exit_transition_backfill && report.canonical_exit_transition_backfill.parsed && report.canonical_exit_transition_backfill.parsed.created_transition_n || 0);
  const stopDivergenceSymbolN = countStopDivergenceSymbols(report.active_exit_watchdog || {});
  const duplicationIssueN = duplicationLiveGroupN > 0 ? duplicationLiveGroupN : fillSyncDuplicateGroupN;
  const liveIssueCount = afterGap + watchdogIssueSymbolN + exitQtyLiveIssueChainN + trailFloorLiveViolationN + duplicationIssueN + fillSyncAlertEventIssueN + tradeExecutionAlertMissingFillN + authorityActionableLiveIssuePositionN + canonicalExitStageFailN;
  const reasons = [];
  if (afterGap > 0) reasons.push(`native trail protection gap ${afterGap}건`);
  if (watchdogIssueSymbolN > 0) reasons.push(`active exit watchdog issue ${watchdogIssueSymbolN}건`);
  if (exitQtyLiveIssueChainN > 0) reasons.push(`exit qty live issue chain ${exitQtyLiveIssueChainN}건`);
  if (trailFloorLiveViolationN > 0) reasons.push(`trail floor live violation ${trailFloorLiveViolationN}건`);
  if (duplicationIssueN > 0) reasons.push(`fill sync duplicate group ${duplicationIssueN}건`);
  if (fillSyncAlertEventIssueN > 0) reasons.push(`fill sync alert event mismatch ${fillSyncAlertEventIssueN}건`);
  if (tradeExecutionAlertMissingFillN > 0) reasons.push(`trade execution alert missing fill ${tradeExecutionAlertMissingFillN}건`);
  if (authorityActionableLiveIssuePositionN > 0) reasons.push(`authority actionable issue position ${authorityActionableLiveIssuePositionN}건`);
  if (canonicalExitStageFailN > 0) reasons.push(`canonical exit stage fail ${canonicalExitStageFailN}건`);
  if (!canonicalTransitionBackfillOk) reasons.push("canonical exit transition backfill failed");
  if (stopDivergenceSymbolN > 0) reasons.push(`stop divergence symbol ${stopDivergenceSymbolN}건`);
  const liveGateBlocked = liveIssueCount > 0 || !canonicalTransitionBackfillOk;
  return {
    status: liveGateBlocked ? "WARN" : "OK",
    live_gate_blocked: liveGateBlocked,
    live_issue_count: liveIssueCount,
    native_gap_before: beforeGap,
    native_gap_after: afterGap,
    stage_issue_symbol_n: stageIssueSymbolN,
    watchdog_issue_symbol_n: watchdogIssueSymbolN,
    watchdog_repaired_symbol_n: watchdogRepairedSymbolN,
    exit_qty_live_issue_chain_n: exitQtyLiveIssueChainN,
    trail_floor_live_violation_n: trailFloorLiveViolationN,
    fill_sync_duplicate_group_n: fillSyncDuplicateGroupN,
    fill_sync_alert_event_issue_n: fillSyncAlertEventIssueN,
    trade_execution_alert_missing_fill_n: tradeExecutionAlertMissingFillN,
    trade_execution_alert_coverage_ready: tradeExecutionAlertCoverageReady,
    duplication_live_group_n: duplicationLiveGroupN,
    authority_live_issue_position_n: authorityLiveIssuePositionN,
    authority_actionable_live_issue_position_n: authorityActionableLiveIssuePositionN,
    authority_artifact_only_live_issue_position_n: authorityArtifactOnlyLiveIssuePositionN,
    canonical_exit_stage_fail_n: canonicalExitStageFailN,
    canonical_exit_stage_gate: canonicalExitStageFailN > 0 ? "BLOCK" : "PASS",
    canonical_transition_backfill_ok: canonicalTransitionBackfillOk,
    canonical_transition_backfill_created_transition_n: canonicalTransitionBackfillCreatedTransitionN,
    stop_divergence_symbol_n: stopDivergenceSymbolN,
    stop_divergence_gate: stopDivergenceSymbolN > 0 ? "BLOCK" : "PASS",
    reasons,
  };
}

async function runBinanceExitIntegrityCycle({
  apply = envBool(process.env.APPLY, false),
  exchange = "BINANCEFUT",
  opsDailyDir = OPS_DAILY_DIR,
  reportNativeGap = generateNativeTrailProtectionGapReport,
  runWatchdog = runBinanceActiveExitWatchdog,
  selfHeal = runBinanceLiveStateSelfHeal,
  runScriptImpl = runScript,
} = {}) {
  fs.mkdirSync(opsDailyDir, { recursive: true });

  const nativeGapBefore = await reportNativeGap({ exchange, outDir: opsDailyDir });
  const gapSymbols = Array.isArray(nativeGapBefore.summary && nativeGapBefore.summary.rows)
    ? nativeGapBefore.summary.rows.map((row) => String(row && row.symbol || "").trim().toUpperCase()).filter(Boolean)
    : [];

  const stageBackfill = runScriptImpl("backfill-binance-active-exit-stage.js", {
    DRY_RUN: apply ? "0" : "1",
  });
  const activeExitWatchdog = await runWatchdog({
    exchange,
    apply,
    maxRepairCount: Number(process.env.ACTIVE_EXIT_WATCHDOG_MAX_REPAIR_COUNT || 10),
  });

  let selfHealResult = {
    ok: true,
    skipped: true,
    reason: apply ? "NO_NATIVE_GAP" : "APPLY_DISABLED",
    scanned: 0,
    healed_n: 0,
    skipped_n: 0,
    results: [],
  };
  if (apply && gapSymbols.length) {
    selfHealResult = await selfHeal({
      exchange,
      symbols: gapSymbols,
      maxPositions: gapSymbols.length,
      forceRepair: true,
      reason: "EXIT_INTEGRITY_CYCLE",
    });
  }

  const nativeGapAfter = await reportNativeGap({ exchange, outDir: opsDailyDir });
  const canonicalExitTransitionBackfill = runScriptImpl("backfill-canonical-exit-transitions.js", {
    CANONICAL_EXIT_TRANSITION_BACKFILL_LOOKBACK_DAYS: String(
      process.env.EXIT_INTEGRITY_CANONICAL_TRANSITION_LOOKBACK_DAYS
      || process.env.CANONICAL_EXIT_TRANSITION_BACKFILL_LOOKBACK_DAYS
      || 7
    ),
    CANONICAL_EXIT_TRANSITION_BACKFILL_PAGE_SIZE: String(
      process.env.EXIT_INTEGRITY_CANONICAL_TRANSITION_PAGE_SIZE
      || process.env.CANONICAL_EXIT_TRANSITION_BACKFILL_PAGE_SIZE
      || 500
    ),
  });
  const fillSyncAlertDuplication = runScriptImpl("report-fill-sync-alert-duplication.js");
  const fillSyncAlertEventConsistency = runScriptImpl("report-fill-sync-alert-event-consistency.js");
  const tradeExecutionAlertCrossAudit = runScriptImpl("report-trade-execution-alert-cross-audit.js");
  const fillSyncAlertDuplicationLiveSeparation = runScriptImpl("report-fill-sync-alert-duplication-live-separation.js");
  const exitQtyContractAudit = runScriptImpl("report-binance-exit-qty-contract-audit.js");
  const exitQtyLiveSeparation = runScriptImpl("report-binance-exit-qty-live-separation.js");
  const trailRunnerFloorAudit = runScriptImpl("report-trail-runner-floor-audit.js");
  const trailRunnerFloorLiveSeparation = runScriptImpl("report-trail-runner-floor-live-separation.js");
  const authorityLiveBoard = runScriptImpl("report-binance-exit-authority-live-board.js");
  const canonicalExitStageQa = runScriptImpl("report-binance-canonical-exit-stage-qa.js");

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    exchange,
    apply,
    active_exit_stage_backfill: stageBackfill,
    active_exit_watchdog: activeExitWatchdog,
    native_trail_gap_before: nativeGapBefore,
    self_heal: selfHealResult,
    native_trail_gap_after: nativeGapAfter,
    canonical_exit_transition_backfill: canonicalExitTransitionBackfill,
    fill_sync_alert_duplication: fillSyncAlertDuplication,
    fill_sync_alert_event_consistency: fillSyncAlertEventConsistency,
    trade_execution_alert_cross_audit: tradeExecutionAlertCrossAudit,
    fill_sync_alert_duplication_live_separation: fillSyncAlertDuplicationLiveSeparation,
    binance_exit_qty_contract_audit: exitQtyContractAudit,
    binance_exit_qty_live_separation: exitQtyLiveSeparation,
    trail_runner_floor_audit: trailRunnerFloorAudit,
    trail_runner_floor_live_separation: trailRunnerFloorLiveSeparation,
    binance_exit_authority_live_board: authorityLiveBoard,
    binance_canonical_exit_stage_qa: canonicalExitStageQa,
  };
  report.summary = buildSummary(report);
  Object.assign(report, report.summary);

  const latestJson = path.join(opsDailyDir, "binance_exit_integrity_cycle_latest.json");
  const latestMd = path.join(opsDailyDir, "binance_exit_integrity_cycle_latest.md");
  const datedJson = path.join(opsDailyDir, `${isoDate()}_binance_exit_integrity_cycle.json`);
  fs.writeFileSync(latestJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(latestMd, `${buildMarkdown(report)}\n`, "utf8");

  return {
    ok: true,
    status: report.summary.status,
    summary: report.summary,
    output_json: latestJson,
    output_md: latestMd,
  };
}

async function main() {
  const result = await runBinanceExitIntegrityCycle();
  console.log(JSON.stringify(result));
}

if (require.main === module) {
  main().catch((err) => {
    console.error("RUN_BINANCE_EXIT_INTEGRITY_CYCLE_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
} else {
  module.exports = {
    runBinanceExitIntegrityCycle,
    __test: {
      extractJson,
      buildSummary,
      buildMarkdown,
      countStopDivergenceSymbols,
    },
  };
}
