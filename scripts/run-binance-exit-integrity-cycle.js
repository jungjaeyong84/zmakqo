#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { spawn } = require("child_process");
const { getFirestore } = require("../src/storage/firestore");
const { runBinanceLiveStateSelfHeal } = require("../src/services/binanceLiveStateSelfHeal");
const { runBinanceActiveExitWatchdog } = require("../src/services/binanceActiveExitWatchdog");
const { STOP_DIVERGENCE_CODES } = require("../src/utils/exitIntegrityPolicy");
const { generateNativeTrailProtectionGapReport } = require("./report-native-trail-protection-gap");
const {
  writeExitIntegrityCollectionCache,
  removeCacheFile,
  ENV_CACHE_PATH: EXIT_INTEGRITY_COLLECTION_CACHE_ENV,
} = require("./lib/exit-integrity-collection-cache");

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

function resolveScriptTimeoutMs(script, env = {}) {
  const explicit = Number(
    env.EXIT_INTEGRITY_SCRIPT_TIMEOUT_MS
    || process.env.EXIT_INTEGRITY_SCRIPT_TIMEOUT_MS
    || 120000
  );
  if (!Number.isFinite(explicit) || explicit < 1000) return 120000;
  return Math.floor(explicit);
}

function appendWithCap(current = "", chunk = "", maxChars = 1024 * 1024 * 4) {
  const next = `${current}${chunk}`;
  if (next.length <= maxChars) return next;
  return next.slice(-maxChars);
}

function buildSkippedNativeGapReport(exchange = "BINANCEFUT") {
  return {
    summary: {
      generated_at: new Date().toISOString(),
      exchange,
      active_position_count: 0,
      gap_count: 0,
      rows: [],
      top_symbols: [],
      skipped: true,
      reason: "EXCHANGE_IO_DISABLED",
    },
    cli: {
      ok: true,
      status: "SKIPPED",
      reason: "EXCHANGE_IO_DISABLED",
      gap_count: 0,
      active_position_count: 0,
      top_symbols: [],
      jsonPath: null,
      mdPath: null,
    },
  };
}

function buildSkippedWatchdogReport() {
  return {
    ok: true,
    status: "SKIPPED",
    reason: "EXCHANGE_IO_DISABLED",
    active_symbol_n: 0,
    target_symbol_n: 0,
    issue_symbol_n: 0,
    issue_symbols: [],
    repaired_symbol_n: 0,
    repaired_symbols: [],
    rows: [],
    actionable_rows: [],
    repaired_rows: [],
  };
}

async function runScript(script, env = {}) {
  const scriptPath = path.join(REPO_ROOT, "scripts", script);
  const timeoutMs = resolveScriptTimeoutMs(script, env);
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let timer = null;
    const child = spawn(process.execPath, [scriptPath], {
      cwd: REPO_ROOT,
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    const finalize = ({ code = null, signal = null, error = null } = {}) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({
        ok: code === 0 && timedOut !== true && !error,
        exit_code: code,
        signal: signal || null,
        parsed: extractJson(stdout),
        stdout_tail: String(stdout || "").trim().split(/\r?\n/).filter(Boolean).slice(-10),
        stderr_tail: String(stderr || "").trim().split(/\r?\n/).filter(Boolean).slice(-10),
        timed_out: timedOut === true,
        timeout_ms: timeoutMs,
        duration_ms: Date.now() - startedAt,
        error: error && error.message ? error.message : (error ? String(error) : null),
      });
    };
    child.stdout.on("data", (chunk) => {
      stdout = appendWithCap(stdout, chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendWithCap(stderr, chunk.toString("utf8"));
    });
    child.on("error", (error) => finalize({ error }));
    child.on("close", (code, signal) => finalize({ code, signal }));
    timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 5000).unref();
    }, timeoutMs);
  });
}

function collectScriptFailures(report = {}) {
  const checks = [
    ["active_exit_stage_backfill", report.active_exit_stage_backfill],
    ["canonical_exit_transition_backfill", report.canonical_exit_transition_backfill],
    ["fill_sync_alert_duplication", report.fill_sync_alert_duplication],
    ["fill_sync_alert_event_consistency", report.fill_sync_alert_event_consistency],
    ["trade_execution_alert_cross_audit", report.trade_execution_alert_cross_audit],
    ["fill_sync_alert_duplication_live_separation", report.fill_sync_alert_duplication_live_separation],
    ["binance_exit_qty_contract_audit", report.binance_exit_qty_contract_audit],
    ["binance_exit_qty_live_separation", report.binance_exit_qty_live_separation],
    ["trail_runner_floor_audit", report.trail_runner_floor_audit],
    ["trail_runner_floor_live_separation", report.trail_runner_floor_live_separation],
    ["binance_exit_authority_live_board", report.binance_exit_authority_live_board],
    ["binance_canonical_exit_stage_qa", report.binance_canonical_exit_stage_qa],
    ["simplified_exit_v2_live_flow", report.simplified_exit_v2_live_flow],
    ["simplified_exit_v2_tp1_drilldown", report.simplified_exit_v2_tp1_drilldown],
    // 2026-04-20 senior-audit P2
    ["native_protection_unprotected_window", report.native_protection_unprotected_window],
  ];
  const failures = [];
  for (const [name, step] of checks) {
    if (!step || step.ok === true) continue;
    if (step.timed_out === true) {
      failures.push(`${name}:TIMEOUT`);
      continue;
    }
    if (step.error) {
      failures.push(`${name}:${String(step.error).trim().toUpperCase() || "ERROR"}`);
      continue;
    }
    failures.push(`${name}:EXIT_${step.exit_code == null ? "UNKNOWN" : step.exit_code}`);
  }
  return failures;
}

function countTp1MetaSyncGapIssues(drilldown = {}) {
  const parsed = drilldown && drilldown.parsed ? drilldown.parsed : {};
  const issueCodeCounts = parsed && typeof parsed.issue_code_counts === "object" ? parsed.issue_code_counts : {};
  const keys = [
    "V2_TP1_ACK_WITHOUT_META_SYNC",
    "V2_TP1_ORDER_ID_MISMATCH",
  ];
  return keys.reduce((sum, key) => sum + Number(issueCodeCounts[key] || 0), 0);
}

function buildSkippedScriptStep(parsed = {}) {
  return {
    ok: true,
    exit_code: 0,
    signal: null,
    parsed: {
      skipped: true,
      reason: "EXCHANGE_IO_DISABLED",
      ...parsed,
    },
    stdout_tail: [],
    stderr_tail: [],
    timed_out: false,
    timeout_ms: null,
    duration_ms: 0,
    error: null,
  };
}

function normalizeCycleProfile(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "gate" || normalized === "deploy" || normalized === "ci") return "gate";
  return "ops";
}

function firstEnv(...values) {
  for (const value of values) {
    if (value === null || value === undefined) continue;
    const text = String(value).trim();
    if (text) return text;
  }
  return "";
}

function resolveCycleProfileEnv(profile = "ops") {
  const normalized = normalizeCycleProfile(profile);
  // C6 invariant: the "gate" profile is meant to be a lightweight deploy
  // check. It must actually be lighter than ops — every subscript's lookback
  // window and scan limit is narrowed so CI cannot accidentally trigger a
  // full-history scan on production Firestore.
  if (normalized === "gate") {
    return {
      EXIT_INTEGRITY_PROFILE: "gate",
      CANONICAL_EXIT_TRANSITION_BACKFILL_LOOKBACK_DAYS: firstEnv(
        process.env.EXIT_INTEGRITY_GATE_CANONICAL_TRANSITION_LOOKBACK_DAYS,
        "1"
      ),
      CANONICAL_EXIT_TRANSITION_BACKFILL_PAGE_SIZE: firstEnv(
        process.env.EXIT_INTEGRITY_GATE_CANONICAL_TRANSITION_PAGE_SIZE,
        "100"
      ),
      TRADE_EXEC_ALERT_CROSS_AUDIT_LOOKBACK_HOURS: firstEnv(
        process.env.EXIT_INTEGRITY_GATE_TRADE_EXEC_ALERT_CROSS_AUDIT_LOOKBACK_HOURS,
        "2"
      ),
      TRADE_EXEC_ALERT_CROSS_AUDIT_PAGE_SIZE: firstEnv(
        process.env.EXIT_INTEGRITY_GATE_TRADE_EXEC_ALERT_CROSS_AUDIT_PAGE_SIZE,
        "100"
      ),
      BINANCE_CANONICAL_EXIT_STAGE_QA_LOOKBACK_HOURS: firstEnv(
        process.env.EXIT_INTEGRITY_GATE_BINANCE_CANONICAL_EXIT_STAGE_QA_LOOKBACK_HOURS,
        "6"
      ),
      BINANCE_CANONICAL_EXIT_STAGE_QA_FILL_SCAN_LIMIT: firstEnv(
        process.env.EXIT_INTEGRITY_GATE_BINANCE_CANONICAL_EXIT_STAGE_QA_FILL_SCAN_LIMIT,
        "75"
      ),
      BINANCE_CANONICAL_EXIT_STAGE_QA_TRANSITION_SCAN_LIMIT: firstEnv(
        process.env.EXIT_INTEGRITY_GATE_BINANCE_CANONICAL_EXIT_STAGE_QA_TRANSITION_SCAN_LIMIT,
        "75"
      ),
      SIMPLIFIED_EXIT_V2_LIVE_FLOW_LOOKBACK_HOURS: firstEnv(
        process.env.EXIT_INTEGRITY_GATE_SIMPLIFIED_EXIT_V2_LIVE_FLOW_LOOKBACK_HOURS,
        "4"
      ),
      SIMPLIFIED_EXIT_V2_LIVE_FLOW_PAGE_SIZE: firstEnv(
        process.env.EXIT_INTEGRITY_GATE_SIMPLIFIED_EXIT_V2_LIVE_FLOW_PAGE_SIZE,
        "100"
      ),
      SIMPLIFIED_EXIT_V2_TP1_DRILLDOWN_LOOKBACK_HOURS: firstEnv(
        process.env.EXIT_INTEGRITY_GATE_SIMPLIFIED_EXIT_V2_TP1_DRILLDOWN_LOOKBACK_HOURS,
        "4"
      ),
      SIMPLIFIED_EXIT_V2_TP1_DRILLDOWN_PAGE_SIZE: firstEnv(
        process.env.EXIT_INTEGRITY_GATE_SIMPLIFIED_EXIT_V2_TP1_DRILLDOWN_PAGE_SIZE,
        "100"
      ),
    };
  }
  return {
    EXIT_INTEGRITY_PROFILE: "ops",
    CANONICAL_EXIT_TRANSITION_BACKFILL_LOOKBACK_DAYS: firstEnv(
      process.env.EXIT_INTEGRITY_CANONICAL_TRANSITION_LOOKBACK_DAYS,
      process.env.CANONICAL_EXIT_TRANSITION_BACKFILL_LOOKBACK_DAYS,
      "2"
    ),
    CANONICAL_EXIT_TRANSITION_BACKFILL_PAGE_SIZE: firstEnv(
      process.env.EXIT_INTEGRITY_CANONICAL_TRANSITION_PAGE_SIZE,
      process.env.CANONICAL_EXIT_TRANSITION_BACKFILL_PAGE_SIZE,
      "250"
    ),
    TRADE_EXEC_ALERT_CROSS_AUDIT_LOOKBACK_HOURS: firstEnv(
      process.env.TRADE_EXEC_ALERT_CROSS_AUDIT_LOOKBACK_HOURS,
      "6"
    ),
    TRADE_EXEC_ALERT_CROSS_AUDIT_PAGE_SIZE: firstEnv(
      process.env.TRADE_EXEC_ALERT_CROSS_AUDIT_PAGE_SIZE,
      "250"
    ),
    BINANCE_CANONICAL_EXIT_STAGE_QA_LOOKBACK_HOURS: firstEnv(
      process.env.BINANCE_CANONICAL_EXIT_STAGE_QA_LOOKBACK_HOURS,
      "24"
    ),
    BINANCE_CANONICAL_EXIT_STAGE_QA_FILL_SCAN_LIMIT: firstEnv(
      process.env.BINANCE_CANONICAL_EXIT_STAGE_QA_FILL_SCAN_LIMIT,
      "150"
    ),
    BINANCE_CANONICAL_EXIT_STAGE_QA_TRANSITION_SCAN_LIMIT: firstEnv(
      process.env.BINANCE_CANONICAL_EXIT_STAGE_QA_TRANSITION_SCAN_LIMIT,
      "150"
    ),
    SIMPLIFIED_EXIT_V2_LIVE_FLOW_LOOKBACK_HOURS: firstEnv(
      process.env.SIMPLIFIED_EXIT_V2_LIVE_FLOW_LOOKBACK_HOURS,
      "12"
    ),
    SIMPLIFIED_EXIT_V2_LIVE_FLOW_PAGE_SIZE: firstEnv(
      process.env.SIMPLIFIED_EXIT_V2_LIVE_FLOW_PAGE_SIZE,
      "250"
    ),
    SIMPLIFIED_EXIT_V2_TP1_DRILLDOWN_LOOKBACK_HOURS: firstEnv(
      process.env.SIMPLIFIED_EXIT_V2_TP1_DRILLDOWN_LOOKBACK_HOURS,
      "12"
    ),
    SIMPLIFIED_EXIT_V2_TP1_DRILLDOWN_PAGE_SIZE: firstEnv(
      process.env.SIMPLIFIED_EXIT_V2_TP1_DRILLDOWN_PAGE_SIZE,
      "250"
    ),
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
  lines.push(`- trade_execution_alert_missing_fill_total_n: ${summary.trade_execution_alert_missing_fill_total_n ?? "N/A"}`);
  lines.push(`- trade_execution_alert_missing_fill_non_actionable_n: ${summary.trade_execution_alert_missing_fill_non_actionable_n ?? "N/A"}`);
  lines.push(`- trade_execution_alert_missing_fill_raw_total_n: ${summary.trade_execution_alert_missing_fill_raw_total_n ?? "N/A"}`);
  lines.push(`- duplication_live_group_n: ${summary.duplication_live_group_n ?? "N/A"}`);
  lines.push(`- authority_live_issue_position_n: ${summary.authority_live_issue_position_n ?? "N/A"}`);
  lines.push(`- canonical_exit_stage_fail_n: ${summary.canonical_exit_stage_fail_n ?? "N/A"}`);
  lines.push(`- canonical_exit_stage_gate: ${summary.canonical_exit_stage_gate || "N/A"}`);
  lines.push(`- canonical_transition_backfill_ok: ${summary.canonical_transition_backfill_ok === true ? "YES" : "NO"}`);
  lines.push(`- canonical_transition_backfill_created_transition_n: ${summary.canonical_transition_backfill_created_transition_n ?? "N/A"}`);
  lines.push(`- simplified_exit_v2_live_flow_actionable_symbol_n: ${summary.simplified_exit_v2_live_flow_actionable_symbol_n ?? "N/A"}`);
  lines.push(`- simplified_exit_v2_live_flow_gate: ${summary.simplified_exit_v2_live_flow_gate || "N/A"}`);
  lines.push(`- tp1_meta_sync_gap_n: ${summary.tp1_meta_sync_gap_n ?? "N/A"}`);
  lines.push(`- tp1_meta_sync_gate: ${summary.tp1_meta_sync_gate || "N/A"}`);
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
  const tradeExecutionAlertMissingFillRawTotalN = tradeExecutionAlertCoverageReady
    ? Number(report.trade_execution_alert_cross_audit && report.trade_execution_alert_cross_audit.parsed && report.trade_execution_alert_cross_audit.parsed.missing_alert_fill_n || 0)
    : 0;
  const tradeExecutionAlertMissingFillN = tradeExecutionAlertCoverageReady
    ? Number(
      report.trade_execution_alert_cross_audit
      && report.trade_execution_alert_cross_audit.parsed
      && (
        report.trade_execution_alert_cross_audit.parsed.missing_verified_exit_alert_fill_n
        ?? report.trade_execution_alert_cross_audit.parsed.missing_alert_fill_n
      )
      || 0
    )
    : 0;
  const tradeExecutionAlertMissingFillNonActionableN = tradeExecutionAlertCoverageReady
    ? Number(
      report.trade_execution_alert_cross_audit
      && report.trade_execution_alert_cross_audit.parsed
      && (
        report.trade_execution_alert_cross_audit.parsed.missing_non_actionable_alert_fill_n
        ?? (tradeExecutionAlertMissingFillRawTotalN - tradeExecutionAlertMissingFillN)
      )
      || 0
    )
    : 0;
  const tradeExecutionAlertMissingFillTotalN = tradeExecutionAlertMissingFillN;
  const duplicationLiveGroupN = Number(report.fill_sync_alert_duplication_live_separation && report.fill_sync_alert_duplication_live_separation.parsed && report.fill_sync_alert_duplication_live_separation.parsed.live_duplicate_group_n || 0);
  const authorityLiveIssuePositionN = Number(report.binance_exit_authority_live_board && report.binance_exit_authority_live_board.parsed && report.binance_exit_authority_live_board.parsed.live_issue_position_n || 0);
  const authorityActionableLiveIssuePositionN = Number(report.binance_exit_authority_live_board && report.binance_exit_authority_live_board.parsed && report.binance_exit_authority_live_board.parsed.actionable_live_issue_position_n || 0);
  const authorityArtifactOnlyLiveIssuePositionN = Number(report.binance_exit_authority_live_board && report.binance_exit_authority_live_board.parsed && report.binance_exit_authority_live_board.parsed.artifact_only_live_issue_position_n || 0);
  const canonicalExitStageFailN = Number(report.binance_canonical_exit_stage_qa && report.binance_canonical_exit_stage_qa.parsed && report.binance_canonical_exit_stage_qa.parsed.fail_n || 0);
  const canonicalTransitionBackfillOk = !!(report.canonical_exit_transition_backfill && report.canonical_exit_transition_backfill.ok === true);
  const canonicalTransitionBackfillCreatedTransitionN = Number(report.canonical_exit_transition_backfill && report.canonical_exit_transition_backfill.parsed && report.canonical_exit_transition_backfill.parsed.created_transition_n || 0);
  const simplifiedExitV2LiveFlowActionableSymbolN = Number(report.simplified_exit_v2_live_flow && report.simplified_exit_v2_live_flow.parsed && report.simplified_exit_v2_live_flow.parsed.actionable_symbol_n || 0);
  const tp1MetaSyncGapN = countTp1MetaSyncGapIssues(report.simplified_exit_v2_tp1_drilldown || {});
  const stopDivergenceSymbolN = countStopDivergenceSymbols(report.active_exit_watchdog || {});
  // 2026-04-20 senior-audit P2: unprotected-window sub-gate.
  const unprotectedWindowParsed = (report.native_protection_unprotected_window
    && report.native_protection_unprotected_window.parsed) || {};
  const unprotectedWindowBreachN = Number(unprotectedWindowParsed.breach_count || 0);
  const unprotectedWindowBreachWindowN = Number(unprotectedWindowParsed.breach_window_count || 0);
  const unprotectedWindowCancelWithoutAckN = Number(unprotectedWindowParsed.breach_cancel_without_ack_count || 0);
  const unprotectedWindowMaxMs = Number.isFinite(Number(unprotectedWindowParsed.max_window_ms))
    ? Number(unprotectedWindowParsed.max_window_ms)
    : null;
  const unprotectedWindowThresholdMs = Number.isFinite(Number(unprotectedWindowParsed.threshold_ms))
    ? Number(unprotectedWindowParsed.threshold_ms)
    : null;
  const unprotectedWindowSkipped = !!(report.native_protection_unprotected_window
    && report.native_protection_unprotected_window.parsed
    && report.native_protection_unprotected_window.parsed.skipped === true);
  // 2026-04-20 senior-audit M1: distinguish "no breaches observed" from
  // "we could not observe anything because listPositions threw". The
  // runtime now sets available: false / gate_status: BLOCK when the
  // read side (Firestore) is down, and we must propagate that up or
  // the deploy gate silently passes on fleet-blindness.
  const unprotectedWindowAvailable = unprotectedWindowParsed.available !== false;
  const unprotectedWindowUnavailableReason = unprotectedWindowParsed.unavailable_reason
    || (!unprotectedWindowAvailable ? "UNKNOWN" : null);
  const unprotectedWindowUnavailableDetail = unprotectedWindowParsed.unavailable_detail || null;
  const unprotectedWindowReportedGateStatus = String(unprotectedWindowParsed.gate_status || "").trim().toUpperCase();
  const unprotectedWindowGate = (unprotectedWindowBreachN > 0 || !unprotectedWindowAvailable
      || unprotectedWindowReportedGateStatus === "BLOCK")
    ? "BLOCK"
    : "PASS";
  const duplicationIssueN = duplicationLiveGroupN > 0 ? duplicationLiveGroupN : fillSyncDuplicateGroupN;
  const scriptFailures = collectScriptFailures(report);
  const scriptFailureN = scriptFailures.length;
  const skippedValidationFamilies = Array.isArray(report.skipped_validation_families)
    ? report.skipped_validation_families
    : [];
  const skippedValidationFamilyN = skippedValidationFamilies.length;
  const actionableExitQtyLiveIssueChainN = authorityActionableLiveIssuePositionN > 0
    ? exitQtyLiveIssueChainN
    : 0;
  const liveIssueCount = afterGap + watchdogIssueSymbolN + exitQtyLiveIssueChainN + trailFloorLiveViolationN + duplicationIssueN + fillSyncAlertEventIssueN + tradeExecutionAlertMissingFillN + authorityActionableLiveIssuePositionN + canonicalExitStageFailN + simplifiedExitV2LiveFlowActionableSymbolN + tp1MetaSyncGapN;
  const actionableLiveIssueCount = afterGap + watchdogIssueSymbolN + actionableExitQtyLiveIssueChainN + trailFloorLiveViolationN + duplicationIssueN + fillSyncAlertEventIssueN + tradeExecutionAlertMissingFillN + authorityActionableLiveIssuePositionN + canonicalExitStageFailN + simplifiedExitV2LiveFlowActionableSymbolN + tp1MetaSyncGapN;
  const reasons = [];
  if (scriptFailureN > 0) reasons.push(`script failure ${scriptFailureN}건`);
  if (afterGap > 0) reasons.push(`native trail protection gap ${afterGap}건`);
  if (watchdogIssueSymbolN > 0) reasons.push(`active exit watchdog issue ${watchdogIssueSymbolN}건`);
  if (actionableExitQtyLiveIssueChainN > 0) reasons.push(`exit qty live issue chain ${actionableExitQtyLiveIssueChainN}건`);
  if (trailFloorLiveViolationN > 0) reasons.push(`trail floor live violation ${trailFloorLiveViolationN}건`);
  if (duplicationIssueN > 0) reasons.push(`fill sync duplicate group ${duplicationIssueN}건`);
  if (fillSyncAlertEventIssueN > 0) reasons.push(`fill sync alert event mismatch ${fillSyncAlertEventIssueN}건`);
  if (tradeExecutionAlertMissingFillN > 0) reasons.push(`trade execution alert missing fill ${tradeExecutionAlertMissingFillN}건`);
  if (authorityActionableLiveIssuePositionN > 0) reasons.push(`authority actionable issue position ${authorityActionableLiveIssuePositionN}건`);
  if (canonicalExitStageFailN > 0) reasons.push(`canonical exit stage fail ${canonicalExitStageFailN}건`);
  if (simplifiedExitV2LiveFlowActionableSymbolN > 0) reasons.push(`simplified exit v2 live flow actionable symbol ${simplifiedExitV2LiveFlowActionableSymbolN}건`);
  if (!canonicalTransitionBackfillOk) reasons.push("canonical exit transition backfill failed");
  if (tp1MetaSyncGapN > 0) reasons.push(`tp1 meta sync gap ${tp1MetaSyncGapN}건`);
  if (stopDivergenceSymbolN > 0) reasons.push(`stop divergence symbol ${stopDivergenceSymbolN}건`);
  if (unprotectedWindowBreachN > 0) {
    reasons.push(`native protection unprotected window breach ${unprotectedWindowBreachN}건 (window=${unprotectedWindowBreachWindowN}, cancel_without_ack=${unprotectedWindowCancelWithoutAckN}, max_ms=${unprotectedWindowMaxMs ?? "N/A"}, threshold_ms=${unprotectedWindowThresholdMs ?? "N/A"})`);
  }
  if (!unprotectedWindowAvailable) {
    reasons.push(`native protection unprotected window unavailable (reason=${unprotectedWindowUnavailableReason || "UNKNOWN"}${unprotectedWindowUnavailableDetail ? `, detail=${unprotectedWindowUnavailableDetail}` : ""})`);
  }
  if (skippedValidationFamilyN > 0) {
    reasons.push(`skipped validation families ${skippedValidationFamilyN}개 (${skippedValidationFamilies.map((f) => f.family || "UNKNOWN").join(", ")})`);
  }
  const liveGateBlocked = scriptFailureN > 0 || actionableLiveIssueCount > 0 || !canonicalTransitionBackfillOk || unprotectedWindowBreachN > 0 || !unprotectedWindowAvailable;
  return {
    status: liveGateBlocked ? "WARN" : "OK",
    live_gate_blocked: liveGateBlocked,
    skipped_validation_family_n: skippedValidationFamilyN,
    skipped_validation_families: skippedValidationFamilies,
    script_failure_n: scriptFailureN,
    script_failures: scriptFailures,
    live_issue_count: liveIssueCount,
    actionable_live_issue_count: actionableLiveIssueCount,
    native_gap_before: beforeGap,
    native_gap_after: afterGap,
    stage_issue_symbol_n: stageIssueSymbolN,
    watchdog_issue_symbol_n: watchdogIssueSymbolN,
    watchdog_repaired_symbol_n: watchdogRepairedSymbolN,
    exit_qty_live_issue_chain_n: exitQtyLiveIssueChainN,
    actionable_exit_qty_live_issue_chain_n: actionableExitQtyLiveIssueChainN,
    trail_floor_live_violation_n: trailFloorLiveViolationN,
    fill_sync_duplicate_group_n: fillSyncDuplicateGroupN,
    fill_sync_alert_event_issue_n: fillSyncAlertEventIssueN,
    trade_execution_alert_missing_fill_n: tradeExecutionAlertMissingFillN,
    trade_execution_alert_missing_fill_total_n: tradeExecutionAlertMissingFillTotalN,
    trade_execution_alert_missing_fill_non_actionable_n: tradeExecutionAlertMissingFillNonActionableN,
    trade_execution_alert_missing_fill_raw_total_n: tradeExecutionAlertMissingFillRawTotalN,
    trade_execution_alert_coverage_ready: tradeExecutionAlertCoverageReady,
    duplication_live_group_n: duplicationLiveGroupN,
    authority_live_issue_position_n: authorityLiveIssuePositionN,
    authority_actionable_live_issue_position_n: authorityActionableLiveIssuePositionN,
    authority_artifact_only_live_issue_position_n: authorityArtifactOnlyLiveIssuePositionN,
    canonical_exit_stage_fail_n: canonicalExitStageFailN,
    canonical_exit_stage_gate: canonicalExitStageFailN > 0 ? "BLOCK" : "PASS",
    canonical_transition_backfill_ok: canonicalTransitionBackfillOk,
    canonical_transition_backfill_created_transition_n: canonicalTransitionBackfillCreatedTransitionN,
    simplified_exit_v2_live_flow_actionable_symbol_n: simplifiedExitV2LiveFlowActionableSymbolN,
    simplified_exit_v2_live_flow_gate: simplifiedExitV2LiveFlowActionableSymbolN > 0 ? "BLOCK" : "PASS",
    tp1_meta_sync_gap_n: tp1MetaSyncGapN,
    tp1_meta_sync_gate: tp1MetaSyncGapN > 0 ? "BLOCK" : "PASS",
    stop_divergence_symbol_n: stopDivergenceSymbolN,
    stop_divergence_gate: stopDivergenceSymbolN > 0 ? "BLOCK" : "PASS",
    // 2026-04-20 senior-audit P2: unprotected-window sub-gate surfaced up
    // to the deploy gate via these four summary keys. Gate wrapper reads
    // `unprotected_window_gate` for the block decision and the other three
    // for the human-readable reason line.
    unprotected_window_breach_n: unprotectedWindowBreachN,
    unprotected_window_breach_window_n: unprotectedWindowBreachWindowN,
    unprotected_window_cancel_without_ack_n: unprotectedWindowCancelWithoutAckN,
    unprotected_window_max_ms: unprotectedWindowMaxMs,
    unprotected_window_threshold_ms: unprotectedWindowThresholdMs,
    unprotected_window_skipped: unprotectedWindowSkipped,
    unprotected_window_available: unprotectedWindowAvailable,
    unprotected_window_unavailable_reason: unprotectedWindowUnavailableReason,
    unprotected_window_unavailable_detail: unprotectedWindowUnavailableDetail,
    unprotected_window_gate: unprotectedWindowGate,
    reasons,
  };
}

function isNonZeroPosition(value) {
  const number = Number(value);
  return Number.isFinite(number) && Math.abs(number) > 1e-12;
}

function isActivePositionRow(row = {}) {
  if (!row || typeof row !== "object") return false;
  if (row.closed === true || row.is_closed === true) return false;
  const stage = String(row.stage || row.exit_stage || row.position_stage || row.lifecycle_stage || "").trim().toUpperCase();
  if (["CLOSED", "EXITED", "FLAT", "DONE"].includes(stage)) return false;
  const status = String(row.status || row.position_status || "").trim().toUpperCase();
  if (["CLOSED", "EXITED", "FLAT"].includes(status)) return false;
  const qtyFields = [
    "runner_remaining_abs",
    "remaining_qty",
    "remaining_qty_abs",
    "qty",
    "quantity",
    "size",
    "position_qty",
    "position_amt",
    "net_qty",
    "contracts",
    "base_size",
  ];
  if (qtyFields.some((key) => isNonZeroPosition(row[key]))) return true;
  return ["OPEN", "ACTIVE", "PARTIAL", "TP0", "TP1", "TRAIL"].includes(stage)
    || ["OPEN", "ACTIVE", "PARTIAL"].includes(status);
}

async function listRawExchangePositions({
  exchange,
  limit = 25,
} = {}) {
  const db = getFirestore();
  let query = db.collection("positions_paper").where("exchange", "==", String(exchange || "").trim().toUpperCase());
  const normalizedLimit = Number.isFinite(Number(limit)) && Number(limit) > 0
    ? Math.trunc(Number(limit))
    : 25;
  if (normalizedLimit > 0) query = query.limit(normalizedLimit);
  const snap = await query.get();
  const rows = [];
  snap.forEach((doc) => {
    rows.push({ id: doc.id, ...(doc.data() || {}) });
  });
  return rows;
}

function buildSkippedSummary(reason, extra = {}) {
  return {
    status: "SKIP",
    live_gate_blocked: false,
    script_failure_n: 0,
    script_failures: [],
    live_issue_count: 0,
    native_gap_before: 0,
    native_gap_after: 0,
    stage_issue_symbol_n: 0,
    watchdog_issue_symbol_n: 0,
    watchdog_repaired_symbol_n: 0,
    exit_qty_live_issue_chain_n: 0,
    trail_floor_live_violation_n: 0,
    fill_sync_duplicate_group_n: 0,
    fill_sync_alert_event_issue_n: 0,
    trade_execution_alert_missing_fill_n: 0,
    trade_execution_alert_missing_fill_total_n: 0,
    trade_execution_alert_missing_fill_non_actionable_n: 0,
    trade_execution_alert_missing_fill_raw_total_n: 0,
    trade_execution_alert_coverage_ready: false,
    duplication_live_group_n: 0,
    authority_live_issue_position_n: 0,
    authority_actionable_live_issue_position_n: 0,
    authority_artifact_only_live_issue_position_n: 0,
    canonical_exit_stage_fail_n: 0,
    canonical_exit_stage_gate: "PASS",
    canonical_transition_backfill_ok: true,
    canonical_transition_backfill_created_transition_n: 0,
    simplified_exit_v2_live_flow_actionable_symbol_n: 0,
    simplified_exit_v2_live_flow_gate: "PASS",
    tp1_meta_sync_gap_n: 0,
    tp1_meta_sync_gate: "PASS",
    stop_divergence_symbol_n: 0,
    stop_divergence_gate: "PASS",
    // 2026-04-20 senior-audit P2 defaults for cycle-skip path.
    unprotected_window_breach_n: 0,
    unprotected_window_breach_window_n: 0,
    unprotected_window_cancel_without_ack_n: 0,
    unprotected_window_max_ms: null,
    unprotected_window_threshold_ms: null,
    unprotected_window_skipped: true,
    // M1: the cycle-skip path is treated as "we didn't check" — surface
    // the sub-report as available: true to avoid double-counting the
    // skip as an unavailable signal (the cycle-level skip is already
    // a gate block via CYCLE_SKIPPED).
    unprotected_window_available: true,
    unprotected_window_unavailable_reason: null,
    unprotected_window_unavailable_detail: null,
    unprotected_window_gate: "PASS",
    reasons: [reason],
    skip_reason: reason,
    ...extra,
  };
}

function buildSkippedCycleReport({
  exchange,
  apply,
  disableExchangeIo,
  reason,
  extraSummary = {},
} = {}) {
  const generatedAt = new Date().toISOString();
  const summary = buildSkippedSummary(reason, extraSummary);
  return {
    ok: true,
    skipped: true,
    generated_at: generatedAt,
    exchange,
    apply,
    exchange_io_disabled: disableExchangeIo === true,
    summary,
    ...summary,
  };
}

function writeCycleArtifacts(report, opsDailyDir) {
  const latestJson = path.join(opsDailyDir, "binance_exit_integrity_cycle_latest.json");
  const latestMd = path.join(opsDailyDir, "binance_exit_integrity_cycle_latest.md");
  const datedJson = path.join(opsDailyDir, `${isoDate()}_binance_exit_integrity_cycle.json`);
  fs.writeFileSync(latestJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(datedJson, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(latestMd, `${buildMarkdown(report)}\n`, "utf8");
  return { latestJson, latestMd };
}

async function runBinanceExitIntegrityCycle({
  apply = envBool(process.env.APPLY, false),
  exchange = "BINANCEFUT",
  opsDailyDir = OPS_DAILY_DIR,
  reportNativeGap = generateNativeTrailProtectionGapReport,
  runWatchdog = runBinanceActiveExitWatchdog,
  selfHeal = runBinanceLiveStateSelfHeal,
  runScriptImpl = runScript,
  disableExchangeIo = envBool(process.env.EXIT_INTEGRITY_CI_NO_EXCHANGE_IO, false),
  enabled = envBool(
    process.env.OPENCLAW_EXIT_INTEGRITY_CYCLE_ENABLED != null
      ? process.env.OPENCLAW_EXIT_INTEGRITY_CYCLE_ENABLED
      : process.env.EXIT_INTEGRITY_CYCLE_ENABLED,
    true
  ),
  skipWhenNoActivePositions = envBool(process.env.EXIT_INTEGRITY_SKIP_WHEN_NO_ACTIVE_POSITIONS, false),
  listActivePositions = listRawExchangePositions,
  activePositionPrecheckLimit = Number(process.env.EXIT_INTEGRITY_ACTIVE_PRECHECK_LIMIT || 25),
  profile = normalizeCycleProfile(process.env.EXIT_INTEGRITY_PROFILE || "ops"),
} = {}) {
  fs.mkdirSync(opsDailyDir, { recursive: true });
  const cycleProfile = normalizeCycleProfile(profile);
  const cycleProfileEnv = resolveCycleProfileEnv(cycleProfile);
  // C8 shared cache: snapshot the hot Firestore collections once at the top
  // of the cycle so that subscripts opting in via
  // `EXIT_INTEGRITY_COLLECTION_CACHE_PATH` can read from the flat JSON blob
  // instead of re-issuing equivalent queries. Subscripts that have not
  // adopted the cache simply ignore the env var and keep their legacy path.
  let collectionCacheMeta = null;
  try {
    if (!disableExchangeIo) {
      const db = getFirestore();
      const cacheLookbackMs = Number(
        process.env.EXIT_INTEGRITY_COLLECTION_CACHE_LOOKBACK_MS
        || (cycleProfile === "gate" ? 2 * 60 * 60 * 1000 : 6 * 60 * 60 * 1000)
      );
      const cache = await writeExitIntegrityCollectionCache({
        db,
        outDir: opsDailyDir,
        lookbackMs: cacheLookbackMs,
        exchange,
      });
      collectionCacheMeta = {
        path: cache.path,
        generated_at: cache.payload && cache.payload.generated_at,
        lookback_ms: cache.payload && cache.payload.lookback_ms,
        duration_ms: cache.payload && cache.payload.duration_ms,
        row_counts: Object.fromEntries(
          Object.entries((cache.payload && cache.payload.collections) || {}).map(([name, entry]) => [
            name,
            Array.isArray(entry && entry.rows) ? entry.rows.length : 0,
          ])
        ),
      };
      cycleProfileEnv[EXIT_INTEGRITY_COLLECTION_CACHE_ENV] = cache.path;
    }
  } catch (cacheErr) {
    collectionCacheMeta = {
      path: null,
      error: cacheErr && cacheErr.message ? cacheErr.message : String(cacheErr),
    };
  }

  if (enabled !== true) {
    const skippedReport = buildSkippedCycleReport({
      exchange,
      apply,
      disableExchangeIo,
      reason: "EXIT_INTEGRITY_CYCLE_DISABLED",
    });
    const artifacts = writeCycleArtifacts(skippedReport, opsDailyDir);
    return {
      ok: true,
      skipped: true,
      status: skippedReport.summary.status,
      summary: skippedReport.summary,
      output_json: artifacts.latestJson,
      output_md: artifacts.latestMd,
    };
  }

  if (!disableExchangeIo && skipWhenNoActivePositions === true) {
    const activeRows = await Promise.resolve(
      listActivePositions({
        exchange,
        limit: activePositionPrecheckLimit,
      })
    ).catch(() => null);
    if (Array.isArray(activeRows) && !activeRows.some((row) => isActivePositionRow(row))) {
      const skippedReport = buildSkippedCycleReport({
        exchange,
        apply,
        disableExchangeIo,
        reason: "NO_ACTIVE_POSITIONS",
        extraSummary: {
          active_position_precheck_n: activeRows.length,
        },
      });
      const artifacts = writeCycleArtifacts(skippedReport, opsDailyDir);
      return {
        ok: true,
        skipped: true,
        status: skippedReport.summary.status,
        summary: skippedReport.summary,
        output_json: artifacts.latestJson,
        output_md: artifacts.latestMd,
      };
    }
  }

  const runScriptStep = (script, env = {}) => Promise.resolve(runScriptImpl(script, env));

  const [nativeGapBefore, stageBackfill, activeExitWatchdog] = await Promise.all([
    disableExchangeIo
      ? Promise.resolve(buildSkippedNativeGapReport(exchange))
      : reportNativeGap({ exchange, outDir: opsDailyDir }),
    runScriptStep("backfill-binance-active-exit-stage.js", {
      DRY_RUN: apply ? "0" : "1",
    }),
    disableExchangeIo
      ? Promise.resolve(buildSkippedWatchdogReport())
      : runWatchdog({
        exchange,
        apply,
        maxRepairCount: Number(process.env.ACTIVE_EXIT_WATCHDOG_MAX_REPAIR_COUNT || 10),
      }),
  ]);
  const gapSymbols = Array.isArray(nativeGapBefore.summary && nativeGapBefore.summary.rows)
    ? nativeGapBefore.summary.rows.map((row) => String(row && row.symbol || "").trim().toUpperCase()).filter(Boolean)
    : [];

  let selfHealResult = {
    ok: true,
    skipped: true,
    reason: apply ? "NO_NATIVE_GAP" : "APPLY_DISABLED",
    scanned: 0,
    healed_n: 0,
    skipped_n: 0,
    results: [],
  };
  if (!disableExchangeIo && apply && gapSymbols.length) {
    selfHealResult = await selfHeal({
      exchange,
      symbols: gapSymbols,
      maxPositions: gapSymbols.length,
      forceRepair: true,
      reason: "EXIT_INTEGRITY_CYCLE",
    });
  }

  const nativeGapAfter = (!disableExchangeIo && apply)
    ? await reportNativeGap({ exchange, outDir: opsDailyDir })
    : nativeGapBefore;
  const [
    canonicalExitTransitionBackfill,
    fillSyncAlertDuplication,
    fillSyncAlertEventConsistency,
    tradeExecutionAlertCrossAudit,
    exitQtyContractAudit,
    trailRunnerFloorAudit,
    canonicalExitStageQa,
    simplifiedExitV2LiveFlow,
    simplifiedExitV2Tp1Drilldown,
  ] = await Promise.all([
    disableExchangeIo
      ? Promise.resolve(buildSkippedScriptStep({ created_transition_n: 0 }))
      : runScriptStep("backfill-canonical-exit-transitions.js", {
        ...cycleProfileEnv,
      }),
    runScriptStep("report-fill-sync-alert-duplication.js"),
    runScriptStep("report-fill-sync-alert-event-consistency.js"),
    runScriptStep("report-trade-execution-alert-cross-audit.js", {
      ...cycleProfileEnv,
    }),
    runScriptStep("report-binance-exit-qty-contract-audit.js"),
    runScriptStep("report-trail-runner-floor-audit.js"),
    disableExchangeIo
      ? Promise.resolve(buildSkippedScriptStep({ fail_n: 0, active_position_n: 0 }))
      : runScriptStep("report-binance-canonical-exit-stage-qa.js", {
        ...cycleProfileEnv,
      }),
    disableExchangeIo
      ? Promise.resolve(buildSkippedScriptStep({ actionable_symbol_n: 0, issue_code_counts: {} }))
      : runScriptStep("report-simplified-exit-v2-live-flow.js", {
        ...cycleProfileEnv,
      }),
    disableExchangeIo
      ? Promise.resolve(buildSkippedScriptStep({ actionable_symbol_n: 0, issue_code_counts: {} }))
      : runScriptStep("report-simplified-exit-v2-tp1-drilldown.js", {
        ...cycleProfileEnv,
      }),
  ]);
  const [
    fillSyncAlertDuplicationLiveSeparation,
    exitQtyLiveSeparation,
    trailRunnerFloorLiveSeparation,
  ] = await Promise.all([
    runScriptStep("report-fill-sync-alert-duplication-live-separation.js"),
    runScriptStep("report-binance-exit-qty-live-separation.js"),
    runScriptStep("report-trail-runner-floor-live-separation.js"),
  ]);
  const authorityLiveBoard = await runScriptStep("report-binance-exit-authority-live-board.js");
  // 2026-04-20 senior-audit P2: unprotected-window sub-report runs in the
  // final serial step because it depends on meta that may have been written
  // by the self-heal phase earlier in this cycle. Running it after the
  // authority board also keeps it next to the other "live board" reports
  // for log readability. It's gated off when exchange-IO is disabled (the
  // meta is still readable from Firestore, but there's no semantic signal
  // to block on when we've explicitly told the cycle to skip exchange-IO
  // validation families).
  const nativeProtectionUnprotectedWindow = disableExchangeIo
    ? buildSkippedScriptStep({ breach_count: 0, gate_status: "PASS", max_window_ms: null })
    : await runScriptStep("report-native-protection-unprotected-window.js");

  // P3-09: enumerate which validation families were skipped under the current
  // CI knob so ops (and the deploy gate) can refuse to treat a skip as pass.
  const skippedValidationFamilies = (() => {
    const skipped = [];
    if (disableExchangeIo) {
      skipped.push({
        family: "EXCHANGE_IO",
        reason: "EXIT_INTEGRITY_CI_NO_EXCHANGE_IO=1",
        affected: [
          "native_trail_gap_before",
          "active_exit_watchdog",
          "self_heal",
          "native_trail_gap_after",
          "canonical_exit_transition_backfill",
          "binance_canonical_exit_stage_qa",
          "simplified_exit_v2_live_flow",
          "simplified_exit_v2_tp1_drilldown",
          // 2026-04-20 senior-audit P2
          "native_protection_unprotected_window",
        ],
      });
    }
    return skipped;
  })();

  const report = {
    ok: true,
    generated_at: new Date().toISOString(),
    exchange,
    apply,
    profile: cycleProfile,
    exchange_io_disabled: disableExchangeIo,
    skipped_validation_families: skippedValidationFamilies,
    collection_cache: collectionCacheMeta || null,
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
    simplified_exit_v2_live_flow: simplifiedExitV2LiveFlow,
    simplified_exit_v2_tp1_drilldown: simplifiedExitV2Tp1Drilldown,
    // 2026-04-20 senior-audit P2
    native_protection_unprotected_window: nativeProtectionUnprotectedWindow,
  };
  report.summary = buildSummary(report);
  Object.assign(report, report.summary);

  const artifacts = writeCycleArtifacts(report, opsDailyDir);

  if (collectionCacheMeta && collectionCacheMeta.path) {
    removeCacheFile(collectionCacheMeta.path);
  }

  return {
    ok: true,
    status: report.summary.status,
    summary: report.summary,
    output_json: artifacts.latestJson,
    output_md: artifacts.latestMd,
    collection_cache: collectionCacheMeta || null,
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
      countTp1MetaSyncGapIssues,
      collectScriptFailures,
      isActivePositionRow,
      buildSkippedSummary,
      normalizeCycleProfile,
      resolveCycleProfileEnv,
    },
  };
}
