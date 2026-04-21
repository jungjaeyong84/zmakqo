"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const comparisonArtifacts = require("../../scripts/generate-v2-comparison-artifacts");

(function resolveComparisonFixturesFallsBackToReferenceProfile() {
  const fixtures = comparisonArtifacts.__test.resolveComparisonFixtures({
    V2_PROMOTION_COMPARISON_FIXTURE_PROFILE: "REFERENCE_CLEAN",
  });
  assert.ok(Array.isArray(fixtures.shadowLivePairs));
  assert.ok(Array.isArray(fixtures.sourceModePairs));
  assert.strictEqual(fixtures.shadowLivePairs.length, 1);
  assert.strictEqual(fixtures.sourceModePairs.length, 1);
})();

(async function mainWritesCleanComparisonArtifacts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-comparison-artifacts-"));
  try {
    await comparisonArtifacts.main({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_COMPARISON_FIXTURE_PROFILE: "REFERENCE_CLEAN",
    });
    const shadowLive = JSON.parse(fs.readFileSync(path.join(dir, "shadow-live-comparison.json"), "utf8"));
    const sourceMode = JSON.parse(fs.readFileSync(path.join(dir, "source-mode-comparison.json"), "utf8"));
    assert.strictEqual(shadowLive.pass, true);
    assert.strictEqual(sourceMode.pass, true);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function mainWritesBlockedComparisonArtifacts() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-comparison-artifacts-blocked-"));
  try {
    await comparisonArtifacts.main({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_COMPARISON_FIXTURE_PROFILE: "REFERENCE_BLOCKED",
    });
    const shadowLive = JSON.parse(fs.readFileSync(path.join(dir, "shadow-live-comparison.json"), "utf8"));
    const sourceMode = JSON.parse(fs.readFileSync(path.join(dir, "source-mode-comparison.json"), "utf8"));
    assert.strictEqual(shadowLive.pass, false);
    assert.strictEqual(sourceMode.pass, false);
    assert.ok(shadowLive.blockers.length > 0);
    assert.ok(sourceMode.blockers.length > 0);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

console.log("GENERATE_V2_COMPARISON_ARTIFACTS_TEST_OK");
