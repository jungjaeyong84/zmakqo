"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { execFileSync } = require("child_process");

function run() {
  const repoRoot = path.resolve(__dirname, "../..");
  const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "donbeolja-watchdog-"));
  const env = {
    ...process.env,
    HOME: tmpHome,
    CODEX_HOME: tmpHome,
  };

  const stdout = execFileSync(process.execPath, [path.join(repoRoot, "scripts", "run-binance-active-exit-watchdog.js")], {
    cwd: repoRoot,
    env: {
      ...env,
      BINANCEFUT_API_KEY: "",
      BINANCEFUT_API_SECRET: "",
    },
    encoding: "utf8",
  });

  const parsed = JSON.parse(String(stdout || "").trim());
  assert.strictEqual(parsed.ok, false);
  assert.ok(/binance_active_exit_watchdog_latest\.json$/.test(parsed.output_json));
  assert.ok(/binance_active_exit_watchdog_latest\.md$/.test(parsed.output_md));

  console.log("RUN_BINANCE_ACTIVE_EXIT_WATCHDOG_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("RUN_BINANCE_ACTIVE_EXIT_WATCHDOG_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
