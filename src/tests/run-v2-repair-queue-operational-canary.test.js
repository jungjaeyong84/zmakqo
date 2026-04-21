"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const runner = require("../../scripts/run-v2-repair-queue-operational-canary");

async function scriptWritesOperationalCanaryArtifact() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-repair-operational-canary-"));
  try {
    const output = await runner.run({
      DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_ARTIFACT_DIR: dir,
      DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_ARTIFACT_FILE: "v2_repair_queue_operational_canary_latest.json",
    }, {
      recordedAt: "2026-04-21T08:00:00.000Z",
    });
    const filePath = path.join(dir, "v2_repair_queue_operational_canary_latest.json");
    assert.strictEqual(output.ok, true);
    assert.strictEqual(output.reason, "V2_REPAIR_QUEUE_OPERATIONAL_CANARY_HEALTHY");
    assert.strictEqual(output.output_filename, "v2_repair_queue_operational_canary_latest.json");
    assert.strictEqual(output.selected_issue_code, "TRAIL_STOP_MISSING");
    assert.ok(fs.existsSync(filePath));
    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.strictEqual(persisted.ok, true);
    assert.strictEqual(persisted.canary_mode, "SHADOW_REPAIR_REQUEST_GENERATION");
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

(function artifactPathsHaveStableDefaultsAndOverrides() {
  assert.strictEqual(runner.__test.resolveOutputFilename({}), runner.__test.OUTPUT_FILENAME);
  assert.strictEqual(
    runner.__test.resolveOutputFilename({ DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_ARTIFACT_FILE: "custom.json" }),
    "custom.json"
  );
  assert.ok(runner.__test.resolveArtifactDir({}).endsWith(path.join("artifacts", "v2-repair-canary")));
})();

async function main() {
  await scriptWritesOperationalCanaryArtifact();
  console.log("RUN_V2_REPAIR_QUEUE_OPERATIONAL_CANARY_TEST_OK");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
