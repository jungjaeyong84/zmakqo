"use strict";

const manifest = require("../../scripts/lib/openclaw-cron-manifest");

const SCOPE = "scheduler_traffic_cutover";
const PASS_REASON = "V2_SCHEDULER_TRAFFIC_CUTOVER_READINESS_PASS";
const BLOCKED_REASON = "V2_SCHEDULER_TRAFFIC_CUTOVER_READINESS_BLOCKED";
const REQUIRED_SERVICES = Object.freeze(["donbeolja", "donbeolja-exit-worker"]);
const FORBIDDEN_LEGACY_PATTERNS = Object.freeze([
  "com.jaeyong.donbeolja.tick",
  "donbeolja-tick",
  "donbeolja_tick",
  "/scheduler/tick",
]);

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function normalizeObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

function normalizeArray(value) {
  return Array.isArray(value) ? value : [];
}

function parseJsonInput(value) {
  const text = trimOrNull(value);
  if (!text) return null;
  return JSON.parse(text);
}

function resolveState(env = process.env) {
  const inline = trimOrNull(env.DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON);
  if (inline) return parseJsonInput(inline);
  return null;
}

function buildCheck({ id, ok, reason, expected = null, actual = null }) {
  return Object.freeze({
    id,
    ok: ok === true,
    reason: trimOrNull(reason),
    ...(expected == null ? {} : { expected }),
    ...(actual == null ? {} : { actual }),
  });
}

function requiredOpenClawJobIds() {
  return Object.freeze(
    [
      ...normalizeArray(manifest.OPENCLAW_CRON_JOBS),
      ...normalizeArray(manifest.OPENCLAW_CLOUD_SCHEDULER_JOBS),
    ]
      .filter((job) => trimOrNull(job && job.criticality) === "HIGH")
      .map((job) => trimOrNull(job && job.job_id))
      .filter(Boolean)
      .sort()
  );
}

function presentEnabledOpenClawJobIds(state) {
  return Object.freeze(
    [
      ...normalizeArray(state && state.openclaw_cron_jobs),
      ...normalizeArray(state && state.openclaw_cloud_scheduler_jobs),
    ]
      .filter((job) => job && job.enabled === true)
      .map((job) => trimOrNull(job.job_id) || trimOrNull(job.name) || trimOrNull(job.label))
      .filter(Boolean)
      .sort()
  );
}

function missingRequiredOpenClawJobIds(state) {
  const present = new Set(presentEnabledOpenClawJobIds(state));
  return Object.freeze(requiredOpenClawJobIds().filter((jobId) => !present.has(jobId)));
}

function serviceRows(state) {
  return normalizeArray(state && state.cloud_run_services)
    .map((service) => normalizeObject(service))
    .filter(Boolean);
}

function serviceByName(state, name) {
  return serviceRows(state).find((service) => trimOrNull(service.name) === name) || null;
}

function serviceEnv(service, key) {
  const env = normalizeObject(service && service.env) || {};
  return trimOrNull(env[key]);
}

function serviceSchedulerAutostartOk(state) {
  return REQUIRED_SERVICES.every((name) => {
    const service = serviceByName(state, name);
    return !!service && serviceEnv(service, "SCHEDULER_AUTOSTART") === "0";
  });
}

function serviceCutoverModeOk(state) {
  return REQUIRED_SERVICES.every((name) => {
    const service = serviceByName(state, name);
    return !!service && serviceEnv(service, "DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE") === manifest.OPENCLAW_SCHEDULER_SOT;
  });
}

function serviceTrafficReadyOk(state) {
  return REQUIRED_SERVICES.every((name) => {
    const service = serviceByName(state, name);
    if (!service) return false;
    return Number(service.traffic_percent) === 100 && service.latest_revision_ready === true;
  });
}

function activeLegacySchedulerJobs(state) {
  return Object.freeze(
    normalizeArray(state && state.legacy_scheduler_jobs)
      .map((job) => normalizeObject(job))
      .filter(Boolean)
      .filter((job) => job.active === true || job.enabled === true)
      .filter((job) => {
        const haystack = [job.job_id, job.name, job.label, job.target, job.http_path, job.command]
          .map((value) => String(value || ""))
          .join(" ");
        return FORBIDDEN_LEGACY_PATTERNS.some((pattern) => haystack.includes(pattern));
      })
      .map((job) => Object.freeze({
        job_id: trimOrNull(job.job_id),
        name: trimOrNull(job.name),
        label: trimOrNull(job.label),
        target: trimOrNull(job.target || job.http_path || job.command),
      }))
  );
}

function summarizeServices(state) {
  return Object.freeze(
    REQUIRED_SERVICES.map((name) => {
      const service = serviceByName(state, name);
      return Object.freeze({
        name,
        present: !!service,
        scheduler_autostart: serviceEnv(service, "SCHEDULER_AUTOSTART"),
        scheduler_cutover_mode: serviceEnv(service, "DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE"),
        traffic_percent: service ? Number(service.traffic_percent) : null,
        latest_revision_ready: service ? service.latest_revision_ready === true : false,
      });
    })
  );
}

function summarizeCloudSchedulerJobs(state) {
  return Object.freeze(
    normalizeArray(state && state.openclaw_cloud_scheduler_jobs)
      .map((job) => normalizeObject(job))
      .filter(Boolean)
      .map((job) => Object.freeze({
        job_id: trimOrNull(job.job_id),
        scheduler_name: trimOrNull(job.scheduler_name || job.name),
        enabled: job.enabled === true,
        criticality: trimOrNull(job.criticality),
        state: trimOrNull(job.state),
        expected_http_path: trimOrNull(job.expected_http_path),
        actual_http_path: trimOrNull(job.actual_http_path || job.http_path || job.target),
        path_match: job.path_match === true,
        expected_schedule: trimOrNull(job.expected_schedule),
        actual_schedule: trimOrNull(job.actual_schedule || job.schedule),
        schedule_match: job.schedule_match === true,
        expected_time_zone: trimOrNull(job.expected_time_zone),
        actual_time_zone: trimOrNull(job.actual_time_zone || job.time_zone),
        time_zone_match: job.time_zone_match === true,
      }))
  );
}

function auditV2SchedulerTrafficCutoverReadiness(env = process.env) {
  let state = null;
  let parseError = null;
  try {
    state = resolveState(env);
  } catch (error) {
    parseError = error;
  }
  const row = normalizeObject(state);
  const checks = [];
  checks.push(buildCheck({
    id: "SCHED_TRAFFIC_CHK_01",
    ok: !!row && !parseError,
    reason: row && !parseError ? "scheduler traffic state JSON is present" : "DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON is missing or invalid",
  }));
  const schedulerSot = trimOrNull(row && row.scheduler_sot);
  checks.push(buildCheck({
    id: "SCHED_TRAFFIC_CHK_02",
    ok: schedulerSot === manifest.OPENCLAW_SCHEDULER_SOT,
    reason: schedulerSot === manifest.OPENCLAW_SCHEDULER_SOT ? "scheduler SOT is OpenClaw cron" : "scheduler SOT must be OPENCLAW_CRON",
    expected: manifest.OPENCLAW_SCHEDULER_SOT,
    actual: schedulerSot,
  }));
  const missingOpenClawJobs = missingRequiredOpenClawJobIds(row);
  checks.push(buildCheck({
    id: "SCHED_TRAFFIC_CHK_03",
    ok: missingOpenClawJobs.length === 0,
    reason: missingOpenClawJobs.length === 0 ? "required OpenClaw cron jobs are enabled" : "required OpenClaw cron jobs are missing or disabled",
    expected: requiredOpenClawJobIds(),
    actual: presentEnabledOpenClawJobIds(row),
  }));
  const activeLegacyJobs = activeLegacySchedulerJobs(row);
  checks.push(buildCheck({
    id: "SCHED_TRAFFIC_CHK_04",
    ok: activeLegacyJobs.length === 0,
    reason: activeLegacyJobs.length === 0 ? "legacy scheduler tick jobs are inactive" : "legacy scheduler tick jobs are still active",
    actual: activeLegacyJobs,
  }));
  checks.push(buildCheck({
    id: "SCHED_TRAFFIC_CHK_05",
    ok: serviceSchedulerAutostartOk(row),
    reason: serviceSchedulerAutostartOk(row) ? "Cloud Run services have SCHEDULER_AUTOSTART=0" : "Cloud Run services must disable built-in scheduler autostart",
    expected: REQUIRED_SERVICES.map((name) => `${name}:SCHEDULER_AUTOSTART=0`),
    actual: summarizeServices(row),
  }));
  checks.push(buildCheck({
    id: "SCHED_TRAFFIC_CHK_06",
    ok: serviceCutoverModeOk(row),
    reason: serviceCutoverModeOk(row) ? "Cloud Run services point to OPENCLAW_CRON cutover mode" : "Cloud Run services must carry DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE=OPENCLAW_CRON",
    expected: REQUIRED_SERVICES.map((name) => `${name}:DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE=${manifest.OPENCLAW_SCHEDULER_SOT}`),
    actual: summarizeServices(row),
  }));
  checks.push(buildCheck({
    id: "SCHED_TRAFFIC_CHK_07",
    ok: serviceTrafficReadyOk(row),
    reason: serviceTrafficReadyOk(row) ? "Cloud Run traffic is fully routed to ready revisions" : "Cloud Run traffic must be 100% on ready revisions before LIVE cutover",
    expected: REQUIRED_SERVICES.map((name) => `${name}:traffic_percent=100 latest_revision_ready=true`),
    actual: summarizeServices(row),
  }));

  const failed = checks.filter((check) => check.ok !== true);
  return Object.freeze({
    ok: failed.length === 0,
    reason: failed.length === 0 ? PASS_REASON : BLOCKED_REASON,
    scope: SCOPE,
    fail_n: failed.length,
    check_n: checks.length,
    failed_check_ids: Object.freeze(failed.map((check) => check.id)),
    scheduler_sot: schedulerSot,
    required_openclaw_job_ids: requiredOpenClawJobIds(),
    missing_openclaw_job_ids: missingOpenClawJobs,
    active_legacy_scheduler_jobs: activeLegacyJobs,
    openclaw_cloud_scheduler_jobs: summarizeCloudSchedulerJobs(row),
    cloud_run_services: summarizeServices(row),
    checks: Object.freeze(checks),
  });
}

module.exports = {
  SCOPE,
  PASS_REASON,
  BLOCKED_REASON,
  REQUIRED_SERVICES,
  FORBIDDEN_LEGACY_PATTERNS,
  auditV2SchedulerTrafficCutoverReadiness,
  __test: {
    trimOrNull,
    normalizeObject,
    parseJsonInput,
    resolveState,
    requiredOpenClawJobIds,
    presentEnabledOpenClawJobIds,
    missingRequiredOpenClawJobIds,
    activeLegacySchedulerJobs,
    summarizeServices,
    summarizeCloudSchedulerJobs,
  },
};
