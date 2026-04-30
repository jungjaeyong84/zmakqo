"use strict";

const assert = require("assert");
const checker = require("../../scripts/check-v2-scheduler-health-drift");

function job(name, state = "ENABLED", code = null) {
  const status = code == null ? {} : { code };
  return Object.freeze({
    name: `projects/donbeolja-dev/locations/asia-northeast3/jobs/${name}`,
    state,
    status,
  });
}

{
  const result = checker.evaluateSchedulerHealthDrift({
    jobs: [
      job("v2-production-entry-route-canary"),
      job("v2-exit-runtime-canary", "ENABLED", 0),
      job("v2-active-protection-reconciliation"),
      job("v2-fill-sync"),
      job("donbeolja-tick-5m", "PAUSED", -1),
      job("donbeolja-cost-guard", "ENABLED"),
    ],
    env: {},
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_SCHEDULER_HEALTH_DRIFT_PASS");
}

{
  const result = checker.evaluateSchedulerHealthDrift({
    jobs: [
      job("v2-production-entry-route-canary"),
      job("v2-exit-runtime-canary"),
      job("v2-active-protection-reconciliation"),
      job("v2-fill-sync"),
      job("donbeolja-tick-5m", "ENABLED"),
    ],
    env: {},
  });
  assert.strictEqual(result.ok, false);
  assert(result.blockers.includes("SCHEDULER_HEALTH:donbeolja-tick-5m:NOT_PAUSED"));
}

{
  const result = checker.evaluateSchedulerHealthDrift({
    jobs: [
      job("v2-production-entry-route-canary"),
      job("v2-exit-runtime-canary"),
      job("v2-active-protection-reconciliation"),
      job("v2-fill-sync"),
      job("donbeolja-tick-5m", "PAUSED", -1),
      job("donbeolja-ml-ops-pipeline", "ENABLED", 14),
    ],
    env: {},
  });
  assert.strictEqual(result.ok, false);
  assert(result.blockers.includes("SCHEDULER_HEALTH:donbeolja-ml-ops-pipeline:STATUS_CODE_14"));
}

{
  const result = checker.evaluateSchedulerHealthDrift({
    jobs: [
      job("v2-production-entry-route-canary"),
      job("donbeolja-tick-5m", "PAUSED", -1),
    ],
    env: {},
  });
  assert.strictEqual(result.ok, false);
  assert(result.blockers.includes("SCHEDULER_HEALTH:v2-exit-runtime-canary:MISSING"));
}

{
  const result = checker.runCheck({
    DONBEOLJA_V2_SCHEDULER_JOBS_JSON: JSON.stringify([
      job("v2-production-entry-route-canary"),
      job("v2-exit-runtime-canary"),
      job("v2-active-protection-reconciliation"),
      job("v2-fill-sync"),
      job("donbeolja-tick-5m", "PAUSED", -1),
    ]),
  });
  assert.strictEqual(result.ok, true);
}

console.log("check-v2-scheduler-health-drift.test.js: OK");
