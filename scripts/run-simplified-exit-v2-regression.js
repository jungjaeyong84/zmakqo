#!/usr/bin/env node
"use strict";

const path = require("path");
const { spawn } = require("child_process");

const REPO_ROOT = path.resolve(__dirname, "..");

const V2_TESTS = Object.freeze([
  "src/tests/simplified-exit-v2.test.js",
  "src/tests/position-state-machine.test.js",
  "src/tests/tp-qty-contract.test.js",
  "src/tests/report-simplified-exit-v2-live-flow.test.js",
  "src/tests/report-simplified-exit-v2-tp1-drilldown.test.js",
  "src/tests/simplified-exit-v2-tp1-missing-replay.test.js",
  "src/tests/simplified-exit-v2-tp1-repair-rearm-replay.test.js",
  "src/tests/tp1-native-refresh-telemetry.test.js",
  "src/tests/tp1-native-protection-gap-watchdog.test.js",
  "src/tests/tp1-meta-sync-gap-watchdog.test.js",
  "src/tests/opposite-transition-immediate-reentry.test.js",
  "src/tests/live-rescue-add-plan.test.js",
  "src/tests/trade-execution-alert.test.js",
  "src/tests/exit-stage-summary.test.js",
  "src/tests/exit-stage-fast-tp0.test.js",
  "src/tests/tick-exit-cooldown.test.js",
  "src/tests/binance-active-exit-watchdog.test.js",
  "src/tests/live-trailing-stage-repair.test.js",
  "src/tests/binance-live-state-flow-integration.test.js",
  "src/tests/binance-position-reconciler.test.js",
  "src/tests/binance-fills-qty-pct.test.js",
]);

function toTimeoutMs(value, fallback = 60000) {
  const n = Number(value);
  if (!Number.isFinite(n) || n < 1000) return fallback;
  return Math.floor(n);
}

function appendWithCap(current = "", chunk = "", maxChars = 1024 * 1024) {
  const next = `${current}${chunk}`;
  if (next.length <= maxChars) return next;
  return next.slice(-maxChars);
}

async function runNodeScript(scriptPath, {
  timeoutMs = 60000,
} = {}) {
  return new Promise((resolve) => {
    const startedAt = Date.now();
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let killTimer = null;

    const child = spawn(process.execPath, [scriptPath], {
      cwd: REPO_ROOT,
      env: process.env,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const finalize = ({ code = null, signal = null, error = null } = {}) => {
      if (settled) return;
      settled = true;
      if (killTimer) clearTimeout(killTimer);
      resolve({
        ok: code === 0 && timedOut !== true && !error,
        script: scriptPath,
        exit_code: code,
        signal,
        timed_out: timedOut,
        duration_ms: Date.now() - startedAt,
        stdout_tail: String(stdout || "").trim().split(/\r?\n/).filter(Boolean).slice(-10),
        stderr_tail: String(stderr || "").trim().split(/\r?\n/).filter(Boolean).slice(-10),
        error: error && error.message ? error.message : (error ? String(error) : null),
      });
    };

    child.stdout.on("data", (chunk) => {
      stdout = appendWithCap(stdout, chunk.toString("utf8"));
    });
    child.stderr.on("data", (chunk) => {
      stderr = appendWithCap(stderr, chunk.toString("utf8"));
    });
    child.on("error", (error) => finalize({ error }));
    child.on("close", (code, signal) => finalize({ code, signal }));

    killTimer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => {
        if (!settled) child.kill("SIGKILL");
      }, 5000).unref();
    }, timeoutMs);
  });
}

async function runSimplifiedExitV2Regression({
  tests = V2_TESTS,
  timeoutMs = null,
} = {}) {
  const resolvedTimeoutMs = toTimeoutMs(
    timeoutMs
    ?? process.env.SIMPLIFIED_EXIT_V2_TEST_TIMEOUT_MS
    ?? process.env.EXIT_INTEGRITY_SCRIPT_TIMEOUT_MS
    ?? 60000
  );

  const steps = [];
  for (const script of tests) {
    const step = await runNodeScript(script, { timeoutMs: resolvedTimeoutMs });
    steps.push(step);
    if (step.ok !== true) break;
  }

  const failed = steps.filter((step) => step.ok !== true);
  const summary = {
    ok: failed.length === 0,
    reason: failed.length === 0
      ? "SIMPLIFIED_EXIT_V2_REGRESSION_PASS"
      : "SIMPLIFIED_EXIT_V2_REGRESSION_FAIL",
    timeout_ms: resolvedTimeoutMs,
    total_test_n: tests.length,
    executed_test_n: steps.length,
    failed_test_n: failed.length,
    failed_tests: failed.map((step) => ({
      script: step.script,
      exit_code: step.exit_code,
      signal: step.signal || null,
      timed_out: step.timed_out === true,
      error: step.error || null,
      stdout_tail: step.stdout_tail,
      stderr_tail: step.stderr_tail,
    })),
    steps,
  };
  return summary;
}

async function main() {
  const result = await runSimplifiedExitV2Regression();
  if (result.ok === true) {
    console.log(JSON.stringify(result));
    return;
  }
  console.error(JSON.stringify(result));
  process.exit(1);
}

if (require.main === module) {
  main().catch((err) => {
    console.error(JSON.stringify({
      ok: false,
      reason: "SIMPLIFIED_EXIT_V2_REGRESSION_CRASH",
      error: err && err.stack ? err.stack : String(err),
    }));
    process.exit(1);
  });
} else {
  module.exports = {
    runSimplifiedExitV2Regression,
    __test: {
      V2_TESTS,
      toTimeoutMs,
      appendWithCap,
    },
  };
}
