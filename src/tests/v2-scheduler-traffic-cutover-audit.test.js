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
    openclaw_cloud_scheduler_jobs: [
      {
        job_id: "openclaw_agent_calibration",
        scheduler_name: "openclaw-calibration",
        enabled: true,
        criticality: "HIGH",
        state: "ENABLED",
        expected_http_path: "/api/openclaw/cron/calibration",
        actual_http_path: "/api/openclaw/cron/calibration",
        path_match: true,
        expected_schedule: "15 6 * * *",
        actual_schedule: "15 6 * * *",
        schedule_match: true,
        expected_time_zone: "Asia/Seoul",
        actual_time_zone: "Asia/Seoul",
        time_zone_match: true,
      },
      {
        job_id: "v2_production_entry_route_canary",
        scheduler_name: "v2-production-entry-route-canary",
        enabled: true,
        criticality: "HIGH",
        state: "ENABLED",
        expected_http_path: "/api/openclaw/cron/v2-production-entry-route-canary",
        actual_http_path: "/api/openclaw/cron/v2-production-entry-route-canary",
        path_match: true,
        expected_schedule: "5 * * * *",
        actual_schedule: "5 * * * *",
        schedule_match: true,
        expected_time_zone: "Asia/Seoul",
        actual_time_zone: "Asia/Seoul",
        time_zone_match: true,
      },
      {
        job_id: "v2_exit_runtime_canary",
        scheduler_name: "v2-exit-runtime-canary",
        enabled: true,
        criticality: "HIGH",
        state: "ENABLED",
        expected_http_path: "/api/openclaw/cron/v2-exit-runtime-canary",
        actual_http_path: "/api/openclaw/cron/v2-exit-runtime-canary",
        path_match: true,
        expected_schedule: "35 * * * *",
        actual_schedule: "35 * * * *",
        schedule_match: true,
        expected_time_zone: "Asia/Seoul",
        actual_time_zone: "Asia/Seoul",
        time_zone_match: true,
      },
      {
        job_id: "v2_active_protection_reconciliation",
        scheduler_name: "v2-active-protection-reconciliation",
        enabled: true,
        criticality: "HIGH",
        state: "ENABLED",
        expected_http_path: "/api/openclaw/cron/v2-active-protection-reconciliation",
        actual_http_path: "/api/openclaw/cron/v2-active-protection-reconciliation",
        path_match: true,
        expected_schedule: "0 * * * *",
        actual_schedule: "0 * * * *",
        schedule_match: true,
        expected_time_zone: "Asia/Seoul",
        actual_time_zone: "Asia/Seoul",
        time_zone_match: true,
      },
      {
        job_id: "openclaw_server_primary_tick",
        scheduler_name: "openclaw-server-primary-tick",
        enabled: true,
        criticality: "HIGH",
        state: "ENABLED",
        expected_http_path: "/api/openclaw/cron/openclaw-server-primary-tick",
        actual_http_path: "/api/openclaw/cron/openclaw-server-primary-tick",
        path_match: true,
        expected_schedule: "1,16,31,46 * * * *",
        actual_schedule: "1,16,31,46 * * * *",
        schedule_match: true,
        expected_time_zone: "Asia/Seoul",
        actual_time_zone: "Asia/Seoul",
        time_zone_match: true,
      },
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
  assert.ok(report.required_openclaw_job_ids.includes("v2_exit_runtime_canary"));
  assert.ok(report.openclaw_cloud_scheduler_jobs.some((job) => job.job_id === "v2_exit_runtime_canary" && job.path_match === true));
  assert.ok(report.required_openclaw_job_ids.includes("v2_active_protection_reconciliation"));
  assert.ok(report.openclaw_cloud_scheduler_jobs.some((job) => job.job_id === "v2_active_protection_reconciliation" && job.path_match === true));
  assert.ok(report.required_openclaw_job_ids.includes("openclaw_server_primary_tick"));
  assert.ok(report.openclaw_cloud_scheduler_jobs.some((job) => job.job_id === "openclaw_server_primary_tick" && job.path_match === true));
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

(function missingCloudSchedulerCanaryFailsClosed() {
  const state = buildPassingState();
  state.openclaw_cloud_scheduler_jobs = state.openclaw_cloud_scheduler_jobs.filter((job) => job.job_id !== "openclaw_server_primary_tick");
  const report = audit.auditV2SchedulerTrafficCutoverReadiness({
    DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON: JSON.stringify(state),
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.failed_check_ids.includes("SCHED_TRAFFIC_CHK_03"));
  assert.ok(report.missing_openclaw_job_ids.includes("openclaw_server_primary_tick"));
})();

(function wrongCloudSchedulerPathFailsClosed() {
  const state = buildPassingState();
  const job = state.openclaw_cloud_scheduler_jobs.find((row) => row.job_id === "openclaw_server_primary_tick");
  job.enabled = false;
  job.actual_http_path = "/api/openclaw/cron/wrong";
  job.path_match = false;
  const report = audit.auditV2SchedulerTrafficCutoverReadiness({
    DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON: JSON.stringify(state),
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.missing_openclaw_job_ids.includes("openclaw_server_primary_tick"));
  assert.strictEqual(report.openclaw_cloud_scheduler_jobs.find((row) => row.job_id === "openclaw_server_primary_tick").path_match, false);
})();

(function checkScriptWritesArtifact() {
  const report = checkScript.runCheck({
    DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON: JSON.stringify(buildPassingState()),
  });
  assert.strictEqual(report.ok, true);
})();

console.log("V2_SCHEDULER_TRAFFIC_CUTOVER_AUDIT_TEST_OK");
