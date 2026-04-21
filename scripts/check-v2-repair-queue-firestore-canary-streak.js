#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const OUTPUT_FILENAME = "v2-repair-queue-firestore-canary-streak.json";
const HISTORY_FILENAME = "v2_repair_queue_firestore_canary_history.jsonl";

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
  return trimOrNull(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_DIR)
    || trimOrNull(env.DONBEOLJA_V2_REPAIR_CANARY_ARTIFACT_DIR)
    || path.join(process.cwd(), "artifacts", "v2-repair-canary");
}

function resolveHistoryFile(env = process.env) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_HISTORY_FILE);
  if (explicit) return path.resolve(explicit);
  return path.resolve(resolveArtifactDir(env), HISTORY_FILENAME);
}

function resolveOutputFile(env = process.env) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_FILE);
  if (explicit) return path.resolve(explicit);
  return path.resolve(resolveArtifactDir(env), OUTPUT_FILENAME);
}

function resolveStreakConfig(env = process.env) {
  return Object.freeze({
    lookbackHours: parsePositiveNumber(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_LOOKBACK_HOURS, 24),
    minRunCount: Math.floor(parsePositiveNumber(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_MIN_RUNS, 12)),
    maxGapMinutes: parsePositiveNumber(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_MAX_GAP_MINUTES, 180),
  });
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

function isHealthyFirestoreCanaryRow(row) {
  const payload = row && row.payload && typeof row.payload === "object" ? row.payload : {};
  const summary = payload.summary && typeof payload.summary === "object" ? payload.summary : {};
  const raw = String(row && row.raw || "");
  return (
    payload.ok === true &&
    payload.reason === "V2_REPAIR_QUEUE_FIRESTORE_CANARY_HEALTHY" &&
    payload.canary_mode === "FIRESTORE_BACKED_SHADOW_REPAIR_REQUEST_GENERATION" &&
    payload.firestore_write_performed === true &&
    payload.exchange_write_performed === false &&
    payload.service_status === "HEALTHY" &&
    payload.selected_issue_code === "TRAIL_STOP_MISSING" &&
    Number(summary.requested_repair_n) === 1 &&
    Number(summary.delegated_repair_n) === 1 &&
    Number(summary.completion_success_n) === 1 &&
    Number(summary.completion_failed_n) === 0 &&
    !raw.includes("apiKey") &&
    !raw.includes("apiSecret") &&
    !raw.includes("canary-key") &&
    !raw.includes("canary-secret")
  );
}

function evaluateFirestoreCanaryStreak({
  history,
  config = resolveStreakConfig({}),
  nowMs = Date.now(),
  historyFile = null,
} = {}) {
  const parsed = history && typeof history === "object" ? history : { rows: [], invalid_lines: [] };
  const lookbackMs = Number(config.lookbackHours) * 60 * 60 * 1000;
  const lookbackStartMs = Number(nowMs) - lookbackMs;
  const rowsInWindow = (Array.isArray(parsed.rows) ? parsed.rows : [])
    .map((row) => {
      const generatedMs = toMs(row && row.payload && row.payload.generated_at);
      return { ...row, generated_ms: generatedMs };
    })
    .filter((row) => row.generated_ms != null && row.generated_ms >= lookbackStartMs && row.generated_ms <= Number(nowMs))
    .sort((left, right) => left.generated_ms - right.generated_ms);
  const healthyRows = rowsInWindow.filter(isHealthyFirestoreCanaryRow);
  const unhealthyRows = rowsInWindow.filter((row) => !isHealthyFirestoreCanaryRow(row));
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
  const blockers = [];
  if ((parsed.invalid_lines || []).length > 0) blockers.push("FIRESTORE_CANARY_STREAK:INVALID_JSONL");
  if (healthyRows.length < Number(config.minRunCount)) blockers.push("FIRESTORE_CANARY_STREAK:MIN_RUN_COUNT");
  if (unhealthyRows.length > 0) blockers.push("FIRESTORE_CANARY_STREAK:UNHEALTHY_ROW_IN_WINDOW");
  if (latestAgeMinutes == null || latestAgeMinutes > Number(config.maxGapMinutes)) blockers.push("FIRESTORE_CANARY_STREAK:LATEST_STALE");
  if (gaps.some((gap) => gap > Number(config.maxGapMinutes))) blockers.push("FIRESTORE_CANARY_STREAK:GAP_EXCEEDED");
  if (coverageMinutes < Math.max(0, Number(config.lookbackHours) * 60 - Number(config.maxGapMinutes))) {
    blockers.push("FIRESTORE_CANARY_STREAK:COVERAGE_INSUFFICIENT");
  }
  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0
      ? "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS"
      : "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_BLOCKED",
    history_file: trimOrNull(historyFile),
    lookback_hours: Number(config.lookbackHours),
    min_run_count: Number(config.minRunCount),
    max_gap_minutes: Number(config.maxGapMinutes),
    row_n: rowsInWindow.length,
    healthy_run_n: healthyRows.length,
    unhealthy_run_n: unhealthyRows.length,
    invalid_line_n: (parsed.invalid_lines || []).length,
    latest_age_minutes: latestAgeMinutes,
    coverage_minutes: coverageMinutes,
    max_observed_gap_minutes: gaps.length ? Math.max(...gaps) : null,
    blockers: Object.freeze(blockers),
  });
}

function runCheck(env = process.env, { nowMs = Date.now() } = {}) {
  const historyFile = resolveHistoryFile(env);
  const history = parseHistoryFile(historyFile);
  return evaluateFirestoreCanaryStreak({
    history,
    config: resolveStreakConfig(env),
    nowMs,
    historyFile,
  });
}

async function main(env = process.env) {
  const outputFile = resolveOutputFile(env);
  let report;
  try {
    report = runCheck(env);
  } catch (error) {
    report = Object.freeze({
      ok: false,
      reason: "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_THROWN",
      history_file: resolveHistoryFile(env),
      blockers: Object.freeze(["FIRESTORE_CANARY_STREAK:HISTORY_READ_FAILED"]),
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
    history_file: report.history_file,
    blockers: report.blockers,
  }));
  if (report.ok !== true) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("CHECK_V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    runCheck,
    evaluateFirestoreCanaryStreak,
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
      toMs,
      isHealthyFirestoreCanaryRow,
    },
  };
}
