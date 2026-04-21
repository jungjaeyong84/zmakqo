#!/usr/bin/env node
"use strict";

const fs = require("fs");
const path = require("path");
const { queryV2DocsByField } = require("../src/v2/storage");
const preflight = require("./check-v2-promotion-canary-preflight");

const OUTPUT_FILENAME = "promotion-canary-candidate-selection.json";

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function parsePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const rounded = Math.trunc(num);
  if (rounded < min) return fallback;
  return Math.min(rounded, max);
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

function parseIsoMs(value) {
  const time = Date.parse(String(value || "").trim());
  return Number.isFinite(time) ? time : 0;
}

function recentCutoffIso({ now = Date.now(), recentWindowHours }) {
  return new Date(now - (recentWindowHours * 60 * 60 * 1000)).toISOString();
}

function resolveCandidateConfig(env = process.env) {
  const mode = upper(env.V2_PROMOTION_MODE) || "CANARY";
  if (!["CANARY", "LIVE"].includes(mode)) throw new Error("V2_PROMOTION_CANDIDATE_MODE_INVALID");
  const scanLimit = parsePositiveInt(env.V2_PROMOTION_CANDIDATE_LIMIT, 10, { min: 1, max: 100 });
  const recentWindowHours = parsePositiveInt(env.V2_PROMOTION_CANDIDATE_RECENT_WINDOW_HOURS, 168, { min: 1, max: 24 * 30 });
  return Object.freeze({
    mode,
    status: upper(env.V2_PROMOTION_CANDIDATE_STATUS) || "ACTIVE_PROTECTED",
    scanLimit,
    recentWindowHours,
    recentCutoffAt: recentCutoffIso({ recentWindowHours }),
    exchangeStateJson: trimOrNull(env.V2_PROMOTION_CANDIDATE_EXCHANGE_STATE_JSON),
  });
}

function summarizeCycle(row) {
  const cycle = row && typeof row === "object" ? row : {};
  return Object.freeze({
    position_cycle_id: trimOrNull(cycle.position_cycle_id),
    symbol: trimOrNull(cycle.symbol),
    position_side: trimOrNull(cycle.position_side),
    status: trimOrNull(cycle.status),
    created_at: trimOrNull(cycle.created_at),
    signal_intent_id: trimOrNull(cycle.signal_intent_id),
    openclaw_decision_id: trimOrNull(cycle.openclaw_decision_id),
  });
}

function summarizePreflight(report) {
  const row = report && typeof report === "object" ? report : {};
  return Object.freeze({
    ok: row.ok === true,
    position_cycle_id: trimOrNull(row.position_cycle_id),
    snapshot_counts: row.snapshot_counts || {},
    blockers: Array.isArray(row.blockers) ? row.blockers.slice() : [],
  });
}

function hasExactSnapshotCounts(preflightSummary) {
  const row = preflightSummary && typeof preflightSummary === "object" ? preflightSummary : null;
  const counts = row && row.snapshot_counts && typeof row.snapshot_counts === "object"
    ? row.snapshot_counts
    : null;
  return !!(
    counts &&
    Number(counts.episode_n) === 1 &&
    Number(counts.shadow_live_pair_n) === 1 &&
    Number(counts.source_mode_pair_n) === 1
  );
}

function buildSelectionContract({ cfg, queriedCycles, recentCycles, selected, collectorEnv } = {}) {
  const selectedCycleId = trimOrNull(selected && selected.cycle && selected.cycle.position_cycle_id);
  const preflightSummary = selected && selected.preflight && typeof selected.preflight === "object"
    ? selected.preflight
    : null;
  const collectorCycleId = trimOrNull(collectorEnv && collectorEnv.V2_PROMOTION_SELECT_POSITION_CYCLE_ID);
  const snapshotCountsExact = hasExactSnapshotCounts(preflightSummary);
  const selectedPreflightOk = preflightSummary ? preflightSummary.ok === true : false;
  const selectedCycleMatchesPreflight = !!(
    selectedCycleId &&
    trimOrNull(preflightSummary && preflightSummary.position_cycle_id) === selectedCycleId
  );
  const selectedCycleMatchesCollectorEnv = !!(
    selectedCycleId &&
    collectorCycleId &&
    collectorCycleId === selectedCycleId
  );
  const scanLimitRespected = Array.isArray(queriedCycles)
    ? queriedCycles.length < Number(cfg && cfg.scanLimit)
    : false;
  const recentWindowEnforced = Array.isArray(recentCycles)
    ? recentCycles.every((row) => parseIsoMs(row && row.created_at) >= parseIsoMs(cfg && cfg.recentCutoffAt))
    : false;

  return Object.freeze({
    ok: scanLimitRespected && recentWindowEnforced && selectedPreflightOk && selectedCycleMatchesPreflight && selectedCycleMatchesCollectorEnv && snapshotCountsExact,
    scan_limit_respected: scanLimitRespected,
    recent_window_enforced: recentWindowEnforced,
    selected_candidate_present: !!selectedCycleId,
    selected_preflight_ok: selectedPreflightOk,
    selected_cycle_matches_preflight: selectedCycleMatchesPreflight,
    selected_cycle_matches_collector_env: selectedCycleMatchesCollectorEnv,
    selected_snapshot_counts_exact: snapshotCountsExact,
  });
}

async function listCandidateCycles({ db = null, env = process.env, cfg } = {}) {
  const result = await queryV2DocsByField({
    db,
    env,
    collectionKey: "POSITION_CYCLES",
    field: "status",
    value: cfg.status,
    limit: cfg.scanLimit,
  });
  return (Array.isArray(result.rows) ? result.rows : [])
    .slice()
    .sort((left, right) => parseIsoMs(right && right.created_at) - parseIsoMs(left && left.created_at));
}

function filterRecentCandidateCycles(rows = [], cutoffAt) {
  const cutoffMs = parseIsoMs(cutoffAt);
  return (Array.isArray(rows) ? rows : []).filter((row) => {
    if (!cutoffMs) return true;
    const createdAtMs = parseIsoMs(row && row.created_at);
    return createdAtMs >= cutoffMs;
  });
}

async function evaluateCandidate({ db = null, env = process.env, mode, cycle, exchangeStateJson = null } = {}) {
  const cycleId = trimOrNull(cycle && cycle.position_cycle_id);
  if (!cycleId) {
    return Object.freeze({
      cycle: summarizeCycle(cycle),
      selected: false,
      preflight: null,
      error: "V2_PROMOTION_CANDIDATE_POSITION_CYCLE_ID_MISSING",
    });
  }
  try {
    const report = await preflight.runPreflight({
      ...env,
      V2_PROMOTION_MODE: mode,
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: cycleId,
      ...(exchangeStateJson ? { V2_PROMOTION_SELECT_EXCHANGE_STATE_JSON: exchangeStateJson } : {}),
    }, { db });
    return Object.freeze({
      cycle: summarizeCycle(cycle),
      selected: report.ok === true,
      preflight: summarizePreflight(report),
      error: null,
    });
  } catch (error) {
    return Object.freeze({
      cycle: summarizeCycle(cycle),
      selected: false,
      preflight: null,
      error: error && error.message ? error.message : String(error),
    });
  }
}

async function selectCanaryCandidate({ db = null, env = process.env } = {}) {
  const cfg = resolveCandidateConfig(env);
  const queriedCycles = await listCandidateCycles({ db, env, cfg });
  if (queriedCycles.length >= cfg.scanLimit) {
    return Object.freeze({
      ok: false,
      mode: cfg.mode,
      status_filter: cfg.status,
      candidate_limit: cfg.scanLimit,
      recent_window_hours: cfg.recentWindowHours,
      recent_cutoff_at: cfg.recentCutoffAt,
      selection_status: "ACTIVE_CYCLE_SCAN_LIMIT_REACHED",
      active_position_cycle_n: queriedCycles.length,
      recent_active_position_cycle_n: queriedCycles.length,
      selected_position_cycle_id: null,
      selected_preflight: null,
      collector_env: null,
      selection_contract: buildSelectionContract({
        cfg,
        queriedCycles,
        recentCycles: queriedCycles,
        selected: null,
        collectorEnv: null,
      }),
      evaluated_candidates: [],
    });
  }
  const cycles = filterRecentCandidateCycles(queriedCycles, cfg.recentCutoffAt);
  const evaluations = [];
  for (const cycle of cycles) {
    const evaluated = await evaluateCandidate({
      db,
      env,
      mode: cfg.mode,
      cycle,
      exchangeStateJson: cfg.exchangeStateJson,
    });
    evaluations.push(evaluated);
  }
  const selected = evaluations.find((row) => row.selected === true) || null;
  const selectionStatus = selected
    ? "READY"
    : (queriedCycles.length === 0
        ? "NO_ACTIVE_POSITION_CYCLES"
        : (cycles.length === 0 ? "NO_RECENT_ACTIVE_POSITION_CYCLES" : "NO_PREFLIGHT_READY_CANDIDATES"));
  return Object.freeze({
    ok: !!selected,
    mode: cfg.mode,
    status_filter: cfg.status,
    candidate_limit: cfg.scanLimit,
    recent_window_hours: cfg.recentWindowHours,
    recent_cutoff_at: cfg.recentCutoffAt,
    selection_status: selectionStatus,
    active_position_cycle_n: queriedCycles.length,
    recent_active_position_cycle_n: cycles.length,
    selected_position_cycle_id: selected ? selected.cycle.position_cycle_id : null,
    selected_preflight: selected ? selected.preflight : null,
    collector_env: selected ? Object.freeze({
      V2_PROMOTION_MODE: cfg.mode,
      V2_PROMOTION_SELECT_POSITION_CYCLE_ID: selected.cycle.position_cycle_id,
      ...(cfg.exchangeStateJson ? { V2_PROMOTION_SELECT_EXCHANGE_STATE_JSON: cfg.exchangeStateJson } : {}),
    }) : null,
    selection_contract: buildSelectionContract({
      cfg,
      queriedCycles,
      recentCycles: cycles,
      selected,
      collectorEnv: selected ? {
        V2_PROMOTION_MODE: cfg.mode,
        V2_PROMOTION_SELECT_POSITION_CYCLE_ID: selected.cycle.position_cycle_id,
        ...(cfg.exchangeStateJson ? { V2_PROMOTION_SELECT_EXCHANGE_STATE_JSON: cfg.exchangeStateJson } : {}),
      } : null,
    }),
    evaluated_candidates: evaluations,
  });
}

async function main(env = process.env, db = null) {
  const artifactDir = resolveArtifactDir(env);
  ensureDir(artifactDir);
  const result = await selectCanaryCandidate({ db, env });
  const outputFile = path.join(artifactDir, OUTPUT_FILENAME);
  writeJson(outputFile, result);
  if (result.ok !== true) {
    console.error(JSON.stringify({
      ok: false,
      reason: result.selection_status === "NO_ACTIVE_POSITION_CYCLES"
        ? "V2_PROMOTION_CANARY_ACTIVE_POSITION_CYCLES_NOT_FOUND"
        : (result.selection_status === "NO_RECENT_ACTIVE_POSITION_CYCLES"
            ? "V2_PROMOTION_CANARY_RECENT_ACTIVE_POSITION_CYCLES_NOT_FOUND"
            : (result.selection_status === "ACTIVE_CYCLE_SCAN_LIMIT_REACHED"
                ? "V2_PROMOTION_CANARY_ACTIVE_CYCLE_SCAN_LIMIT_REACHED"
                : "V2_PROMOTION_CANARY_PREFLIGHT_READY_CANDIDATE_NOT_FOUND")),
      artifact_dir: artifactDir,
      output_file: outputFile,
      selection_status: result.selection_status,
      active_position_cycle_n: result.active_position_cycle_n,
      evaluated_n: result.evaluated_candidates.length,
    }));
    process.exit(1);
  }
  console.log(JSON.stringify({
    ok: true,
    reason: "V2_PROMOTION_CANARY_CANDIDATE_SELECTED",
    artifact_dir: artifactDir,
    output_file: outputFile,
    active_position_cycle_n: result.active_position_cycle_n,
    position_cycle_id: result.selected_position_cycle_id,
  }));
  return result;
}

if (require.main === module) {
  main().catch((error) => {
    console.error("SELECT_V2_PROMOTION_CANARY_CANDIDATE_FAIL", error && error.stack ? error.stack : String(error));
    process.exit(1);
  });
} else {
  module.exports = {
    main,
    selectCanaryCandidate,
    __test: {
      OUTPUT_FILENAME,
      trimOrNull,
      upper,
      resolveArtifactDir,
      resolveCandidateConfig,
      parseIsoMs,
      summarizeCycle,
      summarizePreflight,
      hasExactSnapshotCounts,
      buildSelectionContract,
      listCandidateCycles,
      evaluateCandidate,
    },
  };
}
