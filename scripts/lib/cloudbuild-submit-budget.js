"use strict";

const { execFileSync } = require("child_process");

const CLOUDBUILD_BUDGET_OVERRIDE_PHRASE = "OVERRIDE_V2_CLOUDBUILD_DAILY_BUDGET";

function trimOrNull(value) {
  const text = String(value == null ? "" : value).trim();
  return text || null;
}

function parseBool(value, fallback = false) {
  if (value === true || value === false) return value;
  const text = String(value == null ? "" : value).trim().toLowerCase();
  if (!text) return Boolean(fallback);
  if (["1", "true", "yes", "y", "on"].includes(text)) return true;
  if (["0", "false", "no", "n", "off"].includes(text)) return false;
  return Boolean(fallback);
}

function toPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function parseJsonArray(value) {
  const parsed = typeof value === "string" ? JSON.parse(value) : value;
  if (!parsed) return [];
  return Array.isArray(parsed) ? parsed : [parsed];
}

function resolveCloudBuildProject(env = process.env) {
  return trimOrNull(env.GOOGLE_CLOUD_PROJECT)
    || trimOrNull(env.GCLOUD_PROJECT)
    || trimOrNull(env.PROJECT_ID)
    || trimOrNull(env.CLOUDSDK_CORE_PROJECT);
}

function collectRecentCloudBuilds({
  env = process.env,
  execFileSyncFn = execFileSync,
  nowMs = Date.now(),
  windowHours = 24,
} = {}) {
  const fixture = trimOrNull(env.DONBEOLJA_V2_CLOUDBUILD_RECENT_BUILDS_JSON)
    || trimOrNull(env.V2_GCP_COST_POSTURE_RECENT_BUILDS_JSON);
  if (fixture) return parseJsonArray(fixture);
  const cutoffIso = new Date(Number(nowMs) - (Math.max(1, Number(windowHours) || 24) * 60 * 60 * 1000)).toISOString();
  const args = [
    "builds",
    "list",
    "--filter",
    `createTime>=${cutoffIso}`,
    "--format=json",
  ];
  const project = resolveCloudBuildProject(env);
  if (project) args.push(`--project=${project}`);
  const out = execFileSyncFn("gcloud", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return parseJsonArray(out);
}

function evaluateCloudBuildSubmitBudget({
  env = process.env,
  execFileSyncFn = execFileSync,
  nowMs = Date.now(),
} = {}) {
  if (parseBool(env.DONBEOLJA_V2_CLOUDBUILD_SUBMIT_BUDGET_DISABLED, false)) {
    return Object.freeze({
      ok: true,
      reason: "V2_CLOUDBUILD_SUBMIT_BUDGET_DISABLED",
      blockers: Object.freeze([]),
      disabled: true,
    });
  }
  const limit = toPositiveInt(env.DONBEOLJA_V2_CLOUDBUILD_DAILY_SUBMIT_LIMIT, 6);
  const windowHours = toPositiveInt(env.DONBEOLJA_V2_CLOUDBUILD_SUBMIT_BUDGET_WINDOW_HOURS, 24);
  const overrideConfirmed = trimOrNull(env.DONBEOLJA_V2_CLOUDBUILD_SUBMIT_BUDGET_OVERRIDE_CONFIRM) === CLOUDBUILD_BUDGET_OVERRIDE_PHRASE;
  let builds = [];
  try {
    builds = collectRecentCloudBuilds({ env, execFileSyncFn, nowMs, windowHours });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: "V2_CLOUDBUILD_SUBMIT_BUDGET_READ_FAILED",
      blockers: Object.freeze(["CLOUDBUILD_SUBMIT_BUDGET:READ_FAILED"]),
      error: error && error.message ? String(error.message) : String(error),
      limit,
      window_hours: windowHours,
      override_confirmed: overrideConfirmed,
      override_phrase_required: CLOUDBUILD_BUDGET_OVERRIDE_PHRASE,
    });
  }
  const rows = Array.isArray(builds) ? builds : [];
  const buildN = rows.length;
  const overBudget = buildN >= limit;
  const blockers = overBudget && !overrideConfirmed
    ? Object.freeze(["CLOUDBUILD_SUBMIT_BUDGET:DAILY_LIMIT_EXCEEDED"])
    : Object.freeze([]);
  return Object.freeze({
    ok: blockers.length === 0,
    reason: blockers.length === 0 ? "V2_CLOUDBUILD_SUBMIT_BUDGET_PASS" : "V2_CLOUDBUILD_SUBMIT_BUDGET_BLOCKED",
    blockers,
    build_n: buildN,
    limit,
    window_hours: windowHours,
    override_confirmed: overrideConfirmed,
    override_phrase_required: CLOUDBUILD_BUDGET_OVERRIDE_PHRASE,
    recent_build_ids: Object.freeze(rows
      .map((row) => trimOrNull(row && row.id))
      .filter(Boolean)
      .slice(0, 10)),
  });
}

function assertCloudBuildSubmitBudget(options = {}) {
  const result = evaluateCloudBuildSubmitBudget(options);
  if (result.ok !== true) {
    const error = new Error(result.reason || "V2_CLOUDBUILD_SUBMIT_BUDGET_BLOCKED");
    error.code = result.reason || "V2_CLOUDBUILD_SUBMIT_BUDGET_BLOCKED";
    error.details = result;
    throw error;
  }
  return result;
}

module.exports = {
  CLOUDBUILD_BUDGET_OVERRIDE_PHRASE,
  trimOrNull,
  parseBool,
  toPositiveInt,
  parseJsonArray,
  resolveCloudBuildProject,
  collectRecentCloudBuilds,
  evaluateCloudBuildSubmitBudget,
  assertCloudBuildSubmitBudget,
};
