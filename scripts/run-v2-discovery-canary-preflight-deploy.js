#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const entryStreak = require("./check-v2-production-entry-route-canary-streak");
const exitStreak = require("./check-v2-exit-runtime-canary-streak");
const repairStreak = require("./check-v2-repair-queue-firestore-canary-streak");

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
  return trimOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOL) || "BTCUSDT";
}

function resolveTag(env = process.env) {
  return trimOrNull(env.TAG)
    || trimOrNull(env._TAG)
    || `v2-${execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: process.cwd(), encoding: "utf8" }).trim()}`;
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

function buildDiscoverySubstitutions(env = process.env) {
  return Object.freeze({
    _TAG: resolveTag(env),
    _DONBEOLJA_V2_ENABLED: "1",
    _DONBEOLJA_V2_DRY_RUN: "0",
    _DONBEOLJA_V2_CANARY_ONLY: "1",
    _DONBEOLJA_V2_PRODUCTION_ENTRY_LIVE_ENDPOINT_ENABLED: "1",
    _DONBEOLJA_V2_DISCOVERY_CANARY_ENABLED: "1",
    _DONBEOLJA_V2_DISCOVERY_CANARY_SYMBOLS: resolveSymbol(env),
    _DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE: trimOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_NOTIONAL_QUOTE) || "25",
    _DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT: trimOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_POSITION_COUNT) || "1",
    _DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY: trimOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_MAX_TRADES_PER_DAY) || "1",
    _DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE: trimOrNull(env.DONBEOLJA_V2_DISCOVERY_CANARY_DAILY_LOSS_HALT_QUOTE) || "10",
    _DONBEOLJA_V2_OPENCLAW_EXECUTION_AUDIT_LEDGER_WRITE_ENABLED: "1",
    _DONBEOLJA_V2_RISK_GOVERNOR_REQUIRED: "1",
    _DONBEOLJA_V2_BLOCK_LEGACY_WEBHOOK_SIGNAL: "1",
    _DONBEOLJA_V2_ALLOW_LEGACY_WEBHOOK_SIGNAL: "0",
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

function samePlainObject(left, right) {
  return JSON.stringify(left || null) === JSON.stringify(right || null);
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
  const blockers = [];
  for (const report of [entry, exit, repair]) {
    if (Array.isArray(report && report.blockers) && report.blockers.length > 0) {
      blockers.push(...report.blockers);
    } else if (report && report.ok !== true && report.reason) {
      blockers.push(report.reason);
    }
  }
  return Object.freeze({
    ok: entry.ok === true && exit.ok === true && repair.ok === true,
    entry,
    exit,
    repair,
    blockers: Object.freeze(blockers),
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
      state_file: stateFile,
    });
    writeJson(stateFile, payload);
    console.log(JSON.stringify(payload));
    return payload;
  }

  if (skipDeploy) {
    const payload = Object.freeze({
      ok: true,
      reason: "V2_DISCOVERY_CANARY_PREFLIGHT_PASS_DEPLOY_SKIPPED",
      command_preview: commandPreview,
      substitutions,
      state_file: stateFile,
    });
    writeJson(stateFile, payload);
    console.log(JSON.stringify(payload));
    return payload;
  }

  execFileSync("gcloud", args, { cwd: process.cwd(), stdio: "inherit" });
  const payload = Object.freeze({
    ok: true,
    reason: "V2_DISCOVERY_CANARY_DEPLOY_TRIGGERED",
    command_preview: commandPreview,
    substitutions,
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
    __test: {
      trimOrNull,
      parseBool,
      resolveSymbol,
      resolveTag,
      resolveStateFile,
      readJsonIfExists,
      samePlainObject,
      buildSubstitutionArg,
    },
  };
}
