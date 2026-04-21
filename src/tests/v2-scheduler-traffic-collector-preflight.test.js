"use strict";

const assert = require("assert");
const preflight = require("../v2/schedulerTrafficCollectorPreflight");
const script = require("../../scripts/check-v2-scheduler-traffic-collector-prereq");

function buildRunService(name) {
  return {
    template: {
      spec: {
        containers: [
          {
            env: [
              { name: "SCHEDULER_AUTOSTART", value: "0" },
              { name: "DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE", value: "OPENCLAW_CRON" },
            ],
          },
        ],
      },
    },
    status: {
      latestReadyRevisionName: `${name}-rev-0001`,
      conditions: [{ type: "Ready", status: "True" }],
      traffic: [{ revisionName: `${name}-rev-0001`, latestRevision: true, percent: 100 }],
    },
  };
}

function fakeExecFactory({ failSchedulerList = false, failRunService = null } = {}) {
  return (cmd, args) => {
    assert.strictEqual(cmd, "gcloud");
    const joined = args.join(" ");
    if (joined === "config get-value project") return "donbeolja-dev\n";
    if (joined.includes("scheduler jobs list")) {
      if (failSchedulerList) {
        const error = new Error("PERMISSION_DENIED: cloudscheduler.jobs.list");
        error.code = "PERMISSION_DENIED";
        throw error;
      }
      return JSON.stringify([]);
    }
    if (joined.includes("run services describe")) {
      const serviceName = joined.includes("donbeolja-exit-worker") ? "donbeolja-exit-worker" : "donbeolja";
      if (failRunService === serviceName) {
        const error = new Error(`PERMISSION_DENIED: run.services.get ${serviceName}`);
        error.code = "PERMISSION_DENIED";
        throw error;
      }
      return JSON.stringify(buildRunService(serviceName));
    }
    throw new Error(`UNEXPECTED_GCLOUD:${joined}`);
  };
}

(function preflightPassesWhenCollectorCanReadSchedulerAndRunServices() {
  const report = preflight.runV2SchedulerTrafficCollectorPreflight({
    env: { GOOGLE_CLOUD_PROJECT: "donbeolja-dev" },
    execFileSync: fakeExecFactory(),
  });
  assert.strictEqual(report.ok, true);
  assert.strictEqual(report.reason, "V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_PASS");
  assert.strictEqual(report.fail_n, 0);
  assert.strictEqual(report.check_n, 4);
})();

(function preflightBlocksWithExactSchedulerPermissionCheck() {
  const report = preflight.runV2SchedulerTrafficCollectorPreflight({
    env: { GOOGLE_CLOUD_PROJECT: "donbeolja-dev" },
    execFileSync: fakeExecFactory({ failSchedulerList: true }),
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.failed_check_ids.includes("SCHED_TRAFFIC_COLLECTOR_PREREQ_02_SCHEDULER_JOBS_LIST"));
})();

(function preflightBlocksWithExactRunServicePermissionCheck() {
  const report = script.runCheck({ GOOGLE_CLOUD_PROJECT: "donbeolja-dev" }, {
    execFileSync: fakeExecFactory({ failRunService: "donbeolja-exit-worker" }),
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.failed_check_ids.includes("SCHED_TRAFFIC_COLLECTOR_PREREQ_03_RUN_SERVICE_DESCRIBE_DONBEOLJA_EXIT_WORKER"));
})();

console.log("V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_TEST_OK");
