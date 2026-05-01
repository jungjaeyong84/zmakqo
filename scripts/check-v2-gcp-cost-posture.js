#!/usr/bin/env node
"use strict";

const { execFileSync } = require("child_process");

const PROJECT_ID = "donbeolja-dev";
const REGION = "asia-northeast3";
const DEFAULT_BUILD_LIMIT = 6;
const DEFAULT_BUILD_WINDOW_HOURS = 24;
const DEFAULT_MAX_LIQUIDATION_WINDOW_MS = 15000;
const EXPECTED_LIQUIDATION_SCHEDULE = "*/5 * * * *";
const REQUIRED_ARTIFACT_POLICIES = Object.freeze([
  "keep-recent-deploy-images",
  "delete-old-untagged-images",
  "delete-old-v2-commit-tags",
]);
const DEFAULT_ARTIFACT_REPOSITORIES = Object.freeze([
  Object.freeze({ repository: "gcr.io", location: "us" }),
  Object.freeze({ repository: "cloud-run-source-deploy", location: REGION }),
]);
const DEFAULT_CLOUD_RUN_SERVICES = Object.freeze([
  "donbeolja",
  "donbeolja-exit-worker",
  "donbeolja-egress",
  "donbeolja-egress-private",
]);

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseJsonArray(value, fallback = []) {
  const raw = trimOrNull(value);
  if (!raw) return fallback;
  const parsed = JSON.parse(raw);
  return Array.isArray(parsed) ? parsed : [parsed];
}

function parseJsonObject(value, fallback = null) {
  const raw = trimOrNull(value);
  if (!raw) return fallback;
  const parsed = JSON.parse(raw);
  return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : fallback;
}

function gcloudJson(args, { execFileSyncFn = execFileSync } = {}) {
  const out = execFileSyncFn("gcloud", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  const text = String(out || "").trim();
  return text ? JSON.parse(text) : null;
}

function normalizeArtifactRepository(row = {}) {
  const cleanupPolicies = row.cleanupPolicies && typeof row.cleanupPolicies === "object" ? row.cleanupPolicies : {};
  const cleanupPolicyIds = Array.isArray(row.cleanup_policy_ids)
    ? row.cleanup_policy_ids
    : Object.keys(cleanupPolicies).sort();
  return Object.freeze({
    repository: trimOrNull(row.repository || row.name || row.id),
    location: trimOrNull(row.location),
    cleanup_policy_dry_run: row.cleanupPolicyDryRun === true || row.cleanup_policy_dry_run === true,
    cleanup_policy_ids: Object.freeze(cleanupPolicyIds),
    repository_size_mb: Number.isFinite(Number(row.repositorySizeMb))
      ? Number(row.repositorySizeMb)
      : (Number.isFinite(Number(row.repository_size_mb)) ? Number(row.repository_size_mb) : null),
  });
}

function normalizeCloudRunService(row = {}) {
  const annotations = row.annotations && typeof row.annotations === "object"
    ? row.annotations
    : row.spec && row.spec.template && row.spec.template.metadata && row.spec.template.metadata.annotations || {};
  const containers = row.spec && row.spec.template && row.spec.template.spec && Array.isArray(row.spec.template.spec.containers)
    ? row.spec.template.spec.containers
    : [];
  const envRows = containers[0] && Array.isArray(containers[0].env) ? containers[0].env : [];
  const env = {};
  for (const item of envRows) {
    if (item && item.name) env[item.name] = item.value != null ? String(item.value) : null;
  }
  return Object.freeze({
    name: trimOrNull(row.name || row.metadata && row.metadata.name),
    min_scale: toPositiveInt(row.min_scale, toPositiveInt(annotations["autoscaling.knative.dev/minScale"], 0)),
    max_scale: toPositiveInt(row.max_scale, toPositiveInt(annotations["autoscaling.knative.dev/maxScale"], 0)),
    vpc_connector: trimOrNull(row.vpc_connector || annotations["run.googleapis.com/vpc-access-connector"]),
    vpc_egress: trimOrNull(row.vpc_egress || annotations["run.googleapis.com/vpc-access-egress"]),
    liquidation_stream_window_ms: toPositiveInt(
      row.liquidation_stream_window_ms,
      toPositiveInt(env.DONBEOLJA_V2_LIQUIDATION_STREAM_WINDOW_MS, null),
    ),
  });
}

function normalizeSchedulerJob(row = {}) {
  return Object.freeze({
    name: trimOrNull(row.name || row.scheduler_name || row.id),
    schedule: trimOrNull(row.schedule || row.scheduler_schedule),
    state: trimOrNull(row.state),
  });
}

function normalizeVpcConnector(row = {}) {
  return Object.freeze({
    name: trimOrNull(row.name),
    min_instances: toPositiveInt(row.min_instances, toPositiveInt(row.minInstances, 0)),
    max_instances: toPositiveInt(row.max_instances, toPositiveInt(row.maxInstances, 0)),
    machine_type: trimOrNull(row.machine_type || row.machineType),
    state: trimOrNull(row.state),
  });
}

function loadArtifactRepositories({ env = process.env, execFileSyncFn = execFileSync } = {}) {
  const fixture = parseJsonArray(env.V2_GCP_COST_POSTURE_ARTIFACT_REPOSITORIES_JSON, null);
  if (fixture) return fixture.map(normalizeArtifactRepository);
  return DEFAULT_ARTIFACT_REPOSITORIES.map((repo) => {
    const row = gcloudJson([
      "artifacts", "repositories", "describe", repo.repository,
      "--location", repo.location,
      "--project", env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || PROJECT_ID,
      "--format", "json(name,cleanupPolicyDryRun,cleanupPolicies)",
    ], { execFileSyncFn });
    return normalizeArtifactRepository({ ...row, repository: repo.repository, location: repo.location });
  });
}

function loadSchedulerJobs({ env = process.env, execFileSyncFn = execFileSync } = {}) {
  const fixture = parseJsonArray(env.V2_GCP_COST_POSTURE_SCHEDULER_JOBS_JSON, null);
  if (fixture) return fixture.map(normalizeSchedulerJob);
  const row = gcloudJson([
    "scheduler", "jobs", "describe", "v2-liquidation-stream-collector-window",
    "--location", REGION,
    "--project", env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || PROJECT_ID,
    "--format", "json(name,schedule,state)",
  ], { execFileSyncFn });
  return [normalizeSchedulerJob(row)];
}

function loadCloudRunServices({ env = process.env, execFileSyncFn = execFileSync } = {}) {
  const fixture = parseJsonArray(env.V2_GCP_COST_POSTURE_CLOUD_RUN_SERVICES_JSON, null);
  if (fixture) return fixture.map(normalizeCloudRunService);
  return DEFAULT_CLOUD_RUN_SERVICES.map((service) => {
    const row = gcloudJson([
      "run", "services", "describe", service,
      "--region", REGION,
      "--project", env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || PROJECT_ID,
      "--format", "json(metadata.name,spec.template.metadata.annotations,spec.template.spec.containers[0].env)",
    ], { execFileSyncFn });
    return normalizeCloudRunService(row);
  });
}

function loadVpcConnectors({ env = process.env, execFileSyncFn = execFileSync } = {}) {
  const fixture = parseJsonArray(env.V2_GCP_COST_POSTURE_VPC_CONNECTORS_JSON, null);
  if (fixture) return fixture.map(normalizeVpcConnector);
  const row = gcloudJson([
    "compute", "networks", "vpc-access", "connectors", "describe", "donbeolja-connector",
    "--region", REGION,
    "--project", env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || PROJECT_ID,
    "--format", "json(name,minInstances,maxInstances,machineType,state)",
  ], { execFileSyncFn });
  return [normalizeVpcConnector(row)];
}

function loadRecentCloudBuilds({ env = process.env, execFileSyncFn = execFileSync, nowMs = Date.now() } = {}) {
  const fixture = parseJsonArray(env.V2_GCP_COST_POSTURE_RECENT_BUILDS_JSON, null);
  if (fixture) return fixture;
  const project = env.GOOGLE_CLOUD_PROJECT || env.GCLOUD_PROJECT || PROJECT_ID;
  const windowHours = toPositiveInt(env.DONBEOLJA_V2_CLOUDBUILD_SUBMIT_BUDGET_WINDOW_HOURS, DEFAULT_BUILD_WINDOW_HOURS);
  const cutoff = new Date(nowMs - windowHours * 60 * 60 * 1000).toISOString();
  const rows = gcloudJson([
    "builds", "list",
    "--project", project,
    "--filter", `createTime>=${cutoff}`,
    "--format", "json(id,createTime,status)",
  ], { execFileSyncFn });
  return Array.isArray(rows) ? rows : [];
}

function evaluateGcpCostPosture({
  artifact_repositories = [],
  scheduler_jobs = [],
  cloud_run_services = [],
  vpc_connectors = [],
  recent_cloudbuilds = [],
  env = process.env,
} = {}) {
  const blockers = [];
  const warnings = [];
  const buildLimit = toPositiveInt(env.DONBEOLJA_V2_CLOUDBUILD_DAILY_SUBMIT_LIMIT, DEFAULT_BUILD_LIMIT);
  if (recent_cloudbuilds.length >= buildLimit) {
    blockers.push(`GCP_COST:CLOUDBUILD_24H_BUILD_LIMIT_EXCEEDED:${recent_cloudbuilds.length}/${buildLimit}`);
  }

  for (const repo of artifact_repositories.map(normalizeArtifactRepository)) {
    if (repo.cleanup_policy_dry_run !== true) {
      blockers.push(`GCP_COST:ARTIFACT_CLEANUP_DRY_RUN_DISABLED:${repo.location || "UNKNOWN"}/${repo.repository || "UNKNOWN"}`);
    }
    const ids = new Set(repo.cleanup_policy_ids || []);
    for (const required of REQUIRED_ARTIFACT_POLICIES) {
      if (!ids.has(required)) {
        blockers.push(`GCP_COST:ARTIFACT_CLEANUP_POLICY_MISSING:${repo.location || "UNKNOWN"}/${repo.repository || "UNKNOWN"}:${required}`);
      }
    }
    if (Number.isFinite(Number(repo.repository_size_mb)) && Number(repo.repository_size_mb) > 50000) {
      warnings.push(`GCP_COST:ARTIFACT_REPOSITORY_LARGE:${repo.location || "UNKNOWN"}/${repo.repository || "UNKNOWN"}:${Number(repo.repository_size_mb).toFixed(0)}MB`);
    }
  }

  const liquidationJob = scheduler_jobs.map(normalizeSchedulerJob)
    .find((job) => String(job.name || "").includes("v2-liquidation-stream-collector-window"));
  if (!liquidationJob) {
    blockers.push("GCP_COST:LIQUIDATION_STREAM_SCHEDULER_MISSING");
  } else if (liquidationJob.schedule !== EXPECTED_LIQUIDATION_SCHEDULE) {
    blockers.push(`GCP_COST:LIQUIDATION_STREAM_SCHEDULE_DRIFT:${liquidationJob.schedule || "UNKNOWN"}`);
  }

  const serviceRows = cloud_run_services.map(normalizeCloudRunService);
  const liquidationWindows = serviceRows
    .map((svc) => ({ name: svc.name, ms: svc.liquidation_stream_window_ms }))
    .filter((row) => Number.isFinite(Number(row.ms)));
  const maxWindowMs = toPositiveInt(env.DONBEOLJA_V2_GCP_COST_MAX_LIQUIDATION_WINDOW_MS, DEFAULT_MAX_LIQUIDATION_WINDOW_MS);
  for (const row of liquidationWindows) {
    if (Number(row.ms) > maxWindowMs) {
      blockers.push(`GCP_COST:LIQUIDATION_STREAM_WINDOW_TOO_HIGH:${row.name || "UNKNOWN"}:${row.ms}/${maxWindowMs}`);
    }
  }

  const minScaleServices = serviceRows.filter((svc) => Number(svc.min_scale) > 0);
  if (minScaleServices.length) {
    warnings.push(`GCP_COST:CLOUD_RUN_MIN_INSTANCE_BASELINE:${minScaleServices.map((svc) => `${svc.name || "UNKNOWN"}=${svc.min_scale}`).join(",")}`);
  }
  for (const svc of serviceRows) {
    if (svc.vpc_connector && svc.vpc_egress === "all-traffic") {
      warnings.push(`GCP_COST:VPC_EGRESS_ALL_TRAFFIC_BASELINE:${svc.name || "UNKNOWN"}:${svc.vpc_connector}`);
    }
  }
  for (const connector of vpc_connectors.map(normalizeVpcConnector)) {
    if (Number(connector.min_instances) >= 2) {
      warnings.push(`GCP_COST:VPC_CONNECTOR_MIN_INSTANCE_BASELINE:${connector.name || "UNKNOWN"}:${connector.min_instances}x${connector.machine_type || "UNKNOWN"}`);
    }
  }

  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0 ? "V2_GCP_COST_POSTURE_PASS" : "V2_GCP_COST_POSTURE_BLOCKED",
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
    summary: Object.freeze({
      cloudbuild_24h_build_n: recent_cloudbuilds.length,
      cloudbuild_24h_build_limit: buildLimit,
      artifact_repository_n: artifact_repositories.length,
      cloud_run_min_instance_service_n: minScaleServices.length,
      liquidation_stream_schedule: liquidationJob ? liquidationJob.schedule : null,
      liquidation_stream_window_max_ms: liquidationWindows.reduce((max, row) => Math.max(max, Number(row.ms)), 0) || null,
      vpc_connector_n: vpc_connectors.length,
    }),
  });
}

function main({ env = process.env, execFileSyncFn = execFileSync, nowMs = Date.now() } = {}) {
  let payload;
  try {
    const inputs = {
      artifact_repositories: loadArtifactRepositories({ env, execFileSyncFn }),
      scheduler_jobs: loadSchedulerJobs({ env, execFileSyncFn }),
      cloud_run_services: loadCloudRunServices({ env, execFileSyncFn }),
      vpc_connectors: loadVpcConnectors({ env, execFileSyncFn }),
      recent_cloudbuilds: loadRecentCloudBuilds({ env, execFileSyncFn, nowMs }),
      env,
    };
    payload = evaluateGcpCostPosture(inputs);
  } catch (error) {
    payload = Object.freeze({
      ok: false,
      reason: "V2_GCP_COST_POSTURE_READ_FAILED",
      blockers: Object.freeze(["GCP_COST:POSTURE_READ_FAILED"]),
      warnings: Object.freeze([]),
      error: error && error.message ? String(error.message) : String(error),
    });
  }
  const out = JSON.stringify(payload);
  if (payload.ok) console.log(out);
  else {
    console.error(out);
    process.exitCode = 1;
  }
  return payload;
}

if (require.main === module) {
  main();
} else {
  module.exports = {
    main,
    evaluateGcpCostPosture,
    normalizeArtifactRepository,
    normalizeCloudRunService,
    normalizeSchedulerJob,
    normalizeVpcConnector,
    __test: {
      trimOrNull,
      toPositiveInt,
      parseJsonArray,
      parseJsonObject,
      loadArtifactRepositories,
      loadSchedulerJobs,
      loadCloudRunServices,
      loadVpcConnectors,
      loadRecentCloudBuilds,
      REQUIRED_ARTIFACT_POLICIES,
      EXPECTED_LIQUIDATION_SCHEDULE,
    },
  };
}
