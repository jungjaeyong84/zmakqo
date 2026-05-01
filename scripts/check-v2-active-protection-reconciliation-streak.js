#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const ROOT = path.resolve(__dirname, "..");
const DEFAULT_HISTORY_FILE = path.join(ROOT, "ops", "daily", "v2_active_protection_reconciliation_history.jsonl");

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function parseBool(value, fallback = false) {
  if (value === true || value === false) return value;
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return fallback;
}

function numberWithDefault(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function readJsonlSafe(file) {
  try {
    const rows = fs.readFileSync(file, "utf8")
      .split(/\n/)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
    return { rows };
  } catch (error) {
    return { error, rows: [] };
  }
}

function evaluateActiveProtectionReconciliationStreak({
  rows = [],
  artifactMissing = false,
  artifactFile = DEFAULT_HISTORY_FILE,
  env = process.env,
  nowMs = Date.now(),
} = {}) {
  const blockers = [];
  const warnings = [];
  const required = parseBool(env.V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_REQUIRED, false);
  const windowHours = Math.max(1, numberWithDefault(env.V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_WINDOW_HOURS, 24));
  const minRunN = Math.max(1, numberWithDefault(env.V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_MIN_RUN_N, 1));
  const maxGapMs = Math.max(1, numberWithDefault(env.V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_MAX_GAP_MS, 2 * 60 * 60 * 1000));
  const windowStartMs = nowMs - windowHours * 60 * 60 * 1000;

  if (artifactMissing) {
    const code = "ACTIVE_PROTECTION_RECONCILIATION_STREAK:HISTORY_MISSING";
    if (required) blockers.push(code);
    else warnings.push(code);
    return Object.freeze({
      ok: blockers.length === 0,
      reason: blockers.length === 0
        ? "V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_PASS"
        : "V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_BLOCKED",
      blockers: Object.freeze(blockers),
      warnings: Object.freeze(warnings),
      artifact_file: artifactFile,
      metrics: Object.freeze({
        window_hours: windowHours,
        run_n: 0,
        required_run_n: minRunN,
        max_gap_ms: maxGapMs,
      }),
    });
  }

  const parsedRows = (Array.isArray(rows) ? rows : [])
    .map((row) => ({ row, ts: Date.parse(String(row && row.generated_at || "")) }))
    .filter((item) => Number.isFinite(item.ts) && item.ts >= windowStartMs && item.ts <= nowMs)
    .sort((a, b) => a.ts - b.ts);

  if (parsedRows.length < minRunN) blockers.push("ACTIVE_PROTECTION_RECONCILIATION_STREAK:MIN_RUN_COUNT");
  const badRows = parsedRows.filter(({ row }) => row && row.ok !== true);
  if (badRows.length) blockers.push("ACTIVE_PROTECTION_RECONCILIATION_STREAK:BLOCKED_ROW_IN_WINDOW");
  const unprotectedRows = parsedRows.filter(({ row }) => Number(row && row.unprotected_position_n) > 0);
  if (unprotectedRows.length) blockers.push("ACTIVE_PROTECTION_RECONCILIATION_STREAK:UNPROTECTED_POSITION_IN_WINDOW");
  const criticalRows = parsedRows.filter(({ row }) => Number(row && row.critical_issue_n) > 0);
  if (criticalRows.length) blockers.push("ACTIVE_PROTECTION_RECONCILIATION_STREAK:CRITICAL_ISSUE_IN_WINDOW");

  let maxObservedGapMs = 0;
  for (let i = 1; i < parsedRows.length; i += 1) {
    maxObservedGapMs = Math.max(maxObservedGapMs, parsedRows[i].ts - parsedRows[i - 1].ts);
  }
  if (parsedRows.length > 1 && maxObservedGapMs > maxGapMs) {
    blockers.push("ACTIVE_PROTECTION_RECONCILIATION_STREAK:GAP_EXCEEDED");
  }
  const latestTs = parsedRows.length ? parsedRows[parsedRows.length - 1].ts : NaN;
  const latestAgeMs = Number.isFinite(latestTs) ? Math.max(0, nowMs - latestTs) : null;
  if (Number.isFinite(latestAgeMs) && latestAgeMs > maxGapMs) {
    blockers.push("ACTIVE_PROTECTION_RECONCILIATION_STREAK:LATEST_STALE");
  }

  const unprotectedSymbols = Array.from(new Set(parsedRows
    .flatMap(({ row }) => Array.isArray(row && row.unprotected_symbols) ? row.unprotected_symbols : [])
    .map((symbol) => String(symbol || "").toUpperCase())
    .filter(Boolean))).sort();

  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0
      ? "V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_PASS"
      : "V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_BLOCKED",
    blockers: Object.freeze(Array.from(new Set(blockers))),
    warnings: Object.freeze(warnings),
    artifact_file: artifactFile,
    metrics: Object.freeze({
      window_hours: windowHours,
      run_n: parsedRows.length,
      required_run_n: minRunN,
      max_gap_ms: maxGapMs,
      max_observed_gap_ms: maxObservedGapMs,
      latest_age_ms: latestAgeMs,
      blocked_row_n: badRows.length,
      unprotected_row_n: unprotectedRows.length,
      critical_row_n: criticalRows.length,
      unprotected_symbols: Object.freeze(unprotectedSymbols),
    }),
  });
}

function runCheck(env = process.env) {
  const artifactFile = trimOrNull(env.V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_FILE) || DEFAULT_HISTORY_FILE;
  const loaded = readJsonlSafe(artifactFile);
  const missing = loaded && loaded.error && loaded.error.code === "ENOENT";
  if (loaded && loaded.error && !missing) {
    return Object.freeze({
      ok: false,
      reason: "V2_ACTIVE_PROTECTION_RECONCILIATION_STREAK_BLOCKED",
      blockers: Object.freeze(["ACTIVE_PROTECTION_RECONCILIATION_STREAK:HISTORY_READ_FAILED"]),
      warnings: Object.freeze([]),
      artifact_file: artifactFile,
      error: loaded.error.message || String(loaded.error),
    });
  }
  return evaluateActiveProtectionReconciliationStreak({
    rows: loaded.rows || [],
    artifactMissing: missing,
    artifactFile,
    env,
  });
}

function main(env = process.env) {
  const result = runCheck(env);
  const out = JSON.stringify(result);
  if (result.ok) console.log(out);
  else {
    console.error(out);
    process.exitCode = 1;
  }
  return result;
}

if (require.main === module) {
  main(process.env);
} else {
  module.exports = {
    main,
    runCheck,
    evaluateActiveProtectionReconciliationStreak,
    readJsonlSafe,
    DEFAULT_HISTORY_FILE,
    __test: { trimOrNull, parseBool, numberWithDefault },
  };
}
