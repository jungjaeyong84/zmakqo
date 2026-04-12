"use strict";

const assert = require("assert");
const { __test } = require("../services/systemSloArtifactInputs");

function run() {
  const localOnly = __test.choosePreferredInput({
    localDoc: { generated_at: "2026-04-12T03:00:00.000Z", summary: { status: "LOCAL" } },
    sharedDoc: null,
  });
  assert.strictEqual(localOnly.summary.status, "LOCAL");

  const sharedPreferred = __test.choosePreferredInput({
    localDoc: { generated_at: "2026-04-12T03:00:00.000Z", summary: { status: "LOCAL" } },
    sharedDoc: { generated_at: "2026-04-12T04:00:00.000Z", summary: { status: "SHARED" } },
  });
  assert.strictEqual(sharedPreferred.summary.status, "SHARED");

  const sharedWhenLocalMissingTimestamp = __test.choosePreferredInput({
    localDoc: { summary: { status: "LOCAL_NO_TS" } },
    sharedDoc: { generated_at: "2026-04-12T04:00:00.000Z", summary: { status: "SHARED" } },
  });
  assert.strictEqual(sharedWhenLocalMissingTimestamp.summary.status, "SHARED");

  assert.strictEqual(
    __test.resolveGeneratedAtMs({ generated_at: "2026-04-12T04:00:00.000Z", summary: { status: "X" } }),
    Date.parse("2026-04-12T04:00:00.000Z")
  );
}

try {
  run();
  console.log("SYSTEM_SLO_ARTIFACT_INPUTS_TEST_OK");
} catch (err) {
  console.error("SYSTEM_SLO_ARTIFACT_INPUTS_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
