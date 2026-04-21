"use strict";

const collector = require("./schedulerTrafficStateCollector");

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
  });
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
          return {
            project_id: projectId,
            region,
            service_name: service.name,
            latest_revision_ready: service.latest_revision_ready,
            traffic_percent: service.traffic_percent,
            has_scheduler_autostart_env: Object.prototype.hasOwnProperty.call(service.env || {}, "SCHEDULER_AUTOSTART"),
          };
        }
      ));
    });
  }

  const failed = checks.filter((row) => row.ok !== true);
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
    checks: Object.freeze(checks),
  });
}

module.exports = {
  runV2SchedulerTrafficCollectorPreflight,
  __test: {
    trimOrNull,
    normalizeArray,
    sanitizeId,
    normalizeError,
    buildCheck,
    checkOperation,
  },
};
