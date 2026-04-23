"use strict";

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const entryStreak = require("../../scripts/check-v2-production-entry-route-canary-streak");
const exitStreak = require("../../scripts/check-v2-exit-runtime-canary-streak");
const repairStreak = require("../../scripts/check-v2-repair-queue-firestore-canary-streak");
const runner = require("../../scripts/run-v2-discovery-canary-preflight-deploy");

function makeReport(ok, reason, blockers = []) {
  return Object.freeze({ ok, reason, blockers: Object.freeze(blockers.slice()) });
}

function writePerfMetrics(payload) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "v2-discovery-perf-"));
  const file = path.join(dir, "perf.json");
  fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return file;
}

async function withPatchedRunChecks(overrides, fn) {
  const originalEntry = entryStreak.runCheck;
  const originalExit = exitStreak.runCheck;
  const originalRepair = repairStreak.runCheck;
  entryStreak.runCheck = overrides.entry;
  exitStreak.runCheck = overrides.exit;
  repairStreak.runCheck = overrides.repair;
  try {
    await fn();
  } finally {
    entryStreak.runCheck = originalEntry;
    exitStreak.runCheck = originalExit;
    repairStreak.runCheck = originalRepair;
  }
}

async function blockedPreflightReturnsStructuredFailure() {
  await withPatchedRunChecks({
    entry: async () => makeReport(false, "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_BLOCKED", ["PRODUCTION_ENTRY_ROUTE_CANARY_STREAK:COVERAGE_INSUFFICIENT"]),
    exit: async () => makeReport(true, "V2_EXIT_RUNTIME_CANARY_STREAK_PASS"),
    repair: () => makeReport(true, "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS"),
  }, async () => {
    const perfFile = writePerfMetrics({
      sample_n: 0,
      win_rate_pct: 0,
      profit_factor: 0,
      expectancy: 0,
      net_pnl_pct: 0,
      mdd_pct: -1,
    });
    const result = await runner.main({ TAG: "v2-fixture", V2_PERFORMANCE_GATE_INPUT_FILE: perfFile }, { skipDeploy: true, softFail: true });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "V2_DISCOVERY_CANARY_PREFLIGHT_BLOCKED");
    assert(result.blockers.includes("PRODUCTION_ENTRY_ROUTE_CANARY_STREAK:COVERAGE_INSUFFICIENT"));
    assert.strictEqual(result.performance.ok, true);
    assert.strictEqual(result.performance.stage_matrix.highest_passed_stage, null);
  });
}

async function passingPreflightBuildsDiscoveryDeployCommand() {
  await withPatchedRunChecks({
    entry: async () => makeReport(true, "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS"),
    exit: async () => makeReport(true, "V2_EXIT_RUNTIME_CANARY_STREAK_PASS"),
    repair: () => makeReport(true, "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_PASS"),
  }, async () => {
    const perfFile = writePerfMetrics({
      sample_n: 55,
      win_rate_pct: 49,
      profit_factor: 1.11,
      expectancy: 0.01,
      net_pnl_pct: 0.7,
      mdd_pct: -4.5,
      cost_ratio_pct: 0.12,
      latest_error_count_24h: 0,
    });
    const result = await runner.main({
      TAG: "v2-fixture",
      COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL: "ETHUSDT",
      V2_PERFORMANCE_GATE_INPUT_FILE: perfFile,
    }, { skipDeploy: true, softFail: true });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.reason, "V2_DISCOVERY_CANARY_PREFLIGHT_PASS_DEPLOY_SKIPPED");
    assert.strictEqual(result.substitutions._TAG, "v2-fixture");
    assert.strictEqual(result.substitutions._COMMIT_SHA, "0123456789abcdef0123456789abcdef01234567");
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS, "ETHUSDT");
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED, "1");
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED, "1");
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED, "1");
    assert(result.command_preview.includes("gcloud builds submit"));
    assert(result.command_preview.includes("_DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS=ETHUSDT"));
    assert.strictEqual(result.performance.stage_matrix.highest_passed_stage, "CANARY");
    assert.strictEqual(result.performance.stage_matrix.discovery.ok, true);
    assert.strictEqual(result.performance.stage_matrix.canary.ok, true);
    assert.strictEqual(result.performance.stage_matrix.live.ok, false);
  });
}

async function run() {
  await blockedPreflightReturnsStructuredFailure();
  await passingPreflightBuildsDiscoveryDeployCommand();
  console.log("run-v2-discovery-canary-preflight-deploy.test.js: OK");
}

run().catch((error) => {
  console.error("run-v2-discovery-canary-preflight-deploy.test.js: FAIL");
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
