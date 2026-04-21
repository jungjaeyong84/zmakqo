#!/usr/bin/env node
"use strict";

const runtimeInputSelector = require("./select-v2-promotion-runtime-inputs");
const runtimeSnapshotCollector = require("./collect-v2-promotion-runtime-snapshot");
const runtimeSnapshotExporter = require("./export-v2-promotion-runtime-snapshot");
const replayArtifact = require("./generate-v2-replay-artifact");
const comparisonArtifacts = require("./generate-v2-comparison-artifacts");
const unifiedPromotionReport = require("./generate-v2-unified-promotion-report");
const deployDecision = require("./check-v2-promotion-deploy-decision");
const gate = require("./check-v2-promotion-gate");

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
  const gateResult = gate.__test.evaluateGateFromEnv(effectiveEnv);
  const unifiedReport = await unifiedPromotionReport.main(effectiveEnv);
  const deployDecisionResult = deployDecision.writeDeployDecisionArtifact(effectiveEnv);
  return Object.freeze({
    ...gateResult,
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
    },
  };
}
