"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { __test } = require("../../scripts/generate-v2-promotion-artifacts-mock");

(function defaultArtifactDirFallsBackToTmp() {
  const dir = __test.resolveArtifactDir({});
  assert.ok(dir.endsWith(path.join("tmp", "v2-promotion-artifacts")));
})();

(function resolveMockProfileDefaultsAndRejectsUnknown() {
  assert.strictEqual(__test.resolveMockProfile({}), "CLEAN");
  assert.strictEqual(__test.resolveMockProfile({ V2_PROMOTION_MOCK_PROFILE: "warn" }), "WARN");
  let err = null;
  try {
    __test.resolveMockProfile({ V2_PROMOTION_MOCK_PROFILE: "oops" });
  } catch (error) {
    err = error;
  }
  assert.ok(err);
  assert.strictEqual(err.message, "V2_PROMOTION_MOCK_PROFILE_INVALID:OOPS");
})();

(function mockPayloadProfilesAreExplicit() {
  const clean = __test.buildMockArtifactPayloads({ mode: "CANARY", profile: "CLEAN" });
  const warn = __test.buildMockArtifactPayloads({ mode: "SHADOW", profile: "WARN" });
  const blocked = __test.buildMockArtifactPayloads({ mode: "LIVE", profile: "BLOCKED" });
  assert.strictEqual(clean.replayReport.pass, true);
  assert.strictEqual(clean.replayReport.episode_n, 4);
  assert.strictEqual(clean.replayReport.transition_event_coverage.SL_HIT > 0, true);
  assert.strictEqual(clean.replayReport.transition_event_coverage.EXTERNAL_CLOSE_SYNC > 0, true);
  assert.strictEqual(clean.replayReport.transition_event_coverage.MANUAL_CLOSE_SYNC > 0, true);
  assert.strictEqual(clean.shadowLiveComparisonReport.warn_n, 0);
  assert.strictEqual(warn.shadowLiveComparisonReport.warn_n, 1);
  assert.strictEqual(warn.sourceModeComparisonReport.warn_n, 1);
  assert.strictEqual(blocked.replayReport.pass, false);
  assert.strictEqual(blocked.shadowLiveComparisonReport.pass, false);
  assert.strictEqual(blocked.sourceModeComparisonReport.pass, false);
})();

(async function mainWritesStandardFiles() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-mock-artifacts-"));
  try {
    const logs = [];
    const originalLog = console.log;
    console.log = (...args) => logs.push(args.join(" "));
    await require("../../scripts/generate-v2-promotion-artifacts-mock").main({
      V2_PROMOTION_MODE: "CANARY",
      V2_PROMOTION_MOCK_PROFILE: "CLEAN",
      V2_PROMOTION_ARTIFACT_DIR: dir,
    });
    console.log = originalLog;
    const replayFile = path.join(dir, "replay-report.json");
    const shadowFile = path.join(dir, "shadow-live-comparison.json");
    const sourceFile = path.join(dir, "source-mode-comparison.json");
    assert.ok(fs.existsSync(replayFile));
    assert.ok(fs.existsSync(shadowFile));
    assert.ok(fs.existsSync(sourceFile));
    const replay = JSON.parse(fs.readFileSync(replayFile, "utf8"));
    const shadow = JSON.parse(fs.readFileSync(shadowFile, "utf8"));
    const source = JSON.parse(fs.readFileSync(sourceFile, "utf8"));
    assert.strictEqual(replay.pass, true);
    assert.strictEqual(replay.episode_n, 4);
    assert.strictEqual(replay.transition_event_coverage.TP1_FULL_EXIT > 0, true);
    assert.strictEqual(shadow.warn_n, 0);
    assert.strictEqual(source.warn_n, 0);
    assert.ok(logs.some((line) => line.includes("V2_PROMOTION_ARTIFACTS_MOCK_GENERATED")));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function blockedProfileWritesBlockedReports() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-mock-artifacts-blocked-"));
  try {
    await require("../../scripts/generate-v2-promotion-artifacts-mock").main({
      V2_PROMOTION_MODE: "LIVE",
      V2_PROMOTION_MOCK_PROFILE: "BLOCKED",
      V2_PROMOTION_ARTIFACT_DIR: dir,
    });
    const replay = JSON.parse(fs.readFileSync(path.join(dir, "replay-report.json"), "utf8"));
    const shadow = JSON.parse(fs.readFileSync(path.join(dir, "shadow-live-comparison.json"), "utf8"));
    const source = JSON.parse(fs.readFileSync(path.join(dir, "source-mode-comparison.json"), "utf8"));
    assert.strictEqual(replay.pass, false);
    assert.strictEqual(shadow.pass, false);
    assert.strictEqual(source.pass, false);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

console.log("GENERATE_V2_PROMOTION_ARTIFACTS_MOCK_TEST_OK");
