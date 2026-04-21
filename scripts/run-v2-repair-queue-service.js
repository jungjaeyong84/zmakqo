#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const repairQueueLiveService = require("../src/v2/repairQueueLiveService");
const { buildDelegatedRepairExecutor } = require("../src/v2/repairDelegatedExecutor");
const {
  buildBinanceRefreshNativeStopTransport,
  buildBinancePlaceOrReplaceTp1Transport,
  buildBinancePlaceOrReplaceFullProtectionTransport,
} = require("../src/v2/binanceProtectionTransport");
const { buildBinanceRepairTransportContextResolver } = require("../src/v2/binanceRepairContextResolver");
const { resolveBinanceRepairLiveCfg: resolveV2BinanceRepairLiveCfg } = require("../src/v2/binanceRepairLiveCfgResolver");
const repairCanaryPreflight = require("./check-v2-repair-queue-canary-preflight");

const OUTPUT_FILENAME = "v2-repair-queue-service.json";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function resolveArtifactDir(env = process.env) {
  return trimOrNull(env.DONBEOLJA_V2_REPAIR_SERVICE_ARTIFACT_DIR)
    || path.join(process.cwd(), "artifacts", "v2-repair-service");
}

function resolveOutputFilename(env = process.env) {
  return trimOrNull(env.DONBEOLJA_V2_REPAIR_SERVICE_ARTIFACT_FILE) || OUTPUT_FILENAME;
}

function isEnabledFlag(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function resolveCanaryPreflightRequired(env = process.env) {
  if (String(env && env.DONBEOLJA_V2_REPAIR_CANARY_PREFLIGHT_REQUIRED || "").trim() === "0") {
    return false;
  }
  if (isEnabledFlag(env && env.DONBEOLJA_V2_REPAIR_CANARY_PREFLIGHT_REQUIRED)) {
    return true;
  }
  return (
    isEnabledFlag(env && env.DONBEOLJA_V2_REPAIR_EXECUTOR_BINDING_ENABLED) &&
    isEnabledFlag(env && env.DONBEOLJA_V2_REPAIR_BINANCE_TRANSPORT_ENABLED)
  );
}

function resolveCanaryPreflightEnv(env = process.env) {
  const base = env && typeof env === "object" ? env : {};
  if (
    isEnabledFlag(base.DONBEOLJA_V2_REPAIR_EXECUTOR_BINDING_ENABLED) &&
    isEnabledFlag(base.DONBEOLJA_V2_REPAIR_BINANCE_TRANSPORT_ENABLED)
  ) {
    return {
      ...base,
      DONBEOLJA_V2_REPAIR_LIVE_ENABLE_REQUESTED: "1",
      DONBEOLJA_V2_REPAIR_OPERATIONAL_CANARY_REQUIRED: "1",
    };
  }
  return base;
}

function buildCanaryPreflightBlockedResult({ config, preflightReport = null, error = null } = {}) {
  const row = config && typeof config === "object" ? config : {};
  const blockers = Array.isArray(preflightReport && preflightReport.blockers)
    ? preflightReport.blockers
    : ["REPAIR_CANARY_PREFLIGHT:UNKNOWN"];
  return Object.freeze({
    ok: false,
    reason: "V2_REPAIR_QUEUE_CANARY_PREFLIGHT_BLOCKED",
    service_name: trimOrNull(row.service_name) || "V2_REPAIR_EXECUTOR",
    status: "BLOCKED",
    fail_closed_triggered: true,
    canary_preflight: preflightReport,
    error: error ? Object.freeze({
      message: error && error.message ? error.message : String(error),
    }) : null,
    summary: Object.freeze({
      service_name: trimOrNull(row.service_name) || "V2_REPAIR_EXECUTOR",
      status: "BLOCKED",
      requested_repair_n: 0,
      delegated_repair_n: 0,
      skipped_repair_n: 0,
      completion_attempt_n: 0,
      completion_success_n: 0,
      completion_failed_n: 0,
      missing_context_n: 0,
      missing_position_cycle_ids: Object.freeze([]),
      missing_projection_cycle_ids: Object.freeze([]),
      missing_protection_runtime_cycle_ids: Object.freeze([]),
      blocker_reason_n: 1,
      blocker_reasons: Object.freeze(["CANARY_PREFLIGHT_BLOCKED"]),
      canary_preflight_blockers: Object.freeze(blockers.slice()),
    }),
  });
}

function buildExecutorNotImplementedResult({ config } = {}) {
  const row = config && typeof config === "object" ? config : {};
  return Object.freeze({
    ok: false,
    reason: "V2_REPAIR_QUEUE_EXECUTOR_NOT_IMPLEMENTED",
    service_name: trimOrNull(row.service_name) || "V2_REPAIR_EXECUTOR",
    status: "BLOCKED",
    fail_closed_triggered: true,
    summary: Object.freeze({
      service_name: trimOrNull(row.service_name) || "V2_REPAIR_EXECUTOR",
      status: "BLOCKED",
      requested_repair_n: 0,
      delegated_repair_n: 0,
      skipped_repair_n: 0,
      completion_attempt_n: 0,
      completion_success_n: 0,
      completion_failed_n: 0,
      missing_context_n: 0,
      missing_position_cycle_ids: Object.freeze([]),
      missing_projection_cycle_ids: Object.freeze([]),
      missing_protection_runtime_cycle_ids: Object.freeze([]),
      blocker_reason_n: 1,
      blocker_reasons: Object.freeze(["EXECUTOR_NOT_IMPLEMENTED"]),
    }),
  });
}

function toScriptResult(serviceResult) {
  const row = serviceResult && typeof serviceResult === "object" ? serviceResult : {};
  const status = trimOrNull(row.status) || "UNKNOWN";
  if (status === "DISABLED") {
    return Object.freeze({
      ok: true,
      reason: "V2_REPAIR_QUEUE_SERVICE_DISABLED",
      ...row,
    });
  }
  if (status === "HEALTHY") {
    return Object.freeze({
      ok: true,
      reason: "V2_REPAIR_QUEUE_SERVICE_HEALTHY",
      ...row,
    });
  }
  if (status === "DEGRADED" && row.fail_closed_triggered === true) {
    return Object.freeze({
      ok: false,
      reason: "V2_REPAIR_QUEUE_SERVICE_FAIL_CLOSED",
      ...row,
    });
  }
  if (status === "DEGRADED") {
    return Object.freeze({
      ok: true,
      reason: "V2_REPAIR_QUEUE_SERVICE_ATTENTION",
      ...row,
    });
  }
  return Object.freeze({
    ok: row.ok === true,
    reason: "V2_REPAIR_QUEUE_SERVICE_UNKNOWN_STATUS",
    ...row,
  });
}

function buildMissingTransportExecutor({ env, db, recordedAt } = {}) {
  return buildDelegatedRepairExecutor({
    env,
    db,
    recordedAt,
    transports: {},
  });
}

function resolveBinanceRefreshNativeProtectionFn() {
  try {
    const paperRunner = require("../src/engine/paperBinanceRunner");
    return typeof paperRunner.refreshBinanceNativeProtectionWithRetry === "function"
      ? paperRunner.refreshBinanceNativeProtectionWithRetry
      : null;
  } catch (_) {
    return null;
  }
}

function buildBinanceTransportExecutor({ env, db, recordedAt } = {}) {
  const refreshNativeProtectionWithRetry = resolveBinanceRefreshNativeProtectionFn();
  if (typeof refreshNativeProtectionWithRetry !== "function") {
    return null;
  }
  const resolveContext = buildBinanceRepairTransportContextResolver({
    resolveLiveCfg: resolveBinanceRepairLiveCfg,
  });
  const refreshNativeStop = buildBinanceRefreshNativeStopTransport({
    refreshNativeProtectionWithRetry,
    resolveContext,
  });
  const placeOrReplaceTp1 = buildBinancePlaceOrReplaceTp1Transport({
    resolveContext,
  });
  const placeOrReplaceFullProtection = buildBinancePlaceOrReplaceFullProtectionTransport({
    resolveContext,
  });
  return buildDelegatedRepairExecutor({
    env,
    db,
    recordedAt,
    transports: {
      refreshNativeStop,
      placeOrReplaceTp1,
      placeOrReplaceFullProtection,
    },
  });
}

function resolveBinanceRepairLiveCfg(args = {}) {
  return resolveV2BinanceRepairLiveCfg(args);
}

function resolveDelegatedRepairExecutor({ env, db, recordedAt } = {}) {
  if (String(env && env.DONBEOLJA_V2_REPAIR_EXECUTOR_BINDING_ENABLED || "0").trim() === "1") {
    if (String(env && env.DONBEOLJA_V2_REPAIR_BINANCE_TRANSPORT_ENABLED || "0").trim() === "1") {
      return buildBinanceTransportExecutor({ env, db, recordedAt });
    }
    return buildMissingTransportExecutor({ env, db, recordedAt });
  }
  return null;
}

async function run(env = process.env, {
  db = null,
  recordedAt = null,
  runRepairQueueLiveServiceFn = repairQueueLiveService.runRepairQueueLiveService,
  resolveDelegatedRepairExecutorFn = resolveDelegatedRepairExecutor,
  runCanaryPreflightFn = repairCanaryPreflight.runPreflight,
} = {}) {
  const config = repairQueueLiveService.resolveRepairQueueLiveServiceConfig(env);
  const artifactDir = resolveArtifactDir(env);
  const outputFilename = resolveOutputFilename(env);
  ensureDir(artifactDir);

  let result;
  if (config.enabled === true) {
    if (resolveCanaryPreflightRequired(env)) {
      let preflightReport;
      try {
        preflightReport = runCanaryPreflightFn(resolveCanaryPreflightEnv(env));
      } catch (error) {
        result = buildCanaryPreflightBlockedResult({
          config,
          error,
        });
      }
      if (!result && (!preflightReport || preflightReport.ok !== true)) {
        result = buildCanaryPreflightBlockedResult({
          config,
          preflightReport,
        });
      }
    }
  }

  if (!result && config.enabled === true) {
    const executeDelegatedRepair = resolveDelegatedRepairExecutorFn({
      env,
      db,
      recordedAt,
      config,
    });
    if (typeof executeDelegatedRepair !== "function") {
      result = buildExecutorNotImplementedResult({ config });
    } else {
      const serviceResult = await runRepairQueueLiveServiceFn({
        db,
        env,
        executeDelegatedRepair,
        recordedAt,
      });
      result = toScriptResult(serviceResult);
    }
  } else if (!result) {
    const serviceResult = await runRepairQueueLiveServiceFn({
      db,
      env,
      executeDelegatedRepair: async () => ({ writeDecision: { ok: true } }),
      recordedAt,
    });
    result = toScriptResult(serviceResult);
  }

  const output = Object.freeze({
    generated_at: trimOrNull(recordedAt) || new Date().toISOString(),
    artifact_dir: artifactDir,
    output_filename: outputFilename,
    config,
    ...result,
  });
  writeJson(path.join(artifactDir, outputFilename), output);
  return output;
}

async function main(env = process.env) {
  let output;
  try {
    output = await run(env);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_REPAIR_QUEUE_SERVICE_THROWN",
      error: {
        message: error && error.message ? error.message : String(error),
      },
    }));
    process.exit(1);
  }
  const sink = output.ok === true ? console.log : console.error;
  sink(JSON.stringify(output));
  if (output.ok !== true) process.exit(1);
}

if (require.main === module) {
  main().catch((error) => {
    console.error("RUN_V2_REPAIR_QUEUE_SERVICE_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    run,
    __test: {
      OUTPUT_FILENAME,
      trimOrNull,
      resolveArtifactDir,
      resolveOutputFilename,
      buildExecutorNotImplementedResult,
      toScriptResult,
      resolveDelegatedRepairExecutor,
      buildMissingTransportExecutor,
      buildBinanceTransportExecutor,
      resolveBinanceRefreshNativeProtectionFn,
      resolveBinanceRepairLiveCfg,
      resolveCanaryPreflightRequired,
      resolveCanaryPreflightEnv,
      buildCanaryPreflightBlockedResult,
    },
  };
}
