#!/usr/bin/env node
"use strict";

require("dotenv").config();

const path = require("path");
const { spawnSync } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function envInt(name, fallback) {
  const n = Number(process.env[name]);
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : fallback;
}

function runScript(script, env = {}) {
  const scriptPath = path.join(REPO_ROOT, "scripts", script);
  const child = spawnSync(process.execPath, [scriptPath], {
    cwd: REPO_ROOT,
    encoding: "utf8",
    env: { ...process.env, ...env },
    maxBuffer: 1024 * 1024 * 16,
  });
  const stdout = String(child.stdout || "").trim();
  const stderr = String(child.stderr || "").trim();
  if (stdout) process.stdout.write(`${stdout}\n`);
  if (stderr) process.stderr.write(`${stderr}\n`);
  return child.status === 0;
}

async function main() {
  const watchdogEveryMs = envInt("ACTIVE_EXIT_WATCHDOG_LOOP_MS", 5000);
  const integrityEveryMs = envInt("ACTIVE_EXIT_INTEGRITY_LOOP_MS", 60000);
  const dailyEveryMs = envInt("ACTIVE_EXIT_DAILY_OPS_LOOP_MS", 300000);
  const watchdogApply = String(process.env.ACTIVE_EXIT_WATCHDOG_APPLY || process.env.APPLY || "0").trim();
  const integrityApply = String(process.env.OPENCLAW_EXIT_INTEGRITY_CYCLE_APPLY || process.env.APPLY || "0").trim();

  let nextIntegrityAt = 0;
  let nextDailyAt = 0;

  while (true) {
    const now = Date.now();
    runScript("run-binance-active-exit-watchdog.js", {
      APPLY: watchdogApply,
    });
    if (now >= nextIntegrityAt) {
      runScript("run-binance-exit-integrity-cycle.js", {
        APPLY: integrityApply,
      });
      nextIntegrityAt = now + integrityEveryMs;
    }
    if (now >= nextDailyAt) {
      runScript("daily-system-ops-check.js");
      nextDailyAt = now + dailyEveryMs;
    }
    await sleep(watchdogEveryMs);
  }
}

if (require.main === module) {
  main().catch((err) => {
    console.error("RUN_BINANCE_ACTIVE_EXIT_CONTROL_PLANE_FAIL", err && err.stack ? err.stack : String(err));
    process.exit(1);
  });
}
