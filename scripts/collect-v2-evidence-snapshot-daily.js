#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const DEFAULT_OUTPUT_FILE = path.join(OPS_DAILY_DIR, "v2_evidence_snapshot_latest.json");
const DEFAULT_HISTORY_FILE = path.join(OPS_DAILY_DIR, "v2_evidence_streak.jsonl");

const DEFAULT_FILES = Object.freeze({
  performanceGate: path.join(OPS_DAILY_DIR, "v2_performance_gate_latest.json"),
  performanceReport: path.join(OPS_DAILY_DIR, "v2_openclaw_daily_performance_report_latest.json"),
  activeProtectionLatest: path.join(OPS_DAILY_DIR, "v2_active_protection_reconciliation_latest.json"),
  activeProtectionDaily: path.join(OPS_DAILY_DIR, "v2_active_protection_reconciliation_daily_summary_latest.json"),
  activeProtectionHistory: path.join(OPS_DAILY_DIR, "v2_active_protection_reconciliation_history.jsonl"),
  v1WriterLatest: path.join(OPS_DAILY_DIR, "v2_v1_writer_deny_streak_latest.json"),
  v1WriterHistory: path.join(OPS_DAILY_DIR, "v2_v1_writer_deny_streak_history.jsonl"),
  algoEndpointLatest: path.join(OPS_DAILY_DIR, "v2_algo_endpoint_degradation_state_latest.json"),
  algoEndpointHistory: path.join(OPS_DAILY_DIR, "v2_algo_endpoint_degradation_state_history.jsonl"),
  repairQueueLatest: path.join(OPS_DAILY_DIR, "v2_repair_queue_service_latest.json"),
  runtimeManifestLatest: path.join(OPS_DAILY_DIR, "v2_runtime_discovery_canary_manifest_latest.json"),
});

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function firstNumber(...values) {
  for (const value of values) {
    const n = toNumberOrNull(value);
    if (n != null) return n;
  }
  return null;
}

function boolOrNull(value) {
  if (value === true || value === false) return value;
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return null;
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return null;
}

function normalizeRate(value) {
  const n = toNumberOrNull(value);
  if (n == null) return null;
  return Math.abs(n) > 1 ? n / 100 : n;
}

function dateKeyFromMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function readJsonSafe(file) {
  try {
    return { file, exists: true, data: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (error) {
    return { file, exists: false, data: null, error };
  }
}

function readJsonlSafe(file) {
  try {
    const rows = fs.readFileSync(file, "utf8")
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { file, exists: true, rows };
  } catch (error) {
    return { file, exists: false, rows: [], error };
  }
}

function ensureDir(file) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
}

function writeJson(file, payload) {
  ensureDir(file);
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function appendJsonl(file, payload) {
  ensureDir(file);
  fs.appendFileSync(file, `${JSON.stringify(payload)}\n`, "utf8");
}

function resolveFiles(env = process.env) {
  return Object.freeze({
    performanceGate: trimOrNull(env.V2_EVIDENCE_SNAPSHOT_PERFORMANCE_GATE_FILE) || DEFAULT_FILES.performanceGate,
    performanceReport: trimOrNull(env.V2_EVIDENCE_SNAPSHOT_PERFORMANCE_REPORT_FILE) || DEFAULT_FILES.performanceReport,
    activeProtectionLatest: trimOrNull(env.V2_EVIDENCE_SNAPSHOT_ACTIVE_PROTECTION_LATEST_FILE) || DEFAULT_FILES.activeProtectionLatest,
    activeProtectionDaily: trimOrNull(env.V2_EVIDENCE_SNAPSHOT_ACTIVE_PROTECTION_DAILY_FILE) || DEFAULT_FILES.activeProtectionDaily,
    activeProtectionHistory: trimOrNull(env.V2_EVIDENCE_SNAPSHOT_ACTIVE_PROTECTION_HISTORY_FILE) || DEFAULT_FILES.activeProtectionHistory,
    v1WriterLatest: trimOrNull(env.V2_EVIDENCE_SNAPSHOT_V1_WRITER_FILE) || DEFAULT_FILES.v1WriterLatest,
    v1WriterHistory: trimOrNull(env.V2_EVIDENCE_SNAPSHOT_V1_WRITER_HISTORY_FILE) || DEFAULT_FILES.v1WriterHistory,
    algoEndpointLatest: trimOrNull(env.V2_EVIDENCE_SNAPSHOT_ALGO_ENDPOINT_FILE) || DEFAULT_FILES.algoEndpointLatest,
    algoEndpointHistory: trimOrNull(env.V2_EVIDENCE_SNAPSHOT_ALGO_ENDPOINT_HISTORY_FILE) || DEFAULT_FILES.algoEndpointHistory,
    repairQueueLatest: trimOrNull(env.V2_EVIDENCE_SNAPSHOT_REPAIR_QUEUE_FILE) || DEFAULT_FILES.repairQueueLatest,
    runtimeManifestLatest: trimOrNull(env.V2_EVIDENCE_SNAPSHOT_RUNTIME_MANIFEST_FILE) || DEFAULT_FILES.runtimeManifestLatest,
  });
}

function rowTimestampMs(row) {
  return Date.parse(String(row && (row.generated_at || row.window_end_at || row.date || row.date_key) || ""));
}

function rowsWithinDays(rows = [], nowMs = Date.now(), days = 30) {
  const startMs = nowMs - Math.max(1, Number(days) || 30) * 24 * 60 * 60 * 1000;
  return (Array.isArray(rows) ? rows : [])
    .map((row) => ({ row, ts: rowTimestampMs(row) }))
    .filter((item) => Number.isFinite(item.ts) && item.ts >= startMs && item.ts <= nowMs)
    .sort((a, b) => a.ts - b.ts)
    .map((item) => item.row);
}

function buildPerformanceSummary({ performanceGate = null, performanceReport = null } = {}) {
  const gate = performanceGate && typeof performanceGate === "object" ? performanceGate : {};
  const gateMetrics = gate.metrics && typeof gate.metrics === "object" ? gate.metrics : {};
  const report = performanceReport && typeof performanceReport === "object" ? performanceReport : {};
  const summary = report.summary && typeof report.summary === "object" ? report.summary : {};
  const perf = report.performance && typeof report.performance === "object" ? report.performance : {};
  const costs = report.costs && typeof report.costs === "object" ? report.costs : {};
  const sampleN = firstNumber(gateMetrics.sample_n, report.sample_n, report.trade_n, report.outcome_n, summary.trade_n, summary.outcome_n);
  const pf = firstNumber(gateMetrics.profit_factor, report.profit_factor, perf.profit_factor, summary.profit_factor);
  const expectancyR = firstNumber(gateMetrics.expectancy_r, report.expectancy_r, perf.expectancy_r, summary.expectancy_r);
  const expectancyQuote = firstNumber(report.expectancy_quote, report.expectancy, perf.expectancy_quote, summary.expectancy_quote, summary.expectancy);
  const netPnlQuote = firstNumber(gateMetrics.net_pnl_usdt, report.net_pnl_usdt, perf.net_pnl_usdt, summary.net_pnl_usdt);
  const netPnlPct = firstNumber(gateMetrics.net_pnl_pct, report.net_pnl_pct, perf.net_pnl_pct, summary.net_pnl_pct);
  const winRate = normalizeRate(firstNumber(gateMetrics.win_rate_pct, report.win_rate_pct, report.win_rate, perf.win_rate_pct, summary.win_rate_pct, summary.win_rate));
  const maxDrawdownPct = firstNumber(gateMetrics.max_drawdown_pct, report.max_drawdown_pct, report.mdd_pct, perf.max_drawdown_pct, perf.mdd_pct, summary.max_drawdown_pct);
  const maxDrawdownQuote = firstNumber(report.max_drawdown_quote, report.max_drawdown_usdt, perf.max_drawdown_quote, perf.max_drawdown_usdt, summary.max_drawdown_quote, summary.max_drawdown_usdt);
  const feeIncluded = boolOrNull(report.fee_included ?? perf.fee_included ?? costs.fee_included);
  const fundingIncluded = boolOrNull(report.funding_included ?? perf.funding_included ?? costs.funding_included);
  const slippageIncluded = boolOrNull(report.slippage_included ?? perf.slippage_included ?? costs.slippage_included);
  const bySymbol = summary.by_symbol && typeof summary.by_symbol === "object" ? summary.by_symbol : report.by_symbol;
  const byRegime = summary.by_regime && typeof summary.by_regime === "object" ? summary.by_regime : report.by_regime;
  const blockers = Array.isArray(gate.blockers) ? gate.blockers : [];
  const performanceGateStatus = gate.ok === true
    ? "PASS"
    : (blockers.includes("PERFORMANCE_GATE:SAMPLE_INSUFFICIENT") ? "ACCUMULATING" : "BLOCKED");

  return Object.freeze({
    sample_n_total: sampleN,
    sample_n_30d: sampleN,
    profit_factor_30d: pf,
    expectancy_r_30d: expectancyR,
    expectancy_30d_quote: expectancyQuote,
    net_pnl_30d_quote: netPnlQuote,
    net_pnl_30d_pct: netPnlPct,
    win_rate_30d: winRate,
    max_drawdown_30d_quote: maxDrawdownQuote,
    max_drawdown_30d_pct: maxDrawdownPct,
    fee_included: feeIncluded,
    funding_included: fundingIncluded,
    slippage_included: slippageIncluded,
    symbol_breakdown_present: bySymbol && typeof bySymbol === "object" && Object.keys(bySymbol).length > 0,
    regime_breakdown_present: byRegime && typeof byRegime === "object" && Object.keys(byRegime).length > 0,
    performance_gate_status: performanceGateStatus,
    performance_gate_reason: trimOrNull(gate.reason),
    performance_gate_blockers: Object.freeze(blockers),
  });
}

function dailyProtectionPass(row) {
  return row && row.ok === true
    && Number(row.unprotected_position_n || row.max_unprotected_position_n || 0) === 0
    && Number(row.critical_issue_n || 0) === 0;
}

function computeActiveProtectionStreakDays(rows = [], latest = null, nowMs = Date.now()) {
  const byDate = new Map();
  const allRows = [...(Array.isArray(rows) ? rows : [])];
  if (latest) allRows.push(latest);
  for (const row of allRows) {
    const ts = rowTimestampMs(row);
    if (!Number.isFinite(ts)) continue;
    const key = dateKeyFromMs(ts);
    const current = byDate.get(key) || { row_n: 0, pass: true };
    current.row_n += 1;
    current.pass = current.pass && dailyProtectionPass(row);
    byDate.set(key, current);
  }
  let streak = 0;
  for (let i = 0; i < 30; i += 1) {
    const key = dateKeyFromMs(nowMs - i * 24 * 60 * 60 * 1000);
    const day = byDate.get(key);
    if (!day || day.row_n <= 0 || day.pass !== true) break;
    streak += 1;
  }
  return streak;
}

function buildSafetySummary({
  activeProtectionLatest = null,
  activeProtectionDaily = null,
  activeProtectionHistoryRows = [],
  v1WriterLatest = null,
  v1WriterHistoryRows = [],
  algoEndpointLatest = null,
  algoEndpointHistoryRows = [],
  repairQueueLatest = null,
  runtimeManifestLatest = null,
  nowMs = Date.now(),
} = {}) {
  const activeRows30d = rowsWithinDays(activeProtectionHistoryRows, nowMs, 30);
  const latestActive = activeProtectionDaily || activeProtectionLatest;
  const activeRowsWithLatest = [...activeRows30d];
  if (latestActive) {
    const latestTs = rowTimestampMs(latestActive);
    const latestAlreadyIncluded = Number.isFinite(latestTs)
      && activeRows30d.some((row) => rowTimestampMs(row) === latestTs);
    if (!latestAlreadyIncluded) activeRowsWithLatest.push(latestActive);
  }
  const v1Rows30d = rowsWithinDays(v1WriterHistoryRows, nowMs, 30);
  const algoRows30d = rowsWithinDays(algoEndpointHistoryRows, nowMs, 30);
  const sum = (rows, field) => rows.reduce((acc, row) => acc + (Number(row && row[field]) || 0), 0);
  const max = (rows, field) => rows.reduce((acc, row) => Math.max(acc, Number(row && row[field]) || 0), 0);
  const v1LatestWrites = firstNumber(
    v1WriterLatest && v1WriterLatest.v1_place_futures_call_n_24h,
    v1WriterLatest && v1WriterLatest.v1_direct_exchange_write_call_n_24h,
    v1WriterLatest && v1WriterLatest.v1_place_futures_call_n,
    0,
  );
  const v1Writes30d = v1Rows30d.length
    ? v1Rows30d.reduce((acc, row) => acc + (firstNumber(
      row && row.v1_place_futures_call_n_24h,
      row && row.v1_direct_exchange_write_call_n_24h,
      row && row.v1_place_futures_call_n,
      0,
    ) || 0), 0)
    : v1LatestWrites;
  const algoCrit30d = algoRows30d.length ? sum(algoRows30d, "degraded_crit_n") : Number(algoEndpointLatest && algoEndpointLatest.degraded_crit_n || 0);
  const algoWarn30d = algoRows30d.length ? sum(algoRows30d, "degraded_warn_n") : Number(algoEndpointLatest && algoEndpointLatest.degraded_warn_n || 0);
  const repairSummary = repairQueueLatest && repairQueueLatest.summary && typeof repairQueueLatest.summary === "object" ? repairQueueLatest.summary : {};
  const manifestOk = runtimeManifestLatest && typeof runtimeManifestLatest === "object" ? runtimeManifestLatest.ok : null;

  return Object.freeze({
    active_protection_streak_days: computeActiveProtectionStreakDays(activeRows30d, latestActive, nowMs),
    active_protection_ok: latestActive ? latestActive.ok === true : null,
    active_position_n: firstNumber(latestActive && latestActive.active_position_n, latestActive && latestActive.latest && latestActive.latest.active_position_n),
    protected_position_n: firstNumber(latestActive && latestActive.protected_position_n, latestActive && latestActive.latest && latestActive.latest.protected_position_n),
    unprotected_position_n: firstNumber(latestActive && latestActive.unprotected_position_n, latestActive && latestActive.latest && latestActive.latest.unprotected_position_n),
    max_unprotected_position_30d: Math.max(
      max(activeRowsWithLatest, "unprotected_position_n"),
      max(activeRowsWithLatest, "max_unprotected_position_n"),
    ),
    post_fill_critical_30d: sum(activeRowsWithLatest, "critical_issue_n"),
    v1_place_futures_call_n_30d: v1Writes30d,
    algo_endpoint_degraded_warn_n_30d: algoWarn30d,
    algo_endpoint_degraded_crit_n_30d: algoCrit30d,
    repair_queue_lag_p95_ms: firstNumber(repairQueueLatest && repairQueueLatest.repair_queue_lag_p95_ms, repairSummary.repair_queue_lag_p95_ms),
    repair_requested_n: firstNumber(repairSummary.requested_repair_n, repairQueueLatest && repairQueueLatest.requested_repair_n),
    repair_missing_context_n: firstNumber(repairSummary.missing_context_n, repairQueueLatest && repairQueueLatest.missing_context_n),
    cloud_run_revision_drift_n: manifestOk === null || manifestOk === undefined ? null : (manifestOk === true ? 0 : 1),
  });
}

function buildSnapshot({ loaded = {}, env = process.env, nowMs = Date.now() } = {}) {
  const performance = buildPerformanceSummary({
    performanceGate: loaded.performanceGate && loaded.performanceGate.data,
    performanceReport: loaded.performanceReport && loaded.performanceReport.data,
  });
  const safety = buildSafetySummary({
    activeProtectionLatest: loaded.activeProtectionLatest && loaded.activeProtectionLatest.data,
    activeProtectionDaily: loaded.activeProtectionDaily && loaded.activeProtectionDaily.data,
    activeProtectionHistoryRows: loaded.activeProtectionHistory && loaded.activeProtectionHistory.rows,
    v1WriterLatest: loaded.v1WriterLatest && loaded.v1WriterLatest.data,
    v1WriterHistoryRows: loaded.v1WriterHistory && loaded.v1WriterHistory.rows,
    algoEndpointLatest: loaded.algoEndpointLatest && loaded.algoEndpointLatest.data,
    algoEndpointHistoryRows: loaded.algoEndpointHistory && loaded.algoEndpointHistory.rows,
    repairQueueLatest: loaded.repairQueueLatest && loaded.repairQueueLatest.data,
    runtimeManifestLatest: loaded.runtimeManifestLatest && loaded.runtimeManifestLatest.data,
    nowMs,
  });
  const missingEvidence = Object.entries(loaded)
    .filter(([, value]) => value && value.required === true && value.exists !== true)
    .map(([key]) => key)
    .sort();
  const blockers = [];
  if (Number(safety.max_unprotected_position_30d || 0) > 0) blockers.push("EVIDENCE_SNAPSHOT:UNPROTECTED_POSITION_30D");
  if (Number(safety.post_fill_critical_30d || 0) > 0) blockers.push("EVIDENCE_SNAPSHOT:POST_FILL_CRITICAL_30D");
  if (Number(safety.v1_place_futures_call_n_30d || 0) > 0) blockers.push("EVIDENCE_SNAPSHOT:V1_WRITER_CALL_30D");
  if (Number(safety.algo_endpoint_degraded_crit_n_30d || 0) > 0) blockers.push("EVIDENCE_SNAPSHOT:ALGO_ENDPOINT_CRIT_30D");
  if (safety.cloud_run_revision_drift_n !== null && Number(safety.cloud_run_revision_drift_n) > 0) blockers.push("EVIDENCE_SNAPSHOT:CLOUD_RUN_REVISION_DRIFT");
  if (missingEvidence.length) blockers.push("EVIDENCE_SNAPSHOT:REQUIRED_EVIDENCE_MISSING");

  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0 ? "V2_EVIDENCE_SNAPSHOT_COLLECTED" : "V2_EVIDENCE_SNAPSHOT_BLOCKED",
    generated_at: new Date(nowMs).toISOString(),
    date: dateKeyFromMs(nowMs),
    blockers: Object.freeze(blockers),
    missing_required_evidence: Object.freeze(missingEvidence),
    sample_n_total: performance.sample_n_total,
    sample_n_30d: performance.sample_n_30d,
    profit_factor_30d: performance.profit_factor_30d,
    expectancy_r_30d: performance.expectancy_r_30d,
    expectancy_30d_quote: performance.expectancy_30d_quote,
    net_pnl_30d_quote: performance.net_pnl_30d_quote,
    net_pnl_30d_pct: performance.net_pnl_30d_pct,
    win_rate_30d: performance.win_rate_30d,
    max_drawdown_30d_quote: performance.max_drawdown_30d_quote,
    max_drawdown_30d_pct: performance.max_drawdown_30d_pct,
    active_protection_streak_days: safety.active_protection_streak_days,
    active_position_n: safety.active_position_n,
    protected_position_n: safety.protected_position_n,
    unprotected_position_n: safety.unprotected_position_n,
    max_unprotected_position_30d: safety.max_unprotected_position_30d,
    post_fill_critical_30d: safety.post_fill_critical_30d,
    v1_place_futures_call_n_30d: safety.v1_place_futures_call_n_30d,
    algo_endpoint_degraded_warn_n_30d: safety.algo_endpoint_degraded_warn_n_30d,
    algo_endpoint_degraded_crit_n_30d: safety.algo_endpoint_degraded_crit_n_30d,
    repair_queue_lag_p95_ms: safety.repair_queue_lag_p95_ms,
    repair_requested_n: safety.repair_requested_n,
    repair_missing_context_n: safety.repair_missing_context_n,
    cloud_run_revision_drift_n: safety.cloud_run_revision_drift_n,
    performance_gate_status: performance.performance_gate_status,
    performance_gate_reason: performance.performance_gate_reason,
    performance_gate_blockers: performance.performance_gate_blockers,
    fee_included: performance.fee_included,
    funding_included: performance.funding_included,
    slippage_included: performance.slippage_included,
    symbol_breakdown_present: performance.symbol_breakdown_present,
    regime_breakdown_present: performance.regime_breakdown_present,
    source_files: Object.freeze(Object.fromEntries(Object.entries(loaded).map(([key, value]) => [key, value && value.file || null]))),
  });
}

function loadInputs(files = resolveFiles(), env = process.env) {
  const requireRuntimeManifest = boolOrNull(env.V2_EVIDENCE_SNAPSHOT_REQUIRE_RUNTIME_MANIFEST) === true;
  return Object.freeze({
    performanceGate: { ...readJsonSafe(files.performanceGate), required: true },
    performanceReport: { ...readJsonSafe(files.performanceReport), required: true },
    activeProtectionLatest: { ...readJsonSafe(files.activeProtectionLatest), required: true },
    activeProtectionDaily: { ...readJsonSafe(files.activeProtectionDaily), required: false },
    activeProtectionHistory: { ...readJsonlSafe(files.activeProtectionHistory), required: false },
    v1WriterLatest: { ...readJsonSafe(files.v1WriterLatest), required: true },
    v1WriterHistory: { ...readJsonlSafe(files.v1WriterHistory), required: false },
    algoEndpointLatest: { ...readJsonSafe(files.algoEndpointLatest), required: true },
    algoEndpointHistory: { ...readJsonlSafe(files.algoEndpointHistory), required: false },
    repairQueueLatest: { ...readJsonSafe(files.repairQueueLatest), required: false },
    runtimeManifestLatest: { ...readJsonSafe(files.runtimeManifestLatest), required: requireRuntimeManifest },
  });
}

function collect({ env = process.env, nowMs = Date.now() } = {}) {
  const files = resolveFiles(env);
  const loaded = loadInputs(files, env);
  return buildSnapshot({ loaded, env, nowMs });
}

function writeSnapshot({ snapshot, env = process.env } = {}) {
  const outputFile = trimOrNull(env.V2_EVIDENCE_SNAPSHOT_OUTPUT_FILE) || DEFAULT_OUTPUT_FILE;
  const historyFile = trimOrNull(env.V2_EVIDENCE_SNAPSHOT_HISTORY_FILE) || DEFAULT_HISTORY_FILE;
  writeJson(outputFile, snapshot);
  appendJsonl(historyFile, snapshot);
  return Object.freeze({ outputFile, historyFile });
}

function main(env = process.env) {
  const snapshot = collect({ env });
  const files = writeSnapshot({ snapshot, env });
  const payload = Object.freeze({
    ok: snapshot.ok,
    reason: snapshot.reason,
    blockers: snapshot.blockers,
    output_file: files.outputFile,
    history_file: files.historyFile,
    sample_n_30d: snapshot.sample_n_30d,
    performance_gate_status: snapshot.performance_gate_status,
    active_protection_streak_days: snapshot.active_protection_streak_days,
    max_unprotected_position_30d: snapshot.max_unprotected_position_30d,
    post_fill_critical_30d: snapshot.post_fill_critical_30d,
    v1_place_futures_call_n_30d: snapshot.v1_place_futures_call_n_30d,
  });
  const out = JSON.stringify(payload);
  if (snapshot.ok) console.log(out);
  else {
    console.error(out);
    process.exitCode = 1;
  }
  return payload;
}

if (require.main === module) {
  try {
    main(process.env);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_EVIDENCE_SNAPSHOT_COLLECT_FAILED",
      blockers: ["EVIDENCE_SNAPSHOT:COLLECT_FAILED"],
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  }
} else {
  module.exports = {
    collect,
    main,
    buildSnapshot,
    buildPerformanceSummary,
    buildSafetySummary,
    computeActiveProtectionStreakDays,
    loadInputs,
    resolveFiles,
    writeSnapshot,
    __test: {
      trimOrNull,
      toNumberOrNull,
      firstNumber,
      boolOrNull,
      normalizeRate,
      readJsonSafe,
      readJsonlSafe,
      rowsWithinDays,
      dailyProtectionPass,
    },
  };
}
