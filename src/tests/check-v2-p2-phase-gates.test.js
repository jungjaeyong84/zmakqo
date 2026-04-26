"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  evaluateExitWorkerHaRow,
  evaluateExitWorkerHaStreak,
  runCheck: runExitWorkerHaStreakCheck,
} = require("../../scripts/check-v2-exit-worker-ha-streak");
const {
  evaluateIncidentDrillEvidence,
  runCheck: runIncidentDrillEvidenceCheck,
  REQUIRED_SCENARIOS,
} = require("../../scripts/check-v2-incident-drill-evidence");

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.parse("2026-06-01T09:00:00.000Z");

function mkTmp(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function haRow(dayOffset = 0, overrides = {}) {
  const ts = NOW_MS - dayOffset * DAY_MS;
  return {
    ok: true,
    generated_at: new Date(ts).toISOString(),
    blockers: [],
    worker_instance_n: 2,
    min_instances: 2,
    max_instances: 2,
    duplicate_protection_write_n: 0,
    split_brain_n: 0,
    lease_conflict_n: 0,
    lease_takeover_ok: true,
    firestore_repair_lease_ok: true,
    ...overrides,
  };
}

function exitWorkerHaRowBlocksUnknownOrUnsafe() {
  const result = evaluateExitWorkerHaRow(haRow(0, {
    worker_instance_n: 1,
    duplicate_protection_write_n: 1,
    split_brain_n: 1,
    lease_conflict_n: 1,
    lease_takeover_ok: false,
    firestore_repair_lease_ok: false,
  }));
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("EXIT_WORKER_HA:INSUFFICIENT_WORKER_INSTANCES_OR_UNKNOWN"));
  assert.ok(result.blockers.includes("EXIT_WORKER_HA:DUPLICATE_PROTECTION_WRITE_PRESENT_OR_UNKNOWN"));
  assert.ok(result.blockers.includes("EXIT_WORKER_HA:SPLIT_BRAIN_PRESENT_OR_UNKNOWN"));
  assert.ok(result.blockers.includes("EXIT_WORKER_HA:LEASE_CONFLICT_PRESENT_OR_UNKNOWN"));
  assert.ok(result.blockers.includes("EXIT_WORKER_HA:LEASE_TAKEOVER_NOT_PROVEN"));
  assert.ok(result.blockers.includes("EXIT_WORKER_HA:FIRESTORE_LEASE_NOT_PROVEN"));
}

function exitWorkerHaStreakPassesSevenDays() {
  const rows = Array.from({ length: 7 }, (_, i) => haRow(i));
  const result = evaluateExitWorkerHaStreak({ rows, nowMs: NOW_MS });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_EXIT_WORKER_HA_STREAK_PASS");
  assert.strictEqual(result.consecutive_pass_days, 7);
}

function exitWorkerHaStreakBlocksMissingEvidence() {
  const rows = [haRow(0), haRow(1)];
  const result = evaluateExitWorkerHaStreak({ rows, nowMs: NOW_MS });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("EXIT_WORKER_HA:DAILY_EVIDENCE_MISSING"));
  assert.ok(result.blockers.includes("EXIT_WORKER_HA:INSUFFICIENT_CONSECUTIVE_DAYS"));
}

function exitWorkerHaRunCheckWritesStructuredBlocker() {
  const tmp = mkTmp("v2-exit-worker-ha-");
  const history = path.join(tmp, "history.jsonl");
  const latest = path.join(tmp, "latest.json");
  const output = path.join(tmp, "output.json");
  writeJsonl(history, [haRow(1)]);
  writeJson(latest, haRow(0));
  const result = runExitWorkerHaStreakCheck({
    V2_EXIT_WORKER_HA_STREAK_HISTORY_FILE: history,
    V2_EXIT_WORKER_HA_STREAK_LATEST_FILE: latest,
    V2_EXIT_WORKER_HA_STREAK_OUTPUT_FILE: output,
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("EXIT_WORKER_HA:INSUFFICIENT_CONSECUTIVE_DAYS"));
  assert.ok(fs.existsSync(output));
}

function incidentDrillEvidencePassesAllScenarios() {
  const artifact = {
    drills: REQUIRED_SCENARIOS.map((scenario, i) => ({
      scenario,
      ok: true,
      drilled_at: new Date(NOW_MS - i * 60 * 1000).toISOString(),
      evidence_file: `ops/drills/${scenario}.json`,
      blockers: [],
    })),
  };
  const result = evaluateIncidentDrillEvidence({ artifact, nowMs: NOW_MS });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_INCIDENT_DRILL_EVIDENCE_PASS");
  assert.strictEqual(result.scenario_results.every((row) => row.ok === true), true);
}

function incidentDrillEvidenceBlocksMissingAndStale() {
  const artifact = {
    drills: [
      {
        scenario: "EXIT_WORKER_HA_FAILOVER",
        ok: true,
        drilled_at: "2026-01-01T00:00:00.000Z",
        evidence_file: "ops/drills/old.json",
      },
    ],
  };
  const result = evaluateIncidentDrillEvidence({ artifact, nowMs: NOW_MS, env: { V2_INCIDENT_DRILL_MAX_AGE_DAYS: "30" } });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.some((item) => item.includes("EXIT_WORKER_INSTANCE_FAILURE:INCIDENT_DRILL:SCENARIO_STALE")));
  assert.ok(result.blockers.some((item) => item.includes("SYSTEM_SETTINGS_LIVE_ENABLED_TOGGLE:INCIDENT_DRILL:SCENARIO_MISSING")));
}

function incidentDrillRunCheckBlocksMissingArtifact() {
  const tmp = mkTmp("v2-incident-drill-");
  const output = path.join(tmp, "output.json");
  const result = runIncidentDrillEvidenceCheck({
    V2_INCIDENT_DRILL_EVIDENCE_FILE: path.join(tmp, "missing.json"),
    V2_INCIDENT_DRILL_EVIDENCE_OUTPUT_FILE: output,
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("INCIDENT_DRILL:ARTIFACT_MISSING"));
  assert.ok(fs.existsSync(output));
}

exitWorkerHaRowBlocksUnknownOrUnsafe();
exitWorkerHaStreakPassesSevenDays();
exitWorkerHaStreakBlocksMissingEvidence();
exitWorkerHaRunCheckWritesStructuredBlocker();
incidentDrillEvidencePassesAllScenarios();
incidentDrillEvidenceBlocksMissingAndStale();
incidentDrillRunCheckBlocksMissingArtifact();
console.log("CHECK_V2_P2_PHASE_GATES_TEST_OK");
