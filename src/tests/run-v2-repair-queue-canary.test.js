"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const runner = require("../../scripts/run-v2-repair-queue-canary");

(async function scriptWritesHealthyCanaryArtifact() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-repair-canary-"));
  try {
    const output = await runner.run({
      DONBEOLJA_V2_REPAIR_CANARY_ARTIFACT_DIR: dir,
      DONBEOLJA_V2_REPAIR_CANARY_ARTIFACT_FILE: "v2_repair_queue_canary_latest.json",
    }, {
      recordedAt: "2026-04-21T07:30:00.000Z",
    });
    const filePath = path.join(dir, "v2_repair_queue_canary_latest.json");
    assert.strictEqual(output.ok, true);
    assert.strictEqual(output.reason, "V2_REPAIR_QUEUE_CANARY_HEALTHY");
    assert.strictEqual(output.output_filename, "v2_repair_queue_canary_latest.json");
    assert.strictEqual(output.exchange_write_performed, false);
    assert.ok(fs.existsSync(filePath));
    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.strictEqual(persisted.ok, true);
    assert.strictEqual(persisted.refresh_call_n, 1);
    assert.strictEqual(persisted.summary.completion_success_n, 1);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(async function scriptMapsFailedCanaryToBlockingReason() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-repair-canary-fail-"));
  try {
    const output = await runner.run({
      DONBEOLJA_V2_REPAIR_CANARY_ARTIFACT_DIR: dir,
    }, {
      recordedAt: "2026-04-21T07:31:00.000Z",
      runRepairQueueCanaryFn: async () => ({
        ok: false,
        generated_at: "2026-04-21T07:31:00.000Z",
        canary_mode: "DRY_RUN_FIXTURE",
        exchange_write_performed: false,
        verdict: {
          failed_invariants: ["completion_succeeded"],
        },
      }),
    });
    assert.strictEqual(output.ok, false);
    assert.strictEqual(output.reason, "V2_REPAIR_QUEUE_CANARY_FAILED");
    assert.ok(fs.existsSync(path.join(dir, runner.__test.OUTPUT_FILENAME)));
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
})();

(function artifactPathsHaveStableDefaultsAndOverrides() {
  assert.strictEqual(runner.__test.resolveOutputFilename({}), runner.__test.OUTPUT_FILENAME);
  assert.strictEqual(
    runner.__test.resolveOutputFilename({ DONBEOLJA_V2_REPAIR_CANARY_ARTIFACT_FILE: "custom.json" }),
    "custom.json"
  );
  assert.ok(runner.__test.resolveArtifactDir({}).endsWith(path.join("artifacts", "v2-repair-canary")));
})();

console.log("RUN_V2_REPAIR_QUEUE_CANARY_TEST_OK");
