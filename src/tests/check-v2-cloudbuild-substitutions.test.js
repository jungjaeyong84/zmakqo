"use strict";

const assert = require("assert");
const {
  evaluateCloudBuildSubstitutions,
  resolveCloudBuildSubstitutions,
} = require("../../scripts/check-v2-cloudbuild-substitutions");

function blocksDefaultLatestUnknown() {
  const result = evaluateCloudBuildSubstitutions({ tag: "latest", commitSha: "unknown" });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("CLOUDBUILD_SUBSTITUTIONS:TAG_LATEST_FORBIDDEN"));
  assert.ok(result.blockers.includes("CLOUDBUILD_SUBSTITUTIONS:COMMIT_SHA_UNKNOWN_FORBIDDEN"));
}

function passesMatchingV2TagAndCommit() {
  const sha = "74cb0f0814537f19d8e596038ad5d08bd2a5d257";
  const result = evaluateCloudBuildSubstitutions({ tag: "v2-74cb0f08", commitSha: sha });
  assert.strictEqual(result.ok, true);
  assert.deepStrictEqual(result.blockers, []);
}

function blocksMismatchedTagAndCommit() {
  const result = evaluateCloudBuildSubstitutions({
    tag: "v2-deadbeef",
    commitSha: "74cb0f0814537f19d8e596038ad5d08bd2a5d257",
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers.includes("CLOUDBUILD_SUBSTITUTIONS:TAG_COMMIT_SHA_MISMATCH"));
}

function resolvesEnvFallbacks() {
  const resolved = resolveCloudBuildSubstitutions({
    _TAG: "v2-74cb0f08",
    _COMMIT_SHA: "74cb0f0814537f19d8e596038ad5d08bd2a5d257",
  });
  assert.strictEqual(resolved.tag, "v2-74cb0f08");
  assert.strictEqual(resolved.commitSha, "74cb0f0814537f19d8e596038ad5d08bd2a5d257");
}

blocksDefaultLatestUnknown();
passesMatchingV2TagAndCommit();
blocksMismatchedTagAndCommit();
resolvesEnvFallbacks();
console.log("CHECK_V2_CLOUDBUILD_SUBSTITUTIONS_TEST_OK");
