"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { __test } = require("../../scripts/automation-openclaw-hourly-cycle");
const { __test: trailRunnerFloorAuditTest } = require("../../scripts/report-trail-runner-floor-audit");

(() => {
  const registry = __test.buildStepRegistry();
  assert.ok(Array.isArray(registry));
  assert.strictEqual(registry.length, 15);

  const ids = registry.map((row) => row.id);
  assert.deepStrictEqual(ids, [
    "analytics_local_cache",
    "v2_outcome_adjudication_collector",
    "execution_quality",
    "execution_watch_markets",
    "signal_lineage_health",
    "binance_exit_integrity_cycle",
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

  const outcomeCollectorStep = registry.find((row) => row.id === "v2_outcome_adjudication_collector");
  assert.deepStrictEqual(outcomeCollectorStep.depends_on, ["analytics_local_cache"]);
  assert.strictEqual(outcomeCollectorStep.produces_artifact, "v2_openclaw_outcome_adjudication_collector_latest.json");

  const executionQualityStep = registry.find((row) => row.id === "execution_quality");
  assert.deepStrictEqual(executionQualityStep.depends_on, ["v2_outcome_adjudication_collector"]);

  const watchMarketsStep = registry.find((row) => row.id === "execution_watch_markets");
  assert.deepStrictEqual(watchMarketsStep.depends_on, ["execution_quality"]);
  assert.strictEqual(watchMarketsStep.produces_artifact, "best_self_evolution_execution_watch_markets_latest.json");

  const exitIntegrityStep = registry.find((row) => row.id === "binance_exit_integrity_cycle");
  assert.deepStrictEqual(exitIntegrityStep.depends_on, ["signal_lineage_health"]);
  assert.strictEqual(exitIntegrityStep.produces_artifact, "binance_exit_integrity_cycle_latest.json");

  const applyStep = registry.find((row) => row.id === "server_signal_drift_remediation_apply");
  assert.deepStrictEqual(applyStep.depends_on, ["server_signal_drift_remediation_plan"]);
  assert.strictEqual(applyStep.produces_artifact, "server_signal_drift_remediation_apply_latest.json");

  const watchdogStep = registry.find((row) => row.id === "automation_watchdog");
  assert.deepStrictEqual(watchdogStep.depends_on, ["server_signal_post_remediation_refresh"]);
  assert.strictEqual(watchdogStep.produces_artifact, "automation_watchdog_latest.json");

  const authorityStep = registry.find((row) => row.id === "openclaw_policy_authority");
  assert.deepStrictEqual(authorityStep.depends_on, ["signal_lineage_health", "binance_exit_integrity_cycle"]);

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

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "hourly-cycle-"));
  const reportPath = path.join(tmpDir, "binance_exit_integrity_cycle_latest.json");
  fs.writeFileSync(reportPath, `${JSON.stringify({ generated_at: "2026-04-17T00:00:00.000Z" })}\n`, "utf8");
  assert.strictEqual(
    __test.readExitIntegrityCycleGeneratedAtMs(reportPath),
    Date.parse("2026-04-17T00:00:00.000Z")
  );
  assert.deepStrictEqual(
    __test.shouldRunExitIntegrityCycle({
      enabled: false,
      nowMs: Date.parse("2026-04-17T04:00:00.000Z"),
      lastRunMs: Date.parse("2026-04-17T00:00:00.000Z"),
      minIntervalMs: 4 * 60 * 60 * 1000,
    }),
    {
      shouldRun: false,
      reason: "EXIT_INTEGRITY_CYCLE_DISABLED",
      wait_ms: null,
    }
  );
  assert.deepStrictEqual(
    __test.shouldRunExitIntegrityCycle({
      enabled: true,
      force: false,
      nowMs: Date.parse("2026-04-17T02:00:00.000Z"),
      lastRunMs: Date.parse("2026-04-17T00:00:00.000Z"),
      minIntervalMs: 4 * 60 * 60 * 1000,
    }),
    {
      shouldRun: false,
      reason: "EXIT_INTEGRITY_CYCLE_THROTTLED",
      wait_ms: 2 * 60 * 60 * 1000,
    }
  );
  assert.deepStrictEqual(
    __test.shouldRunExitIntegrityCycle({
      enabled: true,
      force: true,
      nowMs: Date.parse("2026-04-17T02:00:00.000Z"),
      lastRunMs: Date.parse("2026-04-17T00:00:00.000Z"),
      minIntervalMs: 4 * 60 * 60 * 1000,
    }),
    {
      shouldRun: true,
      reason: "EXIT_INTEGRITY_CYCLE_FORCED",
      wait_ms: 0,
    }
  );

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
    active_live_violation_n: 0,
    jsonPath: "/tmp/trail_runner_floor_audit_latest.json",
    mdPath: "/tmp/2026-04-12_trail_runner_floor_audit.md",
  });

  console.log("AUTOMATION_OPENCLAW_HOURLY_CYCLE_TEST_OK");
})();
