"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-automation-watchdog");

(() => {
  const artifactNames = __test.ARTIFACT_SPECS.map((row) => row.name);
  assert.ok(artifactNames.includes("openclaw_hourly_cycle"));
  assert.ok(artifactNames.includes("v2_repair_queue_canary"));
  assert.ok(artifactNames.includes("v2_repair_queue_operational_canary"));
  assert.ok(artifactNames.includes("v2_repair_queue_canary_preflight"));
  assert.ok(artifactNames.includes("v2_repair_queue_service"));
  assert.ok(artifactNames.includes("openclaw_daily_cycle"));
  assert.ok(!artifactNames.includes("rollback_monitor"));
  assert.ok(!artifactNames.includes("signal_data_integrity"));
  assert.ok(!artifactNames.includes("stage_outcome_ledgers"));
  assert.ok(!artifactNames.includes("ml_filter_policy"));

  assert.ok(__test.AUTOMATION_SPECS.length >= 4);
  const hourlySpec = __test.AUTOMATION_SPECS.find((row) => row.job_id === "openclaw_hourly_cycle");
  assert.ok(hourlySpec);
  assert.strictEqual(hourlySpec.produces_artifact, "openclaw_hourly_cycle_latest.json");
  assert.strictEqual(hourlySpec.scheduler_sot, "OPENCLAW_CRON");
  const repairSpec = __test.AUTOMATION_SPECS.find((row) => row.job_id === "v2_repair_queue_service");
  assert.ok(repairSpec);
  assert.strictEqual(repairSpec.produces_artifact, "v2_repair_queue_service_latest.json");
  assert.strictEqual(repairSpec.severity, "FAIL");

  const rows = __test.parseLaunchctlList([
    "123\t0\tcom.jeongjaeyong.donbeolja.objectivesupervisor",
    "-\t0\tcom.jeongjaeyong.donbeolja.weeklypine",
    "-\t78\tcom.jeongjaeyong.donbeolja.stageautopilot",
  ].join("\n"));
  assert.strictEqual(rows.get("com.jeongjaeyong.donbeolja.objectivesupervisor").pid, 123);
  assert.strictEqual(rows.get("com.jeongjaeyong.donbeolja.weeklypine").lastExit, 0);
  assert.strictEqual(rows.get("com.jeongjaeyong.donbeolja.stageautopilot").lastExit, 78);

  const cronRows = __test.parseOpenClawCronList({
    jobs: [
      {
        id: "job-1",
        name: "donbeolja-objective-supervisor",
        enabled: true,
        state: {
          lastStatus: "ok",
          nextRunAtMs: 12345,
        },
      },
      {
        id: "job-2",
        name: "donbeolja-weekly-pine",
        enabled: false,
        state: {
          lastStatus: "error",
          consecutiveErrors: 2,
        },
      },
    ],
  });
  assert.strictEqual(cronRows.get("donbeolja-objective-supervisor").id, "job-1");

  const schedulerPass = __test.assessSchedulerJob(
    {
      job_id: "objective_supervisor",
      label: "com.jeongjaeyong.donbeolja.objectivesupervisor",
      name: "donbeolja-objective-supervisor",
      produces_artifact: "objective_supervisor_latest.json",
      scheduler_sot: "OPENCLAW_CRON",
      severity: "FAIL",
    },
    cronRows
  );
  assert.strictEqual(schedulerPass.configured, true);
  assert.strictEqual(schedulerPass.enabled, true);
  assert.strictEqual(schedulerPass.issueCode, null);
  assert.strictEqual(schedulerPass.scheduler, "OPENCLAW_CRON");

  const schedulerDisabled = __test.assessSchedulerJob(
    {
      job_id: "weekly_pine",
      label: "com.jeongjaeyong.donbeolja.weeklypine",
      name: "donbeolja-weekly-pine",
      produces_artifact: "weekly_pine_latest.json",
      scheduler_sot: "OPENCLAW_CRON",
      severity: "WARN",
    },
    cronRows
  );
  assert.strictEqual(schedulerDisabled.enabled, false);
  assert.strictEqual(schedulerDisabled.issueCode, "donbeolja-weekly-pine_DISABLED");

  const reconciled = __test.reconcileSchedulerRowsWithArtifacts(
    [
      {
        name: "donbeolja-openclaw-hourly-cycle",
        produces_artifact: "openclaw_hourly_cycle_latest.json",
        issueCode: "donbeolja-openclaw-hourly-cycle_STATUS_ERROR",
        issueSeverity: "WARN",
      },
    ],
    [
      {
        name: "openclaw_hourly_cycle",
        fresh: true,
      },
    ]
  );
  assert.strictEqual(reconciled[0].issueCode, null);
  assert.strictEqual(reconciled[0].issueSeverity, null);

  const launchdMissing = __test.assessLaunchdPresence(
    {
      label: "com.jeongjaeyong.donbeolja.rollbackmonitor",
      severity: "FAIL",
    },
    rows
  );
  assert.strictEqual(launchdMissing.loaded, false);
  assert.strictEqual(launchdMissing.issueCode, "com.jeongjaeyong.donbeolja.rollbackmonitor_MISSING");

  const passVerdict = __test.computeVerdict(
    [{ issueSeverity: null }, { issueSeverity: null }],
    [{ issueSeverity: null }]
  );
  assert.strictEqual(passVerdict, "PASS");

  const warnVerdict = __test.computeVerdict(
    [{ issueSeverity: "WARN" }],
    [{ issueSeverity: null }]
  );
  assert.strictEqual(warnVerdict, "WARN");

  const failVerdict = __test.computeVerdict(
    [{ issueSeverity: "WARN" }],
    [{ issueSeverity: "FAIL" }]
  );
  assert.strictEqual(failVerdict, "FAIL");

  const signature = __test.buildIssueSignature(
    [
      { issueSeverity: "WARN", issueCode: "A_STALE" },
      { issueSeverity: null, issueCode: null },
    ],
    [
      { issueSeverity: "FAIL", issueCode: "AGENT_EXIT_1" },
    ]
  );
  assert.strictEqual(signature, "FAIL:AGENT_EXIT_1|WARN:A_STALE");

  assert.strictEqual(__test.normalizeRecoveryMode("recover_and_report"), "RECOVER_AND_REPORT");
  assert.strictEqual(__test.normalizeRecoveryMode("bogus"), "REPORT_ONLY");

  assert.strictEqual(__test.isRecoveryExecutionAllowed("RECOVER_AND_REPORT", "1"), true);
  assert.strictEqual(__test.isRecoveryExecutionAllowed("REPORT_ONLY", "1"), false);
  assert.strictEqual(__test.isRecoveryExecutionAllowed("RECOVER_AND_REPORT", "0"), false);

  const snapshot = __test.buildSnapshot(
    [{ issueSeverity: "WARN", issueCode: "ROW_WARN" }],
    [{ issueSeverity: "FAIL", issueCode: "ROW_FAIL" }]
  );
  assert.strictEqual(snapshot.verdict, "FAIL");
  assert.strictEqual(snapshot.issueCount, 2);
  assert.strictEqual(snapshot.issueSignature, "FAIL:ROW_FAIL|WARN:ROW_WARN");

  const tfSla = __test.computeSchedulerSlaMs({ signalTf: "1h", pollMs: 300000 });
  assert.ok(tfSla >= (60 * 60 * 1000));

  const staleRow = __test.assessSchedulerTickSla({
    ok: true,
    statusCode: 200,
    baseUrl: "http://127.0.0.1:3000",
    data: {
      scheduler: {
        signal_tf: "1h",
        pollMs: 300000,
        running: true,
        lastTick: {
          finished_at: new Date(Date.now() - (3 * 60 * 60 * 1000)).toISOString(),
        },
      },
      runtime: {
        scheduler_managed_externally: false,
      },
    },
  });
  assert.strictEqual(staleRow.issueCode, "SCHEDULER_TICK_STALE");
  assert.strictEqual(staleRow.issueSeverity, "FAIL");
  assert.strictEqual(staleRow.severity, "FAIL");

  const passRow = __test.assessSchedulerTickSla({
    ok: true,
    statusCode: 200,
    baseUrl: "http://127.0.0.1:3000",
    data: {
      scheduler: {
        signal_tf: "1h",
        pollMs: 300000,
        running: true,
        lastTick: {
          finished_at: new Date(Date.now() - (5 * 60 * 1000)).toISOString(),
        },
      },
      runtime: {
        scheduler_managed_externally: false,
      },
    },
  });
  assert.strictEqual(passRow.issueCode, null);
  assert.strictEqual(passRow.severity, "PASS");

  assert.strictEqual(
    __test.shouldMonitorLegacySchedulerTick({
      schedulerMode: "OPENCLAW_CRON",
      env: {},
    }),
    false
  );
  assert.strictEqual(
    __test.shouldMonitorLegacySchedulerTick({
      schedulerMode: "OPENCLAW_CRON",
      env: { AUTOMATION_WATCHDOG_LEGACY_SCHEDULER_TICK_SLA_ENABLED: "1" },
    }),
    true
  );
  assert.strictEqual(
    __test.shouldMonitorLegacySchedulerTick({
      schedulerMode: "LAUNCHD_FALLBACK",
      env: {},
    }),
    true
  );

  const skippedSla = __test.buildSkippedSchedulerTickSla({
    baseUrl: "https://example.invalid",
    reason: "OPENCLAW_CRON",
  });
  assert.strictEqual(skippedSla.issueCode, null);
  assert.strictEqual(skippedSla.severity, "PASS");
  assert.strictEqual(skippedSla.skipped, true);
  assert.strictEqual(skippedSla.skipReason, "LEGACY_SCHEDULER_TICK_SLA_SKIPPED_OPENCLAW_CRON");

  assert.strictEqual(
    __test.shouldAttemptSchedulerRecovery(
      {
        last_scheduler_recovery_attempt_ms: Date.now(),
        last_scheduler_recovery_issue_signature: "SLA:SCHEDULER_TICK_STALE",
      },
      "SLA:SCHEDULER_TICK_STALE"
    ),
    false
  );

  console.log("AUTOMATION_WATCHDOG_TEST_OK");
})();
