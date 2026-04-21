#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const selector = require("./select-v2-promotion-runtime-inputs");
const collector = require("./collect-v2-promotion-runtime-snapshot");
const { buildLineageContract } = require("./lib/v2-promotion-lineage-contract");

const OUTPUT_FILENAME = "promotion-preflight.json";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
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

function resolvePreflightConfig(env = process.env) {
  const mode = upper(env.V2_PROMOTION_MODE) || "CANARY";
  const positionCycleId = trimOrNull(env.V2_PROMOTION_SELECT_POSITION_CYCLE_ID);
  if (!positionCycleId) throw new Error("V2_PROMOTION_PREFLIGHT_POSITION_CYCLE_ID_REQUIRED");
  return Object.freeze({
    mode,
    positionCycleId,
  });
}

function buildAlignmentBlockers(selectorMeta) {
  const blockers = [];
  const meta = selectorMeta && typeof selectorMeta === "object" ? selectorMeta : null;
  const checks = meta && meta.alignment_checks && typeof meta.alignment_checks === "object"
    ? meta.alignment_checks
    : null;
  if (!meta) return ["PREFLIGHT:SELECTOR_META_REQUIRED"];
  if (!checks) return ["PREFLIGHT:ALIGNMENT_CHECKS_REQUIRED"];
  if (checks.symbol_match !== true) blockers.push("PREFLIGHT:SYMBOL_MISMATCH");
  if (checks.side_match !== true) blockers.push("PREFLIGHT:SIDE_MISMATCH");
  if (checks.timeframe_match !== true) blockers.push("PREFLIGHT:TIMEFRAME_MISMATCH");
  if (checks.policy_scope_match !== true) blockers.push("PREFLIGHT:POLICY_SCOPE_MISMATCH");
  return blockers;
}

function evaluateSnapshot(snapshot) {
  const row = snapshot && typeof snapshot === "object" ? snapshot : null;
  if (!row) throw new Error("V2_PROMOTION_PREFLIGHT_SNAPSHOT_REQUIRED");
  const episodes = Array.isArray(row.episodes) ? row.episodes : [];
  const shadowLivePairs = Array.isArray(row.shadowLivePairs) ? row.shadowLivePairs : [];
  const sourceModePairs = Array.isArray(row.sourceModePairs) ? row.sourceModePairs : [];
  const blockers = [];
  if (episodes.length !== 1) blockers.push("PREFLIGHT:EPISODE_COUNT_INVALID");
  if (shadowLivePairs.length !== 1) blockers.push("PREFLIGHT:SHADOW_LIVE_PAIR_COUNT_INVALID");
  if (sourceModePairs.length !== 1) blockers.push("PREFLIGHT:SOURCE_MODE_PAIR_COUNT_INVALID");

  const episode = episodes[0] || null;
  const projection = episode && episode.projection ? episode.projection : null;
  const protectionRuntime = episode && episode.protectionRuntime ? episode.protectionRuntime : null;
  const watchdog = episode && episode.watchdog && typeof episode.watchdog === "object" ? episode.watchdog : null;
  if (!episode || !episode.positionCycle) blockers.push("PREFLIGHT:POSITION_CYCLE_MISSING");
  if (!projection) blockers.push("PREFLIGHT:PROJECTION_MISSING");
  if (!protectionRuntime) blockers.push("PREFLIGHT:PROTECTION_RUNTIME_MISSING");
  if (projection && trimOrNull(projection.position_cycle_id) !== trimOrNull(episode && episode.positionCycle && episode.positionCycle.position_cycle_id)) {
    blockers.push("PREFLIGHT:PROJECTION_POSITION_CYCLE_MISMATCH");
  }
  if (protectionRuntime && trimOrNull(protectionRuntime.position_cycle_id) !== trimOrNull(episode && episode.positionCycle && episode.positionCycle.position_cycle_id)) {
    blockers.push("PREFLIGHT:PROTECTION_RUNTIME_POSITION_CYCLE_MISMATCH");
  }

  const selectorMeta = row.snapshotMeta && row.snapshotMeta.selector_meta;
  blockers.push(...buildAlignmentBlockers(selectorMeta));
  const watchdogIssueCodes = Array.isArray(watchdog && watchdog.issueCodes)
    ? watchdog.issueCodes.map((code) => upper(code)).filter(Boolean)
    : [];
  const terminalMismatchCodes = watchdogIssueCodes.filter((code) => (
    code === "TERMINAL_TRANSITION_MISSING"
    || code === "TERMINAL_PROJECTION_MISMATCH"
    || code === "TERMINAL_STAGE_WITH_ACTIVE_POSITION"
  ));
  if (terminalMismatchCodes.length > 0) {
    blockers.push(`PREFLIGHT:TERMINAL_WATCHDOG_MISMATCH:${terminalMismatchCodes.join("|")}`);
  }

  return Object.freeze({
    ready: blockers.length === 0,
    blockers,
    counts: Object.freeze({
      episode_n: episodes.length,
      shadow_live_pair_n: shadowLivePairs.length,
      source_mode_pair_n: sourceModePairs.length,
    }),
  });
}

async function runPreflight(env = process.env, { db = null } = {}) {
  const cfg = resolvePreflightConfig(env);
  const selected = await selector.selectCollectorInputs({ db, env });
  const mergedEnv = {
    ...env,
    ...selected.collectorEnv,
  };
  const snapshot = await collector.collectRuntimeSnapshot({ db, env: mergedEnv });
  const evaluation = evaluateSnapshot(snapshot);
  const lineageContract = selected.selectorMeta && selected.selectorMeta.lineage_contract
    ? selected.selectorMeta.lineage_contract
    : buildLineageContract(selected.selectorMeta);
  return Object.freeze({
    ok: evaluation.ready,
    mode: cfg.mode,
    position_cycle_id: cfg.positionCycleId,
    selector_meta: selected.selectorMeta,
    lineage_contract: lineageContract,
    collector_env: selected.collectorEnv,
    snapshot_counts: evaluation.counts,
    blockers: evaluation.blockers,
  });
}

async function main(env = process.env, db = null) {
  const artifactDir = resolveArtifactDir(env);
  const report = await runPreflight(env, { db });
  ensureDir(artifactDir);
  const outputFile = path.join(artifactDir, OUTPUT_FILENAME);
  writeJson(outputFile, report);
  if (report.ok !== true) {
    console.error(JSON.stringify({
      ok: false,
      reason: "V2_PROMOTION_PREFLIGHT_BLOCKED",
      artifact_dir: artifactDir,
      output_file: outputFile,
      blockers: report.blockers,
      position_cycle_id: report.position_cycle_id,
    }));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    reason: "V2_PROMOTION_PREFLIGHT_READY",
    artifact_dir: artifactDir,
    output_file: outputFile,
    position_cycle_id: report.position_cycle_id,
    snapshot_counts: report.snapshot_counts,
  }));
  return report;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("CHECK_V2_PROMOTION_CANARY_PREFLIGHT_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    runPreflight,
    __test: {
      OUTPUT_FILENAME,
      trimOrNull,
      upper,
      resolveArtifactDir,
      resolvePreflightConfig,
      buildAlignmentBlockers,
      evaluateSnapshot,
    },
  };
}
