#!/usr/bin/env node
"use strict";

const fs = require("fs");
const { execFileSync } = require("child_process");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function splitList(value) {
  return String(value || "")
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function readSchedulerJobs(env = process.env) {
  if (trimOrNull(env.DONBEOLJA_V2_SCHEDULER_JOBS_JSON)) {
    return JSON.parse(env.DONBEOLJA_V2_SCHEDULER_JOBS_JSON);
  }
  if (trimOrNull(env.DONBEOLJA_V2_SCHEDULER_JOBS_JSON_FILE)) {
    return JSON.parse(fs.readFileSync(env.DONBEOLJA_V2_SCHEDULER_JOBS_JSON_FILE, "utf8"));
  }
  const project = trimOrNull(env.GOOGLE_CLOUD_PROJECT) || trimOrNull(env.GCLOUD_PROJECT) || "donbeolja-dev";
  const location = trimOrNull(env.CLOUD_SCHEDULER_LOCATION) || trimOrNull(env.REGION) || "asia-northeast3";
  const raw = execFileSync("gcloud", [
    "scheduler",
    "jobs",
    "list",
    "--project",
    project,
    "--location",
    location,
    "--format=json",
  ], { encoding: "utf8" });
  return JSON.parse(raw);
}

function shortJobName(job) {
  const name = trimOrNull(job && job.name) || "";
  return name.split("/").filter(Boolean).pop() || name;
}

function normalizeState(value) {
  return String(value || "").trim().toUpperCase();
}

function statusCode(job) {
  const raw = job && job.status && job.status.code;
  if (raw == null || raw === "") return null;
  const num = Number(raw);
  return Number.isFinite(num) ? num : raw;
}

function buildIndex(jobs) {
  const rows = {};
  (Array.isArray(jobs) ? jobs : []).forEach((job) => {
    const shortName = shortJobName(job);
    if (shortName) rows[shortName] = job;
  });
  return Object.freeze(rows);
}

function evaluateSchedulerHealthDrift({ jobs = [], env = process.env } = {}) {
  const blockers = [];
  const warnings = [];
  const index = buildIndex(jobs);
  const requiredEnabled = splitList(env.DONBEOLJA_V2_SCHEDULER_REQUIRED_ENABLED_JOBS
    || "v2-production-entry-route-canary,v2-exit-runtime-canary,v2-active-protection-reconciliation");
  const requiredPaused = splitList(env.DONBEOLJA_V2_SCHEDULER_REQUIRED_PAUSED_JOBS
    || "donbeolja-tick-5m");
  const statusCheckEnabled = String(env.DONBEOLJA_V2_SCHEDULER_STATUS_CHECK_ENABLED || "1") !== "0";
  const statusAllowlist = new Set(splitList(env.DONBEOLJA_V2_SCHEDULER_STATUS_CODE_ALLOWLIST || "0"));
  const enabledRows = [];

  requiredEnabled.forEach((name) => {
    const job = index[name];
    if (!job) {
      blockers.push(`SCHEDULER_HEALTH:${name}:MISSING`);
      return;
    }
    if (normalizeState(job.state) !== "ENABLED") {
      blockers.push(`SCHEDULER_HEALTH:${name}:NOT_ENABLED`);
    }
  });

  requiredPaused.forEach((name) => {
    const job = index[name];
    if (!job) {
      warnings.push(`SCHEDULER_HEALTH:${name}:PAUSED_JOB_MISSING`);
      return;
    }
    const state = normalizeState(job.state);
    if (state !== "PAUSED" && state !== "DISABLED") {
      blockers.push(`SCHEDULER_HEALTH:${name}:NOT_PAUSED`);
    }
  });

  if (statusCheckEnabled) {
    Object.entries(index).forEach(([name, job]) => {
      if (normalizeState(job.state) !== "ENABLED") return;
      const code = statusCode(job);
      enabledRows.push(Object.freeze({ name, status_code: code, state: normalizeState(job.state) }));
      if (code != null && !statusAllowlist.has(String(code))) {
        blockers.push(`SCHEDULER_HEALTH:${name}:STATUS_CODE_${code}`);
      }
    });
  }

  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0 ? "V2_SCHEDULER_HEALTH_DRIFT_PASS" : "V2_SCHEDULER_HEALTH_DRIFT_BLOCKED",
    blockers: Object.freeze(blockers),
    warnings: Object.freeze(warnings),
    required_enabled_jobs: Object.freeze(requiredEnabled),
    required_paused_jobs: Object.freeze(requiredPaused),
    enabled_job_statuses: Object.freeze(enabledRows),
    job_count: Object.keys(index).length,
  });
}

function runCheck(env = process.env) {
  try {
    const jobs = readSchedulerJobs(env);
    return evaluateSchedulerHealthDrift({ jobs, env });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: "V2_SCHEDULER_HEALTH_DRIFT_READ_FAILED",
      blockers: Object.freeze(["SCHEDULER_HEALTH:READ_FAILED"]),
      error: error && error.message ? error.message : String(error),
    });
  }
}

if (require.main === module) {
  const result = runCheck(process.env);
  const out = JSON.stringify(result);
  if (result.ok) {
    console.log(out);
  } else {
    console.error(out);
    process.exitCode = 1;
  }
} else {
  module.exports = {
    runCheck,
    evaluateSchedulerHealthDrift,
    __test: {
      trimOrNull,
      splitList,
      shortJobName,
      normalizeState,
      statusCode,
      buildIndex,
    },
  };
}
