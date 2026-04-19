"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  normalizeStrategyId,
  resolveCurrentVersionPineSource,
  syncCurrentVersionPineAlias,
} = require("../../scripts/lib/current-version-pine");
const automationSyncCurrentVersionPine = require("../../scripts/automation-sync-current-version-pine");
const { buildPineOpenContext } = require("../../scripts/lib/pine-file-ops");

function run() {
  assert.strictEqual(normalizeStrategyId("donbeolja_v6.1.1.0", ""), "donbeolja_v6.1.1.0");
  assert.strictEqual(normalizeStrategyId("", "6.1.1.0"), "donbeolja_v6.1.1.0");

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "pine-sync-"));
  const codeDir = path.join(root, "code");
  fs.mkdirSync(codeDir, { recursive: true });

  const sourcePath = path.join(codeDir, "donbeolja_v6.1.1.0_TV_IMPORT_FINAL.pine.txt");
  const latestPath = path.join(codeDir, "donbeolja_latest_generated.pine.txt");
  fs.writeFileSync(sourcePath, "// current tv import\n", "utf8");

  const resolved = resolveCurrentVersionPineSource({
    repoRoot: root,
    strategyId: "donbeolja_v6.1.1.0",
  });
  assert.strictEqual(resolved.ok, true);
  assert.strictEqual(resolved.source_file_path, sourcePath);

  let sync = syncCurrentVersionPineAlias({
    sourceFilePath: resolved.source_file_path,
    latestFilePath: latestPath,
  });
  assert.strictEqual(sync.ok, true);
  assert.strictEqual(sync.synced, true);
  assert.strictEqual(fs.readFileSync(latestPath, "utf8"), "// current tv import\n");

  sync = syncCurrentVersionPineAlias({
    sourceFilePath: resolved.source_file_path,
    latestFilePath: latestPath,
  });
  assert.strictEqual(sync.ok, true);
  assert.strictEqual(sync.synced, false);
  assert.strictEqual(automationSyncCurrentVersionPine.__test.shouldOpenSyncedPine(sync), false);
  const unchangedContext = buildPineOpenContext({
    sourceFilePath: sourcePath,
    latestFilePath: latestPath,
  });
  assert.ok(String(unchangedContext.message).includes("donbeolja_latest_generated.pine.txt"));
  assert.ok(String(unchangedContext.message).includes("donbeolja_v6.1.1.0_TV_IMPORT_FINAL.pine.txt"));

  fs.writeFileSync(sourcePath, "// changed tv import\n", "utf8");
  sync = syncCurrentVersionPineAlias({
    sourceFilePath: resolved.source_file_path,
    latestFilePath: latestPath,
  });
  assert.strictEqual(sync.ok, true);
  assert.strictEqual(sync.synced, true);
  assert.strictEqual(automationSyncCurrentVersionPine.__test.shouldOpenSyncedPine(sync), true);
  assert.strictEqual(fs.readFileSync(latestPath, "utf8"), "// changed tv import\n");

  console.log("CURRENT_VERSION_PINE_SYNC_TEST_OK");
}

run();
