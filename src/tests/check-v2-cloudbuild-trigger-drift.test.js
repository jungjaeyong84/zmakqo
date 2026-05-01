"use strict";

const assert = require("assert");
const {
  __test,
  evaluateCloudBuildTriggerDrift,
  loadTriggersFromEnv,
  normalizeTrigger,
} = require("../../scripts/check-v2-cloudbuild-trigger-drift");

function disabledLatestUnknownTriggerDoesNotBlock() {
  const result = evaluateCloudBuildTriggerDrift({
    triggers: [{
      id: "trigger-1",
      filename: "cloudbuild.yaml",
      disabled: true,
      github: { push: { branch: "^master$" } },
      substitutions: { _TAG: "latest", _COMMIT_SHA: "unknown" },
    }],
  });
  assert.strictEqual(result.ok, true);
}

function enabledLatestUnknownTriggerBlocks() {
  const result = evaluateCloudBuildTriggerDrift({
    triggers: [{
      id: "trigger-2",
      filename: "cloudbuild.yaml",
      github: { push: { branch: "^master$" } },
      substitutions: { _TAG: "latest", _COMMIT_SHA: "unknown" },
    }],
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.offending_trigger_n, 1);
  assert.ok(result.blockers[0].includes("TRIGGER_TAG_LATEST"));
  assert.ok(result.blockers[0].includes("TRIGGER_COMMIT_SHA_UNKNOWN"));
}

function enabledTriggerMissingSubstitutionsBlocks() {
  const result = evaluateCloudBuildTriggerDrift({
    triggers: [{
      id: "trigger-3",
      filename: "cloudbuild.yaml",
      github: { push: { branch: "^master$" } },
    }],
  });
  assert.strictEqual(result.ok, false);
  assert.ok(result.blockers[0].includes("TRIGGER_TAG_MISSING"));
  assert.ok(result.blockers[0].includes("TRIGGER_COMMIT_SHA_MISSING"));
}

function enabledV2TriggerPasses() {
  const result = evaluateCloudBuildTriggerDrift({
    triggers: [{
      id: "trigger-4",
      filename: "cloudbuild.yaml",
      github: { push: { branch: "^master$" } },
      substitutions: {
        _TAG: "v2-74cb0f08",
        _COMMIT_SHA: "74cb0f0814537f19d8e596038ad5d08bd2a5d257",
      },
    }],
  });
  assert.strictEqual(result.ok, true);
}

function envFixtureParsesSingleOrArray() {
  const rows = loadTriggersFromEnv({
    V2_CLOUDBUILD_TRIGGERS_JSON: JSON.stringify({ id: "one", filename: "cloudbuild.yaml" }),
  });
  assert.strictEqual(rows.length, 1);
  assert.strictEqual(normalizeTrigger(rows[0]).id, "one");
}

function resolvesExplicitGcloudBinary() {
  assert.strictEqual(
    __test.resolveGcloudBinary({ V2_CLOUDBUILD_TRIGGER_GCLOUD_BIN: "/tmp/gcloud-test-bin", PATH: "" }),
    "/tmp/gcloud-test-bin",
  );
}

disabledLatestUnknownTriggerDoesNotBlock();
enabledLatestUnknownTriggerBlocks();
enabledTriggerMissingSubstitutionsBlocks();
enabledV2TriggerPasses();
envFixtureParsesSingleOrArray();
resolvesExplicitGcloudBinary();
console.log("CHECK_V2_CLOUDBUILD_TRIGGER_DRIFT_TEST_OK");
