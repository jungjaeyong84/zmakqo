"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { main, __test } = require("../../scripts/run-v2-production-entry-protected-canary");

function makeTempDir() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "v2-protected-canary-"));
}

function outputEnv(dir) {
  return {
    DONBEOLJA_V2_PRODUCTION_ENTRY_PROTECTED_CANARY_FILE: path.join(dir, "latest.json"),
    DONBEOLJA_V2_PRODUCTION_ENTRY_PROTECTED_CANARY_HISTORY_FILE: path.join(dir, "history.jsonl"),
  };
}

async function scriptWritesLatestAndHistoryArtifacts() {
  const dir = makeTempDir();
  const env = outputEnv(dir);
  const artifact = await main({ env, setProcessExitCode: false });
  assert.strictEqual(artifact.ok, true);
  assert.strictEqual(artifact.exchange_write_performed, false);
  assert.strictEqual(artifact.output_file, env.DONBEOLJA_V2_PRODUCTION_ENTRY_PROTECTED_CANARY_FILE);
  assert.strictEqual(artifact.history_file, env.DONBEOLJA_V2_PRODUCTION_ENTRY_PROTECTED_CANARY_HISTORY_FILE);
  const latest = JSON.parse(fs.readFileSync(artifact.output_file, "utf8"));
  const historyLines = fs.readFileSync(artifact.history_file, "utf8").trim().split("\n");
  assert.strictEqual(latest.reason, "V2_PRODUCTION_ENTRY_PROTECTED_CANARY_PASS");
  assert.strictEqual(historyLines.length, 1);
  assert.strictEqual(JSON.parse(historyLines[0]).reason, "V2_PRODUCTION_ENTRY_PROTECTED_CANARY_PASS");
}

function resolvesDefaultPaths() {
  const env = {};
  assert.ok(__test.resolveOutputFile(env).endsWith("v2_production_entry_protected_canary_latest.json"));
  assert.ok(__test.resolveHistoryFile(env).endsWith("v2_production_entry_protected_canary_history.jsonl"));
}

async function mainTest() {
  resolvesDefaultPaths();
  await scriptWritesLatestAndHistoryArtifacts();
}

mainTest()
  .then(() => {
    console.log("RUN_V2_PRODUCTION_ENTRY_PROTECTED_CANARY_TEST_OK");
  })
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
