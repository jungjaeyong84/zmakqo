#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { resolveV2RuntimeConfig } = require("../src/v2/runtime");
const { buildShadowLiveComparisonReport } = require("../src/v2/shadowLiveComparison");
const { buildSourceModeComparisonReport } = require("../src/v2/sourceModeComparison");
const { buildReferenceComparisonFixtures } = require("../src/v2/comparisonFixtureFactory");

const OUTPUT_FILENAMES = Object.freeze({
  shadowLive: "shadow-live-comparison.json",
  sourceMode: "source-mode-comparison.json",
});

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function readJsonFile(filePath) {
  return JSON.parse(fs.readFileSync(path.resolve(filePath), "utf8"));
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function resolveArtifactDir(env = process.env) {
  return trimOrNull(env.V2_PROMOTION_ARTIFACT_DIR) || path.resolve("tmp", "v2-promotion-artifacts");
}

function resolveComparisonFixtures(env = process.env) {
  const shadowLiveFile = trimOrNull(env.V2_PROMOTION_SHADOW_LIVE_PAIRS_FILE);
  const sourceModeFile = trimOrNull(env.V2_PROMOTION_SOURCE_MODE_PAIRS_FILE);
  const shadowLiveJson = trimOrNull(env.V2_PROMOTION_SHADOW_LIVE_PAIRS_JSON);
  const sourceModeJson = trimOrNull(env.V2_PROMOTION_SOURCE_MODE_PAIRS_JSON);
  if (shadowLiveFile || sourceModeFile || shadowLiveJson || sourceModeJson) {
    return Object.freeze({
      shadowLivePairs: shadowLiveFile ? readJsonFile(shadowLiveFile) : JSON.parse(shadowLiveJson || "[]"),
      sourceModePairs: sourceModeFile ? readJsonFile(sourceModeFile) : JSON.parse(sourceModeJson || "[]"),
    });
  }

  const artifactDir = resolveArtifactDir(env);
  const artifactFixtureFile = path.join(artifactDir, "comparison-fixtures.json");
  if (fs.existsSync(artifactFixtureFile)) return readJsonFile(artifactFixtureFile);

  const profile = upper(env.V2_PROMOTION_COMPARISON_FIXTURE_PROFILE) || "REFERENCE_CLEAN";
  return buildReferenceComparisonFixtures(profile);
}

async function main(env = process.env) {
  const cfg = resolveV2RuntimeConfig(env);
  const artifactDir = resolveArtifactDir(env);
  const fixtures = resolveComparisonFixtures(env);
  const shadowLiveReport = buildShadowLiveComparisonReport({
    pairs: fixtures.shadowLivePairs,
    thresholds: cfg.defaultComparisonThresholds,
  });
  const sourceModeReport = buildSourceModeComparisonReport({
    pairs: fixtures.sourceModePairs,
    thresholds: cfg.defaultComparisonThresholds,
  });
  ensureDir(artifactDir);
  const shadowLiveFile = path.join(artifactDir, OUTPUT_FILENAMES.shadowLive);
  const sourceModeFile = path.join(artifactDir, OUTPUT_FILENAMES.sourceMode);
  writeJson(shadowLiveFile, shadowLiveReport);
  writeJson(sourceModeFile, sourceModeReport);
  console.log(JSON.stringify({
    ok: true,
    reason: "V2_COMPARISON_ARTIFACTS_GENERATED",
    artifact_dir: artifactDir,
    shadow_live_file: shadowLiveFile,
    source_mode_file: sourceModeFile,
    shadow_live_pass: shadowLiveReport.pass === true,
    source_mode_pass: sourceModeReport.pass === true,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("GENERATE_V2_COMPARISON_ARTIFACTS_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    __test: {
      trimOrNull,
      upper,
      resolveArtifactDir,
      resolveComparisonFixtures,
      OUTPUT_FILENAMES,
    },
  };
}
