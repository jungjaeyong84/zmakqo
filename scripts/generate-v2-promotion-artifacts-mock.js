#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { resolveV2RuntimeConfig } = require("../src/v2/runtime");
const { evaluateReplayFixtureSet } = require("../src/v2/replayGate");
const { buildReferenceReplayFixtureSet } = require("../src/v2/replayFixtureFactory");

const ARTIFACT_FILENAMES = Object.freeze({
  replayReport: "replay-report.json",
  shadowLiveComparisonReport: "shadow-live-comparison.json",
  sourceModeComparisonReport: "source-mode-comparison.json",
});

const MOCK_PROFILES = Object.freeze({
  CLEAN: "CLEAN",
  WARN: "WARN",
  BLOCKED: "BLOCKED",
});

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function resolveMockProfile(env = process.env) {
  const profile = upper(env.V2_PROMOTION_MOCK_PROFILE) || MOCK_PROFILES.CLEAN;
  if (Object.prototype.hasOwnProperty.call(MOCK_PROFILES, profile)) return profile;
  throw new Error(`V2_PROMOTION_MOCK_PROFILE_INVALID:${profile}`);
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function buildReplayReportFixture({ mode, profile } = {}) {
  const normalizedProfile = profile === MOCK_PROFILES.BLOCKED ? "REFERENCE_BLOCKED" : "REFERENCE_PASS";
  const report = evaluateReplayFixtureSet(buildReferenceReplayFixtureSet(normalizedProfile));
  return Object.freeze({
    ...report,
    mock_mode: String(mode || "CANARY").trim().toUpperCase() || "CANARY",
    mock_profile: profile || MOCK_PROFILES.CLEAN,
  });
}

function buildShadowLiveComparisonFixture({ profile } = {}) {
  const warn = profile === MOCK_PROFILES.WARN;
  const blocked = profile === MOCK_PROFILES.BLOCKED;
  return Object.freeze({
    pass: blocked !== true,
    pair_n: 1,
    block_n: blocked ? 1 : 0,
    warn_n: warn ? 1 : 0,
    blockers: blocked ? ["BTCUSDT__LONG__15M:PROPOSAL_VERDICT_MISMATCH"] : [],
    warnings: warn ? ["BTCUSDT__LONG__15M:QUALITY_SCORE_DRIFT"] : [],
    rows: [
      {
        label: "BTCUSDT__LONG__15M",
        pass: blocked !== true,
        blocker_reasons: blocked ? ["PROPOSAL_VERDICT_MISMATCH"] : [],
        warn_reasons: warn ? ["QUALITY_SCORE_DRIFT"] : [],
      },
    ],
  });
}

function buildSourceModeComparisonFixture({ profile } = {}) {
  const warn = profile === MOCK_PROFILES.WARN;
  const blocked = profile === MOCK_PROFILES.BLOCKED;
  return Object.freeze({
    pass: blocked !== true,
    pair_n: 1,
    block_n: blocked ? 1 : 0,
    warn_n: warn ? 1 : 0,
    blockers: blocked ? ["BTCUSDT__LONG__SOURCE_MODE:DECISION_APPROVAL_MISMATCH"] : [],
    warnings: warn ? ["BTCUSDT__LONG__SOURCE_MODE:QUALITY_SCORE_DRIFT"] : [],
    rows: [
      {
        label: "BTCUSDT__LONG__SOURCE_MODE",
        pass: blocked !== true,
        blocker_reasons: blocked ? ["DECISION_APPROVAL_MISMATCH"] : [],
        warn_reasons: warn ? ["QUALITY_SCORE_DRIFT"] : [],
      },
    ],
  });
}

function resolveArtifactDir(env = process.env) {
  return trimOrNull(env.V2_PROMOTION_ARTIFACT_DIR) || path.resolve("tmp", "v2-promotion-artifacts");
}

function buildMockArtifactPayloads({ mode, profile } = {}) {
  return Object.freeze({
    replayReport: buildReplayReportFixture({ mode, profile }),
    shadowLiveComparisonReport: buildShadowLiveComparisonFixture({ profile }),
    sourceModeComparisonReport: buildSourceModeComparisonFixture({ profile }),
  });
}

async function main(env = process.env) {
  const cfg = resolveV2RuntimeConfig(env);
  const mode = upper(env.V2_PROMOTION_MODE) || "CANARY";
  const profile = resolveMockProfile(env);
  const artifactDir = resolveArtifactDir(env);
  const payloads = buildMockArtifactPayloads({ mode, profile, cfg });
  ensureDir(artifactDir);

  writeJson(path.join(artifactDir, ARTIFACT_FILENAMES.replayReport), payloads.replayReport);
  writeJson(path.join(artifactDir, ARTIFACT_FILENAMES.shadowLiveComparisonReport), payloads.shadowLiveComparisonReport);
  writeJson(path.join(artifactDir, ARTIFACT_FILENAMES.sourceModeComparisonReport), payloads.sourceModeComparisonReport);

  console.log(JSON.stringify({
    ok: true,
    reason: "V2_PROMOTION_ARTIFACTS_MOCK_GENERATED",
    mode,
    profile,
    artifact_dir: artifactDir,
    files: {
      replayReport: path.join(artifactDir, ARTIFACT_FILENAMES.replayReport),
      shadowLiveComparisonReport: path.join(artifactDir, ARTIFACT_FILENAMES.shadowLiveComparisonReport),
      sourceModeComparisonReport: path.join(artifactDir, ARTIFACT_FILENAMES.sourceModeComparisonReport),
    },
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("GENERATE_V2_PROMOTION_ARTIFACTS_MOCK_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    __test: {
      trimOrNull,
      upper,
      resolveMockProfile,
      resolveArtifactDir,
      buildReplayReportFixture,
      buildShadowLiveComparisonFixture,
      buildSourceModeComparisonFixture,
      buildMockArtifactPayloads,
      ARTIFACT_FILENAMES,
      MOCK_PROFILES,
      toNumberOrNull,
    },
  };
}
