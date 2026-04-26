#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const DEFAULT_HISTORY_FILE = path.join(OPS_DAILY_DIR, "v2_evidence_streak.jsonl");
const DEFAULT_LATEST_FILE = path.join(OPS_DAILY_DIR, "v2_evidence_snapshot_latest.json");
const DEFAULT_OUTPUT_FILE = path.join(OPS_DAILY_DIR, "v2_30d_safety_streak_latest.json");

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function numberFromEnv(env, key, fallback) {
  const n = toNumberOrNull(env[key]);
  return n == null ? fallback : n;
}

function readJsonSafe(file) {
  try {
    return { ok: true, data: JSON.parse(fs.readFileSync(file, "utf8")) };
  } catch (error) {
    return { ok: false, error };
  }
}

function readJsonlSafe(file) {
  try {
    const rows = fs.readFileSync(file, "utf8")
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { ok: true, rows };
  } catch (error) {
    return { ok: false, rows: [], error };
  }
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function dateKeyFromMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function rowTimestampMs(row) {
  const raw = row && (row.generated_at || row.window_end_at || row.date || row.date_key);
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function resolveThresholds(env = process.env) {
  return Object.freeze({
    min_streak_days: numberFromEnv(env, "V2_30D_SAFETY_STREAK_MIN_DAYS", 30),
    max_repair_queue_lag_p95_ms: numberFromEnv(env, "V2_30D_SAFETY_STREAK_MAX_REPAIR_QUEUE_LAG_P95_MS", 60000),
    max_algo_degraded_duration_ms_per_day: numberFromEnv(env, "V2_30D_SAFETY_STREAK_MAX_ALGO_DEGRADED_DURATION_MS_PER_DAY", 600000),
    max_post_fill_critical_n: numberFromEnv(env, "V2_30D_SAFETY_STREAK_MAX_POST_FILL_CRITICAL_N", 0),
    max_unprotected_position_n: numberFromEnv(env, "V2_30D_SAFETY_STREAK_MAX_UNPROTECTED_POSITION_N", 0),
    max_v1_writer_call_n: numberFromEnv(env, "V2_30D_SAFETY_STREAK_MAX_V1_WRITER_CALL_N", 0),
    max_alert_fill_contradiction_n: numberFromEnv(env, "V2_30D_SAFETY_STREAK_MAX_ALERT_FILL_CONTRADICTION_N", 0),
    max_cloud_run_revision_drift_n: numberFromEnv(env, "V2_30D_SAFETY_STREAK_MAX_CLOUD_RUN_REVISION_DRIFT_N", 0),
  });
}

function latestRowsByDate(rows = [], latest = null, nowMs = Date.now(), days = 30) {
  const startMs = nowMs - Math.max(1, days) * 24 * 60 * 60 * 1000;
  const byDate = new Map();
  const allRows = Array.isArray(rows) ? rows.slice() : [];
  if (latest && typeof latest === "object") allRows.push(latest);
  for (const row of allRows) {
    const ts = rowTimestampMs(row);
    if (!Number.isFinite(ts) || ts < startMs || ts > nowMs) continue;
    const key = dateKeyFromMs(ts);
    const current = byDate.get(key);
    if (!current || ts >= current.ts) byDate.set(key, { ts, row });
  }
  return byDate;
}

function metricNumber(row, ...keys) {
  for (const key of keys) {
    const n = toNumberOrNull(row && row[key]);
    if (n != null) return n;
  }
  return null;
}

function evaluateSafetyRow(row = {}, thresholds = resolveThresholds()) {
  const blockers = [];
  const snapshotBlockers = Array.isArray(row.blockers) ? row.blockers : [];
  const unprotectedN = metricNumber(row, "max_unprotected_position_30d", "unprotected_position_n");
  const postFillCriticalN = metricNumber(row, "post_fill_critical_30d", "post_fill_critical_n", "critical_issue_n");
  const repairLagP95 = metricNumber(row, "repair_queue_lag_p95_ms");
  const algoDurationMs = metricNumber(row, "algo_endpoint_degraded_duration_ms", "algo_endpoint_degraded_duration_ms_24h", "algo_endpoint_degraded_duration_ms_per_day");
  const algoCritN = metricNumber(row, "algo_endpoint_degraded_crit_n_30d", "algo_endpoint_degraded_crit_n", "degraded_crit_n");
  const v1WriterN = metricNumber(row, "v1_place_futures_call_n_30d", "v1_place_futures_call_n_24h", "v1_direct_exchange_write_call_n_24h");
  const alertFillContradictionN = metricNumber(row, "contradictory_alert_fill_issue_n_30d", "alert_fill_reconciliation_issue_n_30d", "alert_fill_contradiction_n_24h");
  const revisionDriftN = metricNumber(row, "cloud_run_revision_drift_n");

  if (row.ok !== true) blockers.push("SAFETY_STREAK:SNAPSHOT_NOT_OK");
  if (snapshotBlockers.length > 0) blockers.push("SAFETY_STREAK:SNAPSHOT_BLOCKERS_PRESENT");
  if (!Number.isFinite(unprotectedN) || unprotectedN > thresholds.max_unprotected_position_n) blockers.push("SAFETY_STREAK:UNPROTECTED_POSITION_PRESENT_OR_UNKNOWN");
  if (!Number.isFinite(postFillCriticalN) || postFillCriticalN > thresholds.max_post_fill_critical_n) blockers.push("SAFETY_STREAK:POST_FILL_CRITICAL_PRESENT_OR_UNKNOWN");
  if (!Number.isFinite(repairLagP95) || repairLagP95 >= thresholds.max_repair_queue_lag_p95_ms) blockers.push("SAFETY_STREAK:REPAIR_QUEUE_LAG_P95_EXCEEDED_OR_UNKNOWN");
  if (!Number.isFinite(algoDurationMs) || algoDurationMs >= thresholds.max_algo_degraded_duration_ms_per_day || Number(algoCritN || 0) > 0) blockers.push("SAFETY_STREAK:ALGO_ENDPOINT_DEGRADED_TOO_LONG_OR_UNKNOWN");
  if (!Number.isFinite(v1WriterN) || v1WriterN > thresholds.max_v1_writer_call_n) blockers.push("SAFETY_STREAK:V1_WRITER_CALL_PRESENT_OR_UNKNOWN");
  if (!Number.isFinite(alertFillContradictionN) || alertFillContradictionN > thresholds.max_alert_fill_contradiction_n) blockers.push("SAFETY_STREAK:ALERT_FILL_CONTRADICTION_PRESENT_OR_UNKNOWN");
  if (!Number.isFinite(revisionDriftN) || revisionDriftN > thresholds.max_cloud_run_revision_drift_n) blockers.push("SAFETY_STREAK:CLOUD_RUN_REVISION_DRIFT_PRESENT_OR_UNKNOWN");

  return Object.freeze({
    ok: blockers.length === 0,
    blockers: Object.freeze(Array.from(new Set(blockers))),
    metrics: Object.freeze({
      unprotected_position_n: unprotectedN,
      post_fill_critical_n: postFillCriticalN,
      repair_queue_lag_p95_ms: repairLagP95,
      algo_endpoint_degraded_duration_ms: algoDurationMs,
      algo_endpoint_degraded_crit_n: algoCritN,
      v1_place_futures_call_n: v1WriterN,
      alert_fill_contradiction_n: alertFillContradictionN,
      cloud_run_revision_drift_n: revisionDriftN,
    }),
  });
}

function evaluateThirtyDaySafetyStreak({ rows = [], latest = null, env = process.env, nowMs = Date.now(), historyFile = DEFAULT_HISTORY_FILE } = {}) {
  const thresholds = resolveThresholds(env);
  const byDate = latestRowsByDate(rows, latest, nowMs, thresholds.min_streak_days);
  const daily = [];
  const blockers = [];
  let consecutivePassDays = 0;

  for (let i = 0; i < thresholds.min_streak_days; i += 1) {
    const date = dateKeyFromMs(nowMs - i * 24 * 60 * 60 * 1000);
    const item = byDate.get(date);
    if (!item) {
      const missing = Object.freeze({ date, ok: false, blockers: Object.freeze(["SAFETY_STREAK:DAILY_EVIDENCE_MISSING"]), metrics: Object.freeze({}) });
      daily.push(missing);
      if (i === consecutivePassDays) blockers.push("SAFETY_STREAK:DAILY_EVIDENCE_MISSING");
      continue;
    }
    const result = evaluateSafetyRow(item.row, thresholds);
    daily.push(Object.freeze({ date, ok: result.ok, blockers: result.blockers, metrics: result.metrics }));
    if (i === consecutivePassDays && result.ok) consecutivePassDays += 1;
    else if (i === consecutivePassDays) blockers.push(...result.blockers);
  }

  if (consecutivePassDays < thresholds.min_streak_days) blockers.push("SAFETY_STREAK:INSUFFICIENT_CONSECUTIVE_DAYS");

  return Object.freeze({
    ok: consecutivePassDays >= thresholds.min_streak_days && blockers.length === 0,
    reason: consecutivePassDays >= thresholds.min_streak_days && blockers.length === 0 ? "V2_30D_SAFETY_STREAK_PASS" : "V2_30D_SAFETY_STREAK_BLOCKED",
    generated_at: new Date(nowMs).toISOString(),
    history_file: historyFile,
    blocker_n: Array.from(new Set(blockers)).length,
    blockers: Object.freeze(Array.from(new Set(blockers))),
    thresholds,
    consecutive_pass_days: consecutivePassDays,
    required_days: thresholds.min_streak_days,
    evidence_day_n: byDate.size,
    latest_day: dateKeyFromMs(nowMs),
    daily: Object.freeze(daily.reverse()),
  });
}

function resolveHistoryFile(env = process.env) {
  return trimOrNull(env.V2_30D_SAFETY_STREAK_HISTORY_FILE) || DEFAULT_HISTORY_FILE;
}

function resolveLatestFile(env = process.env) {
  return trimOrNull(env.V2_30D_SAFETY_STREAK_LATEST_FILE) || DEFAULT_LATEST_FILE;
}

function resolveOutputFile(env = process.env) {
  return trimOrNull(env.V2_30D_SAFETY_STREAK_OUTPUT_FILE) || DEFAULT_OUTPUT_FILE;
}

function runCheck(env = process.env) {
  const historyFile = resolveHistoryFile(env);
  const latestFile = resolveLatestFile(env);
  const outputFile = resolveOutputFile(env);
  const history = readJsonlSafe(historyFile);
  const latest = readJsonSafe(latestFile);
  const result = evaluateThirtyDaySafetyStreak({
    rows: history.ok ? history.rows : [],
    latest: latest.ok ? latest.data : null,
    env,
    historyFile,
  });
  const payload = Object.freeze({
    ...result,
    output_file: outputFile,
    latest_file: latestFile,
    history_read_ok: history.ok,
    latest_read_ok: latest.ok,
    ...(history.ok ? {} : { history_error_code: history.error && history.error.code || null, history_error: history.error && history.error.message || String(history.error) }),
    ...(latest.ok ? {} : { latest_error_code: latest.error && latest.error.code || null, latest_error: latest.error && latest.error.message || String(latest.error) }),
  });
  writeJson(outputFile, payload);
  return payload;
}

function main(env = process.env) {
  const result = runCheck(env);
  const line = JSON.stringify({
    ok: result.ok,
    reason: result.reason,
    blockers: result.blockers,
    consecutive_pass_days: result.consecutive_pass_days,
    required_days: result.required_days,
    evidence_day_n: result.evidence_day_n,
    output_file: result.output_file,
  });
  if (result.ok) console.log(line);
  else {
    console.error(line);
    process.exitCode = 1;
  }
  return result;
}

if (require.main === module) {
  try {
    main(process.env);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_30D_SAFETY_STREAK_CHECK_FAILED",
      blockers: ["SAFETY_STREAK:CHECK_FAILED"],
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  }
} else {
  module.exports = {
    main,
    runCheck,
    evaluateThirtyDaySafetyStreak,
    evaluateSafetyRow,
    resolveThresholds,
    latestRowsByDate,
    __test: { trimOrNull, toNumberOrNull, rowTimestampMs, dateKeyFromMs, readJsonSafe, readJsonlSafe },
  };
}
