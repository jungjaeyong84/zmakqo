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

function makeCorrectiveExitReport(blockers = [
  "EXIT_RUNTIME_CANARY_STREAK:MIN_RUN_COUNT",
  "EXIT_RUNTIME_CANARY_STREAK:UNHEALTHY_ROW_IN_WINDOW",
  "EXIT_RUNTIME_CANARY_STREAK:GAP_EXCEEDED",
]) {
  return Object.freeze({
    ok: false,
    reason: "V2_EXIT_RUNTIME_CANARY_STREAK_BLOCKED",
    blockers: Object.freeze(blockers.slice()),
    tp1_missing_n: 0,
    native_refresh_unhealthy_n: 0,
    unprotected_window_violation_n: 0,
    alert_silent_drop_n: 0,
    alert_retry_unresolved_n: 0,
    alert_outbox_integrity_gap_n: 0,
    trail_activation_evidence_gap_n: 0,
  });
}

function makeLatestExitCanaryPass() {
  return Object.freeze({
    ok: true,
    reason: "V2_EXIT_RUNTIME_CANARY_PASS",
    exchange_write_performed: false,
    fail_n: 0,
    tp1_missing_n: 0,
    native_refresh_unhealthy_n: 0,
    unprotected_window_violation_n: 0,
    alert_silent_drop_n: 0,
    alert_retry_unresolved_n: 0,
    alert_outbox_integrity_gap_n: 0,
    trail_activation_evidence_gap_n: 0,
    blockers: Object.freeze([]),
  });
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
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT, "16");
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE, "6");
    assert.strictEqual(
      result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP,
      "BTCUSDT:155|ETHUSDT:120|LINKUSDT:120|BNBUSDT:120|XRPUSDT:120|SOLUSDT:120|AXSUSDT:120|DOGEUSDT:120|WLDUSDT:120|TAOUSDT:120|ARBUSDT:120|INJUSDT:120|SUIUSDT:120|AAVEUSDT:120|SANDUSDT:120|TIAUSDT:120"
    );
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED, "1");
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED, "1");
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_REALIZED_GUARD_ENABLED, "0");
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED, "1");
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_SHADOW_EXIT_WRITE_ENABLED, "1");
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_SHADOW_ALERT_DELIVERY_ENABLED, "1");
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE, "1300");
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE, "200");
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE, "900");
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_ALLOW_LEGACY_SCHEDULER_WRITES, "0");
    assert(result.command_preview.includes("gcloud builds submit"));
    assert(result.command_preview.includes("_DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS=ETHUSDT"));
    assert(result.command_preview.includes("_DONBEOLJA_V2_ALLOW_LEGACY_SCHEDULER_WRITES=0"));
    assert.strictEqual(result.performance.stage_matrix.highest_passed_stage, "CANARY");
    assert.strictEqual(result.performance.stage_matrix.discovery.ok, true);
    assert.strictEqual(result.performance.stage_matrix.canary.ok, true);
    assert.strictEqual(result.performance.stage_matrix.live.ok, false);
  });
}

async function passingPreflightDoesNotDeployWithoutExplicitArm() {
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
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: "SOLUSDT|XRPUSDT",
      V2_PERFORMANCE_GATE_INPUT_FILE: perfFile,
    }, { softFail: true });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.reason, "V2_DISCOVERY_CANARY_PREFLIGHT_PASS_DEPLOY_NOT_ARMED");
    assert.strictEqual(result.deploy_intent.deploy_requested, false);
    assert.strictEqual(result.deploy_intent.confirm_phrase_required, "DEPLOY_V2_DISCOVERY_CANARY");
  });
}

async function deployFlagRequiresConfirmPhrase() {
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
      DONBEOLJA_V2_DISCOVERY_CANARY_DEPLOY: "1",
      DONBEOLJA_V2_DISCOVERY_CANARY_DEPLOY_CONFIRM: "WRONG",
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: "SOLUSDT|XRPUSDT",
      V2_PERFORMANCE_GATE_INPUT_FILE: perfFile,
    }, { softFail: true });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "V2_DISCOVERY_CANARY_DEPLOY_CONFIRM_REQUIRED");
    assert(result.blockers.includes("DISCOVERY_CANARY_DEPLOY:CONFIRM_PHRASE_REQUIRED"));
  });
}

function cloudBuildSubmitBudgetBlocksDailyChurn() {
  const builds = Array.from({ length: 6 }, (_, index) => ({ id: `build-${index + 1}` }));
  const result = runner.evaluateCloudBuildSubmitBudget({
    env: {
      DONBEOLJA_V2_CLOUDBUILD_RECENT_BUILDS_JSON: JSON.stringify(builds),
      DONBEOLJA_V2_CLOUDBUILD_DAILY_SUBMIT_LIMIT: "6",
    },
  });
  assert.strictEqual(result.ok, false);
  assert.strictEqual(result.reason, "V2_CLOUDBUILD_SUBMIT_BUDGET_BLOCKED");
  assert(result.blockers.includes("CLOUDBUILD_SUBMIT_BUDGET:DAILY_LIMIT_EXCEEDED"));
  assert.strictEqual(result.build_n, 6);
  assert.strictEqual(result.limit, 6);
}

function cloudBuildSubmitBudgetOverrideIsExplicit() {
  const builds = Array.from({ length: 7 }, (_, index) => ({ id: `build-${index + 1}` }));
  const result = runner.evaluateCloudBuildSubmitBudget({
    env: {
      DONBEOLJA_V2_CLOUDBUILD_RECENT_BUILDS_JSON: JSON.stringify(builds),
      DONBEOLJA_V2_CLOUDBUILD_DAILY_SUBMIT_LIMIT: "6",
      DONBEOLJA_V2_CLOUDBUILD_SUBMIT_BUDGET_OVERRIDE_CONFIRM: runner.__test.CLOUDBUILD_BUDGET_OVERRIDE_PHRASE,
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.reason, "V2_CLOUDBUILD_SUBMIT_BUDGET_PASS");
  assert.strictEqual(result.override_confirmed, true);
  assert.strictEqual(result.build_n, 7);
}

async function deployConfirmedStopsBeforeGcloudWhenBudgetExceeded() {
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
    const stateFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), "v2-discovery-state-")), "state.json");
    let submitCalled = false;
    const result = await runner.main({
      TAG: "v2-fixture",
      COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
      DONBEOLJA_V2_DISCOVERY_CANARY_DEPLOY: "1",
      DONBEOLJA_V2_DISCOVERY_CANARY_DEPLOY_CONFIRM: runner.__test.DEPLOY_CONFIRM_PHRASE,
      DONBEOLJA_V2_DISCOVERY_CANARY_AUTODEPLOY_STATE_FILE: stateFile,
      DONBEOLJA_V2_CLOUDBUILD_RECENT_BUILDS_JSON: JSON.stringify(Array.from({ length: 6 }, (_, index) => ({ id: `build-${index + 1}` }))),
      DONBEOLJA_V2_CLOUDBUILD_DAILY_SUBMIT_LIMIT: "6",
      V2_PERFORMANCE_GATE_INPUT_FILE: perfFile,
    }, {
      softFail: true,
      execFileSync: () => {
        submitCalled = true;
        throw new Error("GCLOUD_SUBMIT_SHOULD_NOT_RUN");
      },
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.reason, "V2_CLOUDBUILD_SUBMIT_BUDGET_BLOCKED");
    assert.strictEqual(submitCalled, false);
    assert(result.blockers.includes("CLOUDBUILD_SUBMIT_BUDGET:DAILY_LIMIT_EXCEEDED"));
  });
}

async function passingPreflightCanBuildTwoSymbolDiscoveryCommand() {
  await withPatchedRunChecks({
    entry: async () => makeReport(true, "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS"),
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
    const result = await runner.main({
      TAG: "v2-fixture",
      COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: "SOLUSDT|XRPUSDT",
      V2_PERFORMANCE_GATE_INPUT_FILE: perfFile,
    }, { skipDeploy: true, softFail: true });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS, "SOLUSDT|XRPUSDT");
  });
}

async function passingPreflightCanBuildFullUniverseMinimumNotionalCommand() {
  await withPatchedRunChecks({
    entry: async () => makeReport(true, "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS"),
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
    const symbols = "BTCUSDT|ETHUSDT|BNBUSDT|XRPUSDT|SOLUSDT|AXSUSDT|DOGEUSDT|LINKUSDT";
    const result = await runner.main({
      TAG: "v2-fixture",
      COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: symbols,
      DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT: "16",
      DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE: "6",
      V2_PERFORMANCE_GATE_INPUT_FILE: perfFile,
    }, { skipDeploy: true, softFail: true });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS, symbols);
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT, "16");
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE, "6");
    assert.strictEqual(
      result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP,
      "BTCUSDT:155|ETHUSDT:120|LINKUSDT:120|BNBUSDT:120|XRPUSDT:120|SOLUSDT:120|AXSUSDT:120|DOGEUSDT:120|WLDUSDT:120|TAOUSDT:120|ARBUSDT:120|INJUSDT:120|SUIUSDT:120|AAVEUSDT:120|SANDUSDT:120|TIAUSDT:120"
    );
  });
}

async function activePositionEvidencePendingAllowsDiscoveryBootstrapOnly() {
  await withPatchedRunChecks({
    entry: async () => makeReport(true, "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS"),
    exit: async () => makeReport(false, "V2_EXIT_RUNTIME_CANARY_STREAK_BLOCKED", ["EXIT_RUNTIME_CANARY_STREAK:ACTIVE_POSITION_EVIDENCE_REQUIRED"]),
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
    const result = await runner.main({
      TAG: "v2-fixture",
      COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
      DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL: "SOLUSDT",
      V2_PERFORMANCE_GATE_INPUT_FILE: perfFile,
    }, { skipDeploy: true, softFail: true });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.reason, "V2_DISCOVERY_CANARY_PREFLIGHT_PASS_DEPLOY_SKIPPED");
    assert.strictEqual(result.active_position_bootstrap_allowed, true);
    assert.deepStrictEqual(result.warnings, ["DISCOVERY_CANARY_BOOTSTRAP:EXIT_ACTIVE_POSITION_EVIDENCE_PENDING"]);
    assert.strictEqual(result.substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS, "SOLUSDT");
  });
}

async function activePositionEvidenceDoesNotMaskRealExitDefects() {
  await withPatchedRunChecks({
    entry: async () => makeReport(true, "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS"),
    exit: async () => makeReport(false, "V2_EXIT_RUNTIME_CANARY_STREAK_BLOCKED", [
      "EXIT_RUNTIME_CANARY_STREAK:ACTIVE_POSITION_EVIDENCE_REQUIRED",
      "EXIT_RUNTIME_CANARY_STREAK:TP1_MISSING",
    ]),
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
    assert(result.blockers.includes("EXIT_RUNTIME_CANARY_STREAK:TP1_MISSING"));
  });
}

async function correctiveDeployAllowsOnlyExitStreakRebuildWhenLatestCanaryPasses() {
  await withPatchedRunChecks({
    entry: async () => makeReport(true, "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS"),
    exit: async () => makeCorrectiveExitReport(),
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
    const result = await runner.main({
      TAG: "v2-fixture",
      COMMIT_SHA: "0123456789abcdef0123456789abcdef01234567",
      DONBEOLJA_V2_DISCOVERY_CANARY_CORRECTIVE_DEPLOY: "1",
      DONBEOLJA_V2_DISCOVERY_CANARY_CORRECTIVE_DEPLOY_CONFIRM: "CORRECTIVE_DEPLOY_V2_DISCOVERY_CANARY",
      V2_PERFORMANCE_GATE_INPUT_FILE: perfFile,
    }, {
      skipDeploy: true,
      softFail: true,
      runExitRuntimeCanaryFn: async () => makeLatestExitCanaryPass(),
    });
    assert.strictEqual(result.ok, true);
    assert.strictEqual(result.corrective_exit_runtime.allowed, true);
    assert.strictEqual(result.corrective_exit_runtime.reason, "CORRECTIVE_EXIT_STREAK_DEPLOY_ALLOWED");
    assert(result.warnings.includes("DISCOVERY_CANARY_CORRECTIVE_DEPLOY:EXIT_STREAK_REBUILD_REQUIRED"));
  });
}

async function correctiveDeployDoesNotMaskLatestExitCanaryFailure() {
  await withPatchedRunChecks({
    entry: async () => makeReport(true, "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_PASS"),
    exit: async () => makeCorrectiveExitReport(),
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
    const result = await runner.main({
      TAG: "v2-fixture",
      DONBEOLJA_V2_DISCOVERY_CANARY_CORRECTIVE_DEPLOY: "1",
      DONBEOLJA_V2_DISCOVERY_CANARY_CORRECTIVE_DEPLOY_CONFIRM: "CORRECTIVE_DEPLOY_V2_DISCOVERY_CANARY",
      V2_PERFORMANCE_GATE_INPUT_FILE: perfFile,
    }, {
      skipDeploy: true,
      softFail: true,
      runExitRuntimeCanaryFn: async () => Object.freeze({
        ...makeLatestExitCanaryPass(),
        ok: false,
        fail_n: 1,
        blockers: Object.freeze(["EXIT_RUNTIME_CANARY_PROTECTION_RUNTIME_MISSING"]),
      }),
    });
    assert.strictEqual(result.ok, false);
    assert.strictEqual(result.corrective_exit_runtime.allowed, false);
    assert(result.blockers.includes("EXIT_RUNTIME_CANARY_STREAK:MIN_RUN_COUNT"));
  });
}

async function run() {
  await blockedPreflightReturnsStructuredFailure();
  await passingPreflightBuildsDiscoveryDeployCommand();
  await passingPreflightDoesNotDeployWithoutExplicitArm();
  await deployFlagRequiresConfirmPhrase();
  cloudBuildSubmitBudgetBlocksDailyChurn();
  cloudBuildSubmitBudgetOverrideIsExplicit();
  await deployConfirmedStopsBeforeGcloudWhenBudgetExceeded();
  await passingPreflightCanBuildTwoSymbolDiscoveryCommand();
  await passingPreflightCanBuildFullUniverseMinimumNotionalCommand();
  await activePositionEvidencePendingAllowsDiscoveryBootstrapOnly();
  await activePositionEvidenceDoesNotMaskRealExitDefects();
  await correctiveDeployAllowsOnlyExitStreakRebuildWhenLatestCanaryPasses();
  await correctiveDeployDoesNotMaskLatestExitCanaryFailure();
  console.log("run-v2-discovery-canary-preflight-deploy.test.js: OK");
}

run().catch((error) => {
  console.error("run-v2-discovery-canary-preflight-deploy.test.js: FAIL");
  console.error(error && error.stack ? error.stack : String(error));
  process.exit(1);
});
