"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-openclaw-hourly-cycle");
const { __test: trailRunnerFloorAuditTest } = require("../../scripts/report-trail-runner-floor-audit");

(() => {
  const registry = __test.buildStepRegistry();
  assert.ok(Array.isArray(registry));
  assert.strictEqual(registry.length, 12);

  const ids = registry.map((row) => row.id);
  assert.deepStrictEqual(ids, [
    "analytics_local_cache",
    "execution_quality",
    "signal_lineage_health",
    "openclaw_policy_authority",
    "doc_artifact_parity",
    "server_signal_drift_remediation_plan",
    "server_signal_drift_remediation_apply",
    "server_signal_post_remediation_refresh",
    "automation_watchdog",
    "self_evolution_loop",
    "current_version_pine_sync",
    "hourly_overall_report",
  ]);

  const applyStep = registry.find((row) => row.id === "server_signal_drift_remediation_apply");
  assert.deepStrictEqual(applyStep.depends_on, ["server_signal_drift_remediation_plan"]);
  assert.strictEqual(applyStep.produces_artifact, "server_signal_drift_remediation_apply_latest.json");

  const watchdogStep = registry.find((row) => row.id === "automation_watchdog");
  assert.deepStrictEqual(watchdogStep.depends_on, ["server_signal_post_remediation_refresh"]);
  assert.strictEqual(watchdogStep.produces_artifact, "automation_watchdog_latest.json");

  const overallReportStep = registry.find((row) => row.id === "hourly_overall_report");
  assert.deepStrictEqual(overallReportStep.depends_on, ["current_version_pine_sync"]);
  assert.strictEqual(overallReportStep.produces_artifact, "hourly_overall_report_latest.json");

  const result = __test.toStepResult(
    {
      id: "x",
      criticality: "HIGH",
      depends_on: ["a"],
      produces_artifact: "foo.json",
    },
    {
      status: "PASS",
      summary: "OK",
      reason: "DONE",
    },
    {
      runId: "run-1",
      durationMs: 12,
    }
  );
  assert.deepStrictEqual(result, {
    id: "x",
    status: "PASS",
    summary: "OK",
    reason: "DONE",
    run_id: "run-1",
    duration_ms: 12,
    criticality: "HIGH",
    depends_on: ["a"],
    produces_artifact: "foo.json",
  });

  const executed = __test.executeStep(
    {
      id: "y",
      criticality: "MEDIUM",
      depends_on: [],
      produces_artifact: null,
      run() {
        return {
          status: "PASS",
          summary: "OK",
          reason: "INLINE_DONE",
        };
      },
    },
    { runId: "run-2" }
  );
  assert.strictEqual(executed.run_id, "run-2");
  assert.strictEqual(executed.reason, "INLINE_DONE");
  assert.ok(Number.isFinite(executed.duration_ms));

  const cliResult = trailRunnerFloorAuditTest.buildCliResult(
    {
      candidate_rows: 3,
      violation_n: 1,
      violation_total_n: 2,
      live_bar_runner_violation_n: 1,
      live_bar_runner_violation_total_n: 1,
    },
    "/tmp/trail_runner_floor_audit_latest.json",
    "/tmp/2026-04-12_trail_runner_floor_audit.md"
  );
  assert.deepStrictEqual(cliResult, {
    ok: true,
    status: "WARN",
    reason: "RUNNER_FLOOR_VIOLATIONS_PRESENT",
    candidate_rows: 3,
    violation_n: 1,
    violation_total_n: 2,
    live_bar_runner_violation_n: 1,
    live_bar_runner_violation_total_n: 1,
    jsonPath: "/tmp/trail_runner_floor_audit_latest.json",
    mdPath: "/tmp/2026-04-12_trail_runner_floor_audit.md",
  });

  console.log("AUTOMATION_OPENCLAW_HOURLY_CYCLE_TEST_OK");
})();
