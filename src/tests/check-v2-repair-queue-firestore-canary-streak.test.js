"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const checker = require("../../scripts/check-v2-repair-queue-firestore-canary-streak");

function buildHealthyPayload(generatedAt) {
  return {
    ok: true,
    reason: "V2_REPAIR_QUEUE_FIRESTORE_CANARY_HEALTHY",
    canary_mode: "FIRESTORE_BACKED_SHADOW_REPAIR_REQUEST_GENERATION",
    generated_at: generatedAt,
    firestore_write_performed: true,
    exchange_write_performed: false,
    service_status: "HEALTHY",
    selected_issue_code: "TRAIL_STOP_MISSING",
    summary: {
      requested_repair_n: 1,
      delegated_repair_n: 1,
      completion_success_n: 1,
      completion_failed_n: 0,
    },
  };
}

function buildHistory(rows) {
  return {
    rows: rows.map((payload, index) => ({
      line_no: index + 1,
      raw: JSON.stringify(payload),
      payload,
    })),
    invalid_lines: [],
  };
}

(function streakPassesWithContinuousHealthyCoverage() {
  const nowMs = Date.parse("2026-04-21T12:00:00.000Z");
  const rows = [];
  for (let hour = 24; hour >= 0; hour -= 2) {
    rows.push(buildHealthyPayload(new Date(nowMs - hour * 60 * 60000).toISOString()));
  }
  const report = checker.evaluateFirestoreCanaryStreak({
    history: buildHistory(rows),
    config: {
      lookbackHours: 24,
      minRunCount: 12,
      maxGapMinutes: 180,
    },
    nowMs,
    historyFile: "/tmp/history.jsonl",
  });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.healthy_run_n, 13);
  assert.strictEqual(report.blockers.length, 0);
})();

(function streakFailsOnSingleLatestOnlyEvidence() {
  const nowMs = Date.parse("2026-04-21T12:00:00.000Z");
  const report = checker.evaluateFirestoreCanaryStreak({
    history: buildHistory([
      buildHealthyPayload("2026-04-21T12:00:00.000Z"),
    ]),
    config: {
      lookbackHours: 24,
      minRunCount: 12,
      maxGapMinutes: 180,
    },
    nowMs,
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.blockers.includes("FIRESTORE_CANARY_STREAK:MIN_RUN_COUNT"));
  assert.ok(report.blockers.includes("FIRESTORE_CANARY_STREAK:COVERAGE_INSUFFICIENT"));
})();

(function streakFailsOnUnhealthyRowInWindow() {
  const nowMs = Date.parse("2026-04-21T12:00:00.000Z");
  const rows = [];
  for (let hour = 24; hour >= 0; hour -= 2) {
    rows.push(buildHealthyPayload(new Date(nowMs - hour * 60 * 60000).toISOString()));
  }
  rows[5] = {
    ...rows[5],
    ok: false,
    reason: "V2_REPAIR_QUEUE_FIRESTORE_CANARY_FAILED",
  };
  const report = checker.evaluateFirestoreCanaryStreak({
    history: buildHistory(rows),
    config: {
      lookbackHours: 24,
      minRunCount: 12,
      maxGapMinutes: 180,
    },
    nowMs,
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.blockers.includes("FIRESTORE_CANARY_STREAK:UNHEALTHY_ROW_IN_WINDOW"));
})();

(function parserReportsInvalidJsonl() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-firestore-streak-"));
  try {
    const filePath = path.join(dir, "history.jsonl");
    fs.writeFileSync(filePath, `${JSON.stringify(buildHealthyPayload("2026-04-21T12:00:00.000Z"))}\n{bad-json}\n`, "utf8");
    const parsed = checker.parseHistoryFile(filePath);
    assert.strictEqual(parsed.rows.length, 1);
    assert.strictEqual(parsed.invalid_lines.length, 1);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function helperDefaultsStayStable() {
  assert.ok(checker.__test.resolveHistoryFile({}).endsWith("v2_repair_queue_firestore_canary_history.jsonl"));
  assert.ok(checker.__test.resolveOutputFile({}).endsWith("v2-repair-queue-firestore-canary-streak.json"));
  assert.strictEqual(checker.__test.resolveStreakConfig({}).lookbackHours, 24);
})();

console.log("CHECK_V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_TEST_OK");
