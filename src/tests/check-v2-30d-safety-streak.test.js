"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  evaluateThirtyDaySafetyStreak,
  evaluateSafetyRow,
  runCheck,
} = require("../../scripts/check-v2-30d-safety-streak");

const DAY_MS = 24 * 60 * 60 * 1000;
const NOW_MS = Date.parse("2026-05-31T09:00:00.000Z");

function mkTmp() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "v2-30d-safety-streak-"));
}

function writeJson(file, payload) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function writeJsonl(file, rows) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`, "utf8");
}

function safeRow(dayOffset = 0, overrides = {}) {
  const ts = NOW_MS - dayOffset * DAY_MS;
  return {
    ok: true,
    reason: "V2_EVIDENCE_SNAPSHOT_COLLECTED",
    generated_at: new Date(ts).toISOString(),
    date: new Date(ts).toISOString().slice(0, 10),
    blockers: [],
    max_unprotected_position_30d: 0,
    unprotected_position_n: 0,
    post_fill_critical_30d: 0,
    repair_queue_lag_p95_ms: 45000,
    algo_endpoint_degraded_duration_ms: 0,
    algo_endpoint_degraded_crit_n_30d: 0,
    v1_place_futures_call_n_30d: 0,
    contradictory_alert_fill_issue_n_30d: 0,
    cloud_run_revision_drift_n: 0,
    ...overrides,
  };
}

function passingThirtyDays() {
  const rows = Array.from({ length: 30 }, (_, i) => safeRow(i));
  const result = evaluateThirtyDaySafetyStreak({ rows, nowMs: NOW_MS });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_30D_SAFETY_STREAK_PASS");
  assert.strictEqual(result.consecutive_pass_days, 30);
}

function missingDaysBlock() {
  const rows = Array.from({ length: 2 }, (_, i) => safeRow(i));
  const result = evaluateThirtyDaySafetyStreak({ rows, nowMs: NOW_MS });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("SAFETY_STREAK:DAILY_EVIDENCE_MISSING"));
  assert.ok(result.blockers.includes("SAFETY_STREAK:INSUFFICIENT_CONSECUTIVE_DAYS"));
  assert.strictEqual(result.consecutive_pass_days, 2);
}

function anySafetyMetricBlocks() {
  const row = safeRow(0, {
    max_unprotected_position_30d: 1,
    post_fill_critical_30d: 1,
    repair_queue_lag_p95_ms: 61000,
    algo_endpoint_degraded_duration_ms: 700000,
    v1_place_futures_call_n_30d: 1,
    contradictory_alert_fill_issue_n_30d: 1,
    cloud_run_revision_drift_n: 1,
  });
  const result = evaluateSafetyRow(row);
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("SAFETY_STREAK:UNPROTECTED_POSITION_PRESENT_OR_UNKNOWN"));
  assert.ok(result.blockers.includes("SAFETY_STREAK:POST_FILL_CRITICAL_PRESENT_OR_UNKNOWN"));
  assert.ok(result.blockers.includes("SAFETY_STREAK:REPAIR_QUEUE_LAG_P95_EXCEEDED_OR_UNKNOWN"));
  assert.ok(result.blockers.includes("SAFETY_STREAK:ALGO_ENDPOINT_DEGRADED_TOO_LONG_OR_UNKNOWN"));
  assert.ok(result.blockers.includes("SAFETY_STREAK:V1_WRITER_CALL_PRESENT_OR_UNKNOWN"));
  assert.ok(result.blockers.includes("SAFETY_STREAK:ALERT_FILL_CONTRADICTION_PRESENT_OR_UNKNOWN"));
  assert.ok(result.blockers.includes("SAFETY_STREAK:CLOUD_RUN_REVISION_DRIFT_PRESENT_OR_UNKNOWN"));
}

function missingEvidenceBlocksFailClosed() {
  const result = evaluateSafetyRow(safeRow(0, {
    repair_queue_lag_p95_ms: null,
    algo_endpoint_degraded_duration_ms: null,
    contradictory_alert_fill_issue_n_30d: null,
    cloud_run_revision_drift_n: null,
  }));
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("SAFETY_STREAK:REPAIR_QUEUE_LAG_P95_EXCEEDED_OR_UNKNOWN"));
  assert.ok(result.blockers.includes("SAFETY_STREAK:ALGO_ENDPOINT_DEGRADED_TOO_LONG_OR_UNKNOWN"));
  assert.ok(result.blockers.includes("SAFETY_STREAK:ALERT_FILL_CONTRADICTION_PRESENT_OR_UNKNOWN"));
  assert.ok(result.blockers.includes("SAFETY_STREAK:CLOUD_RUN_REVISION_DRIFT_PRESENT_OR_UNKNOWN"));
}

function runCheckWritesStructuredBlocker() {
  const tmp = mkTmp();
  const history = path.join(tmp, "history.jsonl");
  const latest = path.join(tmp, "latest.json");
  const output = path.join(tmp, "out.json");
  writeJsonl(history, [safeRow(1)]);
  writeJson(latest, safeRow(0));
  const result = runCheck({
    V2_30D_SAFETY_STREAK_HISTORY_FILE: history,
    V2_30D_SAFETY_STREAK_LATEST_FILE: latest,
    V2_30D_SAFETY_STREAK_OUTPUT_FILE: output,
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("SAFETY_STREAK:INSUFFICIENT_CONSECUTIVE_DAYS"));
  assert.ok(fs.existsSync(output));
}

passingThirtyDays();
missingDaysBlock();
anySafetyMetricBlocks();
missingEvidenceBlocksFailClosed();
runCheckWritesStructuredBlocker();
console.log("CHECK_V2_30D_SAFETY_STREAK_TEST_OK");
