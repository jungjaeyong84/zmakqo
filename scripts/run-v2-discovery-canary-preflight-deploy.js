#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const entryStreak = require("./check-v2-production-entry-route-canary-streak");
const exitStreak = require("./check-v2-exit-runtime-canary-streak");
const repairStreak = require("./check-v2-repair-queue-firestore-canary-streak");
const runtimeManifest = require("./check-v2-runtime-discovery-canary-manifest");
const { evaluateV2PerformanceStageMatrix } = require("../src/v2/performanceGate");
const {
  DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP_TEXT,
} = require("../src/v2/discoveryCanaryNotionalPolicy");

const DEPLOY_CONFIRM_PHRASE = "DEPLOY_V2_DISCOVERY_CANARY";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function parseBool(value, fallback = false) {
  const text = String(value || "").trim().toLowerCase();
  if (!text) return Boolean(fallback);
  return text === "1" || text === "true" || text === "yes" || text === "on";
}

function resolveSymbol(env = process.env) {
  return trimOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS)
    || trimOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL)
    || "BTCUSDT";
}

function resolveTag(env = process.env) {
  return trimOrNull(env.TAG)
    || trimOrNull(env._TAG)
    || `v2-${execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim()}`;
}

function resolveCommitSha(env = process.env) {
  return trimOrNull(env.COMMIT_SHA)
    || trimOrNull(env._COMMIT_SHA)
    || execFileSync("git", ["rev-parse", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim();
}

function resolveStateFile(env = process.env) {
  return trimOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_AUTODEPLOY_STATE_FILE)
    || path.resolve(process.cwd(), "ops", "daily", "v2_discovery_canary_autodeploy_latest.json");
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  ensureDir(path.dirname(filePath));
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function readJsonIfExists(filePath) {
  try {
    if (!fs.existsSync(filePath)) return null;
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch (_) {
    return null;
  }
}

function resolvePerformanceMetricsFile(env = process.env) {
  return trimOrNull(env.V2_PERFORMANCE_GATE_INPUT_FILE)
    || path.resolve(process.cwd(), "ops", "daily", "v2_openclaw_daily_performance_report_latest.json");
}

function collectPerformanceStageMatrix(env = process.env) {
  const inputFile = resolvePerformanceMetricsFile(env);
  const row = readJsonIfExists(inputFile);
  if (!row) {
    return Object.freeze({
      ok: false,
      reason: "V2_DISCOVERY_CANARY_PERFORMANCE_METRICS_MISSING",
      input_file: inputFile,
      stage_matrix: null,
    });
  }
  return Object.freeze({
    ok: true,
    reason: "V2_DISCOVERY_CANARY_PERFORMANCE_STAGE_MATRIX_READY",
    input_file: inputFile,
    stage_matrix: evaluateV2PerformanceStageMatrix({
      metrics: row,
      env,
      mode: trimOrNull(env.V2_PERFORMANCE_GATE_MODE) || row.mode || "LIVE",
    }),
  });
}

function buildDiscoverySubstitutions(env = process.env) {
  return Object.freeze({
    _TAG: resolveTag(env),
    _COMMIT_SHA: resolveCommitSha(env),
    _DONBEOLJA_V2_ENABLED: "1",
    _DONBEOLJA_V2_DRY_RUN: "0",
    _DONBEOLJA_V2_CANARY_ONLY: "1",
    _DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "1",
    _DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "1",
    _DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: resolveSymbol(env),
    _DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT: trimOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_SYMBOL_COUNT) || "8",
    _DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE: trimOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE) || "6",
    _DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP: trimOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP)
      || DEFAULT_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP_TEXT,
    _DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT: trimOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT) || "5",
    _DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY: trimOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY) || "UNLIMITED",
    _DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE: trimOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE) || "10",
    _DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED: "1",
    _DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED: "1",
    _DONBEOLJA_V2_SHADOW_EXIT_WRITE_ENABLED: "1",
    _DONBEOLJA_V2_SHADOW_ALERT_DELIVERY_ENABLED: "1",
    _DONBEOLJA_V2_SAME_DIRECTION_COOLDOWN_ENABLED: trimOrNull(env.DONBEOLJA_V2_SAME_DIRECTION_COOLDOWN_ENABLED) || "1",
    _DONBEOLJA_V2_SAME_DIRECTION_COOLDOWN_BARS: trimOrNull(env.DONBEOLJA_V2_SAME_DIRECTION_COOLDOWN_BARS) || "8",
    _DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE: trimOrNull(env.DONBEOLJA_V2_RISK_MAX_TOTAL_NOTIONAL_QUOTE) || "300",
    _DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE: trimOrNull(env.DONBEOLJA_V2_RISK_MAX_SYMBOL_NOTIONAL_QUOTE) || "155",
    _DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE: trimOrNull(env.DONBEOLJA_V2_RISK_MAX_CORRELATED_GROUP_NOTIONAL_QUOTE) || "300",
    _DONBEOLJA_V2_RISK_MAX_TRADES_PER_DAY: trimOrNull(env.DONBEOLJA_V2_RISK_MAX_TRADES_PER_DAY) || "UNLIMITED",
    _DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL: "1",
    _DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL: "0",
    _DONBEOLJA_V2_LEGACY_RUNTIME_DISABLED: "1",
    _DONBEOLJA_V2_ALLOW_LEGACY_SCHEDULER_WRITES: "0",
    _DONBEOLJA_V2_LEGACY_ENTRY_FILTERS_DISABLED: "1",
    _DONBEOLJA_V2_LEGACY_WAIT_ONE_BAR_HARD_DROP_DISABLED: "1",
    _DONBEOLJA_V2_SCHEDULER_CUTOVER_MODE: "OPENCLAW_CRON",
    _DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_WRITE_ENABLED: "1",
    _DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED: "1",
    _DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE: "FIRESTORE",
    _DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE: "1",
    _DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_WRITE_ENABLED: "1",
    _DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED: "1",
    _DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE: "FIRESTORE",
    _DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE: "1",
    _ML_LIVE_SERVING_ARMED: "0",
  });
}

function buildSubstitutionArg(map) {
  return Object.entries(map).map(([key, value]) => `${key}=${value}`).join(",");
}

function resolveDeployIntent(env = process.env, options = {}) {
  const deploy_requested = options.deploy === true || parseBool(env.DONBEOLJA_V2_DISCOVERY_CANARY_DEPLOY, false);
  const confirm = trimOrNull(options.confirm) || trimOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_DEPLOY_CONFIRM);
  return Object.freeze({
    deploy_requested,
    deploy_confirmed: deploy_requested === true && confirm === DEPLOY_CONFIRM_PHRASE,
    confirm_phrase_required: DEPLOY_CONFIRM_PHRASE,
  });
}

function buildRuntimeManifestEnv(env = process.env, substitutions = {}) {
  return Object.freeze({
    ...env,
    TAG: substitutions._TAG || env.TAG,
    COMMIT_SHA: substitutions._COMMIT_SHA || env.COMMIT_SHA,
    DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_SYMBOLS: substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS,
    DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_ENABLED: substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED,
    DONBEOLJA_V2_EXPECTED_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: substitutions._DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED,
    DONBEOLJA_V2_EXPECTED_SHADOW_EXIT_WRITE_ENABLED: substitutions._DONBEOLJA_V2_SHADOW_EXIT_WRITE_ENABLED,
    DONBEOLJA_V2_EXPECTED_SHADOW_ALERT_DELIVERY_ENABLED: substitutions._DONBEOLJA_V2_SHADOW_ALERT_DELIVERY_ENABLED,
    DONBEOLJA_V2_EXPECTED_SAME_DIRECTION_COOLDOWN_ENABLED: substitutions._DONBEOLJA_V2_SAME_DIRECTION_COOLDOWN_ENABLED,
    DONBEOLJA_V2_EXPECTED_SAME_DIRECTION_COOLDOWN_BARS: substitutions._DONBEOLJA_V2_SAME_DIRECTION_COOLDOWN_BARS,
    DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE: substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE,
    DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP: substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL_NOTIONAL_QUOTE_MAP,
    DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_MAX_POSITION_COUNT: substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT,
    DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_MAX_TRADES_PER_DAY: substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY,
    DONBEOLJA_V2_EXPECTED_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE: substitutions._DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE,
    DONBEOLJA_V2_EXPECTED_RISK_MAX_TRADES_PER_DAY: substitutions._DONBEOLJA_V2_RISK_MAX_TRADES_PER_DAY,
  });
}

function samePlainObject(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
}

function isActivePositionBootstrapOnly(report) {
  const blockers = Array.isArray(report && report.blockers) ? report.blockers : [];
  return blockers.length === 1 && blockers[0] === "EXIT_RUNTIME_CANARY_STREAK:ACTIVE_POSITION_EVIDENCE_REQUIRED";
}

function buildPreflightBlockers({ entry, exit, repair } = {}) {
  const blockers = [];
  for (const report of [entry, exit, repair]) {
    if (report === exit && isActivePositionBootstrapOnly(report)) continue;
    if (Array.isArray(report && report.blockers) && report.blockers.length > 0) {
      blockers.push(...report.blockers);
    } else if (report && report.ok !== true && report.reason) {
      blockers.push(report.reason);
    }
  }
  return Object.freeze(blockers);
}

async function collectPreflight(env = process.env) {
  const streakEnv = Object.freeze({
    ...env,
    DONBEOLJA_V2_COLLECTION_PREFIX: trimOrNull(env.DONBEOLJA_V2_COLLECTION_PREFIX) || "v2__",
    DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_FIRESTORE_READ_ENABLED: "1",
    DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_SOURCE: "FIRESTORE",
    DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE: "1",
    DONBEOLJA_V2_EXIT_RUNTIME_CANARY_FIRESTORE_READ_ENABLED: "1",
    DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_SOURCE: "FIRESTORE",
    DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE: "1",
  });

  const [entry, exit] = await Promise.all([
    entryStreak.runCheck(streakEnv),
    exitStreak.runCheck(streakEnv),
  ]);
  const repair = repairStreak.runCheck(streakEnv);
  const performance = collectPerformanceStageMatrix(env);
  const activePositionBootstrapAllowed = isActivePositionBootstrapOnly(exit);
  const blockers = buildPreflightBlockers({ entry, exit, repair });
  return Object.freeze({
    ok: entry.ok === true && (exit.ok === true || activePositionBootstrapAllowed) && repair.ok === true && blockers.length === 0,
    entry,
    exit,
    repair,
    performance,
    active_position_bootstrap_allowed: activePositionBootstrapAllowed,
    warnings: activePositionBootstrapAllowed
      ? Object.freeze(["DISCOVERY_CANARY_BOOTSTRAP:EXIT_ACTIVE_POSITION_EVIDENCE_PENDING"])
      : Object.freeze([]),
    blockers,
  });
}

function buildDeployArgs(env = process.env) {
  return Object.freeze([
    "builds",
    "submit",
    "--config",
    trimOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_CLOUDBUILD_CONFIG) || "cloudbuild.yaml",
    "--substitutions",
    buildSubstitutionArg(buildDiscoverySubstitutions(env)),
  ]);
}

async function main(env = process.env, options = {}) {
  const preflight = await collectPreflight(env);
  const skipDeploy = options.skipDeploy === true || parseBool(env.DONBEOLJA_V2_DISCOVERY_CANARY_SKIP_DEPLOY, false);
  const stateFile = resolveStateFile(env);

  if (!preflight.ok) {
    const payload = Object.freeze({
      ok: false,
      reason: "V2_DISCOVERY_CANARY_PREFLIGHT_BLOCKED",
      blockers: preflight.blockers,
      entry: Object.freeze({
        ok: preflight.entry.ok,
        reason: preflight.entry.reason,
        blockers: preflight.entry.blockers || [],
      }),
      exit: Object.freeze({
        ok: preflight.exit.ok,
        reason: preflight.exit.reason,
        blockers: preflight.exit.blockers || [],
      }),
      repair: Object.freeze({
        ok: preflight.repair.ok,
        reason: preflight.repair.reason,
        blockers: preflight.repair.blockers || [],
      }),
      performance: preflight.performance,
    });
    writeJson(stateFile, payload);
    console.error(JSON.stringify(payload));
    if (!options.softFail) process.exitCode = 1;
    return payload;
  }

  const substitutions = buildDiscoverySubstitutions(env);
  const args = buildDeployArgs(env);
  const commandPreview = ["gcloud", ...args].join(" ");
  const previous = readJsonIfExists(stateFile);
  const deployIntent = resolveDeployIntent(env, options);

  if (skipDeploy) {
    const payload = Object.freeze({
      ok: true,
      reason: "V2_DISCOVERY_CANARY_PREFLIGHT_PASS_DEPLOY_SKIPPED",
      command_preview: commandPreview,
      substitutions,
      performance: preflight.performance,
      warnings: preflight.warnings,
      active_position_bootstrap_allowed: preflight.active_position_bootstrap_allowed,
      state_file: stateFile,
    });
    writeJson(stateFile, payload);
    console.log(JSON.stringify(payload));
    return payload;
  }

  if (!deployIntent.deploy_requested) {
    const payload = Object.freeze({
      ok: true,
      reason: "V2_DISCOVERY_CANARY_PREFLIGHT_PASS_DEPLOY_NOT_ARMED",
      command_preview: commandPreview,
      substitutions,
      performance: preflight.performance,
      warnings: preflight.warnings,
      active_position_bootstrap_allowed: preflight.active_position_bootstrap_allowed,
      deploy_intent: deployIntent,
      state_file: stateFile,
    });
    writeJson(stateFile, payload);
    console.log(JSON.stringify(payload));
    return payload;
  }

  if (!deployIntent.deploy_confirmed) {
    const payload = Object.freeze({
      ok: false,
      reason: "V2_DISCOVERY_CANARY_DEPLOY_CONFIRM_REQUIRED",
      blockers: Object.freeze(["DISCOVERY_CANARY_DEPLOY:CONFIRM_PHRASE_REQUIRED"]),
      command_preview: commandPreview,
      substitutions,
      performance: preflight.performance,
      deploy_intent: deployIntent,
      state_file: stateFile,
    });
    writeJson(stateFile, payload);
    console.error(JSON.stringify(payload));
    if (!options.softFail) process.exitCode = 1;
    return payload;
  }

  if (
    parseBool(env.DONBEOLJA_V2_DISCOVERY_CANARY_ALLOW_REPEAT_DEPLOY, false) !== true
    && previous
    && previous.ok === true
    && previous.reason === "V2_DISCOVERY_CANARY_DEPLOY_TRIGGERED"
    && samePlainObject(previous.substitutions, substitutions)
  ) {
    const payload = Object.freeze({
      ok: true,
      reason: "V2_DISCOVERY_CANARY_DEPLOY_ALREADY_TRIGGERED",
      command_preview: commandPreview,
      substitutions,
      performance: preflight.performance,
      deploy_intent: deployIntent,
      state_file: stateFile,
    });
    writeJson(stateFile, payload);
    console.log(JSON.stringify(payload));
    return payload;
  }

  execFileSync("gcloud", args, { cwd: process.cwd(), stdio: "inherit" });
  const runtimeManifestCheck = runtimeManifest.runCheck(buildRuntimeManifestEnv(env, substitutions));
  if (runtimeManifestCheck.ok !== true) {
    const payload = Object.freeze({
      ok: false,
      reason: "V2_DISCOVERY_CANARY_DEPLOY_RUNTIME_MISMATCH",
      blockers: runtimeManifestCheck.blockers || [],
      command_preview: commandPreview,
      substitutions,
      runtime_manifest: runtimeManifestCheck,
      performance: preflight.performance,
      warnings: preflight.warnings,
      active_position_bootstrap_allowed: preflight.active_position_bootstrap_allowed,
      deploy_intent: deployIntent,
      state_file: stateFile,
    });
    writeJson(stateFile, payload);
    console.error(JSON.stringify(payload));
    if (!options.softFail) process.exitCode = 1;
    return payload;
  }
  const payload = Object.freeze({
    ok: true,
    reason: "V2_DISCOVERY_CANARY_DEPLOY_TRIGGERED",
    command_preview: commandPreview,
    substitutions,
    runtime_manifest: runtimeManifestCheck,
    performance: preflight.performance,
    warnings: preflight.warnings,
    active_position_bootstrap_allowed: preflight.active_position_bootstrap_allowed,
    deploy_intent: deployIntent,
    state_file: stateFile,
  });
  writeJson(stateFile, payload);
  console.log(JSON.stringify(payload));
  return payload;
}

if (require.main === module) {
  main().catch((error) => {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_DISCOVERY_CANARY_PREFLIGHT_THROWN",
      error: error && error.message ? error.message : String(error),
    }));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    collectPreflight,
    buildDiscoverySubstitutions,
    buildDeployArgs,
    isActivePositionBootstrapOnly,
    buildPreflightBlockers,
    __test: {
      trimOrNull,
      parseBool,
      resolveSymbol,
      resolveTag,
      resolveCommitSha,
      resolveStateFile,
      resolveDeployIntent,
      buildRuntimeManifestEnv,
      readJsonIfExists,
      samePlainObject,
      buildSubstitutionArg,
      DEPLOY_CONFIRM_PHRASE,
    },
  };
}
