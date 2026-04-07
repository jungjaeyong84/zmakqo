"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { spawnSync } = require("child_process");

const SCRIPT = path.resolve(__dirname, "../../scripts/check-doc-artifact-parity.js");

function makeRoot() {
  return fs.mkdtempSync(path.join(os.tmpdir(), "doc-artifact-parity-"));
}

function write(filePath, body) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, body);
}

function runCheck(root, extraEnv = {}) {
  return spawnSync(process.execPath, [SCRIPT], {
    env: {
      ...process.env,
      DOC_ARTIFACT_PARITY_ROOT: root,
      ...extraEnv,
    },
    encoding: "utf8",
  });
}

function testPassWithArtifacts() {
  const root = makeRoot();
  write(path.join(root, "docs/ARTIFACT_SSOT_LOCK.md"), [
    "- governor_status: RECOVERY_REPLAY_BLOCKED",
    "- degraded_authority_eligible: false",
    "- server_signal_source_mode: SERVER_PRIMARY",
    "- server_signal_readiness_status: SERVER_PRIMARY_ACTIVE",
    "",
  ].join("\n"));
  write(path.join(root, "ops/daily/best_self_evolution_objective_recovery_governor_latest.json"), JSON.stringify({
    summary: {
      governor_status: "RECOVERY_REPLAY_BLOCKED",
      degraded_authority_eligible: false,
    },
  }));
  write(path.join(root, "ops/daily/server_signal_runtime_latest.json"), JSON.stringify({
    summary: {
      canonical_engine_source_mode: "SERVER_PRIMARY",
    },
  }));
  write(path.join(root, "ops/daily/server_signal_cutover_readiness_latest.json"), JSON.stringify({
    summary: {
      readiness_status: "SERVER_PRIMARY_ACTIVE",
    },
  }));
  const res = runCheck(root);
  assert.strictEqual(res.status, 0, res.stderr);
  const parsed = JSON.parse(String(res.stdout || "").trim());
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.skipped, undefined);
}

function testSkipOnCiWhenArtifactsMissing() {
  const root = makeRoot();
  write(path.join(root, "docs/ARTIFACT_SSOT_LOCK.md"), "- governor_status: RECOVERY_REPLAY_BLOCKED\n");
  const res = runCheck(root, { CI: "true" });
  assert.strictEqual(res.status, 0, res.stderr);
  const parsed = JSON.parse(String(res.stdout || "").trim());
  assert.strictEqual(parsed.ok, true);
  assert.strictEqual(parsed.skipped, true);
  assert.strictEqual(parsed.reason, "CI_RUNTIME_ARTIFACTS_MISSING");
}

function testFailWhenArtifactsMissingLocally() {
  const root = makeRoot();
  write(path.join(root, "docs/ARTIFACT_SSOT_LOCK.md"), "- governor_status: RECOVERY_REPLAY_BLOCKED\n");
  const res = runCheck(root, { CI: "" });
  assert.notStrictEqual(res.status, 0);
  const parsed = JSON.parse(String(res.stderr || "").trim());
  assert.strictEqual(parsed.ok, false);
  assert.strictEqual(parsed.reason, "REQUIRED_ARTIFACTS_MISSING");
}

testPassWithArtifacts();
testSkipOnCiWhenArtifactsMissing();
testFailWhenArtifactsMissingLocally();

console.log("DOC_ARTIFACT_PARITY_TEST_OK");
