"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const replayArtifact = require("../../scripts/generate-v2-replay-artifact");

(function resolveReplayFixtureSetFallsBackToReferenceProfile() {
  const fixtureSet = replayArtifact.__test.resolveReplayFixtureSet({
    V2_PROMOTION_REPLAY_FIXTURE_PROFILE: "REFERENCE_PASS",
  });
  assert.ok(Array.isArray(fixtureSet.episodes));
  assert.strictEqual(fixtureSet.episodes.length, 4);
})();

(function resolveReplayFixtureSetReadsInlineJsonFirst() {
  const fixtureSet = replayArtifact.__test.resolveReplayFixtureSet({
    V2_PROMOTION_REPLAY_FIXTURE_JSON: JSON.stringify({
      episodes: [{
        label: "INLINE",
        positionCycle: { position_cycle_id: "PC", entry_event_id: "ENTRY" },
        projection: { position_cycle_id: "PC", stage: "PRE_TP1" },
        transitions: [],
        outboxes: [],
        watchdog: { issueCodes: [], repairRequests: [] },
      }],
    }),
  });
  assert.strictEqual(fixtureSet.episodes[0].label, "INLINE");
})();

(async function mainWritesReplayArtifactFromReferencePassProfile() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-replay-artifact-"));
  try {
    await replayArtifact.main({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_REPLAY_FIXTURE_PROFILE: "REFERENCE_PASS",
    });
    const outputFile = path.join(dir, "replay-report.json");
    assert.ok(fs.existsSync(outputFile));
    const report = JSON.parse(fs.readFileSync(outputFile, "utf8"));
    assert.strictEqual(report.pass, true);
    assert.strictEqual(report.block_n, 0);
    assert.strictEqual(report.transition_event_coverage.SL_HIT > 0, true);
    assert.strictEqual(report.transition_event_coverage.EXTERNAL_CLOSE_SYNC > 0, true);
    assert.strictEqual(report.transition_event_coverage.MANUAL_CLOSE_SYNC > 0, true);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function mainWritesBlockedReplayArtifact() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-replay-artifact-blocked-"));
  try {
    await replayArtifact.main({
      V2_PROMOTION_ARTIFACT_DIR: dir,
      V2_PROMOTION_REPLAY_FIXTURE_PROFILE: "REFERENCE_BLOCKED",
    });
    const report = JSON.parse(fs.readFileSync(path.join(dir, "replay-report.json"), "utf8"));
    assert.strictEqual(report.pass, false);
    assert.ok(report.blockers.some((row) => row.includes("WATCHDOG_ISSUES_PRESENT")));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

console.log("GENERATE_V2_REPLAY_ARTIFACT_TEST_OK");
