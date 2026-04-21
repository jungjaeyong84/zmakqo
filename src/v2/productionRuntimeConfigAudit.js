"use strict";

const fs = require("fs");
const path = require("path");

const REQUIRED_CUTOVER_SUBSTITUTIONS = Object.freeze([
  "_DONBEOLJA_V2_ENABLED",
  "_DONBEOLJA_V2_DRY_RUN",
  "_DONBEOLJA_V2_CANARY_ONLY",
  "_DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER",
  "_DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL",
  "_DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL",
  "_DONBEOLJA_V2_COLLECTION_PREFIX",
  "_DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE",
  "_DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON",
]);

const REQUIRED_CUTOVER_ENV = Object.freeze({
  DONBEOLJA_V2_ENABLED: "$_DONBEOLJA_V2_ENABLED",
  DONBEOLJA_V2_DRY_RUN: "$_DONBEOLJA_V2_DRY_RUN",
  DONBEOLJA_V2_CANARY_ONLY: "$_DONBEOLJA_V2_CANARY_ONLY",
  DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER: "$_DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER",
  DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL: "$_DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL",
  DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL: "$_DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL",
  DONBEOLJA_V2_COLLECTION_PREFIX: "$_DONBEOLJA_V2_COLLECTION_PREFIX",
  DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE: "$_DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE",
  SCHEDULER_AUTOSTART: "0",
});

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function readTextSafe(filePath) {
  try {
    return fs.readFileSync(path.resolve(filePath), "utf8");
  } catch (_error) {
    return "";
  }
}

function buildCheck(id, ok, reason, evidence = {}) {
  return Object.freeze({
    id,
    ok: ok === true,
    reason: trimOrNull(reason),
    evidence: Object.freeze({ ...evidence }),
  });
}

function parseSubstitutionDefaults(cloudbuildSource = "") {
  const rows = {};
  String(cloudbuildSource || "").split(/\r?\n/).forEach((line) => {
    const match = line.match(/^\s{2}(_[A-Z0-9_]+):\s*"([^"]*)"\s*$/);
    if (match) rows[match[1]] = match[2];
  });
  return Object.freeze(rows);
}

function parseEnvArg(envArg = "") {
  const text = String(envArg || "").replace(/^\^\;\^/, "");
  const rows = {};
  text.split(";").forEach((entry) => {
    const idx = entry.indexOf("=");
    if (idx <= 0) return;
    const key = entry.slice(0, idx).trim();
    const value = entry.slice(idx + 1).trim();
    if (key) rows[key] = value;
  });
  return Object.freeze(rows);
}

function extractDeploySetEnvVars(cloudbuildSource = "", serviceToken = "$_SERVICE") {
  const source = String(cloudbuildSource || "");
  const marker = `"run", "deploy", "${serviceToken}"`;
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const rest = source.slice(start);
  const line = rest.split(/\r?\n/).find((row) => row.includes('"--set-env-vars"'));
  if (!line) return null;
  const match = line.match(/"--set-env-vars",\s*"([^"]*)"/);
  return match ? parseEnvArg(match[1]) : null;
}

function hasSelfCheckInCloudBuildValidation(cloudbuildSource = "") {
  return String(cloudbuildSource || "").includes("npm run check:v2-production-runtime-config");
}

function hasSchedulerTrafficStateForwardedToPromotionRuntime(cloudbuildSource = "") {
  return String(cloudbuildSource || "").includes("DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON=$_DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON npm run run:v2-promotion-cloudbuild");
}

function hasPromotionRuntimeGcloudAvailable(cloudbuildSource = "") {
  const source = String(cloudbuildSource || "");
  return source.includes('name: "gcr.io/google.com/cloudsdktool/cloud-sdk:alpine"')
    && source.includes("apk add --no-cache nodejs npm")
    && source.includes("npm run run:v2-promotion-cloudbuild");
}

function buildRequiredEnvMappingChecks(serviceLabel, envVars) {
  const rows = [];
  const env = envVars || {};
  Object.entries(REQUIRED_CUTOVER_ENV).forEach(([name, expected]) => {
    rows.push(buildCheck(
      `${serviceLabel}_${name}_MAPPED`,
      env[name] === expected,
      `${serviceLabel} must map ${name} to ${expected}`,
      { actual: env[name] || null, expected }
    ));
  });
  return rows;
}

function auditV2ProductionRuntimeConfigContract({ cloudbuildSource = "" } = {}) {
  const substitutions = parseSubstitutionDefaults(cloudbuildSource);
  const mainEnv = extractDeploySetEnvVars(cloudbuildSource, "$_SERVICE");
  const exitEnv = extractDeploySetEnvVars(cloudbuildSource, "$_EXIT_SERVICE");
  const checks = [
    ...REQUIRED_CUTOVER_SUBSTITUTIONS.map((name) => buildCheck(
      `CLOUDBUILD_SUBSTITUTION_${name}`,
      Object.prototype.hasOwnProperty.call(substitutions, name),
      `cloudbuild substitutions must declare ${name}`,
      { value: Object.prototype.hasOwnProperty.call(substitutions, name) ? substitutions[name] : null }
    )),
    buildCheck(
      "CLOUDBUILD_DEFAULT_SCHEDULER_CUTOVER_MODE_OPENCLAW_CRON",
      substitutions._DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE === "OPENCLAW_CRON",
      "default V2 scheduler cutover mode must be OPENCLAW_CRON",
      { value: substitutions._DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE || null }
    ),
    buildCheck(
      "CLOUDBUILD_PROMOTION_RUNTIME_FORWARDS_SCHEDULER_TRAFFIC_STATE",
      hasSchedulerTrafficStateForwardedToPromotionRuntime(cloudbuildSource),
      "Cloud Build promotion runtime must forward DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON into run:v2-promotion-cloudbuild"
    ),
    buildCheck(
      "CLOUDBUILD_PROMOTION_RUNTIME_HAS_GCLOUD_AND_NODE",
      hasPromotionRuntimeGcloudAvailable(cloudbuildSource),
      "Cloud Build promotion runtime must run in a cloud-sdk image with node/npm available so scheduler traffic collector can execute"
    ),
    buildCheck(
      "CLOUDBUILD_MAIN_SERVICE_ENV_FOUND",
      !!mainEnv,
      "main Cloud Run deploy step must expose --set-env-vars"
    ),
    buildCheck(
      "CLOUDBUILD_EXIT_SERVICE_ENV_FOUND",
      !!exitEnv,
      "exit-worker Cloud Run deploy step must expose --set-env-vars"
    ),
    ...buildRequiredEnvMappingChecks("MAIN_SERVICE", mainEnv),
    ...buildRequiredEnvMappingChecks("EXIT_SERVICE", exitEnv),
    buildCheck(
      "CLOUDBUILD_VALIDATION_RUNS_RUNTIME_CONFIG_AUDIT",
      hasSelfCheckInCloudBuildValidation(cloudbuildSource),
      "Cloud Build validation step must run check:v2-production-runtime-config before deploy"
    ),
  ];
  const failed = checks.filter((row) => row.ok !== true);
  return Object.freeze({
    ok: failed.length === 0,
    reason: failed.length === 0
      ? "V2_PRODUCTION_RUNTIME_CONFIG_CONTRACT_PASS"
      : "V2_PRODUCTION_RUNTIME_CONFIG_CONTRACT_BLOCKED",
    check_n: checks.length,
    fail_n: failed.length,
    failed_check_ids: Object.freeze(failed.map((row) => row.id)),
    substitutions: Object.freeze({ ...substitutions }),
    main_service_env: mainEnv ? Object.freeze({ ...mainEnv }) : null,
    exit_service_env: exitEnv ? Object.freeze({ ...exitEnv }) : null,
    checks: Object.freeze(checks),
  });
}

function auditWorkspaceV2ProductionRuntimeConfigContract({ rootDir = path.resolve(__dirname, "../..") } = {}) {
  return auditV2ProductionRuntimeConfigContract({
    cloudbuildSource: readTextSafe(path.join(rootDir, "cloudbuild.yaml")),
  });
}

module.exports = {
  REQUIRED_CUTOVER_SUBSTITUTIONS,
  REQUIRED_CUTOVER_ENV,
  auditV2ProductionRuntimeConfigContract,
  auditWorkspaceV2ProductionRuntimeConfigContract,
  __test: {
    trimOrNull,
    readTextSafe,
    buildCheck,
    parseSubstitutionDefaults,
    parseEnvArg,
    extractDeploySetEnvVars,
    hasSelfCheckInCloudBuildValidation,
    hasSchedulerTrafficStateForwardedToPromotionRuntime,
    hasPromotionRuntimeGcloudAvailable,
  },
};
