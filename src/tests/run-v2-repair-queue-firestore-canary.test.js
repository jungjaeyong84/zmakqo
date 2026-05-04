"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const runner = require("../../scripts/run-v2-repair-queue-firestore-canary");
const { buildMemoryDb } = require("../v2/repairQueueCanary");

async function scriptWritesFirestoreCanaryArtifact() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "dbj-v2-repair-firestore-canary-"));
  const db = buildMemoryDb();
  try {
    const output = await runner.run({
      DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_DIR: dir,
      DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_FILE: "v2_repair_queue_firestore_canary_latest.json",
      DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_HISTORY_FILE: path.join(dir, "v2_repair_queue_firestore_canary_history.jsonl"),
      DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_WRITE_ENABLED: "1",
      DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_COLLECTION_PREFIX: "paperopcanarytest__",
    }, {
      db,
      recordedAt: "2026-04-21T09:10:00.000Z",
    });
    const filePath = path.join(dir, "v2_repair_queue_firestore_canary_latest.json");
    const historyFile = path.join(dir, "v2_repair_queue_firestore_canary_history.jsonl");
    assert.strictEqual(output.ok, true);
    assert.strictEqual(output.reason, "V2_REPAIR_QUEUE_FIRESTORE_CANARY_HEALTHY");
    assert.strictEqual(output.output_filename, "v2_repair_queue_firestore_canary_latest.json");
    assert.ok(fs.existsSync(filePath));
    const persisted = JSON.parse(fs.readFileSync(filePath, "utf8"));
    assert.strictEqual(persisted.ok, true);
    assert.strictEqual(persisted.canary_mode, "FIRESTORE_BACKED_SHADOW_REPAIR_REQUEST_GENERATION");
    const historyLines = fs.readFileSync(historyFile, "utf8").trim().split(/\r?\n/);
    assert.strictEqual(historyLines.length, 1);
    assert.strictEqual(JSON.parse(historyLines[0]).ok, true);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

(function artifactPathsHaveStableDefaultsAndOverrides() {
  assert.strictEqual(runner.__test.resolveOutputFilename({}), runner.__test.OUTPUT_FILENAME);
  assert.strictEqual(
    runner.__test.resolveOutputFilename({ DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_FILE: "custom.json" }),
    "custom.json"
  );
  assert.ok(runner.__test.resolveArtifactDir({}).endsWith(path.join("ops", "daily")));
  assert.ok(runner.__test.resolveHistoryFile({}).endsWith("v2_repair_queue_firestore_canary_history.jsonl"));
})();

async function main() {
  await scriptWritesFirestoreCanaryArtifact();
  console.log("RUN_V2_REPAIR_QUEUE_FIRESTORE_CANARY_TEST_OK");
}

main().catch((error) => {
  console.error(error && error.stack ? error.stack : error);
  process.exit(1);
});
