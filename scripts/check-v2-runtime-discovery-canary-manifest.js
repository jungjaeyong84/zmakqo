#!/usr/bin/env node
"use strict";

const fs = require("fs");
const { execFileSync } = require("child_process");
const {
  DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP_TEXT,
} = require("../src/v2/discoveryCanaryNotionalPolicy");

const DEFAULT_DISCOVERY_CANARY_SYMBOLS = "BTCUSDT|ETHUSDT|BNBUSDT|XRPUSDT|SOLUSDT|AXSUSDT|DOGEUSDT|LINKUSDT";
const DEFAULT_DISCOVERY_CANARY_MAX_SYMBOL_COUNT = "8";
const DEFAULT_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE = "6";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function splitSymbols(value) {
  return String(value || "")
    .split(/[|,]/)
    .map((item) => item.trim().toUpperCase())
    .filter(Boolean);
}

function splitServices(value) {
  return String(value || "")
    .split(/[|,]/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function normalizeSymbolList(value) {
  return splitSymbols(value).sort().join("|");
}

function readServiceJson(env = process.env) {
  if (trimOrNull(env.DONBEOLJA_V2_RUNTIME_SERVICE_JSON)) {
    return JSON.parse(env.DONBEOLJA_V2_RUNTIME_SERVICE_JSON);
  }
  if (trimOrNull(env.DONBEOLJA_V2_RUNTIME_SERVICE_JSON_FILE)) {
    return JSON.parse(fs.readFileSync(env.DONBEOLJA_V2_RUNTIME_SERVICE_JSON_FILE, "utf8"));
  }
  const service = trimOrNull(env.DONBEOLJA_V2_RUNTIME_SERVICE) || "donbeolja";
  const region = trimOrNull(env.REGION) || trimOrNull(env._REGION) || "asia-northeast3";
  const project = trimOrNull(env.GOOGLE_CLOUD_PROJECT) || trimOrNull(env.GCLOUD_PROJECT) || "donbeolja-dev";
  const raw = execFileSync("gcloud", [
    "run",
    "services",
    "describe",
    service,
    "--region",
    region,
    "--project",
    project,
    "--format=json",
  ], { encoding: "utf8" });
  return JSON.parse(raw);
}

function readServiceManifests(env = process.env) {
  if (trimOrNull(env.DONBEOLJA_V2_RUNTIME_SERVICE_JSON_MAP)) {
    const parsed = JSON.parse(env.DONBEOLJA_V2_RUNTIME_SERVICE_JSON_MAP);
    return Object.freeze(Object.entries(parsed || {}).map(([serviceName, serviceJson]) => Object.freeze({
      service_name: serviceName,
      service_json: serviceJson,
    })));
  }
  if (trimOrNull(env.DONBEOLJA_V2_RUNTIME_SERVICE_JSON) || trimOrNull(env.DONBEOLJA_V2_RUNTIME_SERVICE_JSON_FILE)) {
    return Object.freeze([Object.freeze({
      service_name: trimOrNull(env.DONBEOLJA_V2_RUNTIME_SERVICE) || "donbeolja",
      service_json: readServiceJson(env),
    })]);
  }
  const services = splitServices(
    env.DONBEOLJA_V2_RUNTIME_SERVICES
      || "donbeolja,donbeolja-exit-worker,donbeolja-egress,donbeolja-egress-private",
  );
  return Object.freeze(services.map((service) => {
    const serviceEnv = Object.assign({}, env, { DONBEOLJA_V2_RUNTIME_SERVICE: service });
    return Object.freeze({ service_name: service, service_json: readServiceJson(serviceEnv) });
  }));
}

function extractEnvMap(serviceJson) {
  const containers = (((serviceJson || {}).spec || {}).template || {}).spec
    ? serviceJson.spec.template.spec.containers || []
    : [];
  const envEntries = containers[0] && Array.isArray(containers[0].env) ? containers[0].env : [];
  return envEntries.reduce((acc, item) => {
    if (item && item.name) acc[item.name] = item.value == null ? null : String(item.value);
    return acc;
  }, {});
}

function extractImage(serviceJson) {
  const containers = (((serviceJson || {}).spec || {}).template || {}).spec
    ? serviceJson.spec.template.spec.containers || []
    : [];
  return containers[0] && containers[0].image ? String(containers[0].image) : "";
}

function extractLabels(serviceJson) {
  return Object.assign({}, ((serviceJson || {}).metadata || {}).labels || {});
}

function expectedValue(env, expectedName, runtimeName, fallback) {
  return trimOrNull(env[expectedName]) || trimOrNull(env[runtimeName]) || fallback;
}

function buildExpectedEnv(env = process.env) {
  return Object.freeze({
    DONBEOLJA_V2_ENABLED: expectedValue(env, "DONBEOLJA_V2_EXPECTED_ENABLED", "DONBEOLJA_V2_ENABLED", "1"),
    DONBEOLJA_V2_DRY_RUN: expectedValue(env, "DONBEOLJA_V2_EXPECTED_DRY_RUN", "DONBEOLJA_V2_DRY_RUN", "0"),
    DONBEOLJA_V2_CANARY_ONLY: expectedValue(env, "DONBEOLJA_V2_EXPECTED_CANARY_ONLY", "DONBEOLJA_V2_CANARY_ONLY", "1"),
    DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED",
      "DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED",
      "1",
    ),
    DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_RISK_GOVERNOR_REQUIRED",
      "DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED",
      "1",
    ),
    DONBEOLJA_V2_SAME_DIRECTION_COOLDOWN_ENABLED: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_SAME_DIRECTION_COOLDOWN_ENABLED",
      "DONBEOLJA_V2_SAME_DIRECTION_COOLDOWN_ENABLED",
      "1",
    ),
    DONBEOLJA_V2_SAME_DIRECTION_COOLDOWN_BARS: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_SAME_DIRECTION_COOLDOWN_BARS",
      "DONBEOLJA_V2_SAME_DIRECTION_COOLDOWN_BARS",
      "8",
    ),
    DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_ENABLED",
      "DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED",
      "1",
    ),
    DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_SYMBOLS",
      "DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS",
      DEFAULT_DISCOVERY_CANARY_SYMBOLS,
    ),
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_MAX_SYMBOL_COUNT",
      "DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT",
      DEFAULT_DISCOVERY_CANARY_MAX_SYMBOL_COUNT,
    ),
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE",
      "DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE",
      DEFAULT_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE,
    ),
    DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP",
      "DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP",
      DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP_TEXT,
    ),
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_MAX_POSITION_COUNT",
      "DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT",
      "5",
    ),
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_MAX_TRADES_PER_DAY",
      "DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY",
      "UNLIMITED",
    ),
    DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE",
      "DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE",
      "10",
    ),
    DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_RISK_MAX_TOTAL_NOTIONAL_QUOTE",
      "DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE",
      "250",
    ),
    DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_RISK_MAX_SYMBOL_NOTIONAL_QUOTE",
      "DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE",
      "230",
    ),
    DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE",
      "DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE",
      "250",
    ),
    DONBEOLJA_V2_RISK_MAX_TRADES_PER_DAY: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_RISK_MAX_TRADES_PER_DAY",
      "DONBEOLJA_V2_RISK_MAX_TRADES_PER_DAY",
      "UNLIMITED",
    ),
    DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_BLOCK_LEGACY_WEBHOOK_SIGNAL",
      "DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL",
      "1",
    ),
    DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_ALLOW_LEGACY_WEBHOOK_SIGNAL",
      "DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL",
      "0",
    ),
    DONBEOLJA_V2_ALLOW_LEGACY_SCHEDULER_WRITES: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_ALLOW_LEGACY_SCHEDULER_WRITES",
      "DONBEOLJA_V2_ALLOW_LEGACY_SCHEDULER_WRITES",
      "0",
    ),
    DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_LEGACY_RUNTIME_DISABLED",
      "DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED",
      "1",
    ),
    DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_LEGACY_ENTRY_FILTERS_DISABLED",
      "DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED",
      "1",
    ),
    DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED",
      "DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED",
      "1",
    ),
    DONBEOLJA_V2_COLLECTION_PREFIX: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_COLLECTION_PREFIX",
      "DONBEOLJA_V2_COLLECTION_PREFIX",
      "v2__",
    ),
    ML_LIVE_SERVING_ARMED: expectedValue(env, "DONBEOLJA_V2_EXPECTED_ML_LIVE_SERVING_ARMED", "ML_LIVE_SERVING_ARMED", "0"),
    OPENCLAW_AGENT_APPLY_ENABLED: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_OPENCLAW_AGENT_APPLY_ENABLED",
      "OPENCLAW_AGENT_APPLY_ENABLED",
      "0",
    ),
    OPENCLAW_NARRATIVE_PROVIDER_MODE: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_OPENCLAW_NARRATIVE_PROVIDER_MODE",
      "OPENCLAW_NARRATIVE_PROVIDER_MODE",
      "CODEX_CLI_ONLY",
    ),
    OPENAI_CODEX_FALLBACK_ENABLED: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_OPENAI_CODEX_FALLBACK_ENABLED",
      "OPENAI_CODEX_FALLBACK_ENABLED",
      "0",
    ),
    SIGNAL_AI_ENABLED: expectedValue(env, "DONBEOLJA_V2_EXPECTED_SIGNAL_AI_ENABLED", "SIGNAL_AI_ENABLED", "0"),
    AI_ALLOC_CLAUDE_ENABLED: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_AI_ALLOC_CLAUDE_ENABLED",
      "AI_ALLOC_CLAUDE_ENABLED",
      "0",
    ),
    AI_ALLOC_ENSEMBLE_ENABLED: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_AI_ALLOC_ENSEMBLE_ENABLED",
      "AI_ALLOC_ENSEMBLE_ENABLED",
      "0",
    ),
    AI_ALLOC_GPT_ENABLED: expectedValue(env, "DONBEOLJA_V2_EXPECTED_AI_ALLOC_GPT_ENABLED", "AI_ALLOC_GPT_ENABLED", "0"),
    NEWS_PROVIDER: expectedValue(env, "DONBEOLJA_V2_EXPECTED_NEWS_PROVIDER", "NEWS_PROVIDER", "disabled"),
    SIGNAL_AI_NEWS_PROVIDER: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_SIGNAL_AI_NEWS_PROVIDER",
      "SIGNAL_AI_NEWS_PROVIDER",
      "disabled",
    ),
  });
}

function buildForbiddenEnvNames(env = process.env) {
  return splitServices(
    env.DONBEOLJA_V2_FORBIDDEN_RUNTIME_ENV_NAMES ||
      [
        "ANTHROPIC_API_KEY",
        "CLAUDE_API_KEY",
        "OPENCLAW_NARRATIVE_CLAUDE_API_KEY",
        "CLAUDE_MODEL",
        "CLAUDE_MODEL_CANARY",
        "CLAUDE_CANARY_PCT",
        "SIGNAL_AI_CLAUDE_MODEL",
        "SIGNAL_AI_CLAUDE_MODEL_CANARY",
        "SIGNAL_AI_CLAUDE_CANARY_PCT",
        "SIGNAL_AI_CLAUDE_TIMEOUT_MS",
        "AI_ALLOC_CLAUDE_MODEL",
        "AI_ALLOC_CLAUDE_MODEL_CANARY",
        "AI_ALLOC_CLAUDE_CANARY_PCT",
        "AI_ALLOC_CLAUDE_TIMEOUT_MS",
        "OPENAI_API_KEY",
        "NEWS_API_KEY",
        "OPENAI_MODEL",
        "SIGNAL_AI_GPT_MODEL",
        "SIGNAL_AI_OPENAI_MODEL",
        "SIGNAL_AI_OPENAI_REASONING_EFFORT",
        "NEWS_WEB_MODEL",
        "SIGNAL_AI_NEWS_MODEL",
      ].join(","),
  );
}

function compareExpectedEnv(actualEnv, expectedEnv) {
  const blockers = [];
  const mismatches = {};
  const discoveryExpectedDisabled = String(expectedEnv.DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED || "") === "0";
  for (const [key, expected] of Object.entries(expectedEnv)) {
    if (key === "DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS") {
      if (discoveryExpectedDisabled) continue;
      if (!trimOrNull(expected)) {
        blockers.push("RUNTIME_DISCOVERY_CANARY:EXPECTED_SYMBOLS_MISSING");
        mismatches[key] = Object.freeze({ expected, actual: actualEnv[key] || null });
        continue;
      }
      if (normalizeSymbolList(actualEnv[key]) !== normalizeSymbolList(expected)) {
        blockers.push("RUNTIME_DISCOVERY_CANARY:SYMBOLS_MISMATCH");
        mismatches[key] = Object.freeze({ expected, actual: actualEnv[key] || null });
      }
      continue;
    }
    if (String(actualEnv[key] == null ? "" : actualEnv[key]) !== String(expected == null ? "" : expected)) {
      blockers.push(`RUNTIME_DISCOVERY_CANARY:${key}_MISMATCH`);
      mismatches[key] = Object.freeze({ expected, actual: actualEnv[key] || null });
    }
  }
  return Object.freeze({ blockers: Object.freeze(blockers), mismatches: Object.freeze(mismatches) });
}

function compareForbiddenEnv(actualEnv, forbiddenNames) {
  const blockers = [];
  const mismatches = {};
  for (const name of forbiddenNames || []) {
    if (Object.prototype.hasOwnProperty.call(actualEnv, name)) {
      blockers.push(`RUNTIME_DISCOVERY_CANARY:FORBIDDEN_ENV_PRESENT:${name}`);
      mismatches[`forbidden:${name}`] = Object.freeze({ expected: "ABSENT", actual: "PRESENT" });
    }
  }
  return Object.freeze({ blockers: Object.freeze(blockers), mismatches: Object.freeze(mismatches) });
}

function compareImageAndLabels(serviceJson, env = process.env) {
  const blockers = [];
  const mismatches = {};
  const labels = extractLabels(serviceJson);
  const image = extractImage(serviceJson);
  const expectedTag = trimOrNull(env.DONBEOLJA_V2_EXPECTED_IMAGE_TAG) || trimOrNull(env.TAG) || trimOrNull(env._TAG);
  const expectedCommit = trimOrNull(env.DONBEOLJA_V2_EXPECTED_COMMIT_SHA) || trimOrNull(env.COMMIT_SHA) || trimOrNull(env._COMMIT_SHA);
  if (expectedTag && !image.endsWith(`:${expectedTag}`)) {
    blockers.push("RUNTIME_DISCOVERY_CANARY:IMAGE_TAG_MISMATCH");
    mismatches.image = Object.freeze({ expected: expectedTag, actual: image || null });
  }
  if (expectedTag && labels["image-tag"] !== expectedTag) {
    blockers.push("RUNTIME_DISCOVERY_CANARY:LABEL_IMAGE_TAG_MISMATCH");
    mismatches["label:image-tag"] = Object.freeze({ expected: expectedTag, actual: labels["image-tag"] || null });
  }
  if (expectedCommit && labels["commit-sha"] !== expectedCommit) {
    blockers.push("RUNTIME_DISCOVERY_CANARY:LABEL_COMMIT_SHA_MISMATCH");
    mismatches["label:commit-sha"] = Object.freeze({ expected: expectedCommit, actual: labels["commit-sha"] || null });
  }
  return Object.freeze({ blockers: Object.freeze(blockers), mismatches: Object.freeze(mismatches), image, labels });
}

function prefixServiceBlocker(serviceName, blocker, serviceCount) {
  if (serviceCount <= 1) return blocker;
  const suffix = String(blocker || "").replace(/^RUNTIME_DISCOVERY_CANARY:/, "");
  return `RUNTIME_DISCOVERY_CANARY:${serviceName}:${suffix}`;
}

function prefixServiceMismatches(serviceName, mismatches, serviceCount) {
  if (serviceCount <= 1) return Object.freeze({ ...mismatches });
  const rows = {};
  Object.entries(mismatches || {}).forEach(([key, value]) => {
    rows[`${serviceName}:${key}`] = value;
  });
  return Object.freeze(rows);
}

function buildEnvServiceSet(env = process.env) {
  return new Set(splitServices(env.DONBEOLJA_V2_RUNTIME_ENV_SERVICES || "donbeolja,donbeolja-exit-worker"));
}

function evaluateServiceManifest(serviceName, serviceJson, expectedEnv, forbiddenEnvNames, env, serviceCount, envRequired = true) {
  const actualEnv = extractEnvMap(serviceJson);
  const envComparison = envRequired
    ? compareExpectedEnv(actualEnv, expectedEnv)
    : Object.freeze({ blockers: Object.freeze([]), mismatches: Object.freeze({}) });
  const forbiddenComparison = envRequired
    ? compareForbiddenEnv(actualEnv, forbiddenEnvNames)
    : Object.freeze({ blockers: Object.freeze([]), mismatches: Object.freeze({}) });
  const imageComparison = compareImageAndLabels(serviceJson, env);
  const blockers = Object.freeze([...envComparison.blockers, ...forbiddenComparison.blockers, ...imageComparison.blockers]
    .map((blocker) => prefixServiceBlocker(serviceName, blocker, serviceCount)));
  const mismatches = Object.freeze({
    ...prefixServiceMismatches(serviceName, envComparison.mismatches, serviceCount),
    ...prefixServiceMismatches(serviceName, forbiddenComparison.mismatches, serviceCount),
    ...prefixServiceMismatches(serviceName, imageComparison.mismatches, serviceCount),
  });
  return Object.freeze({
    service_name: serviceName,
    ok: blockers.length === 0,
    blockers,
    mismatches,
    actual_env: actualEnv,
    env_contract_checked: envRequired === true,
    image: imageComparison.image,
    labels: imageComparison.labels,
  });
}

function runCheck(env = process.env) {
  try {
    const serviceManifests = readServiceManifests(env);
    const expectedEnv = buildExpectedEnv(env);
    const forbiddenEnvNames = buildForbiddenEnvNames(env);
    const envServiceSet = buildEnvServiceSet(env);
    const serviceResults = serviceManifests.map((item) =>
      evaluateServiceManifest(
        item.service_name,
        item.service_json,
        expectedEnv,
        forbiddenEnvNames,
        env,
        serviceManifests.length,
        envServiceSet.has(item.service_name),
      )
    );
    const blockers = Object.freeze(serviceResults.flatMap((row) => row.blockers));
    const mismatches = Object.freeze(serviceResults.reduce((acc, row) => Object.assign(acc, row.mismatches), {}));
    const primary = serviceResults[0] || {};
    return Object.freeze({
      ok: blockers.length === 0,
      reason: blockers.length === 0
        ? "V2_RUNTIME_DISCOVERY_CANARY_MANIFEST_PASS"
        : "V2_RUNTIME_DISCOVERY_CANARY_MANIFEST_BLOCKED",
      blockers,
      mismatches,
      expected_env: expectedEnv,
      forbidden_env_names: Object.freeze(forbiddenEnvNames),
      actual_env: primary.actual_env || {},
      image: primary.image || "",
      labels: primary.labels || {},
      env_contract_services: Object.freeze(Array.from(envServiceSet)),
      service_results: Object.freeze(serviceResults),
    });
  } catch (error) {
    return Object.freeze({
      ok: false,
      reason: "V2_RUNTIME_DISCOVERY_CANARY_MANIFEST_READ_FAILED",
      blockers: Object.freeze(["RUNTIME_DISCOVERY_CANARY:MANIFEST_READ_FAILED"]),
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
    buildExpectedEnv,
    compareExpectedEnv,
    compareImageAndLabels,
    __test: {
      trimOrNull,
      splitSymbols,
      splitServices,
      normalizeSymbolList,
      extractEnvMap,
      extractImage,
      extractLabels,
      readServiceManifests,
      buildEnvServiceSet,
      buildForbiddenEnvNames,
      compareForbiddenEnv,
    },
  };
}
