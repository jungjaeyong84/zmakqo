#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function readJsonFile(file) {
  return JSON.parse(fs.readFileSync(file, "utf8"));
}

function loadArtifact(env = process.env) {
  const file = trimOrNull(env.DONBEOLJA_V2_V1_WRITER_DENY_STREAK_FILE)
    || path.resolve(__dirname, "..", "ops", "daily", "v2_v1_writer_deny_streak_latest.json");
  if (!fs.existsSync(file)) {
    return { file, missing: true, artifact: null };
  }
  return { file, missing: false, artifact: readJsonFile(file) };
}

function evaluateStaticWriterDenySource({ rootDir = path.resolve(__dirname, "..") } = {}) {
  const runnerFile = path.join(rootDir, "src", "engine", "paperBinanceRunner.js");
  const legacyFile = path.join(rootDir, "src", "engine", "legacy", "v1ExchangeWriters.js");
  const runner = fs.readFileSync(runnerFile, "utf8");
  const legacy = fs.readFileSync(legacyFile, "utf8");
  const checks = [];
  const requiredSnippets = [
    "legacyV1ExchangeWriterEnabled",
    "isV2DiscoveryCanaryLegacyExchangeWriteBlocked",
    "V2_DISCOVERY_CANARY_LEGACY_ENTRY_WRITE_DENIED",
    "V2_DISCOVERY_CANARY_LEGACY_EXIT_WRITE_DENIED",
    "V2_LEGACY_RUNTIME_DISABLED_LEGACY_V1_WRITER_DENIED",
  ];
  for (const snippet of requiredSnippets) {
    checks.push(Object.freeze({ id: `paper_runner_contains:${snippet}`, ok: runner.includes(snippet) }));
  }
  checks.push(Object.freeze({ id: "legacy_boundary_marker", ok: legacy.includes("LEGACY_V1_DEAD_CODE boundary") }));
  checks.push(Object.freeze({ id: "legacy_boundary_imported", ok: runner.includes('require("./legacy/v1ExchangeWriters")') }));
  return Object.freeze({
    ok: checks.every((row) => row.ok === true),
    checks: Object.freeze(checks),
  });
}

function evaluateV1WriterDenyStreak({ artifact = null, artifactMissing = false, artifactFile = null, env = process.env } = {}) {
  const blockers = [];
  const warnings = [];
  const requiredWindowHours = toNumberOrNull(env.DONBEOLJA_V2_V1_WRITER_DENY_STREAK_MIN_HOURS) || 24;
  const requireArtifact = String(env.DONBEOLJA_V2_V1_WRITER_DENY_STREAK_REQUIRE_ARTIFACT || "0").trim() === "1";
  const data = artifact && typeof artifact === "object" ? artifact : {};

  if (artifactMissing) {
    const code = "V1_WRITER_DENY_STREAK:ARTIFACT_MISSING";
    if (requireArtifact) blockers.push(code);
    else warnings.push(code);
  }

  const v1WriteCallN = toNumberOrNull(data.v1_place_futures_call_n_24h)
    ?? toNumberOrNull(data.v1_direct_exchange_write_call_n_24h)
    ?? toNumberOrNull(data.v1_place_futures_call_n)
    ?? 0;
  const deniedCallN = toNumberOrNull(data.v1_writer_denied_call_n_24h)
    ?? toNumberOrNull(data.v1_writer_denied_call_n)
    ?? null;
  const windowHours = toNumberOrNull(data.window_hours) ?? null;

  if (v1WriteCallN !== 0) blockers.push("V1_WRITER_DENY_STREAK:V1_EXCHANGE_WRITE_CALLS_PRESENT");
  if (windowHours !== null && windowHours < requiredWindowHours) blockers.push("V1_WRITER_DENY_STREAK:WINDOW_TOO_SHORT");

  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0
      ? "V2_V1_WRITER_DENY_STREAK_PASS"
      : "V2_V1_WRITER_DENY_STREAK_BLOCKED",
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
    artifact_file: artifactFile || null,
    metrics: Object.freeze({
      v1_place_futures_call_n: v1WriteCallN,
      v1_writer_denied_call_n: deniedCallN,
      window_hours: windowHours,
      required_window_hours: requiredWindowHours,
      artifact_required: requireArtifact,
    }),
  });
}

function runCheck(env = process.env) {
  const staticAudit = evaluateStaticWriterDenySource({});
  const loaded = loadArtifact(env);
  const streak = evaluateV1WriterDenyStreak({
    artifact: loaded.artifact,
    artifactMissing: loaded.missing,
    artifactFile: loaded.file,
    env,
  });
  const blockers = [];
  if (staticAudit.ok !== true) blockers.push("V1_WRITER_DENY_STREAK:STATIC_AUDIT_FAILED");
  blockers.push(...streak.blockers);
  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0
      ? "V2_V1_WRITER_DENY_STREAK_GATE_PASS"
      : "V2_V1_WRITER_DENY_STREAK_GATE_BLOCKED",
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(streak.warnings),
    static_audit: staticAudit,
    streak,
  });
}

if (require.main === module) {
  const result = runCheck(process.env);
  const out = JSON.stringify(result);
  if (result.ok) console.log(out);
  else {
    console.error(out);
    process.exitCode = 1;
  }
} else {
  module.exports = {
    runCheck,
    evaluateStaticWriterDenySource,
    evaluateV1WriterDenyStreak,
    __test: { trimOrNull, toNumberOrNull, loadArtifact },
  };
}
