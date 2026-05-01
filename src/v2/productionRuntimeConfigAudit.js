"use strict";

const fs = require("fs");
const path = require("path");

const REQUIRED_CUTOVER_SUBSTITUTIONS = Object.freeze([
  "_ML_LIVE_SERVING_ARMED",
  "_COMMIT_SHA",
  "_DONBEOLJA_V2_ENABLED",
  "_DONBEOLJA_V2_DRY_RUN",
  "_DONBEOLJA_V2_CANARY_ONLY",
  "_DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER",
  "_DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED",
  "_DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL",
  "_DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL",
  "_DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED",
  "_DONBEOLJA_V2_ALLOW_LEGACY_SCHEDULER_WRITES",
  "_DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED",
  "_DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED",
  "_DONBEOLJA_V2_COLLECTION_PREFIX",
  "_DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED",
  "_DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED",
  "_DONBEOLJA_V2_INITIAL_PROTECTION_DEADLINE_ENABLED",
  "_DONBEOLJA_SIGNAL_DROP_CONSUME_LOCK_ENABLED",
  "_DONBEOLJA_V2_REPAIR_WRITER_LEASE_FIRESTORE_ENABLED",
  "_DONBEOLJA_V2_REPAIR_WRITER_LEASE_TTL_MS",
  "_DONBEOLJA_V2_REPAIR_WRITER_LEASE_HEARTBEAT_MS",
  "_DONBEOLJA_V2_RISK_MAX_ACCOUNT_LEVERAGE",
  "_V2_FUTURES_DEFAULT_LEVERAGE",
  "_DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE",
  "_DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE",
  "_DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE",
  "_DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE",
  "_DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON",
  "_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED",
  "_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED",
  "_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE",
  "_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE",
  "_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED",
  "_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED",
  "_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE",
  "_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE",
  "_V2_FIRESTORE_COST_GUARD_REQUIRE_BILLING_METRIC",
  "_DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED",
  "_DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS",
  "_DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT",
  "_DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE",
  "_DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP",
  "_DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT",
  "_DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY",
  "_DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE",
]);

const REQUIRED_CUTOVER_ENV = Object.freeze({
  DONBEOLJA_V2_ENABLED: "$_DONBEOLJA_V2_ENABLED",
  DONBEOLJA_V2_DRY_RUN: "$_DONBEOLJA_V2_DRY_RUN",
  DONBEOLJA_V2_CANARY_ONLY: "$_DONBEOLJA_V2_CANARY_ONLY",
  DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER: "$_DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER",
  DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED: "$_DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED",
  DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL: "$_DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL",
  DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL: "$_DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL",
  DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: "$_DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED",
  DONBEOLJA_V2_ALLOW_LEGACY_SCHEDULER_WRITES: "$_DONBEOLJA_V2_ALLOW_LEGACY_SCHEDULER_WRITES",
  DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED: "$_DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED",
  DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED: "$_DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED",
  DONBEOLJA_V2_COLLECTION_PREFIX: "$_DONBEOLJA_V2_COLLECTION_PREFIX",
  DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "$_DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED",
  DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED: "$_DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED",
  DONBEOLJA_V2_INITIAL_PROTECTION_DEADLINE_ENABLED: "$_DONBEOLJA_V2_INITIAL_PROTECTION_DEADLINE_ENABLED",
  DONBEOLJA_SIGNAL_DROP_CONSUME_LOCK_ENABLED: "$_DONBEOLJA_SIGNAL_DROP_CONSUME_LOCK_ENABLED",
  DONBEOLJA_V2_REPAIR_WRITER_LEASE_FIRESTORE_ENABLED: "$_DONBEOLJA_V2_REPAIR_WRITER_LEASE_FIRESTORE_ENABLED",
  DONBEOLJA_V2_REPAIR_WRITER_LEASE_TTL_MS: "$_DONBEOLJA_V2_REPAIR_WRITER_LEASE_TTL_MS",
  DONBEOLJA_V2_REPAIR_WRITER_LEASE_HEARTBEAT_MS: "$_DONBEOLJA_V2_REPAIR_WRITER_LEASE_HEARTBEAT_MS",
  DONBEOLJA_V2_RISK_MAX_ACCOUNT_LEVERAGE: "$_DONBEOLJA_V2_RISK_MAX_ACCOUNT_LEVERAGE",
  V2_FUTURES_DEFAULT_LEVERAGE: "$_V2_FUTURES_DEFAULT_LEVERAGE",
  DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE: "$_DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE",
  DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE: "$_DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE",
  DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE: "$_DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE",
  DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE: "$_DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE",
  DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED: "$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED",
  DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED: "$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED",
  DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE: "$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE",
  DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE: "$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE",
  DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED: "$_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED",
  DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED: "$_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED",
  DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE: "$_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE",
  DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE: "$_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE",
  V2_FIRESTORE_COST_GUARD_REQUIRE_BILLING_METRIC: "$_V2_FIRESTORE_COST_GUARD_REQUIRE_BILLING_METRIC",
  DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "$_DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED",
  DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: "$_DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS",
  DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT: "$_DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT",
  DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE: "$_DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE",
  DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP: "$_DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP",
  DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT: "$_DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT",
  DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY: "$_DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY",
  DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE: "$_DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE",
  OPENCLAW_AGENT_APPLY_ENABLED: "0",
  ML_LIVE_SERVING_ARMED: "$_ML_LIVE_SERVING_ARMED",
  OPENCLAW_NARRATIVE_SHADOW_ONLY: "1",
  SCHEDULER_AUTOSTART: "0",
});

const REQUIRED_DEPLOY_LABELS = Object.freeze({
  "commit-sha": "$_COMMIT_SHA",
  "image-tag": "$_TAG",
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

function parseLabelsArg(labelsArg = "") {
  const rows = {};
  String(labelsArg || "").split(",").forEach((entry) => {
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

function extractDeployUpdateLabels(cloudbuildSource = "", serviceToken = "$_SERVICE") {
  const source = String(cloudbuildSource || "");
  const marker = `"run", "deploy", "${serviceToken}"`;
  const start = source.indexOf(marker);
  if (start < 0) return null;
  const rest = source.slice(start);
  const line = rest.split(/\r?\n/).find((row) => row.includes('"--update-labels"'));
  if (!line) return null;
  const match = line.match(/"--update-labels",\s*"([^"]*)"/);
  return match ? parseLabelsArg(match[1]) : null;
}

function hasSelfCheckInCloudBuildValidation(cloudbuildSource = "") {
  return String(cloudbuildSource || "").includes("npm run check:v2-production-runtime-config");
}

function hasSchedulerTrafficStateForwardedToPromotionRuntime(cloudbuildSource = "") {
  const source = String(cloudbuildSource || "");
  return source.includes("DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON=$_DONBEOLJA_V2_SCHEDULER_TRAFFIC_STATE_JSON")
    && source.includes("npm run run:v2-promotion-cloudbuild");
}

function hasV2CutoverEnvForwardedToPromotionRuntime(cloudbuildSource = "") {
  const source = String(cloudbuildSource || "");
  return [
    "DONBEOLJA_V2_ENABLED=$_DONBEOLJA_V2_ENABLED",
    "DONBEOLJA_V2_DRY_RUN=$_DONBEOLJA_V2_DRY_RUN",
    "DONBEOLJA_V2_CANARY_ONLY=$_DONBEOLJA_V2_CANARY_ONLY",
    "DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER=$_DONBEOLJA_V2_REQUIRE_PRODUCTION_CUTOVER",
    "DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED=$_DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED",
    "DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL=$_DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL",
    "DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL=$_DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL",
    "DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED=$_DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED",
    "DONBEOLJA_V2_ALLOW_LEGACY_SCHEDULER_WRITES=$_DONBEOLJA_V2_ALLOW_LEGACY_SCHEDULER_WRITES",
    "DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED=$_DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED",
    "DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED=$_DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED",
    "DONBEOLJA_V2_COLLECTION_PREFIX=$_DONBEOLJA_V2_COLLECTION_PREFIX",
    "DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE=$_DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE",
    "DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED=$_DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED",
  "DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED=$_DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED",
  "DONBEOLJA_V2_INITIAL_PROTECTION_DEADLINE_ENABLED=$_DONBEOLJA_V2_INITIAL_PROTECTION_DEADLINE_ENABLED",
  "DONBEOLJA_SIGNAL_DROP_CONSUME_LOCK_ENABLED=$_DONBEOLJA_SIGNAL_DROP_CONSUME_LOCK_ENABLED",
  "DONBEOLJA_V2_REPAIR_WRITER_LEASE_FIRESTORE_ENABLED=$_DONBEOLJA_V2_REPAIR_WRITER_LEASE_FIRESTORE_ENABLED",
  "DONBEOLJA_V2_REPAIR_WRITER_LEASE_TTL_MS=$_DONBEOLJA_V2_REPAIR_WRITER_LEASE_TTL_MS",
  "DONBEOLJA_V2_REPAIR_WRITER_LEASE_HEARTBEAT_MS=$_DONBEOLJA_V2_REPAIR_WRITER_LEASE_HEARTBEAT_MS",
  "DONBEOLJA_V2_RISK_MAX_ACCOUNT_LEVERAGE=$_DONBEOLJA_V2_RISK_MAX_ACCOUNT_LEVERAGE",
    "V2_FUTURES_DEFAULT_LEVERAGE=$_V2_FUTURES_DEFAULT_LEVERAGE",
    "DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE=$_DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE",
    "DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE=$_DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE",
    "DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE=$_DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE",
    "DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED=$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED",
    "DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED=$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED",
    "DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE=$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE",
    "DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE=$_DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE",
    "DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED=$_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED",
    "DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED=$_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED",
    "DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE=$_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE",
    "DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE=$_DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE",
  ].every((needle) => source.includes(needle)) && source.includes("npm run run:v2-promotion-cloudbuild");
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

function buildRequiredLabelMappingChecks(serviceLabel, labels) {
  const rows = [];
  const current = labels || {};
  Object.entries(REQUIRED_DEPLOY_LABELS).forEach(([name, expected]) => {
    rows.push(buildCheck(
      `${serviceLabel}_LABEL_${name.toUpperCase().replace(/[^A-Z0-9]+/g, "_")}_MAPPED`,
      current[name] === expected,
      `${serviceLabel} must map deploy label ${name} to ${expected}`,
      { actual: current[name] || null, expected }
    ));
  });
  return rows;
}

function hasRetiredLegacyStrategySurface(envVars, { requireWebhookAllowlist = false } = {}) {
  const env = envVars || {};
  const strategyId = String(env.DONBEOLJA_STRATEGY_ID || "");
  const allowedIds = String(env.WEBHOOK_ALLOWED_STRATEGY_IDS || "");
  const engineVersion = String(env.ENGINE_VERSION || "");
  const combined = `${strategyId}\n${allowedIds}\n${engineVersion}`;
  return !/(donbeolja_v[0-6]\.|STRAT_v\d+|^6\.)/im.test(combined)
    && strategyId === "donbeolja_v2_openclaw"
    && (requireWebhookAllowlist ? allowedIds === "V2_SERVER_NATIVE_ONLY" : (allowedIds === "" || allowedIds === "V2_SERVER_NATIVE_ONLY"))
    && engineVersion === "2.0.0";
}

function hasCodexOnlyRuntimeImageSurface(dockerfileSource = "") {
  const source = String(dockerfileSource || "");
  if (!source.trim()) return true;
  return !/(@anthropic-ai\/claude-code|OPENCLAW_CLAUDE_|ANTHROPIC_API_KEY|OPENCLAW_NARRATIVE_PROVIDER_MODE=CLI|claude --version)/i.test(source);
}

function auditV2ProductionRuntimeConfigContract({ cloudbuildSource = "", dockerfileSource = "" } = {}) {
  const substitutions = parseSubstitutionDefaults(cloudbuildSource);
  const mainEnv = extractDeploySetEnvVars(cloudbuildSource, "$_SERVICE");
  const mainLabels = extractDeployUpdateLabels(cloudbuildSource, "$_SERVICE");
  const egressLabels = extractDeployUpdateLabels(cloudbuildSource, "$_EGRESS_SERVICE");
  const egressPrivateLabels = extractDeployUpdateLabels(cloudbuildSource, "$_EGRESS_PRIVATE_SERVICE");
  const exitEnv = extractDeploySetEnvVars(cloudbuildSource, "$_EXIT_SERVICE");
  const exitLabels = extractDeployUpdateLabels(cloudbuildSource, "$_EXIT_SERVICE");
  const checks = [
    ...REQUIRED_CUTOVER_SUBSTITUTIONS.map((name) => buildCheck(
      `CLOUDBUILD_SUBSTITUTION_${name}`,
      Object.prototype.hasOwnProperty.call(substitutions, name),
      `cloudbuild substitutions must declare ${name}`,
      { value: Object.prototype.hasOwnProperty.call(substitutions, name) ? substitutions[name] : null }
    )),
    buildCheck(
      "CLOUDBUILD_DEFAULT_V2_ENABLED_CANARY_SAFE",
      substitutions._DONBEOLJA_V2_ENABLED === "1",
      "default Cloud Build deploy must keep V2 enabled so direct builds cannot roll back to V1-disabled runtime",
      { value: substitutions._DONBEOLJA_V2_ENABLED || null }
    ),
    buildCheck(
      "CLOUDBUILD_DEFAULT_V2_DRY_RUN_OFF_CANARY_SAFE",
      substitutions._DONBEOLJA_V2_DRY_RUN === "0",
      "default Cloud Build deploy must match the guarded V2 canary runtime rather than a dry-run-only revision",
      { value: substitutions._DONBEOLJA_V2_DRY_RUN || null }
    ),
    buildCheck(
      "CLOUDBUILD_DEFAULT_V2_CANARY_ONLY_ON",
      substitutions._DONBEOLJA_V2_CANARY_ONLY === "1",
      "default Cloud Build deploy must remain canary-only unless the submit wrapper explicitly promotes LIVE",
      { value: substitutions._DONBEOLJA_V2_CANARY_ONLY || null }
    ),
    buildCheck(
      "CLOUDBUILD_DEFAULT_DISCOVERY_LIVE_ENDPOINT_ON",
      substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED === "1",
      "default Cloud Build deploy must preserve the guarded V2 discovery live endpoint; canary_only still blocks formal LIVE",
      { value: substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED || null }
    ),
    buildCheck(
      "CLOUDBUILD_DEFAULT_DISCOVERY_CANARY_ON",
      substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED === "1",
      "default Cloud Build deploy must preserve discovery canary mode so direct builds cannot silently disable sampling",
      { value: substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED || null }
    ),
    buildCheck(
      "CLOUDBUILD_DEFAULT_DISCOVERY_SYMBOLS_CONFIGURED",
      String(substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS || "").split(/[|,]/).filter(Boolean).length > 0,
      "default Cloud Build deploy must keep a non-empty discovery symbol allowlist",
      { value: substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS || null }
    ),
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
      "CLOUDBUILD_PROMOTION_RUNTIME_FORWARDS_V2_CUTOVER_ENV",
      hasV2CutoverEnvForwardedToPromotionRuntime(cloudbuildSource),
      "Cloud Build promotion runtime must forward V2 cutover env substitutions into run:v2-promotion-cloudbuild"
    ),
    buildCheck(
      "CLOUDBUILD_PROMOTION_RUNTIME_HAS_GCLOUD_AND_NODE",
      hasPromotionRuntimeGcloudAvailable(cloudbuildSource),
      "Cloud Build promotion runtime must run in a cloud-sdk image with node/npm available so scheduler traffic collector can execute"
    ),
    buildCheck(
      "DOCKERFILE_CODEX_ONLY_RUNTIME_SURFACE",
      hasCodexOnlyRuntimeImageSurface(dockerfileSource),
      "runtime image must not install or default to alternate LLM providers"
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
    buildCheck(
      "CLOUDBUILD_MAIN_SERVICE_LABELS_FOUND",
      !!mainLabels,
      "main Cloud Run deploy step must expose --update-labels"
    ),
    buildCheck(
      "CLOUDBUILD_EGRESS_SERVICE_LABELS_FOUND",
      !!egressLabels,
      "egress Cloud Run deploy step must expose --update-labels"
    ),
    buildCheck(
      "CLOUDBUILD_EGRESS_PRIVATE_SERVICE_LABELS_FOUND",
      !!egressPrivateLabels,
      "egress-private Cloud Run deploy step must expose --update-labels"
    ),
    buildCheck(
      "CLOUDBUILD_EXIT_SERVICE_LABELS_FOUND",
      !!exitLabels,
      "exit-worker Cloud Run deploy step must expose --update-labels"
    ),
    ...buildRequiredEnvMappingChecks("MAIN_SERVICE", mainEnv),
    ...buildRequiredEnvMappingChecks("EXIT_SERVICE", exitEnv),
    buildCheck(
      "MAIN_SERVICE_LEGACY_STRATEGY_SURFACE_RETIRED",
      hasRetiredLegacyStrategySurface(mainEnv, { requireWebhookAllowlist: true }),
      "main Cloud Run env must not advertise V1/V6 strategy ids or legacy webhook allowlists",
      {
        DONBEOLJA_STRATEGY_ID: mainEnv && mainEnv.DONBEOLJA_STRATEGY_ID || null,
        WEBHOOK_ALLOWED_STRATEGY_IDS: mainEnv && mainEnv.WEBHOOK_ALLOWED_STRATEGY_IDS || null,
        ENGINE_VERSION: mainEnv && mainEnv.ENGINE_VERSION || null,
      }
    ),
    buildCheck(
      "EXIT_SERVICE_LEGACY_STRATEGY_SURFACE_RETIRED",
      hasRetiredLegacyStrategySurface(exitEnv),
      "exit-worker Cloud Run env must not advertise V1/V6 strategy ids",
      {
        DONBEOLJA_STRATEGY_ID: exitEnv && exitEnv.DONBEOLJA_STRATEGY_ID || null,
        WEBHOOK_ALLOWED_STRATEGY_IDS: exitEnv && exitEnv.WEBHOOK_ALLOWED_STRATEGY_IDS || null,
        ENGINE_VERSION: exitEnv && exitEnv.ENGINE_VERSION || null,
      }
    ),
    ...buildRequiredLabelMappingChecks("MAIN_SERVICE", mainLabels),
    ...buildRequiredLabelMappingChecks("EGRESS_SERVICE", egressLabels),
    ...buildRequiredLabelMappingChecks("EGRESS_PRIVATE_SERVICE", egressPrivateLabels),
    ...buildRequiredLabelMappingChecks("EXIT_SERVICE", exitLabels),
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
    main_service_labels: mainLabels ? Object.freeze({ ...mainLabels }) : null,
    egress_service_labels: egressLabels ? Object.freeze({ ...egressLabels }) : null,
    egress_private_service_labels: egressPrivateLabels ? Object.freeze({ ...egressPrivateLabels }) : null,
    exit_service_env: exitEnv ? Object.freeze({ ...exitEnv }) : null,
    exit_service_labels: exitLabels ? Object.freeze({ ...exitLabels }) : null,
    checks: Object.freeze(checks),
  });
}

function auditWorkspaceV2ProductionRuntimeConfigContract({ rootDir = path.resolve(__dirname, "../..") } = {}) {
  return auditV2ProductionRuntimeConfigContract({
    cloudbuildSource: readTextSafe(path.join(rootDir, "cloudbuild.yaml")),
    dockerfileSource: readTextSafe(path.join(rootDir, "Dockerfile")),
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
    parseLabelsArg,
    extractDeploySetEnvVars,
    extractDeployUpdateLabels,
    hasSelfCheckInCloudBuildValidation,
    hasSchedulerTrafficStateForwardedToPromotionRuntime,
    hasV2CutoverEnvForwardedToPromotionRuntime,
    hasPromotionRuntimeGcloudAvailable,
    hasCodexOnlyRuntimeImageSurface,
  },
};
