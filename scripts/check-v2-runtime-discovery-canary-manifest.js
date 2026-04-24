#!/usr/bin/env node
"use strict";

const fs = require("fs");
const { execFileSync } = require("child_process");

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
      null,
    ),
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE",
      "DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE",
      "25",
    ),
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_MAX_POSITION_COUNT",
      "DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT",
      "1",
    ),
    DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_MAX_TRADES_PER_DAY",
      "DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY",
      "1",
    ),
    DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE: expectedValue(
      env,
      "DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE",
      "DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE",
      "10",
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
  });
}

function compareExpectedEnv(actualEnv, expectedEnv) {
  const blockers = [];
  const mismatches = {};
  const discoveryExpectedDisabled = String(expectedEnv.DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED || "") === "0";
  for (const [key, expected] of Object.entries(expectedEnv)) {
    if (key === "DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS") {
      if (!trimOrNull(expected)) {
        if (discoveryExpectedDisabled) continue;
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

function runCheck(env = process.env) {
  try {
    const serviceJson = readServiceJson(env);
    const actualEnv = extractEnvMap(serviceJson);
    const expectedEnv = buildExpectedEnv(env);
    const envComparison = compareExpectedEnv(actualEnv, expectedEnv);
    const imageComparison = compareImageAndLabels(serviceJson, env);
    const blockers = Object.freeze([...envComparison.blockers, ...imageComparison.blockers]);
    const mismatches = Object.freeze({
      ...envComparison.mismatches,
      ...imageComparison.mismatches,
    });
    return Object.freeze({
      ok: blockers.length === 0,
      reason: blockers.length === 0
        ? "V2_RUNTIME_DISCOVERY_CANARY_MANIFEST_PASS"
        : "V2_RUNTIME_DISCOVERY_CANARY_MANIFEST_BLOCKED",
      blockers,
      mismatches,
      expected_env: expectedEnv,
      actual_env: actualEnv,
      image: imageComparison.image,
      labels: imageComparison.labels,
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
      normalizeSymbolList,
      extractEnvMap,
      extractImage,
      extractLabels,
    },
  };
}
