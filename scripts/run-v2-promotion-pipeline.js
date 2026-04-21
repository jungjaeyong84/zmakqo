#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const runtimeInputSelector = require("./select-v2-promotion-runtime-inputs");
const runtimeSnapshotCollector = require("./collect-v2-promotion-runtime-snapshot");
const runtimeSnapshotExporter = require("./export-v2-promotion-runtime-snapshot");
const replayArtifact = require("./generate-v2-replay-artifact");
const comparisonArtifacts = require("./generate-v2-comparison-artifacts");
const unifiedPromotionReport = require("./generate-v2-unified-promotion-report");
const deployDecision = require("./check-v2-promotion-deploy-decision");
const gate = require("./check-v2-promotion-gate");
const productionEntryRouteCanaryStreak = require("./check-v2-production-entry-route-canary-streak");

const PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_FILENAME = "v2_production_entry_route_canary_streak_latest.json";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function validatePipelineEnv(env = process.env) {
  if (String(env.V2_PROMOTION_MOCK_ARTIFACTS_ENABLED || "0") === "1") {
    throw new Error("V2_PROMOTION_PIPELINE_MOCK_MIX_FORBIDDEN");
  }
  if (trimOrNull(env.V2_PROMOTION_MOCK_PROFILE)) {
    throw new Error("V2_PROMOTION_PIPELINE_MOCK_PROFILE_FORBIDDEN");
  }
  return true;
}

function hasRuntimeSnapshotInput(env = process.env) {
  return runtimeSnapshotExporter.__test.resolveRuntimeSnapshotInput(env) != null;
}

function hasRuntimeCollectorInput(env = process.env) {
  return trimOrNull(env.V2_PROMOTION_COLLECT_POSITION_CYCLE_ID) != null;
}

function hasRuntimeSelectorInput(env = process.env) {
  return trimOrNull(env.V2_PROMOTION_SELECT_POSITION_CYCLE_ID) != null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function resolveArtifactDir(env = process.env) {
  return trimOrNull(env.V2_PROMOTION_ARTIFACT_DIR) || process.cwd();
}

function shouldRefreshProductionEntryRouteCanaryStreak(env = process.env) {
  return ["CANARY", "LIVE"].includes(upper(env.V2_PROMOTION_MODE) || "CANARY");
}

function writeJson(filePath, payload) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function buildProductionEntryRouteCanaryStreakThrownReport(env = process.env, error = null) {
  return Object.freeze({
    ok: false,
    reason: "V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_THROWN",
    history_source: productionEntryRouteCanaryStreak.__test.resolveHistorySource(env),
    history_file: productionEntryRouteCanaryStreak.__test.resolveHistorySource(env) === "FIRESTORE"
      ? null
      : productionEntryRouteCanaryStreak.__test.resolveHistoryFile(env),
    blockers: Object.freeze(["PRODUCTION_ENTRY_ROUTE_CANARY_STREAK:HISTORY_READ_FAILED"]),
    error: Object.freeze({
      message: error && error.message ? error.message : String(error || "unknown production route canary streak error"),
    }),
  });
}

async function refreshProductionEntryRouteCanaryStreak(env = process.env, { db = null } = {}) {
  if (!shouldRefreshProductionEntryRouteCanaryStreak(env)) {
    return Object.freeze({
      required: false,
      skipped: true,
      reason: "PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REFRESH_SKIPPED",
      report: null,
      output_file: null,
    });
  }
  const artifactDir = resolveArtifactDir(env);
  const outputFile = trimOrNull(env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_FILE)
    || path.join(artifactDir, PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_FILENAME);
  const streakEnv = Object.freeze({
    ...env,
    V2_PROMOTION_ARTIFACT_DIR: artifactDir,
    DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_ARTIFACT_DIR: artifactDir,
    DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_FILE: outputFile,
  });
  let report = null;
  try {
    report = await productionEntryRouteCanaryStreak.runCheck(streakEnv, { db });
  } catch (error) {
    report = buildProductionEntryRouteCanaryStreakThrownReport(streakEnv, error);
  }
  writeJson(outputFile, report);
  return Object.freeze({
    required: true,
    skipped: false,
    reason: report && report.ok === true
      ? "PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REFRESH_PASS"
      : "PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REFRESH_BLOCKED",
    report,
    output_file: outputFile,
  });
}

async function runPipeline(env = process.env, {
  selectorDb = null,
  collectorDb = null,
} = {}) {
  validatePipelineEnv(env);
  let effectiveEnv = { ...env };

  if (!hasRuntimeCollectorInput(effectiveEnv) && hasRuntimeSelectorInput(effectiveEnv)) {
    const selected = await runtimeInputSelector.main(effectiveEnv, selectorDb || collectorDb);
    effectiveEnv = {
      ...effectiveEnv,
      ...selected.collectorEnv,
    };
  }

  if (hasRuntimeCollectorInput(effectiveEnv)) {
    await runtimeSnapshotCollector.main(effectiveEnv, collectorDb || selectorDb);
  }
  if (hasRuntimeSnapshotInput(effectiveEnv)) {
    await runtimeSnapshotExporter.main(effectiveEnv);
  }
  await replayArtifact.main(effectiveEnv);
  await comparisonArtifacts.main(effectiveEnv);
  const productionEntryRouteCanaryStreakRefresh = await refreshProductionEntryRouteCanaryStreak(effectiveEnv, {
    db: collectorDb || selectorDb,
  });
  const gateResult = gate.__test.evaluateGateFromEnv(effectiveEnv);
  const unifiedReport = await unifiedPromotionReport.main(effectiveEnv);
  const deployDecisionResult = deployDecision.writeDeployDecisionArtifact(effectiveEnv);
  return Object.freeze({
    ...gateResult,
    productionEntryRouteCanaryStreak: productionEntryRouteCanaryStreakRefresh.report,
    productionEntryRouteCanaryStreakFile: productionEntryRouteCanaryStreakRefresh.output_file,
    productionEntryRouteCanaryStreakStatus: productionEntryRouteCanaryStreakRefresh.reason,
    unifiedReport,
    deployDecision: deployDecisionResult.decision,
  });
}

async function main(env = process.env) {
  let result = null;
  try {
    result = await runPipeline(env);
  } catch (error) {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_PROMOTION_PIPELINE_THROWN",
      error: {
        message: error && error.message ? error.message : String(error),
      },
    }));
    process.exit(1);
  }

  const { report } = result;
  if (report.pass !== true) {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_PROMOTION_PIPELINE_BLOCKED",
      mode: report.mode,
      blockers: Array.isArray(report.blockers) ? report.blockers : [],
      warnings: Array.isArray(report.warnings) ? report.warnings : [],
      report,
    }));
    process.exit(1);
  }

  console.log(JSON.stringify({
    ok: true,
    reason: "V2_PROMOTION_PIPELINE_PASS",
    mode: report.mode,
    warnings: Array.isArray(report.warnings) ? report.warnings : [],
    report,
  }));
}

if (require.main === module) {
  main().catch((error) => {
    console.error("RUN_V2_PROMOTION_PIPELINE_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    runPipeline,
    __test: {
      trimOrNull,
      validatePipelineEnv,
      hasRuntimeSelectorInput,
      hasRuntimeCollectorInput,
      hasRuntimeSnapshotInput,
      resolveArtifactDir,
      shouldRefreshProductionEntryRouteCanaryStreak,
      buildProductionEntryRouteCanaryStreakThrownReport,
      refreshProductionEntryRouteCanaryStreak,
    },
  };
}
