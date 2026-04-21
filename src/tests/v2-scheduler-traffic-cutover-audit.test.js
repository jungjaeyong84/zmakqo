"use strict";

const assert = require("assert");
const audit = require("../v2/schedulerTrafficCutoverAudit");
const checkScript = require("../../scripts/check-v2-scheduler-traffic-cutover");

function buildPassingState() {
  return {
    scheduler_sot: "OPENCLAW_CRON",
    openclaw_cron_jobs: [
      { job_id: "binance_exit_integrity_cycle", enabled: true },
      { job_id: "openclaw_hourly_cycle", enabled: true },
      { job_id: "v2_repair_queue_service", enabled: true },
      { job_id: "openclaw_daily_cycle", enabled: true },
    ],
    legacy_scheduler_jobs: [
      { label: "com.jaeyong.donbeolja.tick", enabled: false, active: false, target: "/scheduler/tick" },
    ],
    cloud_run_services: [
      {
        name: "donbeolja",
        traffic_percent: 100,
        latest_revision_ready: true,
        env: {
          SCHEDULER_AUTOSTART: "0",
          DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE: "OPENCLAW_CRON",
        },
      },
      {
        name: "donbeolja-exit-worker",
        traffic_percent: 100,
        latest_revision_ready: true,
        env: {
          SCHEDULER_AUTOSTART: "0",
          DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE: "OPENCLAW_CRON",
        },
      },
    ],
  };
}

(function passingStateProvesOpenClawSchedulerAndTrafficCutover() {
  const report = audit.auditV2SchedulerTrafficCutoverReadiness({
    DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON: JSON.stringify(buildPassingState()),
  });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.reason, "V2_SCHEDULER_TRAFFIC_CUTOVER_READINESS_PASS");
  assert.strictEqual(report.scope, "scheduler_traffic_cutover");
  assert.strictEqual(report.fail_n, 0);
  assert.strictEqual(report.check_n, 7);
  assert.deepStrictEqual(report.failed_check_ids, []);
  assert.deepStrictEqual(report.missing_openclaw_job_ids, []);
  assert.deepStrictEqual(report.active_legacy_scheduler_jobs, []);
})();

(function missingStateFailsClosed() {
  const report = audit.auditV2SchedulerTrafficCutoverReadiness({});
  assert.strictEqual(report.ok, false);
  assert.strictEqual(report.reason, "V2_SCHEDULER_TRAFFIC_CUTOVER_READINESS_BLOCKED");
  assert.ok(report.failed_check_ids.includes("SCHED_TRAFFIC_CHK_01"));
})();

(function activeLegacyTickAndBadTrafficFailClosed() {
  const state = buildPassingState();
  state.legacy_scheduler_jobs = [
    { label: "com.jaeyong.donbeolja.tick", active: true, target: "/scheduler/tick" },
  ];
  state.cloud_run_services[0].traffic_percent = 50;
  state.cloud_run_services[1].env.SCHEDULER_AUTOSTART = "1";
  const report = audit.auditV2SchedulerTrafficCutoverReadiness({
    DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON: JSON.stringify(state),
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.failed_check_ids.includes("SCHED_TRAFFIC_CHK_04"));
  assert.ok(report.failed_check_ids.includes("SCHED_TRAFFIC_CHK_05"));
  assert.ok(report.failed_check_ids.includes("SCHED_TRAFFIC_CHK_07"));
  assert.strictEqual(report.active_legacy_scheduler_jobs.length, 1);
})();

(function checkScriptWritesArtifact() {
  const report = checkScript.runCheck({
    DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON: JSON.stringify(buildPassingState()),
  });
  assert.strictEqual(report.ok, true);
})();

console.log("V2_SCHEDULER_TRAFFIC_CUTOVER_AUDIT_TEST_OK");
