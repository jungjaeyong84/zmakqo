#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");
const DEFAULT_OUTPUT_FILE = path.join(REPO_ROOT, "ops", "daily", "v2_v1_writer_deny_streak_latest.json");
const DEFAULT_HISTORY_FILE = path.join(REPO_ROOT, "ops", "daily", "v2_v1_writer_deny_streak_history.jsonl");
const DEFAULT_DENY_PATTERNS = Object.freeze([
  "V2_DISCOVERY_CANARY_LEGACY_ENTRY_WRITE_DENIED",
  "V2_DISCOVERY_CANARY_LEGACY_EXIT_WRITE_DENIED",
  "V2_LEGACY_RUNTIME_DISABLED_LEGACY_V1_WRITER_DENIED",
]);
const DEFAULT_WRITE_PATTERNS = Object.freeze([
  "V1_LEGACY_EXCHANGE_WRITE_PERFORMED",
  "LEGACY_V1_EXCHANGE_WRITE_PERFORMED",
  "V1_PAPER_RUNNER_EXCHANGE_WRITE_PERFORMED",
]);

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function parseWindowHours(value, fallback = 24) {
  const num = toNumberOrNull(value);
  if (!Number.isFinite(num) || num <= 0) return fallback;
  return Math.min(24 * 30, num);
}

function splitPatterns(value, fallback) {
  const rows = String(value || "")
    .split(/[|,]/)
    .map((row) => trimOrNull(row))
    .filter(Boolean);
  return rows.length ? rows : Array.from(fallback || []);
}

function stringifyLogRow(row) {
  if (row === null || row === undefined) return "";
  if (typeof row === "string") return row;
  try {
    return JSON.stringify(row);
  } catch (_) {
    return String(row);
  }
}

function rowTimestampMs(row) {
  if (!row || typeof row !== "object") return null;
  const candidates = [
    row.timestamp,
    row.receiveTimestamp,
    row.created_at,
    row.createdAt,
    row.jsonPayload && row.jsonPayload.timestamp,
    row.jsonPayload && row.jsonPayload.created_at,
  ];
  for (const value of candidates) {
    const ms = Date.parse(String(value || ""));
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

function buildLoggingFilter({ windowHours = 24 } = {}) {
  const reasonTerms = DEFAULT_DENY_PATTERNS.concat(DEFAULT_WRITE_PATTERNS)
    .map((term) => `\"${term}\"`)
    .join(" OR ");
  return [
    'resource.type="cloud_run_revision"',
    `timestamp >= "${new Date(Date.now() - windowHours * 60 * 60 * 1000).toISOString()}"`,
    `(${reasonTerms})`,
  ].join(" AND ");
}

function readLogRows(env = process.env) {
  const inline = trimOrNull(env.DONBEOLJA_V2_V1_WRITER_DENY_LOGS_JSON);
  if (inline) return JSON.parse(inline);
  const file = trimOrNull(env.DONBEOLJA_V2_V1_WRITER_DENY_LOGS_JSON_FILE);
  if (file) return JSON.parse(fs.readFileSync(file, "utf8"));
  if (String(env.DONBEOLJA_V2_V1_WRITER_DENY_COLLECT_SKIP_GCLOUD || "0").trim() === "1") return [];

  const project = trimOrNull(env.GOOGLE_CLOUD_PROJECT) || trimOrNull(env.GCLOUD_PROJECT) || "donbeolja-dev";
  const limit = Math.max(1, Math.min(1000, Math.floor(toNumberOrNull(env.DONBEOLJA_V2_V1_WRITER_DENY_LOG_LIMIT) || 500)));
  const windowHours = parseWindowHours(env.DONBEOLJA_V2_V1_WRITER_DENY_WINDOW_HOURS, 24);
  const filter = trimOrNull(env.DONBEOLJA_V2_V1_WRITER_DENY_LOG_FILTER) || buildLoggingFilter({ windowHours });
  const raw = execFileSync("gcloud", [
    "logging",
    "read",
    filter,
    "--project",
    project,
    "--freshness",
    `${windowHours}h`,
    "--limit",
    String(limit),
    "--format=json",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  return JSON.parse(raw || "[]");
}

function classifyV1WriterRows({ rows = [], env = process.env, nowMs = Date.now() } = {}) {
  const windowHours = parseWindowHours(env.DONBEOLJA_V2_V1_WRITER_DENY_WINDOW_HOURS, 24);
  const cutoffMs = nowMs - windowHours * 60 * 60 * 1000;
  const denyPatterns = splitPatterns(env.DONBEOLJA_V2_V1_WRITER_DENY_DENY_PATTERNS, DEFAULT_DENY_PATTERNS);
  const writePatterns = splitPatterns(env.DONBEOLJA_V2_V1_WRITER_DENY_WRITE_PATTERNS, DEFAULT_WRITE_PATTERNS);
  const deniedRows = [];
  const writeRows = [];
  const consideredRows = [];

  for (const row of Array.isArray(rows) ? rows : []) {
    const ts = rowTimestampMs(row);
    if (Number.isFinite(ts) && ts < cutoffMs) continue;
    const text = stringifyLogRow(row);
    consideredRows.push(row);
    if (denyPatterns.some((pattern) => text.includes(pattern))) deniedRows.push(row);
    if (writePatterns.some((pattern) => text.includes(pattern))) writeRows.push(row);
  }

  return Object.freeze({
    window_hours: windowHours,
    window_start_at: new Date(cutoffMs).toISOString(),
    window_end_at: new Date(nowMs).toISOString(),
    log_row_n: consideredRows.length,
    v1_writer_denied_call_n_24h: deniedRows.length,
    v1_direct_exchange_write_call_n_24h: writeRows.length,
    v1_place_futures_call_n_24h: writeRows.length,
    deny_patterns: Object.freeze(denyPatterns),
    write_patterns: Object.freeze(writePatterns),
    sample_denied_rows: Object.freeze(deniedRows.slice(0, 5).map(stringifyLogRow)),
    sample_write_rows: Object.freeze(writeRows.slice(0, 5).map(stringifyLogRow)),
  });
}

function buildArtifact({ rows = [], env = process.env, nowMs = Date.now(), source = "CLOUD_LOGGING" } = {}) {
  const metrics = classifyV1WriterRows({ rows, env, nowMs });
  const blockers = [];
  if (metrics.v1_place_futures_call_n_24h !== 0) {
    blockers.push("V1_WRITER_DENY_STREAK:V1_EXCHANGE_WRITE_CALLS_PRESENT");
  }
  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0
      ? "V2_V1_WRITER_DENY_STREAK_COLLECTED"
      : "V2_V1_WRITER_DENY_STREAK_BLOCKED",
    generated_at: new Date(nowMs).toISOString(),
    source,
    blockers: Object.freeze(blockers),
    ...metrics,
  });
}

function writeArtifacts({ artifact, env = process.env } = {}) {
  const outputFile = trimOrNull(env.DONBEOLJA_V2_V1_WRITER_DENY_STREAK_FILE) || DEFAULT_OUTPUT_FILE;
  const historyFile = trimOrNull(env.DONBEOLJA_V2_V1_WRITER_DENY_STREAK_HISTORY_FILE) || DEFAULT_HISTORY_FILE;
  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, `${JSON.stringify(artifact, null, 2)}\n`, "utf8");
  fs.mkdirSync(path.dirname(historyFile), { recursive: true });
  fs.appendFileSync(historyFile, `${JSON.stringify(artifact)}\n`, "utf8");
  return Object.freeze({ outputFile, historyFile });
}

function collect(env = process.env) {
  const inline = trimOrNull(env.DONBEOLJA_V2_V1_WRITER_DENY_LOGS_JSON);
  const file = trimOrNull(env.DONBEOLJA_V2_V1_WRITER_DENY_LOGS_JSON_FILE);
  const source = inline ? "INLINE_JSON" : file ? "JSON_FILE" : "CLOUD_LOGGING";
  const rows = readLogRows(env);
  const artifact = buildArtifact({ rows, env, source });
  const files = writeArtifacts({ artifact, env });
  return Object.freeze({ artifact, files });
}

function main(env = process.env) {
  const { artifact, files } = collect(env);
  const payload = Object.freeze({
    ok: artifact.ok,
    reason: artifact.reason,
    blockers: artifact.blockers,
    output_file: files.outputFile,
    history_file: files.historyFile,
    window_hours: artifact.window_hours,
    log_row_n: artifact.log_row_n,
    v1_place_futures_call_n_24h: artifact.v1_place_futures_call_n_24h,
    v1_writer_denied_call_n_24h: artifact.v1_writer_denied_call_n_24h,
  });
  const out = JSON.stringify(payload);
  if (payload.ok) console.log(out);
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
      reason: "V2_V1_WRITER_DENY_STREAK_COLLECT_FAILED",
      blockers: ["V1_WRITER_DENY_STREAK:COLLECT_FAILED"],
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  }
} else {
  module.exports = {
    collect,
    main,
    buildArtifact,
    classifyV1WriterRows,
    buildLoggingFilter,
    readLogRows,
    writeArtifacts,
    __test: { trimOrNull, toNumberOrNull, parseWindowHours, splitPatterns, stringifyLogRow, rowTimestampMs },
  };
}
