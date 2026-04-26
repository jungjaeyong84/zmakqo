#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const DEFAULT_HISTORY_FILE = path.join(OPS_DAILY_DIR, "v2_exit_worker_ha_streak.jsonl");
const DEFAULT_LATEST_FILE = path.join(OPS_DAILY_DIR, "v2_exit_worker_ha_latest.json");
const DEFAULT_OUTPUT_FILE = path.join(OPS_DAILY_DIR, "v2_exit_worker_ha_streak_latest.json");
const DAY_MS = 24 * 60 * 60 * 1000;

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function boolOrNull(value) {
  if (value === true || value === false) return value;
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (["1", "true", "yes", "y", "pass", "passed", "ok"].includes(text)) return true;
  if (["0", "false", "no", "n", "fail", "failed", "blocked"].includes(text)) return false;
  return null;
}

function numberFromEnv(env, key, fallback) {
  const n = toNumberOrNull(env && env[key]);
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

function rowTimestampMs(row) {
  const raw = row && (row.generated_at || row.window_end_at || row.checked_at || row.date || row.date_key);
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function dateKeyFromMs(ms) {
  return new Date(ms).toISOString().slice(0, 10);
}

function metricNumber(row, ...keys) {
  for (const key of keys) {
    const n = toNumberOrNull(row && row[key]);
    if (n != null) return n;
  }
  return null;
}

function resolveThresholds(env = process.env) {
  return Object.freeze({
    min_streak_days: numberFromEnv(env, "V2_EXIT_WORKER_HA_STREAK_MIN_DAYS", 7),
    min_worker_instance_n: numberFromEnv(env, "V2_EXIT_WORKER_HA_MIN_INSTANCE_N", 2),
    expected_min_instances: numberFromEnv(env, "V2_EXIT_WORKER_HA_EXPECTED_MIN_INSTANCES", 2),
    expected_max_instances: numberFromEnv(env, "V2_EXIT_WORKER_HA_EXPECTED_MAX_INSTANCES", 2),
    max_duplicate_protection_write_n: numberFromEnv(env, "V2_EXIT_WORKER_HA_MAX_DUPLICATE_PROTECTION_WRITE_N", 0),
    max_split_brain_n: numberFromEnv(env, "V2_EXIT_WORKER_HA_MAX_SPLIT_BRAIN_N", 0),
    max_lease_conflict_n: numberFromEnv(env, "V2_EXIT_WORKER_HA_MAX_LEASE_CONFLICT_N", 0),
  });
}

function latestRowsByDate(rows = [], latest = null, nowMs = Date.now(), days = 7) {
  const startMs = nowMs - Math.max(1, days) * DAY_MS;
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

function evaluateExitWorkerHaRow(row = {}, thresholds = resolveThresholds()) {
  const blockers = [];
  const rowBlockers = Array.isArray(row.blockers) ? row.blockers : [];
  const workerInstanceN = metricNumber(row, "worker_instance_n", "exit_worker_instance_n", "active_exit_worker_instance_n");
  const minInstances = metricNumber(row, "min_instances", "cloud_run_min_instances", "exit_worker_min_instances");
  const maxInstances = metricNumber(row, "max_instances", "cloud_run_max_instances", "exit_worker_max_instances");
  const duplicateWriteN = metricNumber(row, "duplicate_protection_write_n", "duplicate_exchange_write_n", "duplicate_writer_n");
  const splitBrainN = metricNumber(row, "split_brain_n", "split_brain_detected_n");
  const leaseConflictN = metricNumber(row, "lease_conflict_n", "repair_lease_conflict_n", "protection_writer_lease_conflict_n");
  const leaseTakeoverOk = boolOrNull(row.lease_takeover_ok ?? row.lease_takeover_pass ?? row.takeover_ok);
  const firestoreLeaseOk = boolOrNull(row.firestore_repair_lease_ok ?? row.repair_lease_firestore_tx_ok ?? row.firestore_lease_ok);

  if (row.ok !== true) blockers.push("EXIT_WORKER_HA:ROW_NOT_OK");
  if (rowBlockers.length > 0) blockers.push("EXIT_WORKER_HA:ROW_BLOCKERS_PRESENT");
  if (!Number.isFinite(workerInstanceN) || workerInstanceN < thresholds.min_worker_instance_n) blockers.push("EXIT_WORKER_HA:INSUFFICIENT_WORKER_INSTANCES_OR_UNKNOWN");
  if (!Number.isFinite(minInstances) || minInstances < thresholds.expected_min_instances) blockers.push("EXIT_WORKER_HA:MIN_INSTANCES_BELOW_EXPECTED_OR_UNKNOWN");
  if (!Number.isFinite(maxInstances) || maxInstances < thresholds.expected_max_instances) blockers.push("EXIT_WORKER_HA:MAX_INSTANCES_BELOW_EXPECTED_OR_UNKNOWN");
  if (!Number.isFinite(duplicateWriteN) || duplicateWriteN > thresholds.max_duplicate_protection_write_n) blockers.push("EXIT_WORKER_HA:DUPLICATE_PROTECTION_WRITE_PRESENT_OR_UNKNOWN");
  if (!Number.isFinite(splitBrainN) || splitBrainN > thresholds.max_split_brain_n) blockers.push("EXIT_WORKER_HA:SPLIT_BRAIN_PRESENT_OR_UNKNOWN");
  if (!Number.isFinite(leaseConflictN) || leaseConflictN > thresholds.max_lease_conflict_n) blockers.push("EXIT_WORKER_HA:LEASE_CONFLICT_PRESENT_OR_UNKNOWN");
  if (leaseTakeoverOk !== true) blockers.push("EXIT_WORKER_HA:LEASE_TAKEOVER_NOT_PROVEN");
  if (firestoreLeaseOk !== true) blockers.push("EXIT_WORKER_HA:FIRESTORE_LEASE_NOT_PROVEN");

  return Object.freeze({
    ok: blockers.length === 0,
    blockers: Object.freeze(Array.from(new Set(blockers))),
    metrics: Object.freeze({
      worker_instance_n: workerInstanceN,
      min_instances: minInstances,
      max_instances: maxInstances,
      duplicate_protection_write_n: duplicateWriteN,
      split_brain_n: splitBrainN,
      lease_conflict_n: leaseConflictN,
      lease_takeover_ok: leaseTakeoverOk,
      firestore_repair_lease_ok: firestoreLeaseOk,
    }),
  });
}

function evaluateExitWorkerHaStreak({ rows = [], latest = null, env = process.env, nowMs = Date.now(), historyFile = DEFAULT_HISTORY_FILE } = {}) {
  const thresholds = resolveThresholds(env);
  const byDate = latestRowsByDate(rows, latest, nowMs, thresholds.min_streak_days);
  const daily = [];
  const blockers = [];
  let consecutivePassDays = 0;

  for (let i = 0; i < thresholds.min_streak_days; i += 1) {
    const date = dateKeyFromMs(nowMs - i * DAY_MS);
    const item = byDate.get(date);
    if (!item) {
      const missing = Object.freeze({ date, ok: false, blockers: Object.freeze(["EXIT_WORKER_HA:DAILY_EVIDENCE_MISSING"]), metrics: Object.freeze({}) });
      daily.push(missing);
      if (i === consecutivePassDays) blockers.push("EXIT_WORKER_HA:DAILY_EVIDENCE_MISSING");
      continue;
    }
    const result = evaluateExitWorkerHaRow(item.row, thresholds);
    daily.push(Object.freeze({ date, ok: result.ok, blockers: result.blockers, metrics: result.metrics }));
    if (i === consecutivePassDays && result.ok) consecutivePassDays += 1;
    else if (i === consecutivePassDays) blockers.push(...result.blockers);
  }

  if (consecutivePassDays < thresholds.min_streak_days) blockers.push("EXIT_WORKER_HA:INSUFFICIENT_CONSECUTIVE_DAYS");

  return Object.freeze({
    ok: consecutivePassDays >= thresholds.min_streak_days && blockers.length === 0,
    reason: consecutivePassDays >= thresholds.min_streak_days && blockers.length === 0 ? "V2_EXIT_WORKER_HA_STREAK_PASS" : "V2_EXIT_WORKER_HA_STREAK_BLOCKED",
    generated_at: new Date(nowMs).toISOString(),
    history_file: historyFile,
    blocker_n: Array.from(new Set(blockers)).length,
    blockers: Object.freeze(Array.from(new Set(blockers))),
    thresholds,
    consecutive_pass_days: consecutivePassDays,
    required_days: thresholds.min_streak_days,
    evidence_day_n: byDate.size,
    daily: Object.freeze(daily.reverse()),
  });
}

function resolveHistoryFile(env = process.env) {
  return trimOrNull(env.V2_EXIT_WORKER_HA_STREAK_HISTORY_FILE) || DEFAULT_HISTORY_FILE;
}

function resolveLatestFile(env = process.env) {
  return trimOrNull(env.V2_EXIT_WORKER_HA_STREAK_LATEST_FILE) || DEFAULT_LATEST_FILE;
}

function resolveOutputFile(env = process.env) {
  return trimOrNull(env.V2_EXIT_WORKER_HA_STREAK_OUTPUT_FILE) || DEFAULT_OUTPUT_FILE;
}

function runCheck(env = process.env) {
  const historyFile = resolveHistoryFile(env);
  const latestFile = resolveLatestFile(env);
  const outputFile = resolveOutputFile(env);
  const history = readJsonlSafe(historyFile);
  const latest = readJsonSafe(latestFile);
  const result = evaluateExitWorkerHaStreak({
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
      reason: "V2_EXIT_WORKER_HA_STREAK_CHECK_FAILED",
      blockers: ["EXIT_WORKER_HA:CHECK_FAILED"],
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  }
} else {
  module.exports = {
    main,
    runCheck,
    evaluateExitWorkerHaStreak,
    evaluateExitWorkerHaRow,
    resolveThresholds,
    latestRowsByDate,
    __test: { trimOrNull, toNumberOrNull, boolOrNull, rowTimestampMs, dateKeyFromMs, readJsonSafe, readJsonlSafe },
  };
}
