"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const {
  parseEnvFile,
  resolveLocalEnvPaths,
  loadLocalEnv,
} = require("../../scripts/lib/automation-utils");

function withTempDir(prefix, fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  try {
    return fn(dir);
  } finally {
    try { fs.rmSync(dir, { recursive: true, force: true }); } catch (_) {}
  }
}

(function parseEnvFileSupportsExportSyntax() {
  withTempDir("dbj-automation-env-", (dir) => {
    const envFile = path.join(dir, "runtime.env");
    fs.writeFileSync(envFile, [
      "# comment",
      "export DONBEOLJA_V2_LIVE_PAPER_MODE='1'",
      "export DONBEOLJA_OPENCLAW_SERVER_PRIMARY_TICK_EXECUTION_MODE=\"LIVE\"",
      "BASE_URL=http://127.0.0.1:3000",
      "",
    ].join("\n"));
    const parsed = parseEnvFile(envFile);
    assert.strictEqual(parsed.DONBEOLJA_V2_LIVE_PAPER_MODE, "1");
    assert.strictEqual(parsed.DONBEOLJA_OPENCLAW_SERVER_PRIMARY_TICK_EXECUTION_MODE, "LIVE");
    assert.strictEqual(parsed.BASE_URL, "http://127.0.0.1:3000");
    assert.strictEqual(parsed["export DONBEOLJA_V2_LIVE_PAPER_MODE"], undefined);
  });
})();

(function resolveLocalEnvPathsIncludesLocalCostSaverAndHomeEnv() {
  const paths = resolveLocalEnvPaths("/tmp/example-home");
  assert.ok(paths.some((row) => row.endsWith("/.env.openclaw")));
  assert.ok(paths.some((row) => row.endsWith("/.openclaw/.env")));
  assert.ok(paths.some((row) => row.endsWith("/ops/runtime/local_cost_saver_runtime.env")));
})();

(function loadLocalEnvPrefersLaterFilesWithoutOverridingExistingEnv() {
  withTempDir("dbj-load-local-env-", (dir) => {
    const baseEnvFile = path.join(dir, "base.env");
    const localPrimaryEnvFile = path.join(dir, "local_primary.env");
    fs.writeFileSync(baseEnvFile, [
      "DONBEOLJA_OPENCLAW_SERVER_PRIMARY_TICK_EXECUTION_MODE=PAPER",
      "BASE_URL=https://cloud.example",
    ].join("\n"));
    fs.writeFileSync(localPrimaryEnvFile, [
      "export DONBEOLJA_OPENCLAW_SERVER_PRIMARY_TICK_EXECUTION_MODE='LIVE'",
      "export DONBEOLJA_V2_LIVE_PAPER_MODE='1'",
      "BASE_URL=http://127.0.0.1:3000",
    ].join("\n"));

    const env = {
      HOME: dir,
      EXPLICIT_VALUE: "keep-me",
      BASE_URL: "",
    };
    loadLocalEnv({
      env,
      paths: [baseEnvFile, localPrimaryEnvFile],
    });

    assert.strictEqual(env.DONBEOLJA_OPENCLAW_SERVER_PRIMARY_TICK_EXECUTION_MODE, "LIVE");
    assert.strictEqual(env.DONBEOLJA_V2_LIVE_PAPER_MODE, "1");
    assert.strictEqual(env.BASE_URL, "http://127.0.0.1:3000");
    assert.strictEqual(env.EXPLICIT_VALUE, "keep-me");
  });
})();

console.log("AUTOMATION_UTILS_ENV_LOADING_TEST_OK");
