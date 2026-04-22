"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const checker = require("../../scripts/check-v2-exit-runtime-canary-streak");

function buildHealthyPayload(generatedAt) {
  return {
    ok: true,
    reason: "V2_EXIT_RUNTIME_CANARY_PASS",
    scope: "exit_runtime_canary",
    canary_mode: "LIVE_EXIT_RUNTIME_OBSERVATION",
    exchange_write_performed: false,
    generated_at: generatedAt,
    position_cycle_id: "PCY__EXIT_RUNTIME__CANARY",
    active_position_n: 2,
    tp1_missing_n: 0,
    native_refresh_unhealthy_n: 0,
    unprotected_window_violation_n: 0,
    alert_silent_drop_n: 0,
    trail_activation_evidence_gap_n: 0,
    fail_n: 0,
    failed_check_ids: [],
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

function buildFakeDb(rows) {
  return {
    collection(name) {
      return {
        where(field, op, value) {
          return {
            limit(limit) {
              return {
                async get() {
                  return {
                    docs: rows
                      .map((payload) => ({
                        exit_runtime_canary_id: `ERTCHV2__${payload.generated_at}`,
                        generated_at_ms: Date.parse(payload.generated_at),
                        artifact_snapshot: payload,
                      }))
                      .filter((doc) => op === ">=" && Number(doc[field]) >= Number(value))
                      .slice(0, limit)
                      .map((doc) => ({ data: () => ({ ...doc }) })),
                  };
                },
              };
            },
          };
        },
      };
    },
  };
}

(function streakPassesWithContinuousHealthyCoverage() {
  const nowMs = Date.parse("2026-04-22T12:00:00.000Z");
  const rows = [];
  for (let hour = 24; hour >= 0; hour -= 2) {
    rows.push(buildHealthyPayload(new Date(nowMs - hour * 60 * 60000).toISOString()));
  }
  const report = checker.evaluateExitRuntimeCanaryStreak({
    history: buildHistory(rows),
    config: {
      lookbackHours: 24,
      minRunCount: 12,
      maxGapMinutes: 180,
    },
    nowMs,
    historyFile: "/tmp/exit-runtime-history.jsonl",
    historySource: "FIRESTORE",
  });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.reason, "V2_EXIT_RUNTIME_CANARY_STREAK_PASS");
  assert.strictEqual(report.generated_at, "2026-04-22T12:00:00.000Z");
  assert.strictEqual(report.position_cycle_id, "PCY__EXIT_RUNTIME__CANARY");
  assert.strictEqual(report.position_cycle_id_n, 1);
  assert.strictEqual(report.healthy_run_n, 13);
  assert.strictEqual(report.coverage_minutes, 1440);
  assert.strictEqual(report.tp1_missing_n, 0);
  assert.strictEqual(report.native_refresh_unhealthy_n, 0);
  assert.strictEqual(report.unprotected_window_violation_n, 0);
  assert.strictEqual(report.alert_silent_drop_n, 0);
  assert.strictEqual(report.trail_activation_evidence_gap_n, 0);
  assert.strictEqual(report.firestore_source_required, false);
  assert.strictEqual(report.collector_execution_summary.status, "PASS");
  assert.strictEqual(report.collector_execution_summary.scheduler_job_id, "v2_exit_runtime_canary");
  assert.strictEqual(report.collector_execution_summary.producer_script, "run-v2-exit-runtime-canary");
  assert.strictEqual(report.collector_execution_summary.history_source, "FIRESTORE");
  assert.strictEqual(report.collector_execution_summary.exchange_write_performed, false);
  assert.strictEqual(report.long_run_quality_summary.status, "PASS");
  assert.strictEqual(report.long_run_quality_summary.defect_counts.tp1_missing_n, 0);
  assert.strictEqual(report.long_run_quality_summary.defect_counts.trail_activation_evidence_gap_n, 0);
  assert.strictEqual(report.long_run_quality_summary.coverage_minutes, 1440);
  assert.deepStrictEqual(report.blockers, []);
})();

(function streakFailsOnTrailActivationEvidenceGap() {
  const nowMs = Date.parse("2026-04-22T12:00:00.000Z");
  const rows = [];
  for (let hour = 24; hour >= 0; hour -= 2) {
    rows.push(buildHealthyPayload(new Date(nowMs - hour * 60 * 60000).toISOString()));
  }
  rows[5] = {
    ...rows[5],
    ok: false,
    reason: "V2_EXIT_RUNTIME_CANARY_BLOCKED",
    trail_activation_evidence_gap_n: 1,
    fail_n: 1,
    failed_check_ids: ["EXIT_RUNTIME_CANARY_TRAIL_ACTIVATION_EVIDENCE_PRESENT"],
  };
  const report = checker.evaluateExitRuntimeCanaryStreak({
    history: buildHistory(rows),
    config: {
      lookbackHours: 24,
      minRunCount: 12,
      maxGapMinutes: 180,
    },
    nowMs,
  });
  assert.strictEqual(report.ok, false);
  assert.strictEqual(report.trail_activation_evidence_gap_n, 1);
  assert.ok(report.blockers.includes("EXIT_RUNTIME_CANARY_STREAK:TRAIL_ACTIVATION_EVIDENCE_GAP"));
  assert.strictEqual(report.long_run_quality_summary.defect_counts.trail_activation_evidence_gap_n, 1);
})();

(function streakFailsOnTp1MissingEvidence() {
  const nowMs = Date.parse("2026-04-22T12:00:00.000Z");
  const rows = [];
  for (let hour = 24; hour >= 0; hour -= 2) {
    rows.push(buildHealthyPayload(new Date(nowMs - hour * 60 * 60000).toISOString()));
  }
  rows[6] = {
    ...rows[6],
    ok: false,
    reason: "V2_EXIT_RUNTIME_CANARY_BLOCKED",
    tp1_missing_n: 1,
    fail_n: 1,
    failed_check_ids: ["EXIT_RUNTIME_CANARY_TP1_ORDER_MISSING"],
  };
  const report = checker.evaluateExitRuntimeCanaryStreak({
    history: buildHistory(rows),
    config: {
      lookbackHours: 24,
      minRunCount: 12,
      maxGapMinutes: 180,
    },
    nowMs,
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.blockers.includes("EXIT_RUNTIME_CANARY_STREAK:UNHEALTHY_ROW_IN_WINDOW"));
  assert.ok(report.blockers.includes("EXIT_RUNTIME_CANARY_STREAK:TP1_MISSING"));
  assert.strictEqual(report.long_run_quality_summary.status, "BLOCKED");
  assert.strictEqual(report.long_run_quality_summary.defect_counts.tp1_missing_n, 1);
})();

(function streakRequiresFirestoreWhenLiveEvidenceModeIsArmed() {
  const nowMs = Date.parse("2026-04-22T12:00:00.000Z");
  const rows = [];
  for (let hour = 24; hour >= 0; hour -= 2) {
    rows.push(buildHealthyPayload(new Date(nowMs - hour * 60 * 60000).toISOString()));
  }
  const report = checker.evaluateExitRuntimeCanaryStreak({
    history: buildHistory(rows),
    config: {
      lookbackHours: 24,
      minRunCount: 12,
      maxGapMinutes: 180,
      requireFirestoreSource: true,
    },
    nowMs,
    historyFile: "/tmp/exit-runtime-history.jsonl",
    historySource: "JSONL",
  });
  assert.strictEqual(report.ok, false);
  assert.strictEqual(report.firestore_source_required, true);
  assert.strictEqual(report.collector_execution_summary.status, "BLOCKED");
  assert.strictEqual(report.collector_execution_summary.firestore_source_required, true);
  assert.strictEqual(report.long_run_quality_summary.firestore_source_required, true);
  assert.ok(report.blockers.includes("EXIT_RUNTIME_CANARY_STREAK:FIRESTORE_SOURCE_REQUIRED"));
})();

(function parserReportsInvalidJsonl() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-exit-runtime-streak-"));
  try {
    const filePath = path.join(dir, "history.jsonl");
    fs.writeFileSync(filePath, `${JSON.stringify(buildHealthyPayload("2026-04-22T12:00:00.000Z"))}\n{bad-json}\n`, "utf8");
    const parsed = checker.parseHistoryFile(filePath);
    assert.strictEqual(parsed.rows.length, 1);
    assert.strictEqual(parsed.invalid_lines.length, 1);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function helperDefaultsStayStable() {
  assert.ok(checker.__test.resolveHistoryFile({}).endsWith("v2_exit_runtime_canary_history.jsonl"));
  assert.ok(checker.__test.resolveOutputFile({}).endsWith("v2_exit_runtime_canary_streak_latest.json"));
  assert.strictEqual(checker.__test.resolveStreakConfig({}).lookbackHours, 24);
  assert.strictEqual(checker.__test.resolveStreakConfig({ DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE: "1" }).requireFirestoreSource, true);
  assert.strictEqual(checker.__test.resolveHistorySource({}), "JSONL");
  assert.strictEqual(checker.__test.resolveHistorySource({ DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED: "1" }), "FIRESTORE");
})();

async function streakCanReadFirestoreHistorySource() {
  const nowMs = Date.parse("2026-04-22T12:00:00.000Z");
  const rows = [];
  for (let hour = 24; hour >= 0; hour -= 2) {
    rows.push(buildHealthyPayload(new Date(nowMs - hour * 60 * 60000).toISOString()));
  }
  const report = await checker.runCheck({
    DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
    DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE: "firestore",
    DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_LOOKBACK_HOURS: "24",
    DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_MIN_RUNS: "12",
    DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_MAX_GAP_MINUTES: "180",
  }, {
    nowMs,
    db: buildFakeDb(rows),
  });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.history_source, "FIRESTORE");
  assert.strictEqual(report.history_file, "dbjv2__exit_runtime_canaries_v2");
  assert.strictEqual(report.healthy_run_n, 13);
}

streakCanReadFirestoreHistorySource()
  .then(() => {
    console.log("CHECK_V2_EXIT_RUNTIME_CANARY_STREAK_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
