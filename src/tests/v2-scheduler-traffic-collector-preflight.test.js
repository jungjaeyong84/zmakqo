"use strict";

const assert = require("assert");
const preflight = require("../v2/schedulerTrafficCollectorPreflight");
const script = require("../../scripts/check-v2-scheduler-traffic-collector-prereq");

function buildRunService(name, { omitCutoverMode = false, wrongExitCanaryFirestoreWrite = false } = {}) {
  const env = Object.entries(preflight.REQUIRED_LIVE_COLLECTOR_ENV)
    .filter(([key]) => !(omitCutoverMode && key === "DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE"))
    .map(([key, value]) => ({
      name: key,
      value: wrongExitCanaryFirestoreWrite && key === "DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED"
        ? "0"
        : value,
    }));
  return {
    template: {
      spec: {
        containers: [
          {
            env,
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

function fakeExecFactory({
  failSchedulerList = false,
  failRunService = null,
  omitCutoverModeFor = null,
  wrongExitCanaryFirestoreWriteFor = null,
} = {}) {
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
      return JSON.stringify(buildRunService(serviceName, {
        omitCutoverMode: omitCutoverModeFor === serviceName,
        wrongExitCanaryFirestoreWrite: wrongExitCanaryFirestoreWriteFor === serviceName,
      }));
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
  assert.strictEqual(report.required_env_exact_match_n, 2);
  assert.strictEqual(report.required_env_mismatch_n, 0);
  assert.ok(report.required_env_names.includes("DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE"));
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

(function preflightBlocksWhenSchedulerCutoverEnvIsNotVisible() {
  const report = script.runCheck({ GOOGLE_CLOUD_PROJECT: "donbeolja-dev" }, {
    execFileSync: fakeExecFactory({ omitCutoverModeFor: "donbeolja" }),
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.failed_check_ids.includes("SCHED_TRAFFIC_COLLECTOR_PREREQ_03_RUN_SERVICE_DESCRIBE_DONBEOLJA"));
  const failed = report.checks.find((row) => row.id === "SCHED_TRAFFIC_COLLECTOR_PREREQ_03_RUN_SERVICE_DESCRIBE_DONBEOLJA");
  assert.ok(failed.evidence.message.includes("SCHEDULER_TRAFFIC_COLLECTOR_REQUIRED_ENV_MISSING"));
  assert.strictEqual(failed.evidence.details.required_env_mismatch_n, 1);
})();

(function preflightBlocksWhenCanaryFirestoreEnvIsWrong() {
  const report = script.runCheck({ GOOGLE_CLOUD_PROJECT: "donbeolja-dev" }, {
    execFileSync: fakeExecFactory({ wrongExitCanaryFirestoreWriteFor: "donbeolja-exit-worker" }),
  });
  assert.strictEqual(report.ok, false);
  assert.ok(report.failed_check_ids.includes("SCHED_TRAFFIC_COLLECTOR_PREREQ_03_RUN_SERVICE_DESCRIBE_DONBEOLJA_EXIT_WORKER"));
  assert.strictEqual(report.required_env_exact_match_n, 1);
  assert.strictEqual(report.required_env_mismatch_n, 1);
  const failed = report.checks.find((row) => row.id === "SCHED_TRAFFIC_COLLECTOR_PREREQ_03_RUN_SERVICE_DESCRIBE_DONBEOLJA_EXIT_WORKER");
  assert.strictEqual(failed.evidence.code, "SCHEDULER_TRAFFIC_COLLECTOR_REQUIRED_ENV_VALUE_MISMATCH");
  assert.deepStrictEqual(failed.evidence.details.required_env_mismatches, [
    {
      name: "DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED",
      expected: "1",
      actual: "0",
      present: true,
      reason: "VALUE_MISMATCH",
    },
  ]);
})();

console.log("V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_TEST_OK");
