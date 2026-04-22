"use strict";

const { execFileSync: defaultExecFileSync } = require("child_process");
const manifest = require("../../scripts/lib/openclaw-cron-manifest");

const DEFAULT_REGION = "asia-northeast3";
const DEFAULT_SERVICES = Object.freeze(["donbeolja", "donbeolja-exit-worker"]);
const LEGACY_SCHEDULER_PATTERNS = Object.freeze([
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

function parseCsv(value) {
  return Object.freeze(
    String(value || "")
      .split(",")
      .map((entry) => trimOrNull(entry))
      .filter(Boolean)
  );
}

function parseJsonOutput(text, label) {
  const raw = String(text || "").trim();
  if (!raw) throw new Error(`V2_SCHEDULER_TRAFFIC_COLLECT_EMPTY_JSON:${label}`);
  return JSON.parse(raw);
}

function buildExecEnv(env = process.env) {
  return Object.freeze({
    ...process.env,
    ...(normalizeObject(env) || {}),
  });
}

function execGcloudJson(args, { execFileSync = defaultExecFileSync, cwd = process.cwd(), env = process.env, label = "gcloud" } = {}) {
  const output = execFileSync("gcloud", args, {
    cwd,
    env: buildExecEnv(env),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseJsonOutput(output, label);
}

function resolveProjectId(env = process.env, execFileSync = defaultExecFileSync) {
  const explicit = trimOrNull(env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || env.PROJECT_ID);
  if (explicit) return explicit;
  const output = execFileSync("gcloud", ["config", "get-value", "project"], {
    cwd: process.cwd(),
    env: buildExecEnv(env),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  const project = trimOrNull(output);
  if (!project) throw new Error("V2_SCHEDULER_TRAFFIC_PROJECT_REQUIRED");
  return project;
}

function extractContainerEnv(service) {
  const row = normalizeObject(service) || {};
  const containers = normalizeArray(
    row.template && row.template.spec && row.template.spec.containers
      ? row.template.spec.containers
      : row.spec && row.spec.template && row.spec.template.spec && row.spec.template.spec.containers
  );
  const envRows = normalizeArray(containers[0] && containers[0].env);
  return Object.freeze(Object.fromEntries(
    envRows
      .map((entry) => [trimOrNull(entry && entry.name), trimOrNull(entry && entry.value)])
      .filter(([name]) => !!name)
  ));
}

function isReadyService(service) {
  const conditions = normalizeArray(service && service.status && service.status.conditions);
  return conditions.some((condition) => trimOrNull(condition && condition.type) === "Ready" && String(condition && condition.status) === "True");
}

function latestRevisionName(service) {
  return trimOrNull(service && service.status && service.status.latestReadyRevisionName)
    || trimOrNull(service && service.status && service.status.latestCreatedRevisionName);
}

function latestRevisionTrafficPercent(service) {
  const trafficRows = normalizeArray(service && service.status && service.status.traffic);
  const latest = latestRevisionName(service);
  const matched = trafficRows.filter((row) => row && (row.latestRevision === true || (latest && trimOrNull(row.revisionName) === latest)));
  const rows = matched.length ? matched : [];
  if (!rows.length) return null;
  return rows.reduce((sum, row) => sum + Number(row.percent || 0), 0);
}

function collectCloudRunService(serviceName, { projectId, region, env = process.env, execFileSync = defaultExecFileSync } = {}) {
  const service = execGcloudJson([
    "run", "services", "describe", serviceName,
    "--region", region,
    "--project", projectId,
    "--format=json",
  ], { env, execFileSync, label: `run-service:${serviceName}` });
  const trafficPercent = latestRevisionTrafficPercent(service);
  return Object.freeze({
    name: serviceName,
    traffic_percent: trafficPercent,
    latest_revision_ready: isReadyService(service),
    latest_revision_name: latestRevisionName(service),
    env: extractContainerEnv(service),
  });
}

function collectCloudSchedulerJobs({ projectId, region, env = process.env, execFileSync = defaultExecFileSync } = {}) {
  let rows = [];
  try {
    rows = execGcloudJson([
      "scheduler", "jobs", "list",
      "--location", region,
      "--project", projectId,
      "--format=json",
    ], { env, execFileSync, label: "scheduler-jobs" });
  } catch (error) {
    if (String(error && error.message || error).includes("EMPTY_JSON")) rows = [];
    else throw error;
  }
  return Object.freeze(normalizeArray(rows).map((job) => {
    const name = trimOrNull(job && job.name);
    const shortName = name ? name.split("/").pop() : null;
    const httpTarget = normalizeObject(job && job.httpTarget) || {};
    const target = trimOrNull(httpTarget.uri) || trimOrNull(job && job.schedule);
    let httpPath = null;
    try {
      httpPath = target ? `${new URL(target).pathname}${new URL(target).search}` : null;
    } catch (_error) {
      httpPath = target;
    }
    return Object.freeze({
      job_id: shortName,
      name: shortName,
      label: trimOrNull(job && job.description) || shortName,
      target,
      http_path: httpPath,
      schedule: trimOrNull(job && job.schedule),
      time_zone: trimOrNull(job && job.timeZone),
      enabled: trimOrNull(job && job.state) !== "PAUSED",
      active: trimOrNull(job && job.state) !== "PAUSED",
      state: trimOrNull(job && job.state),
    });
  }));
}

function buildOpenClawCronJobs(env = process.env) {
  const disabled = new Set(parseCsv(env.DONBEOLJA_V2_OPENCLAW_CRON_DISABLED_JOB_IDS));
  return Object.freeze(normalizeArray(manifest.OPENCLAW_CRON_JOBS).map((job) => {
    const jobId = trimOrNull(job && job.job_id);
    const enabled = !!jobId && !disabled.has(jobId);
    return Object.freeze({
      job_id: jobId,
      name: trimOrNull(job && job.name),
      label: trimOrNull(job && job.label),
      enabled,
      active: enabled,
      scheduler_sot: trimOrNull(job && job.scheduler_sot) || manifest.OPENCLAW_SCHEDULER_SOT,
      criticality: trimOrNull(job && job.criticality),
    });
  }));
}

function buildOpenClawCloudSchedulerJobs({ cloudSchedulerJobs = [] } = {}) {
  const actualRows = normalizeArray(cloudSchedulerJobs);
  return Object.freeze(normalizeArray(manifest.OPENCLAW_CLOUD_SCHEDULER_JOBS).map((job) => {
    const schedulerName = trimOrNull(job && job.scheduler_name);
    const actual = actualRows.find((row) => (
      trimOrNull(row && row.name) === schedulerName ||
      trimOrNull(row && row.job_id) === schedulerName
    )) || null;
    const expectedPath = trimOrNull(job && job.http_path);
    const actualPath = trimOrNull(actual && actual.http_path) || trimOrNull(actual && actual.target);
    const expectedSchedule = trimOrNull(job && job.scheduler_schedule);
    const actualSchedule = trimOrNull(actual && actual.schedule);
    const expectedTimeZone = trimOrNull(job && job.scheduler_time_zone);
    const actualTimeZone = trimOrNull(actual && actual.time_zone);
    const pathMatch = !!actual && !!expectedPath && (actualPath === expectedPath || String(actual && actual.target || "").includes(expectedPath));
    const scheduleMatch = !!actual && (!expectedSchedule || actualSchedule === expectedSchedule);
    const timeZoneMatch = !!actual && (!expectedTimeZone || actualTimeZone === expectedTimeZone);
    const enabled = !!actual && actual.enabled === true && pathMatch && scheduleMatch && timeZoneMatch;
    return Object.freeze({
      job_id: trimOrNull(job && job.job_id),
      scheduler_name: schedulerName,
      name: schedulerName,
      enabled,
      active: enabled,
      state: trimOrNull(actual && actual.state),
      criticality: trimOrNull(job && job.criticality),
      expected_http_path: expectedPath,
      actual_http_path: actualPath,
      path_match: pathMatch,
      expected_schedule: expectedSchedule,
      actual_schedule: actualSchedule,
      schedule_match: scheduleMatch,
      expected_time_zone: expectedTimeZone,
      actual_time_zone: actualTimeZone,
      time_zone_match: timeZoneMatch,
    });
  }));
}

function buildLegacySchedulerJobs({ cloudSchedulerJobs = [], env = process.env } = {}) {
  const forcedActive = parseCsv(env.DONBEOLJA_V2_LEGACY_SCHEDULER_ACTIVE_JOBS).map((name) => ({
    job_id: name,
    name,
    label: name,
    target: name,
    enabled: true,
    active: true,
    state: "FORCED_ACTIVE",
  }));
  const rows = [...normalizeArray(cloudSchedulerJobs), ...forcedActive];
  return Object.freeze(rows.filter((job) => {
    const haystack = [job.job_id, job.name, job.label, job.target]
      .map((value) => String(value || ""))
      .join(" ");
    return LEGACY_SCHEDULER_PATTERNS.some((pattern) => haystack.includes(pattern));
  }));
}

function collectV2SchedulerTrafficState(options = {}) {
  const env = options.env || process.env;
  const execFileSync = options.execFileSync || defaultExecFileSync;
  const region = trimOrNull(options.region || env.GOOGLE_CLOUD_REGION || env.CLOUD_RUN_REGION || env.REGION) || DEFAULT_REGION;
  const projectId = trimOrNull(options.projectId) || resolveProjectId(env, execFileSync);
  const serviceNames = normalizeArray(options.services).length ? options.services : DEFAULT_SERVICES;
  const cloudSchedulerJobs = collectCloudSchedulerJobs({ projectId, region, env, execFileSync });
  return Object.freeze({
    scheduler_sot: manifest.OPENCLAW_SCHEDULER_SOT,
    generated_from: "GCP_AND_OPENCLAW_MANIFEST",
    project_id: projectId,
    region,
    openclaw_cron_jobs: buildOpenClawCronJobs(env),
    openclaw_cloud_scheduler_jobs: buildOpenClawCloudSchedulerJobs({ cloudSchedulerJobs }),
    legacy_scheduler_jobs: buildLegacySchedulerJobs({ cloudSchedulerJobs, env }),
    cloud_run_services: Object.freeze(serviceNames.map((name) => collectCloudRunService(name, { projectId, region, env, execFileSync }))),
  });
}

module.exports = {
  DEFAULT_REGION,
  DEFAULT_SERVICES,
  LEGACY_SCHEDULER_PATTERNS,
  buildExecEnv,
  resolveProjectId,
  collectCloudRunService,
  collectCloudSchedulerJobs,
  buildOpenClawCronJobs,
  buildOpenClawCloudSchedulerJobs,
  buildLegacySchedulerJobs,
  collectV2SchedulerTrafficState,
  __test: {
    trimOrNull,
    normalizeObject,
    normalizeArray,
    parseCsv,
    parseJsonOutput,
    buildExecEnv,
    resolveProjectId,
    extractContainerEnv,
    isReadyService,
    latestRevisionName,
    latestRevisionTrafficPercent,
    collectCloudRunService,
    collectCloudSchedulerJobs,
    buildOpenClawCronJobs,
    buildOpenClawCloudSchedulerJobs,
    buildLegacySchedulerJobs,
  },
};
