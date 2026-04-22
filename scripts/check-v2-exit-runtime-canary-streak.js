#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const {
  isExitRuntimeCanaryFirestoreReadEnabled,
  loadExitRuntimeCanaryHistoryRows,
} = require("../src/v2/exitRuntimeCanaryHistory");

const OUTPUT_FILENAME = "v2_exit_runtime_canary_streak_latest.json";
const HISTORY_FILENAME = "v2_exit_runtime_canary_history.jsonl";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function parsePositiveNumber(value, fallback) {
  const num = Number(value);
  if (Number.isFinite(num) && num > 0) return num;
  return Number(fallback);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolveArtifactDir(env = process.env) {
  return trimOrNull(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_ARTIFACT_DIR)
    || trimOrNull(env.V2_PROMOTION_ARTIFACT_DIR)
    || path.join(process.cwd(), "ops", "daily");
}

function resolveHistoryFile(env = process.env) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_HISTORY_FILE);
  if (explicit) return path.resolve(explicit);
  return path.resolve(resolveArtifactDir(env), HISTORY_FILENAME);
}

function resolveOutputFile(env = process.env) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_FILE);
  if (explicit) return path.resolve(explicit);
  return path.resolve(resolveArtifactDir(env), OUTPUT_FILENAME);
}

function resolveStreakConfig(env = process.env) {
  return Object.freeze({
    lookbackHours: parsePositiveNumber(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_LOOKBACK_HOURS, 24),
    minRunCount: Math.floor(parsePositiveNumber(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_MIN_RUNS, 12)),
    maxGapMinutes: parsePositiveNumber(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_MAX_GAP_MINUTES, 180),
    firestoreReadLimit: Math.floor(parsePositiveNumber(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_READ_LIMIT, 200)),
    requireFirestoreSource: String(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE || "").trim() === "1",
  });
}

function resolveHistorySource(env = process.env) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE);
  if (explicit) {
    const upper = explicit.toUpperCase();
    if (upper === "FIRESTORE" || upper === "JSONL") return upper;
  }
  return isExitRuntimeCanaryFirestoreReadEnabled(env) ? "FIRESTORE" : "JSONL";
}

function parseHistoryFile(filePath) {
  const raw = fs.readFileSync(path.resolve(filePath), "utf8");
  const rows = [];
  const invalidLines = [];
  raw.split(/\r?\n/).forEach((line, index) => {
    const text = line.trim();
    if (!text) return;
    try {
      rows.push(Object.freeze({
        line_no: index + 1,
        raw: text,
        payload: JSON.parse(text),
      }));
    } catch (error) {
      invalidLines.push(Object.freeze({
        line_no: index + 1,
        error: error && error.message ? error.message : String(error),
      }));
    }
  });
  return Object.freeze({
    raw,
    rows: Object.freeze(rows),
    invalid_lines: Object.freeze(invalidLines),
  });
}

function toMs(value) {
  const ms = Date.parse(String(value || "").trim());
  return Number.isFinite(ms) ? ms : null;
}

function numberField(payload, field) {
  const num = Number(payload && payload[field]);
  return Number.isFinite(num) ? num : 0;
}

function isHealthyExitRuntimeCanaryRow(row) {
  const payload = row && row.payload && typeof row.payload === "object" ? row.payload : {};
  const raw = String(row && row.raw || "");
  return (
    payload.ok === true &&
    payload.reason === "V2_EXIT_RUNTIME_CANARY_PASS" &&
    payload.scope === "exit_runtime_canary" &&
    payload.canary_mode === "LIVE_EXIT_RUNTIME_OBSERVATION" &&
    payload.exchange_write_performed === false &&
    Number(payload.fail_n) === 0 &&
    Array.isArray(payload.failed_check_ids) &&
    payload.failed_check_ids.length === 0 &&
    numberField(payload, "tp1_missing_n") === 0 &&
    numberField(payload, "native_refresh_unhealthy_n") === 0 &&
    numberField(payload, "unprotected_window_violation_n") === 0 &&
    numberField(payload, "alert_silent_drop_n") === 0 &&
    numberField(payload, "trail_activation_evidence_gap_n") === 0 &&
    !raw.includes("apiKey") &&
    !raw.includes("apiSecret") &&
    !raw.includes("BINANCE_SECRET") &&
    !raw.includes("BINANCE_API")
  );
}

function extractHealthyPositionCycleIds(rows) {
  const ids = new Set();
  for (const row of Array.isArray(rows) ? rows : []) {
    const payload = row && row.payload && typeof row.payload === "object" ? row.payload : {};
    const topLevelId = trimOrNull(payload.position_cycle_id || payload.selected_position_cycle_id);
    if (topLevelId) {
      ids.add(topLevelId);
      continue;
    }
    const summaries = Array.isArray(payload.position_summaries) ? payload.position_summaries : [];
    if (summaries.length === 1) {
      const id = trimOrNull(summaries[0] && summaries[0].position_cycle_id);
      if (id) ids.add(id);
    }
  }
  return Object.freeze(Array.from(ids));
}

function sumCounter(rows, field) {
  return rows.reduce((sum, row) => sum + numberField(row && row.payload, field), 0);
}

function buildLongRunQualitySummary({
  ok,
  historySource,
  config,
  healthyRunN,
  rowN,
  latestAgeMinutes,
  coverageMinutes,
  maxObservedGapMinutes,
  tp1MissingN,
  nativeRefreshUnhealthyN,
  unprotectedWindowViolationN,
  alertSilentDropN,
  trailActivationEvidenceGapN,
  blockers,
} = {}) {
  return Object.freeze({
    status: ok === true ? "PASS" : "BLOCKED",
    history_source: trimOrNull(historySource) || "JSONL",
    firestore_source_required: config && config.requireFirestoreSource === true,
    lookback_hours: Number(config && config.lookbackHours),
    min_run_count: Number(config && config.minRunCount),
    max_gap_minutes: Number(config && config.maxGapMinutes),
    row_n: Number(rowN) || 0,
    healthy_run_n: Number(healthyRunN) || 0,
    latest_age_minutes: Number.isFinite(Number(latestAgeMinutes)) ? Number(latestAgeMinutes) : null,
    coverage_minutes: Number.isFinite(Number(coverageMinutes)) ? Number(coverageMinutes) : 0,
    max_observed_gap_minutes: Number.isFinite(Number(maxObservedGapMinutes)) ? Number(maxObservedGapMinutes) : null,
    defect_counts: Object.freeze({
      tp1_missing_n: Number(tp1MissingN) || 0,
      native_refresh_unhealthy_n: Number(nativeRefreshUnhealthyN) || 0,
      unprotected_window_violation_n: Number(unprotectedWindowViolationN) || 0,
      alert_silent_drop_n: Number(alertSilentDropN) || 0,
      trail_activation_evidence_gap_n: Number(trailActivationEvidenceGapN) || 0,
    }),
    blockers: Object.freeze(Array.isArray(blockers) ? blockers.slice() : []),
  });
}

function buildCollectorExecutionSummary({
  ok,
  historySource,
  config,
  rowN,
  healthyRunN,
  latestAgeMinutes,
  coverageMinutes,
  maxObservedGapMinutes,
  blockers,
} = {}) {
  return Object.freeze({
    status: ok === true ? "PASS" : "BLOCKED",
    scheduler_job_id: "v2_exit_runtime_canary",
    expected_scheduler_job_id: "v2_exit_runtime_canary",
    producer_script: "run-v2-exit-runtime-canary",
    producer_scope: "exit_runtime_canary",
    canary_mode: "LIVE_EXIT_RUNTIME_OBSERVATION",
    exchange_write_performed: false,
    history_source: trimOrNull(historySource) || "JSONL",
    firestore_source_required: config && config.requireFirestoreSource === true,
    lookback_hours: Number(config && config.lookbackHours),
    min_run_count: Number(config && config.minRunCount),
    max_gap_minutes: Number(config && config.maxGapMinutes),
    row_n: Number(rowN) || 0,
    healthy_run_n: Number(healthyRunN) || 0,
    latest_age_minutes: Number.isFinite(Number(latestAgeMinutes)) ? Number(latestAgeMinutes) : null,
    coverage_minutes: Number.isFinite(Number(coverageMinutes)) ? Number(coverageMinutes) : 0,
    max_observed_gap_minutes: Number.isFinite(Number(maxObservedGapMinutes)) ? Number(maxObservedGapMinutes) : null,
    blockers: Object.freeze(Array.isArray(blockers) ? blockers.slice() : []),
  });
}

function evaluateExitRuntimeCanaryStreak({
  history,
  config = resolveStreakConfig({}),
  nowMs = Date.now(),
  historyFile = null,
  historySource = "JSONL",
} = {}) {
  const parsed = history && typeof history === "object" ? history : { rows: [], invalid_lines: [] };
  const normalizedHistorySource = trimOrNull(historySource) || "JSONL";
  const lookbackMs = Number(config.lookbackHours) * 60 * 60 * 1000;
  const lookbackStartMs = Number(nowMs) - lookbackMs;
  const rowsInWindow = (Array.isArray(parsed.rows) ? parsed.rows : [])
    .map((row) => {
      const generatedMs = Number(row && row.generated_ms) || toMs(row && row.payload && row.payload.generated_at);
      return { ...row, generated_ms: generatedMs };
    })
    .filter((row) => row.generated_ms != null && row.generated_ms >= lookbackStartMs && row.generated_ms <= Number(nowMs))
    .sort((left, right) => left.generated_ms - right.generated_ms);
  const healthyRows = rowsInWindow.filter(isHealthyExitRuntimeCanaryRow);
  const unhealthyRows = rowsInWindow.filter((row) => !isHealthyExitRuntimeCanaryRow(row));
  const gaps = [];
  for (let index = 1; index < healthyRows.length; index += 1) {
    gaps.push((healthyRows[index].generated_ms - healthyRows[index - 1].generated_ms) / 60000);
  }
  const latestAgeMinutes = healthyRows.length > 0
    ? Math.max(0, (Number(nowMs) - healthyRows[healthyRows.length - 1].generated_ms) / 60000)
    : null;
  const coverageMinutes = healthyRows.length > 0
    ? Math.max(0, (healthyRows[healthyRows.length - 1].generated_ms - healthyRows[0].generated_ms) / 60000)
    : 0;
  const tp1MissingN = sumCounter(rowsInWindow, "tp1_missing_n");
  const nativeRefreshUnhealthyN = sumCounter(rowsInWindow, "native_refresh_unhealthy_n");
  const unprotectedWindowViolationN = sumCounter(rowsInWindow, "unprotected_window_violation_n");
  const alertSilentDropN = sumCounter(rowsInWindow, "alert_silent_drop_n");
  const trailActivationEvidenceGapN = sumCounter(rowsInWindow, "trail_activation_evidence_gap_n");
  const positionCycleIds = extractHealthyPositionCycleIds(healthyRows);
  const blockers = [];
  if (config.requireFirestoreSource === true && normalizedHistorySource !== "FIRESTORE") {
    blockers.push("EXIT_RUNTIME_CANARY_STREAK:FIRESTORE_SOURCE_REQUIRED");
  }
  if ((parsed.invalid_lines || []).length > 0) blockers.push("EXIT_RUNTIME_CANARY_STREAK:INVALID_JSONL");
  if (healthyRows.length < Number(config.minRunCount)) blockers.push("EXIT_RUNTIME_CANARY_STREAK:MIN_RUN_COUNT");
  if (unhealthyRows.length > 0) blockers.push("EXIT_RUNTIME_CANARY_STREAK:UNHEALTHY_ROW_IN_WINDOW");
  if (latestAgeMinutes == null || latestAgeMinutes > Number(config.maxGapMinutes)) blockers.push("EXIT_RUNTIME_CANARY_STREAK:LATEST_STALE");
  if (gaps.some((gap) => gap > Number(config.maxGapMinutes))) blockers.push("EXIT_RUNTIME_CANARY_STREAK:GAP_EXCEEDED");
  if (coverageMinutes < Math.max(0, Number(config.lookbackHours) * 60 - Number(config.maxGapMinutes))) {
    blockers.push("EXIT_RUNTIME_CANARY_STREAK:COVERAGE_INSUFFICIENT");
  }
  if (tp1MissingN > 0) blockers.push("EXIT_RUNTIME_CANARY_STREAK:TP1_MISSING");
  if (nativeRefreshUnhealthyN > 0) blockers.push("EXIT_RUNTIME_CANARY_STREAK:NATIVE_REFRESH_UNHEALTHY");
  if (unprotectedWindowViolationN > 0) blockers.push("EXIT_RUNTIME_CANARY_STREAK:UNPROTECTED_WINDOW");
  if (alertSilentDropN > 0) blockers.push("EXIT_RUNTIME_CANARY_STREAK:ALERT_SILENT_DROP");
  if (trailActivationEvidenceGapN > 0) blockers.push("EXIT_RUNTIME_CANARY_STREAK:TRAIL_ACTIVATION_EVIDENCE_GAP");
  const ok = blockers.length === 0;
  const qualitySummary = buildLongRunQualitySummary({
    ok,
    historySource: normalizedHistorySource,
    config,
    healthyRunN: healthyRows.length,
    rowN: rowsInWindow.length,
    latestAgeMinutes,
    coverageMinutes,
    maxObservedGapMinutes: gaps.length ? Math.max(...gaps) : null,
    tp1MissingN,
    nativeRefreshUnhealthyN,
    unprotectedWindowViolationN,
    alertSilentDropN,
    trailActivationEvidenceGapN,
    blockers,
  });
  const collectorExecutionSummary = buildCollectorExecutionSummary({
    ok,
    historySource: normalizedHistorySource,
    config,
    rowN: rowsInWindow.length,
    healthyRunN: healthyRows.length,
    latestAgeMinutes,
    coverageMinutes,
    maxObservedGapMinutes: gaps.length ? Math.max(...gaps) : null,
    blockers,
  });
  return Object.freeze({
    ok,
    reason: ok
      ? "V2_EXIT_RUNTIME_CANARY_STREAK_PASS"
      : "V2_EXIT_RUNTIME_CANARY_STREAK_BLOCKED",
    generated_at: new Date(Number(nowMs)).toISOString(),
    position_cycle_id: positionCycleIds.length === 1 ? positionCycleIds[0] : null,
    position_cycle_id_n: positionCycleIds.length,
    history_source: normalizedHistorySource,
    history_file: trimOrNull(historyFile),
    firestore_source_required: config.requireFirestoreSource === true,
    lookback_hours: Number(config.lookbackHours),
    min_run_count: Number(config.minRunCount),
    max_gap_minutes: Number(config.maxGapMinutes),
    firestore_read_limit: Number(config.firestoreReadLimit) || null,
    row_n: rowsInWindow.length,
    healthy_run_n: healthyRows.length,
    unhealthy_run_n: unhealthyRows.length,
    invalid_line_n: (parsed.invalid_lines || []).length,
    latest_age_minutes: latestAgeMinutes,
    coverage_minutes: coverageMinutes,
    max_observed_gap_minutes: gaps.length ? Math.max(...gaps) : null,
    active_position_n: sumCounter(rowsInWindow, "active_position_n"),
    tp1_missing_n: tp1MissingN,
    native_refresh_unhealthy_n: nativeRefreshUnhealthyN,
    unprotected_window_violation_n: unprotectedWindowViolationN,
    alert_silent_drop_n: alertSilentDropN,
    trail_activation_evidence_gap_n: trailActivationEvidenceGapN,
    collector_execution_summary: collectorExecutionSummary,
    long_run_quality_summary: qualitySummary,
    blockers: Object.freeze(blockers),
  });
}

async function loadHistory(env = process.env, { nowMs = Date.now(), db = null, config = resolveStreakConfig(env) } = {}) {
  const source = resolveHistorySource(env);
  if (source === "FIRESTORE") {
    const lookbackMs = Number(config.lookbackHours) * 60 * 60 * 1000;
    const sinceMs = Number(nowMs) - lookbackMs;
    const loaded = await loadExitRuntimeCanaryHistoryRows({
      db,
      env,
      sinceMs,
      limit: config.firestoreReadLimit,
    });
    return Object.freeze({
      source,
      historyFile: loaded.collectionName,
      history: Object.freeze({
        rows: loaded.rows,
        invalid_lines: loaded.invalid_lines || Object.freeze([]),
      }),
    });
  }
  const historyFile = resolveHistoryFile(env);
  return Object.freeze({
    source,
    historyFile,
    history: parseHistoryFile(historyFile),
  });
}

async function runCheck(env = process.env, { nowMs = Date.now(), db = null } = {}) {
  const config = resolveStreakConfig(env);
  const loaded = await loadHistory(env, { nowMs, db, config });
  return evaluateExitRuntimeCanaryStreak({
    history: loaded.history,
    config,
    nowMs,
    historyFile: loaded.historyFile,
    historySource: loaded.source,
  });
}

async function main(env = process.env) {
  const outputFile = resolveOutputFile(env);
  let report;
  try {
    report = await runCheck(env);
  } catch (error) {
    report = Object.freeze({
      ok: false,
      reason: "V2_EXIT_RUNTIME_CANARY_STREAK_THROWN",
      history_source: resolveHistorySource(env),
      history_file: resolveHistorySource(env) === "FIRESTORE" ? null : resolveHistoryFile(env),
      blockers: Object.freeze(["EXIT_RUNTIME_CANARY_STREAK:HISTORY_READ_FAILED"]),
      error: Object.freeze({
        message: error && error.message ? error.message : String(error),
      }),
    });
  }
  ensureDir(path.dirname(outputFile));
  writeJson(outputFile, report);
  const sink = report.ok === true ? console.log : console.error;
  sink(JSON.stringify({
    ok: report.ok,
    reason: report.reason,
    output_file: outputFile,
    history_source: report.history_source,
    history_file: report.history_file,
    long_run_quality_status: report.long_run_quality_summary && report.long_run_quality_summary.status,
    tp1_missing_n: report.tp1_missing_n,
    native_refresh_unhealthy_n: report.native_refresh_unhealthy_n,
    unprotected_window_violation_n: report.unprotected_window_violation_n,
    alert_silent_drop_n: report.alert_silent_drop_n,
    blockers: report.blockers,
  }));
  if (report.ok !== true) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("CHECK_V2_EXIT_RUNTIME_CANARY_STREAK_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    runCheck,
    loadHistory,
    evaluateExitRuntimeCanaryStreak,
    parseHistoryFile,
    __test: {
      OUTPUT_FILENAME,
      HISTORY_FILENAME,
      trimOrNull,
      parsePositiveNumber,
      resolveArtifactDir,
      resolveHistoryFile,
      resolveOutputFile,
      resolveStreakConfig,
      resolveHistorySource,
      toMs,
      numberField,
      isHealthyExitRuntimeCanaryRow,
      extractHealthyPositionCycleIds,
      buildLongRunQualitySummary,
      buildCollectorExecutionSummary,
    },
  };
}
