"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const checker = require("../../scripts/check-v2-repair-live-cutover-readiness");

function buildPassingStreak() {
  return {
    ok: true,
    reason: "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS",
    healthy_run_n: 13,
    min_run_count: 12,
    unhealthy_run_n: 0,
    invalid_line_n: 0,
    latest_age_minutes: 42,
    coverage_minutes: 1440,
    blockers: [],
  };
}

(function blockedWhenStreakArtifactIsMissing() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-live-cutover-missing-"));
  try {
    const report = checker.runCheck({
      DONBEOLJA_V2_REPAIR_LIVE_CUTOVER_ARTIFACT_DIR: dir,
      DONBEOLJA_V2_REPAIR_LIVE_CUTOVER_STREAK_FILE: path.join(dir, "missing.json"),
    }, {
      generatedAt: "2026-04-21T12:00:00.000Z",
    });
    assert.strictEqual(report.ok, false);
    assert.strictEqual(report.reason, "V2_REPAIR_FIRESTORE_CANARY_NOT_READY_FOR_LIVE_PREFLIGHT");
    assert.ok(report.blockers.includes("LIVE_CUTOVER:STREAK_ARTIFACT_MISSING"));
    assert.deepStrictEqual(report.required_env_changes, []);
    assert.strictEqual(report.auto_apply, false);
    assert.strictEqual(report.mutates_environment, false);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

(function blockedStreakCarriesOriginalBlockersAndRunbookTrace() {
  const report = checker.evaluateLiveCutoverReadiness({
    generatedAt: "2026-04-21T12:00:00.000Z",
    streakFile: "/tmp/streak.json",
    streak: {
      ...buildPassingStreak(),
      ok: false,
      reason: "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_BLOCKED",
      healthy_run_n: 3,
      blockers: [
        "FIRESTORE_CANARY_STREAK:MIN_RUN_COUNT",
        "FIRESTORE_CANARY_STREAK:COVERAGE_INSUFFICIENT",
      ],
    },
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.blockers.includes("LIVE_CUTOVER:STREAK_NOT_PASSING"));
  assert.ok(report.blockers.includes("FIRESTORE_CANARY_STREAK:MIN_RUN_COUNT"));
  assert.deepStrictEqual(report.runbook_checklist, ["19"]);
  assert.deepStrictEqual(report.submit_check_ids, ["SUBMIT_CHK_11"]);
  assert.strictEqual(report.recommended_next_action, "WAIT_FOR_FIRESTORE_CANARY_STREAK_COVERAGE");
})();

(function passingStreakProducesExplicitManualEnvPlan() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-live-cutover-pass-"));
  try {
    const streakFile = path.join(dir, "v2_repair_queue_firestore_canary_streak_latest.json");
    fs.writeFileSync(streakFile, `${JSON.stringify(buildPassingStreak(), null, 2)}\n`, "utf8");
    const report = checker.runCheck({
      DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_DIR: dir,
    }, {
      generatedAt: "2026-04-21T12:00:00.000Z",
    });
    assert.strictEqual(report.ok, true);
    assert.strictEqual(report.reason, "V2_REPAIR_FIRESTORE_CANARY_READY_FOR_LIVE_PREFLIGHT");
    assert.strictEqual(report.source_streak_file, streakFile);
    assert.strictEqual(report.auto_apply, false);
    assert.strictEqual(report.mutates_environment, false);
    assert.deepStrictEqual(report.blockers, []);
    assert.deepStrictEqual(
      report.required_env_changes.map((row) => `${row.name}=${row.value}`),
      [
        "DONBEOLJA_V2_REPAIR_LIVE_ENABLE_REQUESTED=1",
        "DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_REQUIRED=1",
        "DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_REQUIRED=1",
        "DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_REQUIRED=1",
      ]
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
})();

(function outputFileUsesDedicatedCutoverArtifactName() {
  const dir = "/tmp/dbj-v2-live-cutover-output";
  const outputFile = checker.resolveOutputFile({
    DONBEOLJA_V2_REPAIR_LIVE_CUTOVER_ARTIFACT_DIR: dir,
  });
  assert.strictEqual(outputFile, path.join(dir, "v2_repair_live_cutover_readiness_latest.json"));
})();

console.log("CHECK_V2_REPAIR_LIVE_CUTOVER_READINESS_TEST_OK");
