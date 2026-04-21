#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const OUTPUT_FILENAME = "v2_repair_live_cutover_readiness_latest.json";
const STREAK_FILENAMES = Object.freeze([
  "v2_repair_queue_firestore_canary_streak_latest.json",
  "v2-repair-queue-firestore-canary-streak.json",
]);

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readJson(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function resolveArtifactDir(env = process.env) {
  return trimOrNull(env.DONBEOLJA_V2_REPAIR_LIVE_CUTOVER_ARTIFACT_DIR)
    || trimOrNull(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_DIR)
    || trimOrNull(env.DONBEOLJA_V2_REPAIR_CANARY_ARTIFACT_DIR)
    || path.join(process.cwd(), "ops", "daily");
}

function resolveOutputFile(env = process.env) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_REPAIR_LIVE_CUTOVER_READINESS_FILE);
  if (explicit) return path.resolve(explicit);
  return path.resolve(resolveArtifactDir(env), OUTPUT_FILENAME);
}

function candidateStreakFiles(env = process.env) {
  const explicit = trimOrNull(env.DONBEOLJA_V2_REPAIR_LIVE_CUTOVER_STREAK_FILE)
    || trimOrNull(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_FILE);
  if (explicit) return Object.freeze([path.resolve(explicit)]);

  const dirs = [
    trimOrNull(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_DIR),
    trimOrNull(env.DONBEOLJA_V2_REPAIR_CANARY_ARTIFACT_DIR),
    trimOrNull(env.DONBEOLJA_V2_REPAIR_LIVE_CUTOVER_ARTIFACT_DIR),
    path.join(process.cwd(), "ops", "daily"),
    path.join(process.cwd(), "artifacts", "v2-repair-canary"),
  ].filter(Boolean);

  const files = [];
  dirs.forEach((dir) => {
    STREAK_FILENAMES.forEach((filename) => files.push(path.resolve(dir, filename)));
  });
  return Object.freeze([...new Set(files)]);
}

function resolveStreakFile(env = process.env) {
  const candidates = candidateStreakFiles(env);
  return candidates.find((filePath) => fs.existsSync(filePath)) || candidates[0] || null;
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value.slice() : [];
}

function hasPassingFirestoreCanaryStreak(streak) {
  const row = normalizeObject(streak);
  if (!row) return false;
  return (
    row.ok === true &&
    trimOrNull(row.reason) === "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS" &&
    Number(row.healthy_run_n) >= Number(row.min_run_count) &&
    Number(row.unhealthy_run_n) === 0 &&
    Number(row.invalid_line_n) === 0 &&
    normalizeArray(row.blockers).length === 0
  );
}

function buildRequiredEnvChanges() {
  return Object.freeze([
    Object.freeze({
      name: "DONBEOLJA_V2_REPAIR_LIVE_ENABLE_REQUESTED",
      value: "1",
      scope: "live-repair-preflight",
      reason: "marks the repair path as an intentional LIVE enablement request",
    }),
    Object.freeze({
      name: "DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_REQUIRED",
      value: "1",
      scope: "live-repair-preflight",
      reason: "keeps watchdog-generated repair request canary mandatory for LIVE",
    }),
    Object.freeze({
      name: "DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_REQUIRED",
      value: "1",
      scope: "live-repair-preflight",
      reason: "keeps Firestore-backed repair queue canary mandatory for LIVE",
    }),
    Object.freeze({
      name: "DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_REQUIRED",
      value: "1",
      scope: "live-repair-preflight",
      reason: "requires 24h Firestore canary streak evidence before LIVE cutover",
    }),
  ]);
}

function evaluateLiveCutoverReadiness({
  streak = null,
  streakFile = null,
  generatedAt = new Date().toISOString(),
  readError = null,
} = {}) {
  const blockers = [];
  const row = normalizeObject(streak);
  if (readError) blockers.push("LIVE_CUTOVER:STREAK_ARTIFACT_READ_FAILED");
  if (!row) blockers.push("LIVE_CUTOVER:STREAK_ARTIFACT_MISSING");
  if (row && !hasPassingFirestoreCanaryStreak(row)) {
    blockers.push("LIVE_CUTOVER:STREAK_NOT_PASSING");
    normalizeArray(row.blockers).forEach((blocker) => blockers.push(blocker));
  }

  const ok = blockers.length === 0;
  return Object.freeze({
    ok,
    reason: ok
      ? "V2_REPAIR_FIRESTORE_CANARY_READY_FOR_LIVE_PREFLIGHT"
      : "V2_REPAIR_FIRESTORE_CANARY_NOT_READY_FOR_LIVE_PREFLIGHT",
    generated_at: generatedAt,
    source_streak_file: trimOrNull(streakFile),
    auto_apply: false,
    mutates_environment: false,
    runbook_checklist: Object.freeze(["19"]),
    submit_check_ids: Object.freeze(["SUBMIT_CHK_11"]),
    recommended_next_action: ok
      ? "ENABLE_LIVE_REPAIR_PREFLIGHT_ENV_EXPLICITLY"
      : "WAIT_FOR_FIRESTORE_CANARY_STREAK_COVERAGE",
    required_env_changes: ok ? buildRequiredEnvChanges() : Object.freeze([]),
    blockers: Object.freeze([...new Set(blockers)]),
    streak_summary: row ? Object.freeze({
      ok: row.ok === true,
      reason: trimOrNull(row.reason),
      healthy_run_n: Number(row.healthy_run_n),
      min_run_count: Number(row.min_run_count),
      unhealthy_run_n: Number(row.unhealthy_run_n),
      invalid_line_n: Number(row.invalid_line_n),
      latest_age_minutes: Number.isFinite(Number(row.latest_age_minutes)) ? Number(row.latest_age_minutes) : null,
      coverage_minutes: Number.isFinite(Number(row.coverage_minutes)) ? Number(row.coverage_minutes) : null,
      blockers: Object.freeze(normalizeArray(row.blockers)),
    }) : null,
    read_error: readError ? Object.freeze({
      message: readError && readError.message ? readError.message : String(readError),
    }) : null,
  });
}

function runCheck(env = process.env, { generatedAt = new Date().toISOString() } = {}) {
  const streakFile = resolveStreakFile(env);
  if (!streakFile || !fs.existsSync(streakFile)) {
    return evaluateLiveCutoverReadiness({
      streak: null,
      streakFile,
      generatedAt,
    });
  }
  try {
    return evaluateLiveCutoverReadiness({
      streak: readJson(streakFile),
      streakFile,
      generatedAt,
    });
  } catch (error) {
    return evaluateLiveCutoverReadiness({
      streak: null,
      streakFile,
      generatedAt,
      readError: error,
    });
  }
}

function writeReadinessArtifact(env = process.env, report = runCheck(env)) {
  const outputFile = resolveOutputFile(env);
  ensureDir(path.dirname(outputFile));
  writeJson(outputFile, report);
  return outputFile;
}

async function main(env = process.env) {
  const report = runCheck(env);
  const outputFile = writeReadinessArtifact(env, report);
  const sink = report.ok === true ? console.log : console.error;
  sink(JSON.stringify({
    ok: report.ok,
    reason: report.reason,
    output_file: outputFile,
    source_streak_file: report.source_streak_file,
    recommended_next_action: report.recommended_next_action,
    blockers: report.blockers,
  }));
  if (report.ok !== true) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("CHECK_V2_REPAIR_LIVE_CUTOVER_READINESS_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    runCheck,
    evaluateLiveCutoverReadiness,
    hasPassingFirestoreCanaryStreak,
    writeReadinessArtifact,
    candidateStreakFiles,
    resolveStreakFile,
    resolveOutputFile,
    __test: {
      OUTPUT_FILENAME,
      STREAK_FILENAMES,
      trimOrNull,
      resolveArtifactDir,
      buildRequiredEnvChanges,
    },
  };
}
