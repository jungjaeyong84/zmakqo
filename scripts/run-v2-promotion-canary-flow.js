#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const preflight = require("./check-v2-promotion-canary-preflight");
const pipeline = require("./run-v2-promotion-pipeline");
const candidateSelector = require("./select-v2-promotion-canary-candidate");

const OUTPUT_FILENAME = "promotion-canary-flow.json";
const PREFLIGHT_OUTPUT_FILENAME = preflight.__test && preflight.__test.OUTPUT_FILENAME
  ? preflight.__test.OUTPUT_FILENAME
  : "promotion-preflight.json";
const CANDIDATE_OUTPUT_FILENAME = candidateSelector.__test && candidateSelector.__test.OUTPUT_FILENAME
  ? candidateSelector.__test.OUTPUT_FILENAME
  : "promotion-canary-candidate-selection.json";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function isEnabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function ensureDir(dirPath) {
  fs.mkdirSync(dirPath, { recursive: true });
}

function writeJson(filePath, payload) {
  fs.writeFileSync(filePath, JSON.stringify(payload, null, 2), "utf8");
}

function resolveArtifactDir(env = process.env) {
  return trimOrNull(env.V2_PROMOTION_ARTIFACT_DIR) || path.resolve("tmp", "v2-promotion-artifacts");
}

function buildArtifactContext({ requestedArtifactDir, positionCycleId }) {
  const requested = path.resolve(trimOrNull(requestedArtifactDir) || path.resolve("tmp", "v2-promotion-artifacts"));
  const cycleId = trimOrNull(positionCycleId);
  if (!cycleId) {
    return Object.freeze({
      requested_artifact_dir: requested,
      artifact_dir: requested,
      artifact_dir_bounded_by_cycle: false,
      artifact_dir_strategy: "UNRESOLVED",
    });
  }
  if (requested.includes(cycleId)) {
    return Object.freeze({
      requested_artifact_dir: requested,
      artifact_dir: requested,
      artifact_dir_bounded_by_cycle: true,
      artifact_dir_strategy: "REQUESTED_ALREADY_BOUNDED",
    });
  }
  return Object.freeze({
    requested_artifact_dir: requested,
    artifact_dir: path.join(requested, cycleId),
    artifact_dir_bounded_by_cycle: true,
    artifact_dir_strategy: "NESTED_BY_SELECTED_POSITION_CYCLE",
  });
}

function resolveFlowConfig(env = process.env) {
  const mode = upper(env.V2_PROMOTION_MODE) || "CANARY";
  if (!["CANARY", "LIVE"].includes(mode)) throw new Error("V2_PROMOTION_CANARY_FLOW_MODE_INVALID");
  const autoSelectEnabled = isEnabled(env.V2_PROMOTION_CANARY_AUTO_SELECT_ENABLED);
  const positionCycleId = trimOrNull(env.V2_PROMOTION_SELECT_POSITION_CYCLE_ID);
  if (!positionCycleId && !autoSelectEnabled) throw new Error("V2_PROMOTION_CANARY_FLOW_POSITION_CYCLE_ID_REQUIRED");
  return Object.freeze({
    mode,
    positionCycleId,
    autoSelectEnabled,
  });
}

function flattenCandidateBlockers(candidateSelection) {
  const rows = Array.isArray(candidateSelection && candidateSelection.evaluated_candidates)
    ? candidateSelection.evaluated_candidates
    : [];
  const blockers = [];
  for (const row of rows) {
    if (row && row.error) blockers.push(`CANDIDATE_EVALUATION:${row.error}`);
    const preflightBlockers = Array.isArray(row && row.preflight && row.preflight.blockers)
      ? row.preflight.blockers
      : [];
    blockers.push(...preflightBlockers);
  }
  if (blockers.length) return Object.freeze(blockers);
  return Object.freeze([`CANDIDATE_SELECTION:${trimOrNull(candidateSelection && candidateSelection.selection_status) || "BLOCKED"}`]);
}

async function resolveFlowContext(env = process.env, { selectorDb = null, collectorDb = null, requestedArtifactDir = null } = {}) {
  const cfg = resolveFlowConfig(env);
  const baseArtifactDir = trimOrNull(requestedArtifactDir) || resolveArtifactDir(env);
  if (cfg.positionCycleId) {
    const artifactContext = buildArtifactContext({
      requestedArtifactDir: baseArtifactDir,
      positionCycleId: cfg.positionCycleId,
    });
    return Object.freeze({
      cfg,
      effectiveEnv: Object.freeze({
        ...env,
        V2_PROMOTION_ARTIFACT_DIR: artifactContext.artifact_dir,
      }),
      candidateSelection: null,
      artifactContext,
    });
  }

  const candidateSelection = await candidateSelector.selectCanaryCandidate({
    db: selectorDb || collectorDb,
    env,
  });
  if (candidateSelection.ok !== true) {
    return Object.freeze({
      cfg,
      effectiveEnv: null,
      candidateSelection,
      artifactContext: buildArtifactContext({
        requestedArtifactDir: baseArtifactDir,
        positionCycleId: null,
      }),
    });
  }

  const artifactContext = buildArtifactContext({
    requestedArtifactDir: baseArtifactDir,
    positionCycleId: candidateSelection.selected_position_cycle_id,
  });

  return Object.freeze({
    cfg: Object.freeze({
      ...cfg,
      positionCycleId: candidateSelection.selected_position_cycle_id,
    }),
    effectiveEnv: Object.freeze({
      ...env,
      V2_PROMOTION_ARTIFACT_DIR: artifactContext.artifact_dir,
      ...(candidateSelection.collector_env || {}),
    }),
    candidateSelection,
    artifactContext,
  });
}

function summarizePipelineResult(result) {
  const report = result && result.report && typeof result.report === "object" ? result.report : null;
  if (!report) throw new Error("V2_PROMOTION_CANARY_FLOW_PIPELINE_REPORT_REQUIRED");
  return Object.freeze({
    pass: report.pass === true,
    mode: report.mode || null,
    blockers: Array.isArray(report.blockers) ? report.blockers : [],
    warnings: Array.isArray(report.warnings) ? report.warnings : [],
  });
}

async function runCanaryFlow(
  env = process.env,
  { selectorDb = null, collectorDb = null, preflightReport = null, flowContext = null } = {}
) {
  const context = flowContext || await resolveFlowContext(env, { selectorDb, collectorDb });
  const cfg = context.cfg;
  const effectiveEnv = context.effectiveEnv;
  const candidateSelection = context.candidateSelection;
  if (!effectiveEnv) {
    return Object.freeze({
      ok: false,
      mode: cfg.mode,
      position_cycle_id: null,
      requested_artifact_dir: context.artifactContext.requested_artifact_dir,
      artifact_dir: context.artifactContext.artifact_dir,
      artifact_dir_bounded_by_cycle: context.artifactContext.artifact_dir_bounded_by_cycle,
      artifact_dir_strategy: context.artifactContext.artifact_dir_strategy,
      stage: "CANDIDATE_BLOCKED",
      candidate_selection: candidateSelection,
      preflight: null,
      pipeline: null,
      blockers: flattenCandidateBlockers(candidateSelection),
    });
  }

  const effectivePreflightReport = preflightReport || await preflight.runPreflight(effectiveEnv, { db: selectorDb || collectorDb });
  if (effectivePreflightReport.ok !== true) {
    return Object.freeze({
      ok: false,
      mode: cfg.mode,
      position_cycle_id: cfg.positionCycleId,
      requested_artifact_dir: context.artifactContext.requested_artifact_dir,
      artifact_dir: context.artifactContext.artifact_dir,
      artifact_dir_bounded_by_cycle: context.artifactContext.artifact_dir_bounded_by_cycle,
      artifact_dir_strategy: context.artifactContext.artifact_dir_strategy,
      stage: "PREFLIGHT_BLOCKED",
      candidate_selection: candidateSelection,
      preflight: effectivePreflightReport,
      pipeline: null,
      blockers: Array.isArray(effectivePreflightReport.blockers) ? effectivePreflightReport.blockers : [],
    });
  }

  const pipelineEnv = {
    ...effectiveEnv,
    ...(effectivePreflightReport.collector_env || {}),
  };
  const pipelineResult = await pipeline.runPipeline(pipelineEnv, { selectorDb, collectorDb });
  const pipelineSummary = summarizePipelineResult(pipelineResult);
  const blockers = pipelineSummary.pass ? [] : pipelineSummary.blockers;
  return Object.freeze({
    ok: pipelineSummary.pass,
    mode: cfg.mode,
    position_cycle_id: cfg.positionCycleId,
    requested_artifact_dir: context.artifactContext.requested_artifact_dir,
    artifact_dir: context.artifactContext.artifact_dir,
    artifact_dir_bounded_by_cycle: context.artifactContext.artifact_dir_bounded_by_cycle,
    artifact_dir_strategy: context.artifactContext.artifact_dir_strategy,
    stage: pipelineSummary.pass ? "PIPELINE_PASS" : "PIPELINE_BLOCKED",
    candidate_selection: candidateSelection,
    preflight: effectivePreflightReport,
    pipeline: pipelineSummary,
    blockers,
  });
}

async function main(env = process.env, db = null) {
  const requestedArtifactDir = resolveArtifactDir(env);
  ensureDir(requestedArtifactDir);
  const flowContext = await resolveFlowContext(env, {
    requestedArtifactDir,
    selectorDb: db,
    collectorDb: db,
  });
  const artifactDir = flowContext.artifactContext.artifact_dir;
  ensureDir(artifactDir);
  const cfg = flowContext.cfg;
  if (flowContext.candidateSelection) {
    writeJson(path.join(requestedArtifactDir, CANDIDATE_OUTPUT_FILENAME), flowContext.candidateSelection);
    if (artifactDir !== requestedArtifactDir) {
      writeJson(path.join(artifactDir, CANDIDATE_OUTPUT_FILENAME), flowContext.candidateSelection);
    }
  }
  const preflightReport = flowContext.effectiveEnv
    ? await preflight.runPreflight(flowContext.effectiveEnv, { db })
    : null;
  const preflightOutputFile = path.join(artifactDir, PREFLIGHT_OUTPUT_FILENAME);
  if (preflightReport) writeJson(preflightOutputFile, preflightReport);
  const report = await runCanaryFlow(env, {
    selectorDb: db,
    collectorDb: db,
    preflightReport,
    flowContext,
  });
  const outputFile = path.join(artifactDir, OUTPUT_FILENAME);
  writeJson(outputFile, report);
  if (artifactDir !== requestedArtifactDir) {
    writeJson(path.join(requestedArtifactDir, OUTPUT_FILENAME), report);
  }
  if (report.ok !== true) {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_PROMOTION_CANARY_FLOW_BLOCKED",
      artifact_dir: report.artifact_dir,
      output_file: outputFile,
      stage: report.stage,
      blockers: report.blockers,
      position_cycle_id: report.position_cycle_id,
    }));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    reason: "V2_PROMOTION_CANARY_FLOW_PASS",
    artifact_dir: report.artifact_dir,
    output_file: outputFile,
    stage: report.stage,
    position_cycle_id: report.position_cycle_id,
    warnings: report.pipeline ? report.pipeline.warnings : [],
  }));
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("RUN_V2_PROMOTION_CANARY_FLOW_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    runCanaryFlow,
    __test: {
      OUTPUT_FILENAME,
      PREFLIGHT_OUTPUT_FILENAME,
      trimOrNull,
      upper,
      isEnabled,
      resolveArtifactDir,
      buildArtifactContext,
      resolveFlowConfig,
      resolveFlowContext,
      flattenCandidateBlockers,
      summarizePipelineResult,
      CANDIDATE_OUTPUT_FILENAME,
    },
  };
}
