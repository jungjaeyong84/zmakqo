#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");

const REPO_ROOT = path.resolve(__dirname, "..");
const OPS_DAILY_DIR = path.join(REPO_ROOT, "ops", "daily");
const DEFAULT_INPUT_FILE = path.join(OPS_DAILY_DIR, "v2_incident_drill_evidence_latest.json");
const DEFAULT_OUTPUT_FILE = path.join(OPS_DAILY_DIR, "v2_incident_drill_evidence_check_latest.json");

const REQUIRED_SCENARIOS = Object.freeze([
  "EXIT_WORKER_INSTANCE_FAILURE",
  "SYSTEM_SETTINGS_LIVE_ENABLED_TOGGLE",
  "BINANCE_API_DEGRADED",
  "TELEGRAM_DELIVERY_OUTAGE",
]);

const SCENARIO_ALIASES = Object.freeze({
  EXIT_WORKER_INSTANCE_FAILURE: "EXIT_WORKER_INSTANCE_FAILURE",
  EXIT_WORKER_HA_FAILOVER: "EXIT_WORKER_INSTANCE_FAILURE",
  EXIT_WORKER_KILL: "EXIT_WORKER_INSTANCE_FAILURE",
  SYSTEM_SETTINGS_LIVE_ENABLED_TOGGLE: "SYSTEM_SETTINGS_LIVE_ENABLED_TOGGLE",
  LIVE_ENABLED_TOGGLE: "SYSTEM_SETTINGS_LIVE_ENABLED_TOGGLE",
  FIRESTORE_LIVE_ENABLED_TOGGLE: "SYSTEM_SETTINGS_LIVE_ENABLED_TOGGLE",
  BINANCE_API_DEGRADED: "BINANCE_API_DEGRADED",
  ALGO_ENDPOINT_DEGRADED: "BINANCE_API_DEGRADED",
  BINANCE_OUTAGE: "BINANCE_API_DEGRADED",
  TELEGRAM_DELIVERY_OUTAGE: "TELEGRAM_DELIVERY_OUTAGE",
  TELEGRAM_OUTAGE: "TELEGRAM_DELIVERY_OUTAGE",
  ALERT_DELIVERY_OUTAGE: "TELEGRAM_DELIVERY_OUTAGE",
});

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function upperCode(value) {
  return String(value == null ? "" : value)
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
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

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function normalizeScenario(value) {
  const code = upperCode(value);
  return SCENARIO_ALIASES[code] || code || null;
}

function rowTimestampMs(row) {
  const raw = row && (row.drilled_at || row.executed_at || row.generated_at || row.completed_at || row.date);
  const parsed = Date.parse(String(raw || ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function collectDrillRows(artifact = null) {
  const row = artifact && typeof artifact === "object" ? artifact : {};
  const candidates = [];
  for (const key of ["drills", "scenarios", "results", "items"]) {
    if (Array.isArray(row[key])) candidates.push(...row[key]);
  }
  if (Array.isArray(artifact)) candidates.push(...artifact);
  if (candidates.length === 0 && trimOrNull(row.scenario || row.drill_scenario || row.id)) candidates.push(row);
  return candidates.filter((item) => item && typeof item === "object");
}

function evaluateIncidentDrillEvidence({ artifact = null, artifactMissing = false, artifactFile = DEFAULT_INPUT_FILE, env = process.env, nowMs = Date.now() } = {}) {
  const maxAgeDays = numberFromEnv(env, "V2_INCIDENT_DRILL_MAX_AGE_DAYS", 90);
  const maxAgeMs = Math.max(1, maxAgeDays) * 24 * 60 * 60 * 1000;
  const blockers = [];
  const byScenario = new Map();
  const rows = collectDrillRows(artifact);

  if (artifactMissing) blockers.push("INCIDENT_DRILL:ARTIFACT_MISSING");
  if (rows.length === 0) blockers.push("INCIDENT_DRILL:NO_DRILL_ROWS");

  for (const row of rows) {
    const scenario = normalizeScenario(row.scenario || row.drill_scenario || row.id || row.name);
    if (!scenario) continue;
    const ts = rowTimestampMs(row);
    const passed = boolOrNull(row.ok ?? row.passed ?? row.pass ?? row.drill_passed);
    const blockersForRow = Array.isArray(row.blockers) ? row.blockers : [];
    const evidenceRef = trimOrNull(row.evidence_file || row.artifact_file || row.report_file || row.runbook_ref || row.evidence_ref);
    const stale = !Number.isFinite(ts) || (nowMs - ts) > maxAgeMs || ts > nowMs;
    const candidate = Object.freeze({
      scenario,
      ok: passed === true && stale !== true && blockersForRow.length === 0 && Boolean(evidenceRef),
      passed,
      stale,
      drilled_at: Number.isFinite(ts) ? new Date(ts).toISOString() : null,
      evidence_ref: evidenceRef,
      blockers: Object.freeze(blockersForRow),
    });
    const prev = byScenario.get(scenario);
    const prevTs = prev && prev.drilled_at ? Date.parse(prev.drilled_at) : -Infinity;
    if (!prev || (Number.isFinite(ts) && ts >= prevTs)) byScenario.set(scenario, candidate);
  }

  const scenarioResults = REQUIRED_SCENARIOS.map((scenario) => {
    const result = byScenario.get(scenario) || null;
    const scenarioBlockers = [];
    if (!result) scenarioBlockers.push("INCIDENT_DRILL:SCENARIO_MISSING");
    else {
      if (result.passed !== true) scenarioBlockers.push("INCIDENT_DRILL:SCENARIO_NOT_PASSED");
      if (result.stale === true) scenarioBlockers.push("INCIDENT_DRILL:SCENARIO_STALE");
      if (!result.evidence_ref) scenarioBlockers.push("INCIDENT_DRILL:EVIDENCE_REF_MISSING");
      if (result.blockers.length > 0) scenarioBlockers.push("INCIDENT_DRILL:SCENARIO_BLOCKERS_PRESENT");
    }
    if (scenarioBlockers.length > 0) blockers.push(`${scenario}:${scenarioBlockers.join("+")}`);
    return Object.freeze({
      scenario,
      ok: scenarioBlockers.length === 0,
      blockers: Object.freeze(scenarioBlockers),
      ...(result || {}),
    });
  });

  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0 ? "V2_INCIDENT_DRILL_EVIDENCE_PASS" : "V2_INCIDENT_DRILL_EVIDENCE_BLOCKED",
    generated_at: new Date(nowMs).toISOString(),
    artifact_file: artifactFile,
    blocker_n: Array.from(new Set(blockers)).length,
    blockers: Object.freeze(Array.from(new Set(blockers))),
    required_scenarios: REQUIRED_SCENARIOS,
    max_age_days: maxAgeDays,
    scenario_results: Object.freeze(scenarioResults),
  });
}

function resolveInputFile(env = process.env) {
  return trimOrNull(env.V2_INCIDENT_DRILL_EVIDENCE_FILE) || DEFAULT_INPUT_FILE;
}

function resolveOutputFile(env = process.env) {
  return trimOrNull(env.V2_INCIDENT_DRILL_EVIDENCE_OUTPUT_FILE) || DEFAULT_OUTPUT_FILE;
}

function runCheck(env = process.env) {
  const inputFile = resolveInputFile(env);
  const outputFile = resolveOutputFile(env);
  const loaded = readJsonSafe(inputFile);
  const result = evaluateIncidentDrillEvidence({
    artifact: loaded.ok ? loaded.data : null,
    artifactMissing: loaded.ok !== true,
    artifactFile: inputFile,
    env,
  });
  const payload = Object.freeze({
    ...result,
    output_file: outputFile,
    input_read_ok: loaded.ok,
    ...(loaded.ok ? {} : { input_error_code: loaded.error && loaded.error.code || null, input_error: loaded.error && loaded.error.message || String(loaded.error) }),
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
      reason: "V2_INCIDENT_DRILL_EVIDENCE_CHECK_FAILED",
      blockers: ["INCIDENT_DRILL:CHECK_FAILED"],
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  }
} else {
  module.exports = {
    main,
    runCheck,
    evaluateIncidentDrillEvidence,
    collectDrillRows,
    normalizeScenario,
    REQUIRED_SCENARIOS,
    __test: { trimOrNull, toNumberOrNull, boolOrNull, rowTimestampMs, readJsonSafe },
  };
}
