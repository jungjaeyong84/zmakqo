#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { evaluateReplayFixtureSet } = require("../src/v2/replayGate");
const { buildReferenceReplayFixtureSet } = require("../src/v2/replayFixtureFactory");

const REPLAY_REPORT_FILENAME = "replay-report.json";

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

function resolveReplayFixtureSet(env = process.env) {
  const fixtureFile = trimOrNull(env.V2_PROMOTION_REPLAY_FIXTURE_FILE);
  if (fixtureFile) return readJsonFile(fixtureFile);

  const fixtureJson = trimOrNull(env.V2_PROMOTION_REPLAY_FIXTURE_JSON);
  if (fixtureJson) return JSON.parse(fixtureJson);

  const artifactDir = resolveArtifactDir(env);
  const artifactFixtureFile = path.join(artifactDir, "replay-fixtures.json");
  if (fs.existsSync(artifactFixtureFile)) return readJsonFile(artifactFixtureFile);

  const profile = upper(env.V2_PROMOTION_REPLAY_FIXTURE_PROFILE) || "REFERENCE_PASS";
  return buildReferenceReplayFixtureSet(profile);
}

async function main(env = process.env) {
  const artifactDir = resolveArtifactDir(env);
  const fixtureSet = resolveReplayFixtureSet(env);
  const report = evaluateReplayFixtureSet(fixtureSet);
  ensureDir(artifactDir);
  const outputFile = path.join(artifactDir, REPLAY_REPORT_FILENAME);
  writeJson(outputFile, report);
  console.log(JSON.stringify({
    ok: true,
    reason: "V2_REPLAY_ARTIFACT_GENERATED",
    artifact_dir: artifactDir,
    replay_report_file: outputFile,
    episode_n: report.episode_n,
    pass: report.pass === true,
    block_n: report.block_n || 0,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("GENERATE_V2_REPLAY_ARTIFACT_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    __test: {
      trimOrNull,
      upper,
      resolveArtifactDir,
      resolveReplayFixtureSet,
      REPLAY_REPORT_FILENAME,
    },
  };
}
