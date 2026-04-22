"use strict";

const collector = require("./schedulerTrafficStateCollector");

const REQUIRED_LIVE_COLLECTOR_ENV = Object.freeze({
  SCHEDULER_AUTOSTART: "0",
  DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE: "OPENCLAW_CRON",
  DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED: "1",
  DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED: "1",
  DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE: "FIRESTORE",
  DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE: "1",
  DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED: "1",
  DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED: "1",
  DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE: "FIRESTORE",
  DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE: "1",
});

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function sanitizeId(value) {
  return String(value || "")
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "") || "UNKNOWN";
}

function normalizeError(error) {
  const code = trimOrNull(error && error.code);
  const message = trimOrNull(error && error.message) || String(error || "UNKNOWN_ERROR");
  return Object.freeze({
    code,
    message,
    ...(error && error.details && typeof error.details === "object" ? { details: Object.freeze({ ...error.details }) } : {}),
  });
}

function getRequiredSchedulerEnvMismatches(service) {
  const env = service && typeof service.env === "object" ? service.env : {};
  return Object.freeze(Object.entries(REQUIRED_LIVE_COLLECTOR_ENV).map(([name, expected]) => {
    const present = Object.prototype.hasOwnProperty.call(env, name);
    const actual = present ? trimOrNull(env[name]) : null;
    const ok = present && actual === expected;
    return ok ? null : Object.freeze({
      name,
      expected,
      actual,
      present,
      reason: present ? "VALUE_MISMATCH" : "MISSING",
    });
  }).filter(Boolean));
}

function hasRequiredSchedulerEnv(service) {
  return getRequiredSchedulerEnvMismatches(service).length === 0;
}

function assertRequiredSchedulerEnv(serviceName, service) {
  const mismatches = getRequiredSchedulerEnvMismatches(service);
  if (!mismatches.length) return;
  const hasMissing = mismatches.some((row) => row.reason === "MISSING");
  const error = new Error(hasMissing
    ? `SCHEDULER_TRAFFIC_COLLECTOR_REQUIRED_ENV_MISSING:${serviceName}`
    : `SCHEDULER_TRAFFIC_COLLECTOR_REQUIRED_ENV_VALUE_MISMATCH:${serviceName}`);
  error.code = hasMissing
    ? "SCHEDULER_TRAFFIC_COLLECTOR_REQUIRED_ENV_MISSING"
    : "SCHEDULER_TRAFFIC_COLLECTOR_REQUIRED_ENV_VALUE_MISMATCH";
  error.details = {
    service_name: serviceName,
    required_env_mismatch_n: mismatches.length,
    required_env_mismatches: mismatches,
  };
  throw error;
}

function buildCheck(id, ok, reason, evidence = {}) {
  return Object.freeze({
    id,
    ok: ok === true,
    reason: trimOrNull(reason),
    evidence: Object.freeze({ ...evidence }),
  });
}

function checkOperation(id, reason, operation) {
  try {
    const evidence = operation();
    return buildCheck(id, true, reason, evidence && typeof evidence === "object" ? evidence : {});
  } catch (error) {
    return buildCheck(id, false, reason, normalizeError(error));
  }
}

function runV2SchedulerTrafficCollectorPreflight(options = {}) {
  const env = options.env || process.env;
  const execFileSync = options.execFileSync;
  const region = trimOrNull(options.region || env.GOOGLE_CLOUD_REGION || env.CLOUD_RUN_REGION || env.REGION) || collector.DEFAULT_REGION;
  const serviceNames = normalizeArray(options.services).length ? options.services : collector.DEFAULT_SERVICES;
  let projectId = trimOrNull(options.projectId);
  let cloudSchedulerJobN = null;
  const checks = [];

  checks.push(checkOperation(
    "SCHED_TRAFFIC_COLLECTOR_PREREQ_01_PROJECT_RESOLVED",
    "collector must resolve a GCP project before scheduler/traffic state collection",
    () => {
      projectId = projectId || collector.resolveProjectId(env, execFileSync);
      return { project_id: projectId };
    }
  ));

  if (projectId) {
    checks.push(checkOperation(
      "SCHED_TRAFFIC_COLLECTOR_PREREQ_02_SCHEDULER_JOBS_LIST",
      "collector must list Cloud Scheduler jobs to prove legacy /scheduler/tick is inactive",
      () => {
        const jobs = collector.collectCloudSchedulerJobs({ projectId, region, env, execFileSync });
        cloudSchedulerJobN = jobs.length;
        return { project_id: projectId, region, scheduler_job_n: jobs.length };
      }
    ));

    serviceNames.forEach((serviceName) => {
      checks.push(checkOperation(
        `SCHED_TRAFFIC_COLLECTOR_PREREQ_03_RUN_SERVICE_DESCRIBE_${sanitizeId(serviceName)}`,
        "collector must describe each Cloud Run service to verify ready revision, traffic, and scheduler env",
        () => {
          const service = collector.collectCloudRunService(serviceName, { projectId, region, env, execFileSync });
          assertRequiredSchedulerEnv(serviceName, service);
          return {
            project_id: projectId,
            region,
            service_name: service.name,
            latest_revision_ready: service.latest_revision_ready,
            traffic_percent: service.traffic_percent,
            required_env_exact_match: true,
            required_env_mismatch_n: 0,
            required_env_expected: REQUIRED_LIVE_COLLECTOR_ENV,
            required_env_actual: Object.freeze(Object.fromEntries(
              Object.keys(REQUIRED_LIVE_COLLECTOR_ENV).map((name) => [name, trimOrNull(service.env && service.env[name])])
            )),
          };
        }
      ));
    });
  }

  const failed = checks.filter((row) => row.ok !== true);
  const serviceEnvChecks = checks.filter((row) => row.id.includes("SCHED_TRAFFIC_COLLECTOR_PREREQ_03_RUN_SERVICE_DESCRIBE_"));
  const requiredEnvMismatchN = serviceEnvChecks.reduce((sum, row) => {
    if (row.ok === true) return sum + Number(row.evidence && row.evidence.required_env_mismatch_n || 0);
    return sum + Number(row.evidence && row.evidence.details && row.evidence.details.required_env_mismatch_n || 1);
  }, 0);
  const requiredEnvExactMatchN = serviceEnvChecks.filter((row) => row.ok === true && row.evidence && row.evidence.required_env_exact_match === true).length;
  return Object.freeze({
    ok: failed.length === 0,
    reason: failed.length === 0
      ? "V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_PASS"
      : "V2_SCHEDULER_TRAFFIC_COLLECTOR_PREFLIGHT_BLOCKED",
    check_n: checks.length,
    fail_n: failed.length,
    failed_check_ids: Object.freeze(failed.map((row) => row.id)),
    project_id: projectId || null,
    region,
    service_names: Object.freeze(serviceNames.slice()),
    scheduler_job_n: cloudSchedulerJobN,
    required_env_names: Object.freeze(Object.keys(REQUIRED_LIVE_COLLECTOR_ENV)),
    required_env_exact_match_n: requiredEnvExactMatchN,
    required_env_mismatch_n: requiredEnvMismatchN,
    checks: Object.freeze(checks),
  });
}

module.exports = {
  REQUIRED_LIVE_COLLECTOR_ENV,
  runV2SchedulerTrafficCollectorPreflight,
  __test: {
    trimOrNull,
    normalizeArray,
    getRequiredSchedulerEnvMismatches,
    hasRequiredSchedulerEnv,
    assertRequiredSchedulerEnv,
    sanitizeId,
    normalizeError,
    buildCheck,
    checkOperation,
  },
};
