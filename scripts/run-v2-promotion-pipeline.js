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
const openclawDailyPerformanceReport = require("./generate-v2-openclaw-daily-performance-report");
const openclawOutcomeAdjudicationCollector = require("./collect-v2-openclaw-outcome-adjudications");
const performanceGate = require("./check-v2-performance-gate");
const firestoreCostGuard = require("./check-v2-firestore-cost-guard");
const repairFirestoreCanaryStreak = require("./check-v2-repair-queue-firestore-canary-streak");
const productionEntryRouteCanaryStreak = require("./check-v2-production-entry-route-canary-streak");
const exitRuntimeCanaryStreak = require("./check-v2-exit-runtime-canary-streak");
const productionEntryProtectedCanary = require("./run-v2-production-entry-protected-canary");

const REPAIR_FIRESTORE_CANARY_STREAK_FILENAME = "v2_repair_queue_firestore_canary_streak_latest.json";
const PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_FILENAME = "v2_production_entry_route_canary_streak_latest.json";
const EXIT_RUNTIME_CANARY_STREAK_FILENAME = "v2_exit_runtime_canary_streak_latest.json";
const PRODUCTION_ENTRY_PROTECTED_CANARY_FILENAME = "v2_production_entry_protected_canary_latest.json";
const OPENCLAW_DAILY_PERFORMANCE_REPORT_FILENAME = "v2_openclaw_daily_performance_report_latest.json";
const OPENCLAW_OUTCOME_ADJUDICATION_COLLECTOR_FILENAME = "v2_openclaw_outcome_adjudication_collector_latest.json";
const PERFORMANCE_GATE_FILENAME = "v2_performance_gate_latest.json";
const FIRESTORE_COST_GUARD_FILENAME = "v2_firestore_cost_guard_latest.json";
const REPAIR_FIRESTORE_CANARY_HISTORY_FILENAME = "v2_repair_queue_firestore_canary_history.jsonl";
const PRODUCTION_ENTRY_PROTECTED_CANARY_HISTORY_FILENAME = "v2_production_entry_protected_canary_history.jsonl";

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

function isLivePromotionMode(env = process.env) {
  return upper(env.V2_PROMOTION_MODE) === "LIVE";
}

function shouldRefreshOpenClawOutcomeAdjudications(env = process.env) {
  const explicit = trimOrNull(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_COLLECTOR_ENABLED);
  if (explicit === "0") return false;
  if (explicit !== "1") return false;
  if (String(env.V2_PROMOTION_REPLAY_FIXTURE_PROFILE || "").trim()) return false;
  if (String(env.V2_PROMOTION_COMPARISON_FIXTURE_PROFILE || "").trim()) return false;
  return ["CANARY", "LIVE"].includes(upper(env.V2_PROMOTION_MODE) || "CANARY");
}

function shouldRefreshExitRuntimeCanaryStreak(env = process.env) {
  return ["CANARY", "LIVE"].includes(upper(env.V2_PROMOTION_MODE) || "CANARY");
}

function shouldRefreshProductionEntryProtectedCanary(env = process.env) {
  return ["CANARY", "LIVE"].includes(upper(env.V2_PROMOTION_MODE) || "CANARY");
}

function shouldRefreshRepairFirestoreCanaryStreak(env = process.env) {
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

function buildExitRuntimeCanaryStreakThrownReport(env = process.env, error = null) {
  return Object.freeze({
    ok: false,
    reason: "V2_EXIT_RUNTIME_CANARY_STREAK_THROWN",
    history_source: exitRuntimeCanaryStreak.__test.resolveHistorySource(env),
    history_file: exitRuntimeCanaryStreak.__test.resolveHistorySource(env) === "FIRESTORE"
      ? null
      : exitRuntimeCanaryStreak.__test.resolveHistoryFile(env),
    blockers: Object.freeze(["EXIT_RUNTIME_CANARY_STREAK:HISTORY_READ_FAILED"]),
    error: Object.freeze({
      message: error && error.message ? error.message : String(error || "unknown exit runtime canary streak error"),
    }),
  });
}

function buildRepairFirestoreCanaryStreakThrownReport(env = process.env, error = null) {
  return Object.freeze({
    ok: false,
    reason: "V2_REPAIR_QUEUE_FIRESTORE_CANARY_STREAK_THROWN",
    history_file: repairFirestoreCanaryStreak.__test.resolveHistoryFile(env),
    blockers: Object.freeze(["FIRESTORE_CANARY_STREAK:HISTORY_READ_FAILED"]),
    error: Object.freeze({
      message: error && error.message ? error.message : String(error || "unknown repair firestore canary streak error"),
    }),
  });
}

function resolveRepairFirestoreCanaryHistoryFile(env = process.env) {
  return trimOrNull(env.DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_HISTORY_FILE)
    || path.resolve("ops", "daily", REPAIR_FIRESTORE_CANARY_HISTORY_FILENAME);
}

async function refreshRepairFirestoreCanaryStreak(env = process.env) {
  if (!shouldRefreshRepairFirestoreCanaryStreak(env)) {
    return Object.freeze({
      required: false,
      skipped: true,
      reason: "REPAIR_FIRESTORE_CANARY_STREAK_REFRESH_SKIPPED",
      report: null,
      output_file: null,
    });
  }
  const artifactDir = resolveArtifactDir(env);
  const outputFile = path.join(artifactDir, REPAIR_FIRESTORE_CANARY_STREAK_FILENAME);
  const streakEnv = Object.freeze({
    ...env,
    V2_PROMOTION_ARTIFACT_DIR: artifactDir,
    DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_ARTIFACT_DIR: artifactDir,
    DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_HISTORY_FILE: resolveRepairFirestoreCanaryHistoryFile(env),
    DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_FILE: outputFile,
  });
  let report = null;
  try {
    report = repairFirestoreCanaryStreak.runCheck(streakEnv);
  } catch (error) {
    report = buildRepairFirestoreCanaryStreakThrownReport(streakEnv, error);
  }
  writeJson(outputFile, report);
  return Object.freeze({
    required: true,
    skipped: false,
    reason: report && report.ok === true
      ? "REPAIR_FIRESTORE_CANARY_STREAK_REFRESH_PASS"
      : "REPAIR_FIRESTORE_CANARY_STREAK_REFRESH_BLOCKED",
    report,
    output_file: outputFile,
  });
}

async function refreshExitRuntimeCanaryStreak(env = process.env, { db = null } = {}) {
  if (!shouldRefreshExitRuntimeCanaryStreak(env)) {
    return Object.freeze({
      required: false,
      skipped: true,
      reason: "EXIT_RUNTIME_CANARY_STREAK_REFRESH_SKIPPED",
      report: null,
      output_file: null,
    });
  }
  const artifactDir = resolveArtifactDir(env);
  const outputFile = path.join(artifactDir, EXIT_RUNTIME_CANARY_STREAK_FILENAME);
  const streakEnv = Object.freeze({
    ...env,
    V2_PROMOTION_ARTIFACT_DIR: artifactDir,
    DONBEOLJA_V2_EXIT_RUNTIME_CANARY_ARTIFACT_DIR: artifactDir,
    DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_FILE: outputFile,
    DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE: isLivePromotionMode(env) ? "1" : trimOrNull(env.DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_REQUIRE_FIRESTORE),
  });
  let report = null;
  try {
    report = await exitRuntimeCanaryStreak.runCheck(streakEnv, { db });
  } catch (error) {
    report = buildExitRuntimeCanaryStreakThrownReport(streakEnv, error);
  }
  writeJson(outputFile, report);
  return Object.freeze({
    required: true,
    skipped: false,
    reason: report && report.ok === true
      ? "EXIT_RUNTIME_CANARY_STREAK_REFRESH_PASS"
      : "EXIT_RUNTIME_CANARY_STREAK_REFRESH_BLOCKED",
    report,
    output_file: outputFile,
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
  const outputFile = path.join(artifactDir, PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_FILENAME);
  const streakEnv = Object.freeze({
    ...env,
    V2_PROMOTION_ARTIFACT_DIR: artifactDir,
    DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_ARTIFACT_DIR: artifactDir,
    DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_FILE: outputFile,
    DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE: isLivePromotionMode(env) ? "1" : trimOrNull(env.DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_REQUIRE_FIRESTORE),
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

async function refreshProductionEntryProtectedCanary(env = process.env) {
  if (!shouldRefreshProductionEntryProtectedCanary(env)) {
    return Object.freeze({
      required: false,
      skipped: true,
      reason: "PRODUCTION_ENTRY_PROTECTED_CANARY_REFRESH_SKIPPED",
      report: null,
      output_file: null,
    });
  }
  const artifactDir = resolveArtifactDir(env);
  const outputFile = path.join(artifactDir, PRODUCTION_ENTRY_PROTECTED_CANARY_FILENAME);
  const historyFile = path.join(artifactDir, PRODUCTION_ENTRY_PROTECTED_CANARY_HISTORY_FILENAME);
  const canaryEnv = Object.freeze({
    ...env,
    V2_PROMOTION_ARTIFACT_DIR: artifactDir,
    DONBEOLJA_V2_PRODUCTION_ENTRY_PROTECTED_CANARY_ARTIFACT_DIR: artifactDir,
    DONBEOLJA_V2_PRODUCTION_ENTRY_PROTECTED_CANARY_FILE: outputFile,
    DONBEOLJA_V2_PRODUCTION_ENTRY_PROTECTED_CANARY_HISTORY_FILE: historyFile,
  });
  let report = null;
  try {
    report = await productionEntryProtectedCanary.main({
      env: canaryEnv,
      setProcessExitCode: false,
    });
  } catch (error) {
    report = Object.freeze({
      ok: false,
      reason: "V2_PRODUCTION_ENTRY_PROTECTED_CANARY_THROWN",
      scope: "production_entry_protected_canary",
      canary_mode: "PROTECTED_ENTRY_NO_EXCHANGE_PROOF",
      exchange_write_performed: false,
      error: Object.freeze({
        message: error && error.message ? error.message : String(error),
      }),
    });
    writeJson(outputFile, report);
  }
  return Object.freeze({
    required: true,
    skipped: false,
    reason: report && report.ok === true
      ? "PRODUCTION_ENTRY_PROTECTED_CANARY_REFRESH_PASS"
      : "PRODUCTION_ENTRY_PROTECTED_CANARY_REFRESH_BLOCKED",
    report,
    output_file: outputFile,
  });
}

async function refreshPerformanceGate(env = process.env) {
  const artifactDir = resolveArtifactDir(env);
  const performanceReportFile = path.join(artifactDir, OPENCLAW_DAILY_PERFORMANCE_REPORT_FILENAME);
  const performanceGateFile = path.join(artifactDir, PERFORMANCE_GATE_FILENAME);
  const reportEnv = Object.freeze({
    ...env,
    V2_PROMOTION_ARTIFACT_DIR: artifactDir,
    V2_OPENCLAW_DAILY_PERFORMANCE_REPORT_FILE: performanceReportFile,
  });
  let report = null;
  let gateReport = null;
  try {
    report = await openclawDailyPerformanceReport.main(reportEnv);
    gateReport = performanceGate.main(Object.freeze({
      ...reportEnv,
      V2_PERFORMANCE_GATE_INPUT_FILE: performanceReportFile,
      V2_PERFORMANCE_GATE_OUTPUT_FILE: performanceGateFile,
      // The deploy decision owns hard blocking. Always write the artifact.
      V2_PERFORMANCE_GATE_SOFT: "1",
    }));
  } catch (error) {
    gateReport = Object.freeze({
      ok: false,
      reason: "V2_PERFORMANCE_GATE_THROWN",
      output_file: performanceGateFile,
      blockers: Object.freeze(["PERFORMANCE_GATE:THROWN"]),
      error: Object.freeze({
        message: error && error.message ? error.message : String(error),
      }),
    });
    writeJson(performanceGateFile, gateReport);
  }
  return Object.freeze({
    required: true,
    skipped: false,
    reason: gateReport && gateReport.ok === true
      ? "PERFORMANCE_GATE_REFRESH_PASS"
      : "PERFORMANCE_GATE_REFRESH_BLOCKED",
    report,
    gate: gateReport,
    performance_report_file: performanceReportFile,
    output_file: performanceGateFile,
  });
}

function refreshFirestoreCostGuard(env = process.env) {
  const artifactDir = resolveArtifactDir(env);
  const outputFile = path.join(artifactDir, FIRESTORE_COST_GUARD_FILENAME);
  let report = null;
  try {
    report = firestoreCostGuard.main(Object.freeze({
      ...env,
      V2_PROMOTION_ARTIFACT_DIR: artifactDir,
      V2_FIRESTORE_COST_GUARD_OUTPUT_FILE: outputFile,
      V2_FIRESTORE_COST_GUARD_UNIFIED_REPORT_FILE: path.join(artifactDir, "unified-promotion-report.json"),
      // The deploy decision owns hard blocking. Always write the artifact.
      V2_FIRESTORE_COST_GUARD_SOFT: "1",
    }));
  } catch (error) {
    report = Object.freeze({
      ok: false,
      reason: "V2_FIRESTORE_COST_GUARD_THROWN",
      output_file: outputFile,
      blockers: Object.freeze(["FIRESTORE_COST_GUARD:THROWN"]),
      error: Object.freeze({
        message: error && error.message ? error.message : String(error),
      }),
    });
    writeJson(outputFile, report);
  }
  return Object.freeze({
    required: true,
    skipped: false,
    reason: report && report.ok === true
      ? "FIRESTORE_COST_GUARD_REFRESH_PASS"
      : "FIRESTORE_COST_GUARD_REFRESH_BLOCKED",
    report,
    output_file: outputFile,
  });
}

async function refreshOpenClawOutcomeAdjudications(env = process.env, { db = null } = {}) {
  const artifactDir = resolveArtifactDir(env);
  const outputFile = path.join(artifactDir, OPENCLAW_OUTCOME_ADJUDICATION_COLLECTOR_FILENAME);
  if (!shouldRefreshOpenClawOutcomeAdjudications(env)) {
    return Object.freeze({
      required: false,
      skipped: true,
      reason: "OPENCLAW_OUTCOME_ADJUDICATION_COLLECTOR_REFRESH_SKIPPED",
      report: null,
      output_file: outputFile,
    });
  }
  const collectorEnv = Object.freeze({
    ...env,
    V2_PROMOTION_ARTIFACT_DIR: artifactDir,
    V2_OPENCLAW_OUTCOME_ADJUDICATION_OUTPUT_FILE: outputFile,
    V2_OPENCLAW_OUTCOME_ADJUDICATION_SOURCE: trimOrNull(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_SOURCE) || "AUTO",
    V2_OPENCLAW_OUTCOME_ADJUDICATION_WRITE: trimOrNull(env.V2_OPENCLAW_OUTCOME_ADJUDICATION_WRITE) || "1",
  });
  let report = null;
  try {
    report = await openclawOutcomeAdjudicationCollector.main({
      env: collectorEnv,
      db,
      setProcessExitCode: false,
    });
  } catch (error) {
    report = Object.freeze({
      ok: false,
      reason: "V2_OPENCLAW_OUTCOME_ADJUDICATION_COLLECTOR_THROWN",
      output_file: outputFile,
      blockers: Object.freeze(["OPENCLAW_OUTCOME_ADJUDICATION_COLLECTOR:THROWN"]),
      error: Object.freeze({
        message: error && error.message ? error.message : String(error),
      }),
    });
    writeJson(outputFile, report);
  }
  return Object.freeze({
    required: true,
    skipped: false,
    reason: report && report.ok === true
      ? "OPENCLAW_OUTCOME_ADJUDICATION_COLLECTOR_REFRESH_PASS"
      : "OPENCLAW_OUTCOME_ADJUDICATION_COLLECTOR_REFRESH_BLOCKED",
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
  const repairFirestoreCanaryStreakRefresh = await refreshRepairFirestoreCanaryStreak(effectiveEnv);
  const productionEntryRouteCanaryStreakRefresh = await refreshProductionEntryRouteCanaryStreak(effectiveEnv, {
    db: collectorDb || selectorDb,
  });
  const exitRuntimeCanaryStreakRefresh = await refreshExitRuntimeCanaryStreak(effectiveEnv, {
    db: collectorDb || selectorDb,
  });
  const productionEntryProtectedCanaryRefresh = await refreshProductionEntryProtectedCanary(effectiveEnv);
  const openclawOutcomeAdjudicationRefresh = await refreshOpenClawOutcomeAdjudications(effectiveEnv, {
    db: collectorDb || selectorDb,
  });
  const performanceGateRefresh = await refreshPerformanceGate(effectiveEnv);
  const reportEnv = {
    ...effectiveEnv,
    ...(repairFirestoreCanaryStreakRefresh.output_file
      ? { DONBEOLJA_V2_REPAIR_FIRESTORE_CANARY_STREAK_FILE: repairFirestoreCanaryStreakRefresh.output_file }
      : {}),
    ...(productionEntryRouteCanaryStreakRefresh.output_file
      ? { DONBEOLJA_V2_PRODUCTION_ENTRY_ROUTE_CANARY_STREAK_FILE: productionEntryRouteCanaryStreakRefresh.output_file }
      : {}),
    ...(exitRuntimeCanaryStreakRefresh.output_file
      ? { DONBEOLJA_V2_EXIT_RUNTIME_CANARY_STREAK_FILE: exitRuntimeCanaryStreakRefresh.output_file }
      : {}),
    ...(productionEntryProtectedCanaryRefresh.output_file
      ? { DONBEOLJA_V2_PRODUCTION_ENTRY_PROTECTED_CANARY_FILE: productionEntryProtectedCanaryRefresh.output_file }
      : {}),
    ...(performanceGateRefresh.output_file
      ? { V2_PERFORMANCE_GATE_OUTPUT_FILE: performanceGateRefresh.output_file }
      : {}),
  };
  const gateResult = gate.__test.evaluateGateFromEnv(reportEnv);
  await unifiedPromotionReport.main(reportEnv);
  const firestoreCostGuardRefresh = refreshFirestoreCostGuard(reportEnv);
  const finalReportEnv = {
    ...reportEnv,
    ...(firestoreCostGuardRefresh.output_file
      ? { V2_FIRESTORE_COST_GUARD_OUTPUT_FILE: firestoreCostGuardRefresh.output_file }
      : {}),
  };
  const unifiedReport = await unifiedPromotionReport.main(finalReportEnv);
  const deployDecisionResult = deployDecision.writeDeployDecisionArtifact(finalReportEnv);
  return Object.freeze({
    ...gateResult,
    repairFirestoreCanaryStreak: repairFirestoreCanaryStreakRefresh.report,
    repairFirestoreCanaryStreakFile: repairFirestoreCanaryStreakRefresh.output_file,
    repairFirestoreCanaryStreakStatus: repairFirestoreCanaryStreakRefresh.reason,
    productionEntryRouteCanaryStreak: productionEntryRouteCanaryStreakRefresh.report,
    productionEntryRouteCanaryStreakFile: productionEntryRouteCanaryStreakRefresh.output_file,
    productionEntryRouteCanaryStreakStatus: productionEntryRouteCanaryStreakRefresh.reason,
    exitRuntimeCanaryStreak: exitRuntimeCanaryStreakRefresh.report,
    exitRuntimeCanaryStreakFile: exitRuntimeCanaryStreakRefresh.output_file,
    exitRuntimeCanaryStreakStatus: exitRuntimeCanaryStreakRefresh.reason,
    productionEntryProtectedCanary: productionEntryProtectedCanaryRefresh.report,
    productionEntryProtectedCanaryFile: productionEntryProtectedCanaryRefresh.output_file,
    productionEntryProtectedCanaryStatus: productionEntryProtectedCanaryRefresh.reason,
    openclawOutcomeAdjudicationCollector: openclawOutcomeAdjudicationRefresh.report,
    openclawOutcomeAdjudicationCollectorFile: openclawOutcomeAdjudicationRefresh.output_file,
    openclawOutcomeAdjudicationCollectorStatus: openclawOutcomeAdjudicationRefresh.reason,
    performanceGate: performanceGateRefresh.gate,
    performanceGateFile: performanceGateRefresh.output_file,
    performanceGateStatus: performanceGateRefresh.reason,
    firestoreCostGuard: firestoreCostGuardRefresh.report,
    firestoreCostGuardFile: firestoreCostGuardRefresh.output_file,
    firestoreCostGuardStatus: firestoreCostGuardRefresh.reason,
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
      shouldRefreshRepairFirestoreCanaryStreak,
      buildRepairFirestoreCanaryStreakThrownReport,
      resolveRepairFirestoreCanaryHistoryFile,
      refreshRepairFirestoreCanaryStreak,
      shouldRefreshProductionEntryRouteCanaryStreak,
      shouldRefreshExitRuntimeCanaryStreak,
      shouldRefreshProductionEntryProtectedCanary,
      shouldRefreshOpenClawOutcomeAdjudications,
      buildProductionEntryRouteCanaryStreakThrownReport,
      buildExitRuntimeCanaryStreakThrownReport,
      refreshProductionEntryRouteCanaryStreak,
      refreshExitRuntimeCanaryStreak,
      refreshProductionEntryProtectedCanary,
      refreshOpenClawOutcomeAdjudications,
      refreshPerformanceGate,
      refreshFirestoreCostGuard,
    },
  };
}
