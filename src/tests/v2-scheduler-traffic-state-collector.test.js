"use strict";

const assert = require("assert");
const collector = require("../v2/schedulerTrafficStateCollector");
const checkScript = require("../../scripts/check-v2-scheduler-traffic-cutover");

function buildRunService(name, { autostart = "0", cutoverMode = "OPENCLAW_CRON", trafficPercent = 100, ready = true } = {}) {
  return {
    metadata: { name },
    template: {
      spec: {
        containers: [
          {
            env: [
              { name: "SCHEDULER_AUTOSTART", value: autostart },
              { name: "DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE", value: cutoverMode },
            ],
          },
        ],
      },
    },
    status: {
      latestReadyRevisionName: `${name}-rev-0001`,
      conditions: ready ? [{ type: "Ready", status: "True" }] : [{ type: "Ready", status: "False" }],
      traffic: [{ revisionName: `${name}-rev-0001`, latestRevision: true, percent: trafficPercent }],
    },
  };
}

function buildCloudSchedulerJobs({ legacyScheduler = false, missingServerPrimaryTick = false } = {}) {
  const rows = [
    {
      name: "projects/p/locations/asia-northeast3/jobs/openclaw-calibration",
      state: "ENABLED",
      schedule: "15 6 * * *",
      timeZone: "Asia/Seoul",
      httpTarget: { uri: "https://donbeolja.run.app/api/openclaw/cron/calibration" },
    },
    {
      name: "projects/p/locations/asia-northeast3/jobs/v2-production-entry-route-canary",
      state: "ENABLED",
      schedule: "5 * * * *",
      timeZone: "Asia/Seoul",
      httpTarget: { uri: "https://donbeolja.run.app/api/openclaw/cron/v2-production-entry-route-canary" },
    },
    {
      name: "projects/p/locations/asia-northeast3/jobs/v2-exit-runtime-canary",
      state: "ENABLED",
      schedule: "35 * * * *",
      timeZone: "Asia/Seoul",
      httpTarget: { uri: "https://donbeolja.run.app/api/openclaw/cron/v2-exit-runtime-canary" },
    },
    {
      name: "projects/p/locations/asia-northeast3/jobs/v2-active-protection-reconciliation",
      state: "ENABLED",
      schedule: "0 * * * *",
      timeZone: "Asia/Seoul",
      httpTarget: { uri: "https://donbeolja.run.app/api/openclaw/cron/v2-active-protection-reconciliation" },
    },
    {
      name: "projects/p/locations/asia-northeast3/jobs/v2-fill-sync",
      state: "ENABLED",
      schedule: "*/5 * * * *",
      timeZone: "Asia/Seoul",
      httpTarget: { uri: "https://donbeolja.run.app/api/openclaw/cron/v2-fill-sync" },
    },
    {
      name: "projects/p/locations/asia-northeast3/jobs/v2-performance-evidence-cycle",
      state: "ENABLED",
      schedule: "10 * * * *",
      timeZone: "Asia/Seoul",
      httpTarget: { uri: "https://donbeolja.run.app/api/openclaw/cron/v2-performance-evidence-cycle" },
    },
    {
      name: "projects/p/locations/asia-northeast3/jobs/openclaw-server-primary-tick",
      state: "ENABLED",
      schedule: "1,16,31,46 * * * *",
      timeZone: "Asia/Seoul",
      httpTarget: { uri: "https://donbeolja.run.app/api/openclaw/cron/openclaw-server-primary-tick" },
    },
  ].filter((job) => !(missingServerPrimaryTick && job.name.endsWith("/openclaw-server-primary-tick")));
  if (legacyScheduler) {
    rows.push({
      name: "projects/p/locations/asia-northeast3/jobs/donbeolja-tick",
      state: "ENABLED",
      httpTarget: { uri: "https://example.com/scheduler/tick" },
    });
  }
  return rows;
}

function fakeExecFactory({ legacyScheduler = false, badTraffic = false, expectPath = false, missingServerPrimaryTick = false } = {}) {
  return (cmd, args, options = {}) => {
    assert.strictEqual(cmd, "gcloud");
    if (expectPath) assert.strictEqual(options.env.PATH, "/bin:/usr/bin");
    const joined = args.join(" ");
    if (joined === "config get-value project") return "donbeolja-dev\n";
    if (joined.includes("scheduler jobs list")) {
      return JSON.stringify(buildCloudSchedulerJobs({ legacyScheduler, missingServerPrimaryTick }));
    }
    if (joined.includes("run services describe donbeolja-exit-worker")) {
      return JSON.stringify(buildRunService("donbeolja-exit-worker"));
    }
    if (joined.includes("run services describe donbeolja")) {
      return JSON.stringify(buildRunService("donbeolja", { trafficPercent: badTraffic ? 50 : 100 }));
    }
    throw new Error(`UNEXPECTED_GCLOUD:${joined}`);
  };
}

(function collectorBuildsPassingStateFromGcloudAndManifest() {
  const state = collector.collectV2SchedulerTrafficState({
    env: { GOOGLE_CLOUD_PROJECT: "donbeolja-dev" },
    execFileSync: fakeExecFactory(),
  });
  assert.strictEqual(state.scheduler_sot, "OPENCLAW_CRON");
  assert.strictEqual(state.project_id, "donbeolja-dev");
  assert.strictEqual(state.region, "asia-northeast3");
  assert.strictEqual(state.cloud_run_services.length, 2);
  assert.ok(state.openclaw_cron_jobs.some((job) => job.job_id === "v2_repair_queue_service" && job.enabled === true));
  assert.ok(state.openclaw_cloud_scheduler_jobs.some((job) => job.job_id === "v2_exit_runtime_canary" && job.enabled === true));
  assert.ok(state.openclaw_cloud_scheduler_jobs.some((job) => job.job_id === "v2_active_protection_reconciliation" && job.enabled === true));
  assert.ok(state.openclaw_cloud_scheduler_jobs.some((job) => job.job_id === "v2_fill_sync" && job.enabled === true));
  assert.ok(state.openclaw_cloud_scheduler_jobs.some((job) => job.job_id === "v2_performance_evidence_cycle" && job.enabled === true));
  assert.ok(state.openclaw_cloud_scheduler_jobs.some((job) => job.job_id === "openclaw_server_primary_tick" && job.enabled === true));
  assert.deepStrictEqual(state.legacy_scheduler_jobs, []);
})();

(function collectorKeepsLegacySchedulerEvidenceForAudit() {
  const state = collector.collectV2SchedulerTrafficState({
    env: { GOOGLE_CLOUD_PROJECT: "donbeolja-dev" },
    execFileSync: fakeExecFactory({ legacyScheduler: true }),
  });
  assert.strictEqual(state.legacy_scheduler_jobs.length, 1);
  assert.strictEqual(state.legacy_scheduler_jobs[0].name, "donbeolja-tick");
})();

(function collectorPreservesProcessEnvForGcloudPathLookup() {
  const originalPath = process.env.PATH;
  process.env.PATH = "/bin:/usr/bin";
  try {
    const state = collector.collectV2SchedulerTrafficState({
      env: { GOOGLE_CLOUD_PROJECT: "donbeolja-dev", DONBEOLJA_V2_ONLY: "1" },
      execFileSync: fakeExecFactory({ expectPath: true }),
    });
    assert.strictEqual(state.project_id, "donbeolja-dev");
  } finally {
    process.env.PATH = originalPath;
  }
})();

(function readinessScriptAutoCollectsWhenInlineStateIsMissing() {
  const report = checkScript.runCheck({ GOOGLE_CLOUD_PROJECT: "donbeolja-dev" }, {
    execFileSync: fakeExecFactory(),
  });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.reason, "V2_SCHEDULER_TRAFFIC_CUTOVER_READINESS_PASS");
})();

(function readinessScriptAutoCollectFailClosesOnBadTraffic() {
  const report = checkScript.runCheck({ GOOGLE_CLOUD_PROJECT: "donbeolja-dev" }, {
    execFileSync: fakeExecFactory({ badTraffic: true }),
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.failed_check_ids.includes("SCHED_TRAFFIC_CHK_07"));
})();

(function readinessScriptFailsWhenRequiredCloudSchedulerTickIsMissing() {
  const report = checkScript.runCheck({ GOOGLE_CLOUD_PROJECT: "donbeolja-dev" }, {
    execFileSync: fakeExecFactory({ missingServerPrimaryTick: true }),
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.failed_check_ids.includes("SCHED_TRAFFIC_CHK_03"));
  assert.ok(report.missing_openclaw_job_ids.includes("openclaw_server_primary_tick"));
})();

console.log("V2_SCHEDULER_TRAFFIC_STATE_COLLECTOR_TEST_OK");
