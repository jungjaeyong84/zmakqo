#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const {
  OPS_DAILY_DIR,
  copyLatest,
  copySelfEvolutionLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  sendKoreanTelegramSummary,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { deriveBestFebtTuningContract, deriveBestFebtMarketContracts, buildSelfEvolutionPolicySpec } = require("./lib/best-febt-supervisor");
const {
  deriveDatasetObjectiveScore,
  deriveMarketObjectiveScores,
  deriveMarketConcentrationDiagnostics,
  deriveAttribution,
} = require("../src/utils/bestSelfEvolutionAnalysis");
const { buildMemoryLedger } = require("../src/utils/bestSelfEvolutionMemoryLedger");
const { deriveDeploymentGuards } = require("../src/utils/bestSelfEvolutionDeploymentGuards");
const { deriveDeploymentPlan } = require("../src/utils/bestSelfEvolutionDeploymentPlan");
const { deriveLoopMonitor } = require("../src/utils/bestSelfEvolutionLoopMonitor");
const { deriveWeightTuningPlan } = require("../src/utils/bestSelfEvolutionWeightTuning");
const { wrapDisplayAndRawReport } = require("../src/utils/jsonDisplayFields");
const { resolveMarketStateSummary } = require("../src/utils/marketStateSummary");
const { resolveStatPhysFeatures } = require("../src/utils/statPhysFeatures");

loadLocalEnv();

function resolveLatestArtifactPath(...names) {
  for (const name of names) {
    const filePath = path.join(OPS_DAILY_DIR, name);
    if (fs.existsSync(filePath)) return filePath;
  }
  return path.join(OPS_DAILY_DIR, names[0]);
}

const GOVERNANCE_LATEST_PATH = path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.json");
const CHANGE_CONTROL_LATEST_PATH = resolveLatestArtifactPath("pine_quality_change_control_latest.json", "pine_stage1_change_control_latest.json");
const CANARY_LATEST_PATH = path.join(OPS_DAILY_DIR, "filter_shadow_canary_latest.json");
const ML_LATEST_PATH = path.join(OPS_DAILY_DIR, "ml_filter_policy_latest.json");
const EV_LATEST_PATH = path.join(OPS_DAILY_DIR, "ev_tp1_threshold_tune_latest.json");
const WAIT_LATEST_PATH = path.join(OPS_DAILY_DIR, "wait_one_bar_tune_latest.json");
const FEBT_PHASE0_LATEST_PATH = path.join(OPS_DAILY_DIR, "febt_phase0_baseline_latest.json");
const SELF_EVOLUTION_DATASET_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_dataset_latest.json");
const SELF_EVOLUTION_OBJECTIVE_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_objective_latest.json");
const SELF_EVOLUTION_ATTRIBUTION_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_attribution_latest.json");
const SELF_EVOLUTION_CANDIDATES_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json");
const SELF_EVOLUTION_REPLAY_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_replay_latest.json");
const SELF_EVOLUTION_CANARY_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json");
const SELF_EVOLUTION_MEMORY_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_memory_latest.json");
const WEEKLY_PINE_HISTORY_PATH = path.join(OPS_DAILY_DIR, "weekly_pine_upgrade_history.json");
const CODEX_PATCH_LATEST_PATH = path.join(OPS_DAILY_DIR, "codex_weekly_patch_engine_latest.json");
const STAGE_AUTOPILOT_LATEST_PATH = path.join(OPS_DAILY_DIR, "stage_autopilot_latest.json");
const RETROSPECTIVE_LATEST_PATH = path.join(OPS_DAILY_DIR, "objective_retrospective_latest.json");
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "objective_supervisor_latest.md");
const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json");
const SELF_EVOLUTION_REPORT_LATEST_JSON = selfEvolutionSnapshotLatestPath("objective_supervisor_latest.json");
const SELF_EVOLUTION_REPORT_LATEST_MD = selfEvolutionSnapshotLatestPath("objective_supervisor_latest.md");
const FRESHNESS_HOURS = Object.freeze({
  governance: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_GOVERNANCE_MAX_AGE_HOURS || 30)),
  changeControl: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_CHANGE_CONTROL_MAX_AGE_HOURS || 36)),
  canary: Math.max(4, Number(process.env.OBJECTIVE_SUPERVISOR_CANARY_MAX_AGE_HOURS || 12)),
  ml: Math.max(4, Number(process.env.OBJECTIVE_SUPERVISOR_ML_MAX_AGE_HOURS || 12)),
  ev: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_EV_MAX_AGE_HOURS || 24)),
  wait: Math.max(24, Number(process.env.OBJECTIVE_SUPERVISOR_WAIT_MAX_AGE_HOURS || 144)),
  phase0: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_FEBT_PHASE0_MAX_AGE_HOURS || 36)),
  selfEvolutionDataset: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_DATASET_MAX_AGE_HOURS || 36)),
  selfEvolutionObjective: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_OBJECTIVE_MAX_AGE_HOURS || 36)),
  selfEvolutionAttribution: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_ATTRIBUTION_MAX_AGE_HOURS || 36)),
  selfEvolutionCandidates: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_CANDIDATES_MAX_AGE_HOURS || 36)),
  selfEvolutionReplay: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_REPLAY_MAX_AGE_HOURS || 36)),
  selfEvolutionCanary: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_CANARY_MAX_AGE_HOURS || 36)),
  selfEvolutionMemory: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_MEMORY_MAX_AGE_HOURS || 72)),
  weeklyPineHistory: Math.max(24, Number(process.env.OBJECTIVE_SUPERVISOR_WEEKLY_PINE_HISTORY_MAX_AGE_HOURS || 240)),
  codex: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_CODEX_MAX_AGE_HOURS || 48)),
  stageAutopilot: Math.max(4, Number(process.env.OBJECTIVE_SUPERVISOR_STAGE_AUTOPILOT_MAX_AGE_HOURS || 12)),
  retrospective: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_RETROSPECTIVE_MAX_AGE_HOURS || 30)),
});

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function pct(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function signedNum(value, digits = 0) {
  if (value === null || value === undefined || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  return `${n > 0 ? "+" : ""}${n.toFixed(digits)}`;
}

function signedPct(value, digits = 2) {
  if (value === null || value === undefined || value === "") return "N/A";
  const n = Number(value);
  if (!Number.isFinite(n)) return "N/A";
  const text = (n * 100).toFixed(digits);
  return `${n > 0 ? "+" : ""}${text}%`;
}

function renderSummaryLine(rows = []) {
  return (Array.isArray(rows) ? rows : [])
    .slice(0, 8)
    .map((row) => `${row.key} ${row.count}`)
    .join(" / ") || "N/A";
}

function parseArtifactTimestampMs(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const normalized = raw.endsWith(" KST")
    ? `${raw.slice(0, -4).replace(" ", "T")}+09:00`
    : raw.replace(" ", "T");
  const ms = Date.parse(normalized);
  return Number.isFinite(ms) ? ms : null;
}

function extractArtifactGeneratedAtMs(data) {
  const raw = data && data.raw && typeof data.raw === "object" ? data.raw : data;
  const display = data && data.display && typeof data.display === "object" ? data.display : null;
  return (
    parseArtifactTimestampMs(raw && (raw.generated_at_kst || raw.generated_at))
    || parseArtifactTimestampMs(display && (display.generated_at_kst || display.generated_at))
    || null
  );
}

function resolveDisplayCandidateId(candidateId, changeControl = null) {
  const raw = String(candidateId || "").trim();
  if (!raw) return null;
  const display = String(
    changeControl
    && changeControl.auto_promotion
    && changeControl.auto_promotion.display_candidate_id
    || ""
  ).trim();
  if (
    display
    && String(changeControl && changeControl.auto_promotion && changeControl.auto_promotion.candidate_id || "").trim() === raw
  ) return display;
  return raw;
}

function readArtifact(name, filePath, maxAgeHours) {
  const data = readJsonRawSafe(filePath, null);
  if (!data) {
    return { name, filePath, data: null, exists: false, fresh: false, ageHours: null };
  }
  try {
    const st = fs.statSync(filePath);
    const generatedAtMs = extractArtifactGeneratedAtMs(data);
    const referenceMs = Number.isFinite(generatedAtMs) ? generatedAtMs : Number(st.mtimeMs || 0);
    const ageHours = (Date.now() - referenceMs) / (60 * 60 * 1000);
    return {
      name,
      filePath,
      data,
      exists: true,
      ageHours,
      generatedAtMs: Number.isFinite(generatedAtMs) ? generatedAtMs : null,
      fresh: Number.isFinite(ageHours) && ageHours <= maxAgeHours,
    };
  } catch (_err) {
    return { name, filePath, data, exists: true, fresh: false, ageHours: null };
  }
}

function readCycleId(value = null) {
  const raw = value && value.raw && typeof value.raw === "object" ? value.raw : value;
  const cycleId = String(raw && (raw.cycle_id || raw.generation_id) || "").trim();
  return cycleId || null;
}

const SELF_EVOLUTION_STAGE_KEYS = Object.freeze({
  SEED: ["dataset"],
  INTEGRATED: ["dataset", "objective", "attribution", "candidates", "replay", "canary", "memory", "codex"],
  FINAL: ["dataset", "objective", "attribution", "candidates", "replay", "canary", "memory", "codex"],
  STANDALONE: ["dataset", "objective", "attribution", "candidates", "replay", "canary", "memory", "codex", "stageAutopilot"],
});

function summarizeSelfEvolutionArtifactCycles({ artifacts = {}, stage = "STANDALONE", preferredCycleId = null } = {}) {
  const normalizedStage = String(stage || "STANDALONE").trim().toUpperCase();
  const keys = SELF_EVOLUTION_STAGE_KEYS[normalizedStage] || SELF_EVOLUTION_STAGE_KEYS.STANDALONE;
  const rows = keys.map((key) => {
    const artifact = artifacts[key] || {};
    const exists = artifact.exists === true || artifact.data != null;
    return {
      key,
      exists,
      fresh: artifact.fresh === true,
      cycle_id: readCycleId(artifact.data),
    };
  });
  const availableWithCycle = rows.filter((row) => row.exists && row.cycle_id);
  const cycleCounts = availableWithCycle.reduce((acc, row) => {
    acc[row.cycle_id] = (acc[row.cycle_id] || 0) + 1;
    return acc;
  }, {});
  const dominantCycleId = Object.entries(cycleCounts)
    .sort((a, b) => Number(b[1] || 0) - Number(a[1] || 0) || String(a[0]).localeCompare(String(b[0])))
    .map((row) => row[0])[0] || null;
  const expectedCycleId = String(preferredCycleId || "").trim() || dominantCycleId || null;
  const missingKeys = rows.filter((row) => !row.exists).map((row) => row.key);
  const cycleMismatches = expectedCycleId
    ? rows.filter((row) => row.exists && row.cycle_id && row.cycle_id !== expectedCycleId).map((row) => ({ key: row.key, cycle_id: row.cycle_id }))
    : [];
  const cycleIdAbsentKeys = expectedCycleId
    ? rows.filter((row) => row.exists && row.fresh === true && !row.cycle_id).map((row) => row.key)
    : [];
  return {
    available: rows.some((row) => row.exists),
    stage: normalizedStage,
    expected_cycle_id: expectedCycleId,
    required_keys: keys.slice(),
    available_n: rows.filter((row) => row.exists).length,
    missing_key_n: missingKeys.length,
    missing_keys: missingKeys,
    cycle_consistent: missingKeys.length === 0 && cycleMismatches.length === 0 && cycleIdAbsentKeys.length === 0,
    cycle_mismatch_n: cycleMismatches.length,
    cycle_mismatches: cycleMismatches,
    cycle_id_absent_n: cycleIdAbsentKeys.length,
    cycle_id_absent_keys: cycleIdAbsentKeys,
    rows,
  };
}

function summarizeRetrospective(retrospective = null) {
  const periods = retrospective && retrospective.periods && typeof retrospective.periods === "object"
    ? retrospective.periods
    : {};
  const daily = periods.DAILY || null;
  const weekly = periods.WEEKLY || null;
  const monthly = periods.MONTHLY || null;
  const buildRow = (row) => ({
    verdict: String(row && row.objective && row.objective.verdict || "N/A"),
    pass: row && row.objective ? row.objective.pass === true : null,
    executed_n: toNum(row && row.objective && row.objective.executed_n),
    realized_n: toNum(row && row.objective && row.objective.realized_n),
    net_pnl_quote: toNum(row && row.realized_trades && row.realized_trades.net_pnl_quote),
    failed_checks: Array.isArray(row && row.objective && row.objective.failed_checks) ? row.objective.failed_checks : [],
  });
  const dailyRow = buildRow(daily);
  const weeklyRow = buildRow(weekly);
  const monthlyRow = buildRow(monthly);
  return {
    available: !!retrospective,
    daily: dailyRow,
    weekly: weeklyRow,
    monthly: monthlyRow,
    any_fail: [dailyRow, weeklyRow, monthlyRow].some((row) => row.pass === false),
    daily_no_trade: dailyRow.failed_checks.includes("NO_TRADE_ACTIVITY"),
    daily_zero_idle: dailyRow.failed_checks.includes("ZERO_KRW_IDLE"),
    any_no_trade: dailyRow.failed_checks.includes("NO_TRADE_ACTIVITY"),
    any_zero_idle: dailyRow.failed_checks.includes("ZERO_KRW_IDLE"),
  };
}

function weightedAvg(rows = [], field, weightField = "executed_n") {
  const scoped = (Array.isArray(rows) ? rows : []).filter((row) => Number(row && row[weightField] || 0) > 0 && Number.isFinite(toNum(row && row[field])));
  if (!scoped.length) return null;
  const totalWeight = scoped.reduce((acc, row) => acc + Number(row[weightField] || 0), 0);
  if (!Number.isFinite(totalWeight) || totalWeight <= 0) return null;
  return scoped.reduce((acc, row) => acc + (Number(row[field] || 0) * Number(row[weightField] || 0)), 0) / totalWeight;
}

function summarizeGovernancePhysics(governance = null) {
  const current = governance && governance.current && typeof governance.current === "object" ? governance.current : {};
  const byTier = current && current.pine_follow_through && current.pine_follow_through.by_tier && typeof current.pine_follow_through.by_tier === "object"
    ? current.pine_follow_through.by_tier
    : {};
  const rows = [byTier.EARLY, byTier.CORE].filter(Boolean);
  const executedN = rows.length
    ? rows.reduce((acc, row) => acc + Number(row && row.executed_n || 0), 0)
    : toNum(current && current.overall && current.overall.executed_n);
  const summary = rows.length ? {
    entropy: weightedAvg(rows, "avg_entropy_score"),
    coherence: weightedAvg(rows, "avg_coherence_score"),
    transitionRisk: weightedAvg(rows, "avg_transition_risk"),
    fieldAlignment: weightedAvg(rows, "avg_field_alignment"),
    domainWallDensity: weightedAvg(rows, "avg_domain_wall_density"),
    susceptibility: weightedAvg(rows, "avg_susceptibility"),
    freeEnergy: weightedAvg(rows, "avg_free_energy"),
  } : {
    entropy: toNum(current && current.overall && current.overall.avg_entropy_score),
    coherence: toNum(current && current.overall && current.overall.avg_coherence_score),
    transitionRisk: toNum(current && current.overall && current.overall.avg_transition_risk),
    fieldAlignment: toNum(current && current.overall && current.overall.avg_field_alignment),
    domainWallDensity: toNum(current && current.overall && current.overall.avg_domain_wall_density),
    susceptibility: toNum(current && current.overall && current.overall.avg_susceptibility),
    freeEnergy: toNum(current && current.overall && current.overall.avg_free_energy),
  };
  const resolved = resolveStatPhysFeatures({
    sp_entropy_score: summary.entropy,
    sp_coherence_score: summary.coherence,
    sp_transition_risk: summary.transitionRisk,
    sp_field_alignment: summary.fieldAlignment,
    sp_domain_wall_density: summary.domainWallDensity,
    sp_susceptibility: summary.susceptibility,
    sp_free_energy: summary.freeEnergy,
  });
  const marketState = resolveMarketStateSummary({
    sp_entropy_score: summary.entropy,
    sp_coherence_score: summary.coherence,
    sp_transition_risk: summary.transitionRisk,
    sp_field_alignment: summary.fieldAlignment,
    sp_domain_wall_density: summary.domainWallDensity,
    sp_susceptibility: summary.susceptibility,
    sp_free_energy: summary.freeEnergy,
  });
  const available = [
    summary.entropy,
    summary.coherence,
    summary.transitionRisk,
    summary.fieldAlignment,
    summary.domainWallDensity,
    summary.susceptibility,
    summary.freeEnergy,
  ].some((v) => Number.isFinite(v));
  let blockReason = null;
  if (resolved.state === "CRITICAL" && Number(executedN || 0) >= 4) blockReason = "STAT_PHYSICS_CRITICAL";
  else if (resolved.state === "DISORDERED" && Number(executedN || 0) >= 8) blockReason = "STAT_PHYSICS_DISORDERED";
  return {
    available,
    executed_n: Number.isFinite(Number(executedN)) ? Number(executedN) : null,
    state: resolved.state || null,
    display_state: resolved.display_state,
    entropy: summary.entropy,
    coherence: summary.coherence,
    transition_risk: summary.transitionRisk,
    field_alignment: summary.fieldAlignment,
    domain_wall_density: summary.domainWallDensity,
    susceptibility: summary.susceptibility,
    free_energy: summary.freeEnergy,
    block_reason: blockReason,
    action: marketState.physicsAction || "ALLOW",
    qty_scale: Number.isFinite(Number(marketState.physicsQtyScale)) ? Number(marketState.physicsQtyScale) : null,
    wait_assist: marketState.waitAssist === true,
    wait_hard: marketState.waitHard === true,
  };
}

function topBreakdownValue(rows = []) {
  if (!Array.isArray(rows) || !rows.length) return null;
  const row = rows[0] || {};
  const value = row.value != null ? row.value : row.key;
  const text = String(value || "").trim();
  return text || null;
}

function summarizeFebtByTier(byTier = {}) {
  const rows = Object.values(byTier || {}).filter((row) => row && typeof row === "object");
  const executed = rows.reduce((acc, row) => acc + Number(row.executed_n || 0), 0);
  const calcOk = rows.reduce((acc, row) => acc + Number(row.febt_calc_ok_n || 0), 0);
  const phaseKnown = rows.reduce((acc, row) => acc + Number(row.febt_phase_known_n || 0), 0);
  const fire = rows.reduce((acc, row) => acc + Number(row.febt_fire_n || 0), 0);
  const late = rows.reduce((acc, row) => acc + Number(row.febt_late_n || 0), 0);
  const voidN = rows.reduce((acc, row) => acc + Number(row.febt_void_n || 0), 0);
  const missing = rows.reduce((acc, row) => acc + Number(row.febt_payload_missing_n || 0), 0);
  const disagreement = rows.reduce((acc, row) => acc + Number(row.febt_disagreement_n || 0), 0);
  const fallbackLegacy = rows.reduce((acc, row) => acc + Number(row.febt_fallback_legacy_n || 0), 0);
  return {
    executed,
    calc_ok_rate: executed > 0 ? (calcOk / executed) : null,
    phase_known: phaseKnown,
    fire,
    late,
    void_n: voidN,
    disagreement,
    fallback_legacy: fallbackLegacy,
    missing_rate: executed > 0 ? (missing / executed) : null,
  };
}

function summarizeSelfEvolutionDataset(dataset = null) {
  const summary = dataset && dataset.summary && typeof dataset.summary === "object"
    ? dataset.summary
    : {};
  return {
    available: !!dataset,
    rows_n: toNum(summary.rows_n) || 0,
    executed_n: toNum(summary.executed_n) || 0,
    drop_n: toNum(summary.drop_n) || 0,
    missed_n: toNum(summary.missed_n) || 0,
    fallback_n: toNum(summary.fallback_n) || 0,
    rejected_n: toNum(summary.rejected_n) || 0,
    partial_n: toNum(summary.partial_n) || 0,
    realized_n: toNum(summary.realized_n) || 0,
    features_coverage_rate: toNum(summary.features_coverage_rate),
    febt_coverage_rate: toNum(summary.febt_coverage_rate),
    febt_eligible_n: toNum(summary.febt_eligible_n) || 0,
    febt_coverage_rate_eligible: toNum(summary.febt_coverage_rate_eligible),
    febt_active_eligible_n: toNum(summary.febt_active_eligible_n) || 0,
    febt_coverage_rate_active_eligible: toNum(summary.febt_coverage_rate_active_eligible),
    febt_active_missing_n: toNum(summary.febt_active_missing_n) || 0,
    active_entry_n: toNum(summary.active_entry_n) || 0,
    legacy_entry_n: toNum(summary.legacy_entry_n) || 0,
    active_entry_family_counts: Array.isArray(summary.active_entry_family_counts) ? summary.active_entry_family_counts : [],
    avg_realized_ret_net: toNum(summary.avg_realized_ret_net),
    avg_realized_pnl_quote: toNum(summary.avg_realized_pnl_quote),
    avg_hold_minutes: toNum(summary.avg_hold_minutes),
    entry_pending_total_n: toNum(summary.entry_pending_total_n) || 0,
    entry_executed_null_realized_n: toNum(summary.entry_executed_null_realized_n) || 0,
    entry_fallback_pending_n: toNum(summary.entry_fallback_pending_n) || 0,
    entry_fallback_payload_missing_n: toNum(summary.entry_fallback_payload_missing_n) || 0,
    entry_fallback_payload_missing_linked_n: toNum(summary.entry_fallback_payload_missing_linked_n) || 0,
    entry_fallback_pending_active_n: toNum(summary.entry_fallback_pending_active_n) || 0,
    entry_fallback_pending_active_by_family: Array.isArray(summary.entry_fallback_pending_active_by_family)
      ? summary.entry_fallback_pending_active_by_family
      : [],
    entry_exit_present_unlabeled_n: toNum(summary.entry_exit_present_unlabeled_n) || 0,
    entry_open_pending_n: toNum(summary.entry_open_pending_n) || 0,
    entry_link_missing_n: toNum(summary.entry_link_missing_n) || 0,
  };
}

function summarizeSelfEvolutionObjective(report = null) {
  const global = report && report.global_objective_score && typeof report.global_objective_score === "object"
    ? report.global_objective_score
    : {};
  const markets = Array.isArray(report && report.market_objective_scores) ? report.market_objective_scores : [];
  const concentration = report && report.market_concentration && typeof report.market_concentration === "object"
    ? report.market_concentration
    : deriveMarketConcentrationDiagnostics({
      globalObjectiveScore: global.objective_score,
      marketObjectiveScores: markets,
    });
  return {
    available: !!report,
    objective_score: toNum(global.objective_score),
    profit_score: toNum(global.components && global.components.profit_score),
    count_score: toNum(global.components && global.components.count_score),
    replacement_score: toNum(global.components && global.components.replacement_score),
    tp1_score: toNum(global.components && global.components.tp1_score),
    drawdown_penalty: toNum(global.components && global.components.drawdown_penalty),
    latency_penalty: toNum(global.components && global.components.latency_penalty),
    instability_penalty: toNum(global.components && global.components.instability_penalty),
    count_floor_pass: global.constraints && typeof global.constraints.count_floor_pass === "boolean" ? global.constraints.count_floor_pass : null,
    replacement_floor_pass: global.constraints && typeof global.constraints.replacement_floor_pass === "boolean" ? global.constraints.replacement_floor_pass : null,
    latency_budget_pass: global.constraints && typeof global.constraints.latency_budget_pass === "boolean" ? global.constraints.latency_budget_pass : null,
    cohort_scope: String(global.snapshot && global.snapshot.cohort_scope || "").trim() || null,
    rows_n: toNum(global.snapshot && global.snapshot.rows_n),
    executed_n: toNum(global.snapshot && global.snapshot.executed_n),
    strict_executed_n: toNum(global.snapshot && global.snapshot.strict_executed_n),
    partial_n: toNum(global.snapshot && global.snapshot.partial_n),
    fallback_n: toNum(global.snapshot && global.snapshot.fallback_n),
    realized_n: toNum(global.snapshot && global.snapshot.realized_n),
    fire_n: toNum(global.snapshot && global.snapshot.fire_n),
    fire_win_rate: toNum(global.snapshot && global.snapshot.fire_win_rate),
    tp1_first_rate: toNum(global.snapshot && global.snapshot.tp1_first_rate),
    win_rate: toNum(global.snapshot && global.snapshot.win_rate),
    avg_realized_ret_net: toNum(global.snapshot && global.snapshot.avg_realized_ret_net),
    missing_rate: toNum(global.snapshot && global.snapshot.missing_rate),
    projected_count_ratio_global: toNum(global.snapshot && global.snapshot.projected_count_ratio_global),
    projected_replacement_ratio: toNum(global.snapshot && global.snapshot.projected_replacement_ratio),
    top_market: markets[0] || null,
    bottom_market: markets.length ? markets[markets.length - 1] : null,
    market_concentration: concentration,
    market_objective_scores: markets,
  };
}

function resolveSelfEvolutionRealizedMinSample() {
  const configured = toNum(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_REALIZED_MIN_SAMPLE);
  return Number.isFinite(configured) && configured > 0 ? configured : 8;
}

function resolveGovernanceRealizedMinSample(governance = null, objective = null) {
  const configured = toNum(process.env.OBJECTIVE_SUPERVISOR_GOVERNANCE_REALIZED_MIN_SAMPLE);
  if (Number.isFinite(configured) && configured > 0) return configured;
  const objectiveCfg = governance && governance.objective && typeof governance.objective === "object"
    ? governance.objective
    : {};
  const configuredMin = toNum(objectiveCfg.realized_min_sample);
  if (Number.isFinite(configuredMin) && configuredMin > 0) return configuredMin;
  const objectiveMin = toNum(objective && objective.realized_min_sample);
  if (Number.isFinite(objectiveMin) && objectiveMin > 0) return objectiveMin;
  return 8;
}

function normalizeGovernanceFailedChecks(failedChecks = [], { strictEnoughSample = false, effectiveEnoughSample = false } = {}) {
  const rows = Array.isArray(failedChecks) ? failedChecks : [];
  return rows.map((row) => {
    const value = String(row || "").trim().toUpperCase();
    if (value === "INSUFFICIENT_SAMPLE" && strictEnoughSample !== true && effectiveEnoughSample === true) {
      return "STRICT_SAMPLE_ONLY";
    }
    return value;
  }).filter(Boolean);
}

function summarizeSelfEvolutionAttribution(report = null) {
  const attribution = report && report.attribution && typeof report.attribution === "object"
    ? report.attribution
    : {};
  const summary = attribution.summary && typeof attribution.summary === "object" ? attribution.summary : {};
  return {
    available: !!report,
    drop_top_layer: summary.drop_top_layer || null,
    late_loss_top_market: summary.late_loss_top_market || null,
    false_fire_top_market: summary.false_fire_top_market || null,
    missed_recovery_top_reason: summary.missed_recovery_top_reason || null,
    fallback_cost_top_market: summary.fallback_cost_top_market || null,
    drop_attribution: Array.isArray(attribution.drop_attribution) ? attribution.drop_attribution : [],
    late_loss_attribution: Array.isArray(attribution.late_loss_attribution) ? attribution.late_loss_attribution : [],
    false_fire_attribution: Array.isArray(attribution.false_fire_attribution) ? attribution.false_fire_attribution : [],
    missed_recovery_attribution: Array.isArray(attribution.missed_recovery_attribution) ? attribution.missed_recovery_attribution : [],
    fallback_cost_attribution: Array.isArray(attribution.fallback_cost_attribution) ? attribution.fallback_cost_attribution : [],
  };
}

function summarizeSelfEvolutionCandidates(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const rows = Array.isArray(report && report.rows) ? report.rows : [];
  return {
    available: !!report,
    total_n: toNum(summary.total_n) || 0,
    ready_n: toNum(summary.ready_n) || 0,
    blocked_n: toNum(summary.blocked_n) || 0,
    by_scope: summary.by_scope && typeof summary.by_scope === "object" ? summary.by_scope : {},
    top_candidate_id: String(summary.top_candidate_id || "").trim() || null,
    top_scope: String(summary.top_scope || "").trim() || null,
    rows,
  };
}

function summarizeSelfEvolutionReplay(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const rows = Array.isArray(report && report.validations) ? report.validations : [];
  return {
    available: !!report,
    validation_mode: String(report && report.validation_mode || "N/A"),
    total_n: toNum(summary.total_n) || 0,
    pass_n: toNum(summary.pass_n) || 0,
    warn_n: toNum(summary.warn_n) || 0,
    block_n: toNum(summary.block_n) || 0,
    best_candidate_id: String(summary.best_candidate_id || "").trim() || null,
    best_verdict: String(summary.best_verdict || "").trim() || null,
    best_objective_delta: toNum(summary.best_objective_delta),
    validations: rows,
  };
}

function summarizeSelfEvolutionCanary(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const rows = Array.isArray(report && report.rows) ? report.rows : [];
  return {
    available: !!report,
    total_n: toNum(summary.total_n) || 0,
    shadow_n: toNum(summary.shadow_n) || 0,
    soft_n: toNum(summary.soft_n) || 0,
    hard_n: toNum(summary.hard_n) || 0,
    ready_n: toNum(summary.ready_n) || 0,
    blocked_n: toNum(summary.blocked_n) || 0,
    rollback_ready_n: toNum(summary.rollback_ready_n) || 0,
    apply_pass: summary.apply_pass === true,
    global_canary_pass: summary.global_canary_pass === true,
    current_open_wave: toNum(summary.current_open_wave) || 1,
    open_wave: toNum(summary.open_wave) || 1,
    scale_allowed: summary.scale_allowed === true,
    scale_block_reason: String(summary.scale_block_reason || "").trim() || null,
    next_wave_candidate: toNum(summary.next_wave_candidate),
    top_ready_market: String(summary.top_ready_market || "").trim() || null,
    top_rollback_market: String(summary.top_rollback_market || "").trim() || null,
    rows,
  };
}

function summarizeSelfEvolutionMemory(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const rows = Array.isArray(report && report.current_rows) ? report.current_rows : [];
  return {
    available: !!report,
    total_n: toNum(summary.total_n) || 0,
    current_n: toNum(summary.current_n) || 0,
    success_n: toNum(summary.success_n) || 0,
    neutral_n: toNum(summary.neutral_n) || 0,
    fail_n: toNum(summary.fail_n) || 0,
    rolled_back_n: toNum(summary.rolled_back_n) || 0,
    blocked_candidate_n: toNum(summary.blocked_candidate_n) || 0,
    blocked_candidate_ids: Array.isArray(summary.blocked_candidate_ids) ? summary.blocked_candidate_ids : [],
    top_success_candidate_id: String(summary.top_success_candidate_id || "").trim() || null,
    top_failed_candidate_id: String(summary.top_failed_candidate_id || "").trim() || null,
    avg_objective_delta: toNum(summary.avg_objective_delta),
    avg_count_delta: toNum(summary.avg_count_delta),
    avg_replacement_delta: toNum(summary.avg_replacement_delta),
    avg_ret_net_delta: toNum(summary.avg_ret_net_delta),
    recent_failed_fingerprints: Array.isArray(summary.recent_failed_fingerprints) ? summary.recent_failed_fingerprints : [],
    latest_week_key: String(summary.latest_week_key || "").trim() || null,
    current_rows: rows,
  };
}

function summarizeSelfEvolutionDeployment(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const rows = Array.isArray(report && report.rows) ? report.rows : [];
  return {
    available: !!report,
    target_candidate_id: String(summary.target_candidate_id || "").trim() || null,
    deploy_pass: summary.deploy_pass === true,
    rollback_only: summary.rollback_only === true,
    blockers: Array.isArray(summary.blockers) ? summary.blockers : [],
    root_cause: String(summary.root_cause || "").trim() || null,
    next_actions: Array.isArray(summary.next_actions) ? summary.next_actions : [],
    replay_verdict: String(summary.replay_verdict || "").trim().toUpperCase() || null,
    canary_open_wave: toNum(summary.canary_open_wave) || 1,
    market_ready_n: toNum(summary.market_ready_n) || 0,
    market_total_n: toNum(summary.market_total_n) || 0,
    memory_blocked_candidate_n: toNum(summary.memory_blocked_candidate_n) || 0,
    rows,
  };
}

function summarizeSelfEvolutionDeploymentPlan(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const rows = Array.isArray(report && report.rows) ? report.rows : [];
  const handoff = report && report.handoff && typeof report.handoff === "object" ? report.handoff : {};
  return {
    available: !!report,
    plan_status: String(summary.plan_status || "").trim().toUpperCase() || null,
    target_candidate_id: String(summary.target_candidate_id || "").trim() || null,
    display_candidate_id: String(summary.display_candidate_id || "").trim() || null,
    rollback_file_path: String(summary.rollback_file_path || "").trim() || null,
    prepare_pass: summary.prepare_pass === true,
    ready_for_manual_paste: summary.ready_for_manual_paste === true,
    manual_step_required: summary.manual_step_required === true,
    open_wave: toNum(summary.open_wave) || 1,
    target_wave: toNum(summary.target_wave) || 1,
    market_scope_n: toNum(summary.market_scope_n) || 0,
    market_scope_ready_n: toNum(summary.market_scope_ready_n) || 0,
    market_scope_blocked_n: toNum(summary.market_scope_blocked_n) || 0,
    prepared_file_path: String(summary.prepared_file_path || "").trim() || null,
    latest_generated_file_path: String(summary.latest_generated_file_path || "").trim() || null,
    rollback_source_file_path: String(summary.rollback_source_file_path || "").trim() || null,
    prepared_stage_ready: summary.prepared_stage_ready === true,
    source_week_key: String(summary.source_week_key || "").trim() || null,
    codex_verdict: String(summary.codex_verdict || "").trim().toUpperCase() || null,
    blockers: Array.isArray(summary.blockers) ? summary.blockers : [],
    next_actions: Array.isArray(summary.next_actions) ? summary.next_actions : [],
    rows,
    handoff: {
      checklist: Array.isArray(handoff.checklist) ? handoff.checklist : [],
      prepared_file_path: String(handoff.prepared_file_path || "").trim() || null,
      latest_generated_file_path: String(handoff.latest_generated_file_path || "").trim() || null,
      rollback_source_file_path: String(handoff.rollback_source_file_path || "").trim() || null,
      candidate_signature: String(handoff.candidate_signature || "").trim() || null,
      prepared_reason: String(handoff.prepared_reason || "").trim() || null,
      next_actions: Array.isArray(handoff.next_actions) ? handoff.next_actions : [],
    },
  };
}

function summarizeSelfEvolutionLoopMonitor(report = null) {
  const summary = report && report.summary && typeof report.summary === "object" ? report.summary : {};
  const rows = Array.isArray(report && report.rows) ? report.rows : [];
  return {
    available: !!report,
    cycle_id: String(summary.cycle_id || report && report.cycle_id || "").trim() || null,
    overall_status: String(summary.overall_status || "").trim().toUpperCase() || null,
    stale_artifact_n: toNum(summary.stale_artifact_n) || 0,
    stale_artifacts: Array.isArray(summary.stale_artifacts) ? summary.stale_artifacts : [],
    cycle_consistent: summary.cycle_consistent === true,
    cycle_mismatch_n: toNum(summary.cycle_mismatch_n) || 0,
    cycle_mismatches: Array.isArray(summary.cycle_mismatches) ? summary.cycle_mismatches : [],
    critical_blocker_n: toNum(summary.critical_blocker_n) || 0,
    critical_blockers: Array.isArray(summary.critical_blockers) ? summary.critical_blockers : [],
    promotion_path_ready: summary.promotion_path_ready === true,
    manual_paste_ready: summary.manual_paste_ready === true,
    ready_candidate_id: String(summary.ready_candidate_id || "").trim() || null,
    canary_open_wave: toNum(summary.canary_open_wave) || null,
    loop_n: toNum(summary.loop_n) || 0,
    fresh_loop_n: toNum(summary.fresh_loop_n) || 0,
    rows,
  };
}

function summarizeCodexAuthority({
  reportVerdict = "HOLD",
  reportReason = "N/A",
  codexReview = null,
  deploymentPlan = null,
} = {}) {
  const review = codexReview && typeof codexReview === "object" ? codexReview : {};
  const plan = deploymentPlan && typeof deploymentPlan === "object" ? deploymentPlan : {};
  const authorityMode = plan.plan_status || review.verdict || "HOLD";
  return {
    owner: "CODEX",
    authority_mode: String(authorityMode || "HOLD").trim().toUpperCase(),
    report_verdict: String(reportVerdict || "HOLD").trim().toUpperCase(),
    report_reason: String(reportReason || "N/A"),
    status: String(review.status || "N/A").trim().toUpperCase() || "N/A",
    verdict: String(review.verdict || "HOLD").trim().toUpperCase() || "HOLD",
    recommended_candidate_id: String(review.recommended_candidate_id || plan.target_candidate_id || "").trim() || null,
    display_candidate_id: String(review.display_candidate_id || plan.display_candidate_id || "").trim() || null,
    recommended_rollback_file_path: String(review.recommended_rollback_file_path || plan.rollback_file_path || "").trim() || null,
    confidence: toNum(review.confidence),
    reason: String(review.reason || reportReason || "N/A"),
    manual_step_required: plan.manual_step_required === true,
    ready_for_manual_paste: plan.ready_for_manual_paste === true,
    prepared_stage_ready: plan.prepared_stage_ready === true,
    prepared_file_path: plan.prepared_file_path || null,
    latest_generated_file_path: plan.latest_generated_file_path || null,
    rollback_source_file_path: plan.rollback_source_file_path || null,
    blockers: Array.isArray(plan.blockers) ? plan.blockers : [],
  };
}

function pushPlanStep(steps = [], message) {
  const line = String(message || "").trim();
  if (!line) return;
  if (!steps.includes(line)) steps.push(line);
}

function buildSupervisorActionPlan({
  reason = null,
  blockers = [],
  promotionCandidateId = null,
  promotionReplay = null,
  deployment = null,
  deploymentPlan = null,
  governanceEnoughSample = false,
  codexFresh = false,
  stageAutopilotFresh = false,
  retrospective = null,
} = {}) {
  const steps = [];
  const blockerSet = new Set(Array.isArray(blockers) ? blockers : []);
  const deploymentSummary = deployment && typeof deployment === "object" ? deployment : {};
  const deploymentPlanSummary = deploymentPlan && typeof deploymentPlan === "object" ? deploymentPlan : {};

  if (blockerSet.has("DAILY_NO_TRADE_ACTIVITY")) {
    const dailyExecuted = retrospective && retrospective.daily && retrospective.daily.executed_n != null
      ? retrospective.daily.executed_n
      : "N/A";
    pushPlanStep(steps, `Run the loop after real trade activity resumes or move the schedule into active trading hours (retrospective daily executed_n=${dailyExecuted}).`);
  }
  if (blockerSet.has("ZERO_KRW_IDLE")) {
    pushPlanStep(steps, "Restore idle KRW balance before expecting new validation trades.");
  }
  if (blockerSet.has("MONTHLY_TARGET_NOT_MET") || blockerSet.has("OBJECTIVE_NOT_MET") || blockerSet.has("RETROSPECTIVE_MONTHLY_FAIL")) {
    pushPlanStep(steps, "Use the current replay/canary-ready candidate set to recover objective performance before promotion.");
  }
  if (blockerSet.has("SELF_EVOLUTION_REPLAY_BLOCK") || blockerSet.has("SELF_EVOLUTION_REPLAY_NOT_PASS")) {
    pushPlanStep(
      steps,
      `Resolve replay blockers for ${promotionCandidateId || "the promotion candidate"}: ${Array.isArray(promotionReplay && promotionReplay.blockers) && promotionReplay.blockers.length ? promotionReplay.blockers.join(", ") : "validation_verdict is not PASS"}.`
    );
  }
  if (Array.isArray(deploymentSummary.next_actions)) {
    deploymentSummary.next_actions.forEach((row) => pushPlanStep(steps, row));
  }
  if (deploymentPlanSummary.prepare_pass !== true && Array.isArray(deploymentPlanSummary.next_actions)) {
    deploymentPlanSummary.next_actions.forEach((row) => pushPlanStep(steps, row));
  }
  if ((reason === "CODEX_REVIEW_REQUIRED_PROMOTION" || reason === "CODEX_REVIEW_REQUIRED_ROLLBACK") && !codexFresh) {
    pushPlanStep(steps, "Refresh Codex review for the current cycle before promotion or rollback.");
  }
  if ((reason === "STAGE_AUTOPILOT_REQUIRED_PROMOTION" || reason === "STAGE_AUTOPILOT_REQUIRED_ROLLBACK") && !stageAutopilotFresh) {
    pushPlanStep(steps, "Refresh stage autopilot for the current cycle before promotion or rollback.");
  }
  if (reason === "GOVERNANCE_OBJECTIVE_SAMPLE_NOT_READY" && governanceEnoughSample !== true) {
    pushPlanStep(steps, "Wait for more realized governance trades or increase the effective governance sample source.");
  }
  if (!steps.length && reason) {
    pushPlanStep(steps, `Review the blocker '${reason}' and clear the highest-priority gate before the next loop.`);
  }
  return steps;
}

function formatBestFebtMarketContractLine(row = {}) {
  const market = String(row.market || "UNKNOWN");
  const replacement = row.projected_replacement_ratio != null ? pct(row.projected_replacement_ratio) : "N/A";
  const count = row.projected_count_ratio_global != null ? `${Number(row.projected_count_ratio_global).toFixed(2)}x` : "N/A";
  return `${market} ${row.mode || "N/A"} / replacement ${replacement} / count ${count} / fire ${row.fire_n ?? 0} / late ${row.late_n ?? 0} / disagree ${row.disagreement_n ?? 0} / reason ${row.dominant_disagreement_reason || "N/A"}`;
}

function buildFilterLayerSummary({ governance, changeControl, ml, ev, wait, physicsSummary } = {}) {
  const current = governance && governance.current && typeof governance.current === "object" ? governance.current : {};
  const patchCandidates = current && current.pine_stage1_patch_candidates && typeof current.pine_stage1_patch_candidates === "object"
    ? current.pine_stage1_patch_candidates
    : {};
  const leadCandidate = Array.isArray(patchCandidates.candidates) ? patchCandidates.candidates[0] || null : null;
  const featureBreakdown = current
    && current.drop_counterfactual
    && current.drop_counterfactual.feature_breakdown
    && typeof current.drop_counterfactual.feature_breakdown === "object"
      ? current.drop_counterfactual.feature_breakdown
      : {};
  const waitPhysics = physicsSummary && physicsSummary.wait_hard
    ? "HARD"
    : (physicsSummary && physicsSummary.wait_assist ? "ASSIST" : "ALLOW");
  const qualityByTier = current && current.quality && current.quality.by_tier && typeof current.quality.by_tier === "object"
    ? current.quality.by_tier
    : {};
  const febtShadow = summarizeFebtByTier(qualityByTier);
  const evReasonRaw = String(ev && ev.decision_reason || "N/A");
  const evFresh = ev ? ev.fresh !== false : true;
  return {
    integrity: {
      label: "1차 상태/무결성",
      server_mode: String(leadCandidate && leadCandidate.server_stage1_mode || "INTEGRITY_GUARD_ONLY"),
      expectation: String(leadCandidate && leadCandidate.server_stage1_expectation || "N/A"),
      coverage_pass: Boolean(changeControl && changeControl.coverage_guard && changeControl.coverage_guard.pass === true),
    },
    entry_quality: {
      label: "2차 진입 품질",
      pine_candidate_verdict: String(patchCandidates.verdict || "N/A"),
      quality_actions: Array.isArray(ml && ml.recommendations && ml.recommendations.QUALITY) ? ml.recommendations.QUALITY.length : 0,
    },
    state_soft_sizing: {
      label: "3차 상태 기반 Soft Sizing",
      ml_action: String(ml && ml.recommendations && ml.recommendations.MARKET && ml.recommendations.MARKET.action || "N/A"),
      physics_action: String(physicsSummary && physicsSummary.action || "ALLOW"),
      qty_scale: Number.isFinite(Number(physicsSummary && physicsSummary.qty_scale)) ? Number(physicsSummary.qty_scale) : null,
      dominant_state: topBreakdownValue(featureBreakdown.market_state),
      dominant_action: topBreakdownValue(featureBreakdown.market_action),
    },
    ev_time_value: {
      label: "4차 EV/시간가치층",
      tuner_reason: evFresh ? evReasonRaw : "STALE_ARTIFACT",
      observed_tuner_reason: evReasonRaw,
      fresh: evFresh,
      age_hours: toNum(ev && ev.age_hours),
      policy_version: evFresh ? topBreakdownValue(featureBreakdown.ev_policy_version) : "STALE_ARTIFACT",
      policy_source: evFresh ? topBreakdownValue(featureBreakdown.ev_policy_source) : "STALE_TUNER_ARTIFACT",
    },
    wait_timing: {
      label: "5차 WAIT 타이밍층",
      tuner_reason: String(wait && wait.reason || "N/A"),
      wait_action: waitPhysics,
      febt_calc_ok_rate: febtShadow.calc_ok_rate,
      febt_phase_known: febtShadow.phase_known,
      febt_fire_n: febtShadow.fire,
      febt_late_n: febtShadow.late,
      febt_void_n: febtShadow.void_n,
      febt_disagreement_n: febtShadow.disagreement,
      febt_fallback_legacy_n: febtShadow.fallback_legacy,
      febt_missing_rate: febtShadow.missing_rate,
    },
  };
}

function buildObjectiveSupervisorTelegramSections(report = {}) {
  const blockersLine = Array.isArray(report.blockers) && report.blockers.length
    ? report.blockers.slice(0, 4).join(", ")
    : "없음";
  const physicsWait = report.physics && report.physics.wait_hard
    ? "HARD"
    : (report.physics && report.physics.wait_assist ? "ASSIST" : "ALLOW");
  return [
    {
      header: "지금 결론",
      lines: [
        `자동화는 지금 '${report.verdict}' 상태입니다. 주된 이유는 '${report.reason}' 입니다.`,
        `현재 차단 사유 ${blockersLine}`,
      ],
    },
    {
      header: "목표 달성 상태",
      lines: [
        `현재 실현 표본 ${report.objective.realized_n ?? "정보 없음"}건, 실행 ${report.objective.executed_n ?? "정보 없음"}건, 월간 예상 수익 ${signedNum(report.objective.monthly_run_rate_krw, 0)} KRW, 목표 ${signedNum(report.objective.min_monthly_net_krw, 0)} KRW`,
      ],
    },
    {
      header: "최근 회고",
      lines: [
        `오늘 ${report.retrospective.daily.verdict}, 실행 ${report.retrospective.daily.executed_n ?? "정보 없음"}건, 실현 ${report.retrospective.daily.realized_n ?? "정보 없음"}건, 손익 ${signedNum(report.retrospective.daily.net_pnl_quote, 0)} KRW`,
        `주간 ${report.retrospective.weekly.verdict} / 월간 ${report.retrospective.monthly.verdict}`,
      ],
    },
    {
      header: "자동 변경 가능 여부",
      lines: [
        `변경 승격 ${report.promotion.ready ? "가능" : "보류"} / 사유 ${report.promotion.reason} / 후보 ${report.promotion.display_candidate_id || report.promotion.candidate_id || "정보 없음"}`,
        `자동 롤백 ${report.rollback.ready ? "가능" : "보류"} / 사유 ${report.rollback.reason}`,
      ],
    },
    {
      header: "안전 장치",
      lines: [
        `검증 ${report.guards.canary_pass ? "정상" : "차단"} / golden drift ${report.guards.canary_golden_drift} / shadow drift ${report.guards.canary_shadow_drift}`,
        `데이터 커버리지 ${report.guards.coverage_pass ? "충분" : "부족"}`,
      ],
    },
    {
      header: "필터 계층",
      lines: [
        `1차 상태/무결성 ${report.filter_layers && report.filter_layers.integrity ? `${report.filter_layers.integrity.server_mode} / coverage ${report.filter_layers.integrity.coverage_pass ? "PASS" : "BLOCK"}` : "N/A"}`,
        `2차 진입 품질 ${report.filter_layers && report.filter_layers.entry_quality ? `candidate ${report.filter_layers.entry_quality.pine_candidate_verdict} / ml quality ${report.filter_layers.entry_quality.quality_actions}` : "N/A"}`,
        `3차 상태 기반 Soft Sizing ${report.filter_layers && report.filter_layers.state_soft_sizing ? `${report.filter_layers.state_soft_sizing.ml_action} / physics ${report.filter_layers.state_soft_sizing.physics_action} / qty ${report.filter_layers.state_soft_sizing.qty_scale != null ? report.filter_layers.state_soft_sizing.qty_scale : "N/A"}` : "N/A"}`,
        `4차 EV/시간가치층 ${report.filter_layers && report.filter_layers.ev_time_value ? `${report.filter_layers.ev_time_value.tuner_reason} / policy ${report.filter_layers.ev_time_value.policy_version || "N/A"} / source ${report.filter_layers.ev_time_value.policy_source || "N/A"}` : "N/A"}`,
        `5차 WAIT 타이밍층 ${report.filter_layers && report.filter_layers.wait_timing ? `${report.filter_layers.wait_timing.tuner_reason} / ${report.filter_layers.wait_timing.wait_action} / FEBT calc ${pct(report.filter_layers.wait_timing.febt_calc_ok_rate)} / phase_known ${pct(report.filter_layers.wait_timing.febt_phase_known)} / fire ${report.filter_layers.wait_timing.febt_fire_n ?? 0} / late ${report.filter_layers.wait_timing.febt_late_n ?? 0} / void ${report.filter_layers.wait_timing.febt_void_n ?? 0} / disagree ${report.filter_layers.wait_timing.febt_disagreement_n ?? 0} / fallback ${report.filter_layers.wait_timing.febt_fallback_legacy_n ?? 0} / missing ${pct(report.filter_layers.wait_timing.febt_missing_rate)}` : "N/A"}`,
      ],
    },
    {
      header: "상태층(시장 물리)",
      lines: [
        `상태 ${report.physics.display_state || "정보 없음"} / action ${report.physics.action || "N/A"} / qty ${report.physics.qty_scale != null ? report.physics.qty_scale : "N/A"} / wait ${physicsWait} / 차단 ${report.physics.block_reason || "없음"}`,
        `entropy ${pct(report.physics.entropy)} / coherence ${pct(report.physics.coherence)} / transition ${pct(report.physics.transition_risk)} / align ${pct(report.physics.field_alignment)} / wall ${pct(report.physics.domain_wall_density)} / free ${pct(report.physics.free_energy)}`,
      ],
    },
    {
      header: "FEBT Phase 0",
      lines: [
        `legacy WAIT coverage ${report.phase0 && report.phase0.legacy_wait_coverage_rate != null ? pct(report.phase0.legacy_wait_coverage_rate) : "N/A"} / observed ${report.phase0 && report.phase0.legacy_wait_observed_chain_n != null ? report.phase0.legacy_wait_observed_chain_n : "N/A"}`,
        `legacy WAIT immediate win ${report.phase0 && report.phase0.immediate_win_rate != null ? pct(report.phase0.immediate_win_rate) : "N/A"} / saved_loss ${report.phase0 && report.phase0.saved_loss_pct != null ? pct(report.phase0.saved_loss_pct) : "N/A"} / missed_gain ${report.phase0 && report.phase0.missed_gain_pct != null ? pct(report.phase0.missed_gain_pct) : "N/A"} / delta ${report.phase0 && report.phase0.saved_loss_minus_missed_gain != null ? signedPct(report.phase0.saved_loss_minus_missed_gain) : "N/A"}`,
        `bridge webhook->fill p95 ${report.phase0 && report.phase0.webhook_to_fill_p95_ms != null ? `${Number(report.phase0.webhook_to_fill_p95_ms).toFixed(0)}ms` : "N/A"} / dup ${report.phase0 && report.phase0.duplicate_count != null ? report.phase0.duplicate_count : "N/A"} / reject ${report.phase0 && report.phase0.reject_count != null ? report.phase0.reject_count : "N/A"} / fresh ${report.phase0 && report.phase0.fresh ? "YES" : "NO"}`,
      ],
    },
    {
      header: "BEST/FEBT 공통 계약",
      lines: [
        `mode ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.mode || "N/A"} / tightening ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.tightening_allowed ? "ALLOW" : "BLOCK"} / recovery ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.recovery_priority ? "FIRST" : "NORMAL"}`,
        `replacement ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.projected_replacement_ratio != null ? pct(report.best_febt_tuning_contract.projected_replacement_ratio) : "N/A"} / count ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.projected_count_ratio_global != null ? `${Number(report.best_febt_tuning_contract.projected_count_ratio_global).toFixed(2)}x` : "N/A"} / net delta ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.projected_net_signal_delta_n != null ? report.best_febt_tuning_contract.projected_net_signal_delta_n : "N/A"}`,
        `fire ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.fire_n != null ? report.best_febt_tuning_contract.fire_n : "N/A"} / late ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.late_n != null ? report.best_febt_tuning_contract.late_n : "N/A"} / disagree ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.disagreement_n != null ? report.best_febt_tuning_contract.disagreement_n : "N/A"} / fallback ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.fallback_legacy_n != null ? report.best_febt_tuning_contract.fallback_legacy_n : "N/A"}`,
      ],
    },
    {
      header: "자기 진화 정책",
      lines: [
        `master ${report.self_evolution_policy && report.self_evolution_policy.master_spec_path || "N/A"}`,
        `focus ${report.self_evolution_policy && report.self_evolution_policy.current_focus || "N/A"} / docs ${report.self_evolution_policy && Array.isArray(report.self_evolution_policy.linked_paths) ? report.self_evolution_policy.linked_paths.length : 0}`,
      ],
    },
    {
      header: "자기 진화 데이터셋",
      lines: [
        `rows ${report.self_evolution_dataset && report.self_evolution_dataset.rows_n != null ? report.self_evolution_dataset.rows_n : "N/A"} / executed ${report.self_evolution_dataset && report.self_evolution_dataset.executed_n != null ? report.self_evolution_dataset.executed_n : "N/A"} / drop ${report.self_evolution_dataset && report.self_evolution_dataset.drop_n != null ? report.self_evolution_dataset.drop_n : "N/A"} / missed ${report.self_evolution_dataset && report.self_evolution_dataset.missed_n != null ? report.self_evolution_dataset.missed_n : "N/A"}`,
        `fallback ${report.self_evolution_dataset && report.self_evolution_dataset.fallback_n != null ? report.self_evolution_dataset.fallback_n : "N/A"} / rejected ${report.self_evolution_dataset && report.self_evolution_dataset.rejected_n != null ? report.self_evolution_dataset.rejected_n : "N/A"} / partial ${report.self_evolution_dataset && report.self_evolution_dataset.partial_n != null ? report.self_evolution_dataset.partial_n : "N/A"}`,
        `features ${report.self_evolution_dataset && report.self_evolution_dataset.features_coverage_rate != null ? pct(report.self_evolution_dataset.features_coverage_rate) : "N/A"} / FEBT ${report.self_evolution_dataset && report.self_evolution_dataset.febt_coverage_rate != null ? pct(report.self_evolution_dataset.febt_coverage_rate) : "N/A"} / avg_ret ${report.self_evolution_dataset && report.self_evolution_dataset.avg_realized_ret_net != null ? signedPct(report.self_evolution_dataset.avg_realized_ret_net) : "N/A"}`,
      ],
    },
    {
      header: "자기 진화 목적함수",
      lines: [
        `score ${report.self_evolution_objective && report.self_evolution_objective.objective_score != null ? signedNum(report.self_evolution_objective.objective_score, 4) : "N/A"} / count ${report.self_evolution_objective && report.self_evolution_objective.count_floor_pass === true ? "PASS" : (report.self_evolution_objective && report.self_evolution_objective.count_floor_pass === false ? "FAIL" : "N/A")} / replacement ${report.self_evolution_objective && report.self_evolution_objective.replacement_floor_pass === true ? "PASS" : (report.self_evolution_objective && report.self_evolution_objective.replacement_floor_pass === false ? "FAIL" : "N/A")} / latency ${report.self_evolution_objective && report.self_evolution_objective.latency_budget_pass === true ? "PASS" : (report.self_evolution_objective && report.self_evolution_objective.latency_budget_pass === false ? "FAIL" : "N/A")}`,
        `fire win ${report.self_evolution_objective && report.self_evolution_objective.fire_win_rate != null ? pct(report.self_evolution_objective.fire_win_rate) : "N/A"} / tp1 ${report.self_evolution_objective && report.self_evolution_objective.tp1_first_rate != null ? pct(report.self_evolution_objective.tp1_first_rate) : "N/A"} / count ${report.self_evolution_objective && report.self_evolution_objective.projected_count_ratio_global != null ? `${Number(report.self_evolution_objective.projected_count_ratio_global).toFixed(2)}x` : "N/A"} / replacement ${report.self_evolution_objective && report.self_evolution_objective.projected_replacement_ratio != null ? pct(report.self_evolution_objective.projected_replacement_ratio) : "N/A"}`,
        `top ${report.self_evolution_objective && report.self_evolution_objective.top_market ? `${report.self_evolution_objective.top_market.market} ${signedNum(report.self_evolution_objective.top_market.objective_score, 3)}` : "N/A"} / bottom ${report.self_evolution_objective && report.self_evolution_objective.bottom_market ? `${report.self_evolution_objective.bottom_market.market} ${signedNum(report.self_evolution_objective.bottom_market.objective_score, 3)}` : "N/A"}`,
        `dominant drag ${report.self_evolution_objective && report.self_evolution_objective.market_concentration && report.self_evolution_objective.market_concentration.dominant_negative_market ? `${report.self_evolution_objective.market_concentration.dominant_negative_market.market} share ${pct(report.self_evolution_objective.market_concentration.dominant_negative_share)} / ex-bottom ${signedNum(report.self_evolution_objective.market_concentration.objective_score_ex_bottom_market, 3)}` : "N/A"}`,
      ],
    },
    {
      header: "자기 진화 원인분해",
      lines: [
        `drop top layer ${report.self_evolution_attribution && report.self_evolution_attribution.drop_top_layer ? `${report.self_evolution_attribution.drop_top_layer.key} ${report.self_evolution_attribution.drop_top_layer.count}` : "N/A"}`,
        `late loss top market ${report.self_evolution_attribution && report.self_evolution_attribution.late_loss_top_market ? `${report.self_evolution_attribution.late_loss_top_market.key} ${report.self_evolution_attribution.late_loss_top_market.count}` : "N/A"} / false fire ${report.self_evolution_attribution && report.self_evolution_attribution.false_fire_top_market ? `${report.self_evolution_attribution.false_fire_top_market.key} ${report.self_evolution_attribution.false_fire_top_market.count}` : "N/A"}`,
        `missed recovery ${report.self_evolution_attribution && report.self_evolution_attribution.missed_recovery_top_reason ? `${report.self_evolution_attribution.missed_recovery_top_reason.key} ${report.self_evolution_attribution.missed_recovery_top_reason.count}` : "N/A"} / fallback cost ${report.self_evolution_attribution && report.self_evolution_attribution.fallback_cost_top_market ? `${report.self_evolution_attribution.fallback_cost_top_market.key} ${report.self_evolution_attribution.fallback_cost_top_market.count}` : "N/A"}`,
      ],
    },
    {
      header: "자기 진화 후보",
      lines: [
        `total ${report.self_evolution_candidates && report.self_evolution_candidates.total_n != null ? report.self_evolution_candidates.total_n : "N/A"} / ready ${report.self_evolution_candidates && report.self_evolution_candidates.ready_n != null ? report.self_evolution_candidates.ready_n : "N/A"} / blocked ${report.self_evolution_candidates && report.self_evolution_candidates.blocked_n != null ? report.self_evolution_candidates.blocked_n : "N/A"}`,
        `top candidate ${report.self_evolution_candidates && report.self_evolution_candidates.top_candidate_id || "N/A"} / scope ${report.self_evolution_candidates && report.self_evolution_candidates.top_scope || "N/A"}`,
      ],
    },
    {
      header: "자기 진화 리플레이",
      lines: [
        `mode ${report.self_evolution_replay && report.self_evolution_replay.validation_mode || "N/A"} / pass ${report.self_evolution_replay && report.self_evolution_replay.pass_n != null ? report.self_evolution_replay.pass_n : "N/A"} / warn ${report.self_evolution_replay && report.self_evolution_replay.warn_n != null ? report.self_evolution_replay.warn_n : "N/A"} / block ${report.self_evolution_replay && report.self_evolution_replay.block_n != null ? report.self_evolution_replay.block_n : "N/A"}`,
        `best ${report.self_evolution_replay && report.self_evolution_replay.best_candidate_id || "N/A"} / verdict ${report.self_evolution_replay && report.self_evolution_replay.best_verdict || "N/A"} / delta ${report.self_evolution_replay && report.self_evolution_replay.best_objective_delta != null ? signedNum(report.self_evolution_replay.best_objective_delta, 4) : "N/A"}`,
      ],
    },
    {
      header: "자기 진화 canary",
      lines: [
        `total ${report.self_evolution_canary && report.self_evolution_canary.total_n != null ? report.self_evolution_canary.total_n : "N/A"} / shadow ${report.self_evolution_canary && report.self_evolution_canary.shadow_n != null ? report.self_evolution_canary.shadow_n : "N/A"} / soft ${report.self_evolution_canary && report.self_evolution_canary.soft_n != null ? report.self_evolution_canary.soft_n : "N/A"} / hard ${report.self_evolution_canary && report.self_evolution_canary.hard_n != null ? report.self_evolution_canary.hard_n : "N/A"}`,
        `ready ${report.self_evolution_canary && report.self_evolution_canary.ready_n != null ? report.self_evolution_canary.ready_n : "N/A"} / blocked ${report.self_evolution_canary && report.self_evolution_canary.blocked_n != null ? report.self_evolution_canary.blocked_n : "N/A"} / rollback ${report.self_evolution_canary && report.self_evolution_canary.rollback_ready_n != null ? report.self_evolution_canary.rollback_ready_n : "N/A"} / apply ${report.self_evolution_canary && report.self_evolution_canary.apply_pass ? "PASS" : "BLOCK"}`,
        `top ready ${report.self_evolution_canary && report.self_evolution_canary.top_ready_market || "N/A"} / top rollback ${report.self_evolution_canary && report.self_evolution_canary.top_rollback_market || "N/A"}`,
      ],
    },
    {
      header: "자기 진화 배포 가드",
      lines: [
        `target ${report.self_evolution_deployment && report.self_evolution_deployment.target_candidate_id || "N/A"} / deploy ${report.self_evolution_deployment && report.self_evolution_deployment.deploy_pass ? "PASS" : "BLOCK"} / rollback_only ${report.self_evolution_deployment && report.self_evolution_deployment.rollback_only ? "YES" : "NO"}`,
        `replay ${report.self_evolution_deployment && report.self_evolution_deployment.replay_verdict || "N/A"} / open wave ${report.self_evolution_deployment && report.self_evolution_deployment.canary_open_wave != null ? report.self_evolution_deployment.canary_open_wave : "N/A"} / markets ${report.self_evolution_deployment && report.self_evolution_deployment.market_ready_n != null ? report.self_evolution_deployment.market_ready_n : "N/A"} / ${report.self_evolution_deployment && report.self_evolution_deployment.market_total_n != null ? report.self_evolution_deployment.market_total_n : "N/A"}`,
        `blockers ${report.self_evolution_deployment && Array.isArray(report.self_evolution_deployment.blockers) && report.self_evolution_deployment.blockers.length ? report.self_evolution_deployment.blockers.join("|") : "none"}`,
      ],
    },
    {
      header: "자기 진화 배포 handoff",
      lines: [
        `status ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.plan_status || "N/A"} / prepare ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.prepare_pass ? "PASS" : "BLOCK"} / manual ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.manual_step_required ? "YES" : "NO"}`,
        `file ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.prepared_file_path || report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.latest_generated_file_path || "N/A"} / rollback ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.rollback_source_file_path || "N/A"}`,
      ],
    },
    {
      header: "자기 진화 루프 모니터",
      lines: [
        `cycle ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.cycle_id || "N/A"} / status ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.overall_status || "N/A"} / consistent ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.cycle_consistent ? "YES" : "NO"}`,
        `fresh ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.fresh_loop_n != null ? report.self_evolution_loop_monitor.fresh_loop_n : "N/A"} / ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.loop_n != null ? report.self_evolution_loop_monitor.loop_n : "N/A"} / promotion ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.promotion_path_ready ? "YES" : "NO"} / manual ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.manual_paste_ready ? "YES" : "NO"}`,
        `blockers ${report.self_evolution_loop_monitor && Array.isArray(report.self_evolution_loop_monitor.critical_blockers) && report.self_evolution_loop_monitor.critical_blockers.length ? report.self_evolution_loop_monitor.critical_blockers.join("|") : "none"}`,
      ],
    },
    {
      header: "자기 진화 가중치 튜닝",
      lines: [
        `mode ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.advisory_mode || "N/A"} / suggestion ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.suggestion_n != null ? report.self_evolution_weight_tuning.summary.suggestion_n : "N/A"} / dominant ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.dominant_axis || "N/A"}`,
        `count ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.count_guard_blocked ? "BLOCK" : "PASS"} / memory ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.memory_blocked ? "BLOCK" : "PASS"} / canary ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.canary_blocked ? "BLOCK" : "PASS"}`,
      ],
    },
    {
      header: "자기 진화 메모리",
      lines: [
        `total ${report.self_evolution_memory && report.self_evolution_memory.total_n != null ? report.self_evolution_memory.total_n : "N/A"} / current ${report.self_evolution_memory && report.self_evolution_memory.current_n != null ? report.self_evolution_memory.current_n : "N/A"} / blocked ${report.self_evolution_memory && report.self_evolution_memory.blocked_candidate_n != null ? report.self_evolution_memory.blocked_candidate_n : "N/A"}`,
        `success ${report.self_evolution_memory && report.self_evolution_memory.success_n != null ? report.self_evolution_memory.success_n : "N/A"} / fail ${report.self_evolution_memory && report.self_evolution_memory.fail_n != null ? report.self_evolution_memory.fail_n : "N/A"} / rolled_back ${report.self_evolution_memory && report.self_evolution_memory.rolled_back_n != null ? report.self_evolution_memory.rolled_back_n : "N/A"}`,
        `top success ${report.self_evolution_memory && report.self_evolution_memory.top_success_candidate_id || "N/A"} / top failed ${report.self_evolution_memory && report.self_evolution_memory.top_failed_candidate_id || "N/A"}`,
      ],
    },
    {
      header: "시장별 BEST/FEBT 계약",
      lines: Array.isArray(report.best_febt_market_contracts) && report.best_febt_market_contracts.length
        ? report.best_febt_market_contracts.slice(0, 4).map((row) => formatBestFebtMarketContractLine(row))
        : ["시장별 계약 없음"],
    },
    {
      header: "Codex 검토",
      lines: [
        `상태 ${report.codex_review.status} / 결론 ${report.codex_review.verdict} / 사유 ${report.codex_review.reason}`,
      ],
    },
    {
      header: "Codex 권한",
      lines: [
        `owner ${report.codex_authority && report.codex_authority.owner || "N/A"} / mode ${report.codex_authority && report.codex_authority.authority_mode || "N/A"} / verdict ${report.codex_authority && report.codex_authority.verdict || "N/A"}`,
        `manual ${report.codex_authority && report.codex_authority.manual_step_required ? "YES" : "NO"} / file ${report.codex_authority && report.codex_authority.prepared_file_path || report.codex_authority && report.codex_authority.latest_generated_file_path || "N/A"}`,
      ],
    },
    {
      header: "자동 적용 엔진",
      lines: [
        `상태 ${report.stage_autopilot.status} / 목표 판정 ${report.stage_autopilot.objective_verdict}`,
        `이번 실행에서 실제 반영된 변경 ${report.stage_autopilot.action_n}건 / ${(report.stage_autopilot.action_types || []).join(", ") || "없음"}`,
      ],
    },
  ];
}

function evaluateSupervisor({ governance, changeControl, canary, ml, ev, wait, phase0, selfEvolutionDataset, selfEvolutionObjective, selfEvolutionAttribution, selfEvolutionCandidates, selfEvolutionReplay, selfEvolutionCanary, selfEvolutionMemory, selfEvolutionLoopMonitor, selfEvolutionCycleState, codex, stageAutopilot, retrospective, weeklyHistory } = {}) {
  const objective = governance && governance.current && governance.current.objective ? governance.current.objective : {};
  const objectiveCfg = governance && governance.objective ? governance.objective : {};
  const promotion = changeControl && changeControl.auto_promotion ? changeControl.auto_promotion : {};
  const rollback = changeControl && changeControl.auto_rollback ? changeControl.auto_rollback : {};
  const canarySummary = canary && canary.shadow && canary.shadow.summary ? canary.shadow.summary : {};
  const canaryGolden = canary && canary.golden && canary.golden.summary ? canary.golden.summary : {};
  const codexVerdict = String(codex && codex.verdict || "HOLD").toUpperCase();
  const codexStatus = String(codex && codex.status || "N/A").toUpperCase();
  const codexCandidateId = String(codex && codex.recommended_candidate_id || "").trim() || null;
  const codexDisplayCandidateId = resolveDisplayCandidateId(codexCandidateId, changeControl);
  const codexRollbackPath = String(codex && codex.recommended_rollback_file_path || "").trim() || null;
  const codexFresh = Boolean(codex && (codex.fresh === true || codexStatus === "FRESH" || codexStatus === "SKIPPED"));
  const codexDisplayStatus = codexStatus === "FAILED"
    ? "FAILED"
    : (codexFresh ? "FRESH" : (codex ? "STALE" : "N/A"));
  const stageAutopilotStatus = String(stageAutopilot && stageAutopilot.status || "").toUpperCase();
  const stageAutopilotFresh = Boolean(stageAutopilot && (stageAutopilot.fresh === true || stageAutopilotStatus === "FRESH"));
  const retrospectiveSummary = summarizeRetrospective(retrospective);
  const physicsSummary = summarizeGovernancePhysics(governance);
  const filterLayers = buildFilterLayerSummary({
    governance,
    changeControl,
    ml,
    ev,
    wait,
    physicsSummary,
  });
  const phase0Summary = {
    available: !!phase0,
    fresh: Boolean(phase0 && phase0.fresh === true),
    provider: String(phase0 && phase0.provider || "N/A"),
    tf: String(phase0 && phase0.tf || "N/A"),
    legacy_wait_coverage_rate: toNum(phase0 && phase0.legacy_wait_baseline && phase0.legacy_wait_baseline.legacy_wait_coverage_rate),
    legacy_wait_observed_chain_n: toNum(phase0 && phase0.legacy_wait_baseline && phase0.legacy_wait_baseline.legacy_wait_observed_chain_n),
    immediate_win_rate: toNum(phase0 && phase0.legacy_wait_baseline && phase0.legacy_wait_baseline.immediate_win_rate),
    saved_loss_pct: toNum(phase0 && phase0.legacy_wait_baseline && phase0.legacy_wait_baseline.saved_loss_pct),
    missed_gain_pct: toNum(phase0 && phase0.legacy_wait_baseline && phase0.legacy_wait_baseline.missed_gain_pct),
    saved_loss_minus_missed_gain: toNum(phase0 && phase0.legacy_wait_baseline && phase0.legacy_wait_baseline.saved_loss_minus_missed_gain),
    webhook_to_fill_p95_ms: toNum(phase0 && phase0.bridge_latency && phase0.bridge_latency.webhook_to_fill_ms && phase0.bridge_latency.webhook_to_fill_ms.p95),
    duplicate_count: toNum(phase0 && phase0.bridge_latency && phase0.bridge_latency.duplicate_count) || 0,
    reject_count: toNum(phase0 && phase0.bridge_latency && phase0.bridge_latency.reject_count) || 0,
  };
  const bestFebtTuningContract = deriveBestFebtTuningContract({
    governance,
    objectiveSupervisor: {
      verdict: null,
      filter_layers: filterLayers,
      phase0: phase0Summary,
    },
  });
  const bestFebtMarketContracts = deriveBestFebtMarketContracts({
    governance,
    objectiveSupervisor: {
      verdict: null,
      filter_layers: filterLayers,
      phase0: phase0Summary,
    },
  });
  const selfEvolutionPolicy = buildSelfEvolutionPolicySpec();
  const selfEvolutionDatasetSummary = summarizeSelfEvolutionDataset(selfEvolutionDataset);
  const selfEvolutionObjectiveSummary = summarizeSelfEvolutionObjective(
    selfEvolutionObjective || {
      global_objective_score: deriveDatasetObjectiveScore({
        dataset: selfEvolutionDataset,
        governance,
        phase0,
        tuningContract: bestFebtTuningContract,
      }),
      market_objective_scores: deriveMarketObjectiveScores({
        dataset: selfEvolutionDataset,
        governance,
        phase0,
        marketContracts: bestFebtMarketContracts,
      }),
    }
  );
  const selfEvolutionAttributionSummary = summarizeSelfEvolutionAttribution(
    selfEvolutionAttribution || {
      attribution: deriveAttribution({ dataset: selfEvolutionDataset }),
    }
  );
  const selfEvolutionCandidatesSummary = summarizeSelfEvolutionCandidates(selfEvolutionCandidates);
  const selfEvolutionReplaySummary = summarizeSelfEvolutionReplay(selfEvolutionReplay);
  const selfEvolutionCanarySummary = summarizeSelfEvolutionCanary(selfEvolutionCanary);
  const selfEvolutionMemorySummary = summarizeSelfEvolutionMemory(selfEvolutionMemory);
  const selfEvolutionDeploymentReport = deriveDeploymentGuards({
    objectiveSupervisor: {
      guards: {
        canary_pass: Boolean(canary && canarySummary.drift === 0 && canaryGolden.drift === 0),
      },
      promotion,
      rollback,
      self_evolution_objective: selfEvolutionObjectiveSummary,
    },
    candidateChangeSet: selfEvolutionCandidates,
    replayReport: selfEvolutionReplay,
    canaryReport: selfEvolutionCanary,
    memoryLedger: selfEvolutionMemory,
  });
  const selfEvolutionDeploymentSummary = summarizeSelfEvolutionDeployment(selfEvolutionDeploymentReport);
  const selfEvolutionDeploymentPlanSummary = summarizeSelfEvolutionDeploymentPlan(deriveDeploymentPlan({
    objectiveSupervisor: {
      promotion,
      rollback,
      self_evolution_deployment: selfEvolutionDeploymentSummary,
    },
    changeControl,
    codexPatchReview: codex,
    deploymentGuards: selfEvolutionDeploymentReport,
    canaryReport: selfEvolutionCanary,
    stageAutopilot,
    weeklyHistory,
  }));
  const selfEvolutionWeightTuning = deriveWeightTuningPlan({
    objective: selfEvolutionObjectiveSummary,
    attribution: selfEvolutionAttributionSummary,
    canary: selfEvolutionCanarySummary,
    memoryLedger: selfEvolutionMemorySummary,
  });
  const governanceRealizedMinSample = resolveGovernanceRealizedMinSample(governance, objective);
  const governanceStrictRealizedN = toNum(objective.realized_n) || 0;
  const governanceMonthlySourceRealizedN = toNum(objective.monthly_source_realized_n) || 0;
  const governanceEffectiveRealizedN = Math.max(governanceStrictRealizedN, governanceMonthlySourceRealizedN);
  const governanceStrictSampleReady = objective.enough_sample === true;
  const governanceSampleReady = governanceStrictSampleReady || governanceEffectiveRealizedN >= governanceRealizedMinSample;
  const governanceFailedChecks = normalizeGovernanceFailedChecks(objective.failed_checks, {
    strictEnoughSample: governanceStrictSampleReady,
    effectiveEnoughSample: governanceSampleReady,
  });
  const selfEvolutionRealizedMinSample = resolveSelfEvolutionRealizedMinSample();
  const selfEvolutionSampleReady = Number(selfEvolutionObjectiveSummary.realized_n || 0) >= selfEvolutionRealizedMinSample;
  const selfEvolutionCycleSummary = selfEvolutionCycleState && typeof selfEvolutionCycleState === "object"
    ? selfEvolutionCycleState
    : { available: false, cycle_consistent: true, cycle_mismatch_n: 0, missing_key_n: 0, cycle_id_absent_n: 0, missing_keys: [], cycle_mismatches: [], cycle_id_absent_keys: [] };
  const selfEvolutionLoopMonitorSummary = summarizeSelfEvolutionLoopMonitor(selfEvolutionLoopMonitor);
  const memoryBlockedIds = new Set(selfEvolutionMemorySummary.blocked_candidate_ids || []);
  const changeControlRelevant = promotion.ready === true || rollback.ready === true;

  const blockers = [];
  if (!objective || governanceSampleReady !== true) blockers.push("GOVERNANCE_OBJECTIVE_SAMPLE_NOT_READY");
  if (objective && objective.monthly_pass === false) blockers.push("MONTHLY_TARGET_NOT_MET");
  if (objective && objective.pass === false) blockers.push("OBJECTIVE_NOT_MET");
  if (!retrospectiveSummary.available) blockers.push("RETROSPECTIVE_MISSING");
  if (retrospectiveSummary.daily.pass === false) blockers.push("DAILY_OBJECTIVE_FAIL");
  if (retrospectiveSummary.weekly.pass === false) blockers.push("WEEKLY_OBJECTIVE_FAIL");
  if (retrospectiveSummary.monthly.pass === false) blockers.push("RETROSPECTIVE_MONTHLY_FAIL");
  if (retrospectiveSummary.any_no_trade) blockers.push("DAILY_NO_TRADE_ACTIVITY");
  if (retrospectiveSummary.any_zero_idle) blockers.push("ZERO_KRW_IDLE");
  if (!canary || canarySummary.drift > 0 || canaryGolden.drift > 0) blockers.push("CANARY_DRIFT");
  if (changeControlRelevant && (!changeControl || String(changeControl.verdict || "").toUpperCase() === "HOLD")) {
    blockers.push("CHANGE_CONTROL_HOLD");
  }
  if (changeControl && changeControl.coverage_guard && changeControl.coverage_guard.pass !== true) blockers.push("COVERAGE_GUARD_BLOCK");
  if (physicsSummary.block_reason) blockers.push(physicsSummary.block_reason);
  if (selfEvolutionObjectiveSummary.count_floor_pass === false) blockers.push("SELF_EVOLUTION_COUNT_FLOOR_FAIL");
  if (selfEvolutionObjectiveSummary.replacement_floor_pass === false) blockers.push("SELF_EVOLUTION_REPLACEMENT_FLOOR_FAIL");
  if (selfEvolutionObjectiveSummary.latency_budget_pass === false) blockers.push("SELF_EVOLUTION_LATENCY_BUDGET_FAIL");
  const promotionCandidateId = String(changeControl && changeControl.auto_promotion && changeControl.auto_promotion.candidate_id || "").trim() || null;
  const promotionReplay = selfEvolutionReplaySummary.validations.find((row) => String(row && row.candidate_id || "").trim() === promotionCandidateId) || null;
  if (promotionReplay && promotionReplay.validation_verdict === "BLOCK") blockers.push("SELF_EVOLUTION_REPLAY_BLOCK");
  if (promotion.ready === true && selfEvolutionCanarySummary.available && selfEvolutionCanarySummary.apply_pass !== true) blockers.push("SELF_EVOLUTION_CANARY_BLOCK");
  if (selfEvolutionCanarySummary.rollback_ready_n > 0) blockers.push("SELF_EVOLUTION_CANARY_ROLLBACK_READY");
  if (selfEvolutionCycleSummary.available && selfEvolutionCycleSummary.cycle_consistent === false) blockers.push("SELF_EVOLUTION_ARTIFACT_CYCLE_MISMATCH");
  if (selfEvolutionLoopMonitorSummary.available && selfEvolutionLoopMonitorSummary.cycle_consistent === false) blockers.push("SELF_EVOLUTION_LOOP_CYCLE_MISMATCH");
  if (promotion.ready === true && promotionCandidateId && memoryBlockedIds.has(promotionCandidateId)) blockers.push("SELF_EVOLUTION_MEMORY_BLOCK");
  if (promotion.ready === true && selfEvolutionDeploymentSummary.deploy_pass !== true) {
    const deployReason = Array.isArray(selfEvolutionDeploymentSummary.blockers) && selfEvolutionDeploymentSummary.blockers.length
      ? selfEvolutionDeploymentSummary.blockers[0]
      : "SELF_EVOLUTION_DEPLOYMENT_BLOCK";
    if (!blockers.includes(deployReason)) blockers.push(deployReason);
  }
  if ((promotion.ready === true || rollback.ready === true) && selfEvolutionDeploymentPlanSummary.prepare_pass !== true) {
    blockers.push("SELF_EVOLUTION_DEPLOYMENT_PLAN_BLOCK");
  }
  if (codex && codexStatus === "FAILED" && (promotion.ready === true || rollback.ready === true)) {
    blockers.push("CODEX_REVIEW_FAILED");
  }
  if ((promotion.ready === true || rollback.ready === true) && !stageAutopilotFresh) {
    blockers.push("STAGE_AUTOPILOT_STALE");
  }
  const objectiveBlockReason = retrospectiveSummary.any_no_trade
    ? "DAILY_NO_TRADE_ACTIVITY"
    : retrospectiveSummary.any_zero_idle
      ? "ZERO_KRW_IDLE"
      : physicsSummary.block_reason
        ? physicsSummary.block_reason
      : selfEvolutionObjectiveSummary.count_floor_pass === false
        ? "SELF_EVOLUTION_COUNT_FLOOR_FAIL"
      : selfEvolutionObjectiveSummary.replacement_floor_pass === false
        ? "SELF_EVOLUTION_REPLACEMENT_FLOOR_FAIL"
      : selfEvolutionObjectiveSummary.latency_budget_pass === false
        ? "SELF_EVOLUTION_LATENCY_BUDGET_FAIL"
      : (promotionReplay && promotionReplay.validation_verdict === "BLOCK")
        ? "SELF_EVOLUTION_REPLAY_BLOCK"
      : (promotion.ready === true && selfEvolutionCanarySummary.available && selfEvolutionCanarySummary.apply_pass !== true)
        ? "SELF_EVOLUTION_CANARY_BLOCK"
      : selfEvolutionCanarySummary.rollback_ready_n > 0
        ? "SELF_EVOLUTION_CANARY_ROLLBACK_READY"
      : (selfEvolutionCycleSummary.available && selfEvolutionCycleSummary.cycle_consistent === false)
        ? "SELF_EVOLUTION_ARTIFACT_CYCLE_MISMATCH"
      : (selfEvolutionLoopMonitorSummary.available && selfEvolutionLoopMonitorSummary.cycle_consistent === false)
        ? "SELF_EVOLUTION_LOOP_CYCLE_MISMATCH"
      : (promotion.ready === true && promotionCandidateId && memoryBlockedIds.has(promotionCandidateId))
        ? "SELF_EVOLUTION_MEMORY_BLOCK"
      : (promotion.ready === true && selfEvolutionDeploymentSummary.deploy_pass !== true)
        ? ((Array.isArray(selfEvolutionDeploymentSummary.blockers) && selfEvolutionDeploymentSummary.blockers.length)
          ? selfEvolutionDeploymentSummary.blockers[0]
          : "SELF_EVOLUTION_DEPLOYMENT_BLOCK")
      : retrospectiveSummary.any_fail
        ? "RETROSPECTIVE_OBJECTIVE_FAIL"
      : (!objective || governanceSampleReady !== true)
          ? "GOVERNANCE_OBJECTIVE_SAMPLE_NOT_READY"
          : (objective && objective.pass === false)
            ? "OBJECTIVE_NOT_MET"
            : null;

  let verdict = "HOLD";
  let reason = "NO_ACTION_READY";
  if (rollback && rollback.ready === true) {
    if (!codex || !codexFresh) {
      verdict = "HOLD";
      reason = "CODEX_REVIEW_REQUIRED_ROLLBACK";
      blockers.push("CODEX_REVIEW_REQUIRED_ROLLBACK");
    } else if (!stageAutopilotFresh) {
      verdict = "HOLD";
      reason = "STAGE_AUTOPILOT_REQUIRED_ROLLBACK";
      blockers.push("STAGE_AUTOPILOT_REQUIRED_ROLLBACK");
    } else if (codexVerdict === "ROLLBACK") {
      verdict = "ROLLBACK_CANDIDATE";
      reason = "AUTO_ROLLBACK_READY";
    } else {
      verdict = "HOLD";
      reason = "CODEX_REVIEW_BLOCK_ROLLBACK";
      blockers.push("CODEX_BLOCK_ROLLBACK");
    }
  } else if (promotion && promotion.ready === true) {
    if (objectiveBlockReason) {
      verdict = "HOLD";
      reason = objectiveBlockReason;
    } else if (!codex || !codexFresh) {
      verdict = "HOLD";
      reason = "CODEX_REVIEW_REQUIRED_PROMOTION";
      blockers.push("CODEX_REVIEW_REQUIRED_PROMOTION");
    } else if (!stageAutopilotFresh) {
      verdict = "HOLD";
      reason = "STAGE_AUTOPILOT_REQUIRED_PROMOTION";
      blockers.push("STAGE_AUTOPILOT_REQUIRED_PROMOTION");
    } else if (codexVerdict !== "PROMOTE") {
      verdict = "HOLD";
      reason = "CODEX_REVIEW_BLOCK_PROMOTION";
      blockers.push("CODEX_BLOCK_PROMOTION");
    } else if (selfEvolutionDeploymentPlanSummary.prepare_pass !== true) {
      verdict = "HOLD";
      reason = "SELF_EVOLUTION_DEPLOYMENT_PLAN_BLOCK";
    } else {
      verdict = "PATCH_CANDIDATE";
      reason = "AUTO_PROMOTION_READY";
    }
  } else if (objectiveBlockReason) {
    verdict = "HOLD";
    reason = objectiveBlockReason;
  } else if (objective && objective.pass === true) {
    verdict = "HOLD";
    reason = "OBJECTIVE_ON_TRACK";
  } else if (blockers.length) {
    verdict = "HOLD";
    reason = blockers[0];
  }

  const codexAuthority = summarizeCodexAuthority({
    reportVerdict: verdict,
    reportReason: reason,
    codexReview: {
      status: codexDisplayStatus,
      verdict: codexVerdict,
      recommended_candidate_id: codexCandidateId,
      display_candidate_id: codexDisplayCandidateId,
      recommended_rollback_file_path: codexRollbackPath,
      confidence: toNum(codex && codex.confidence),
      reason: String(codex && (codex.reason || codex.summary) || "N/A"),
    },
    deploymentPlan: selfEvolutionDeploymentPlanSummary,
  });
  const actionPlan = buildSupervisorActionPlan({
    reason,
    blockers,
    promotionCandidateId,
    promotionReplay,
    deployment: selfEvolutionDeploymentSummary,
    deploymentPlan: selfEvolutionDeploymentPlanSummary,
    governanceEnoughSample: governanceSampleReady,
    codexFresh,
    stageAutopilotFresh,
    retrospective: retrospectiveSummary,
  });

  return {
    verdict,
    reason,
    root_cause: reason,
    action_plan: actionPlan,
    blockers: Array.from(new Set(blockers)),
    objective: {
      scope: "GOVERNANCE_7D_ENTRY_COHORT",
      verdict: String(objective.verdict || "N/A"),
      pass: objective.pass === true,
      enough_sample: governanceSampleReady,
      strict_enough_sample: governanceStrictSampleReady,
      activity_pass: objective.activity_pass === true,
      executed_n: toNum(objective.executed_n),
      realized_n: governanceStrictRealizedN,
      monthly_source_realized_n: governanceMonthlySourceRealizedN,
      effective_realized_n: governanceEffectiveRealizedN,
      realized_min_sample: governanceRealizedMinSample,
      win_rate: toNum(governance && governance.current && governance.current.overall && governance.current.overall.win_rate),
      avg_ret_net: toNum(governance && governance.current && governance.current.overall && governance.current.overall.avg_ret_net),
      net_pnl_quote: toNum(governance && governance.current && governance.current.overall && governance.current.overall.net_pnl_quote),
      monthly_run_rate_krw: toNum(objective.monthly_run_rate_krw),
      min_monthly_net_krw: toNum(objectiveCfg.min_monthly_net_krw),
      monthly_pass: objective.monthly_pass === true,
      failed_checks: governanceFailedChecks,
    },
    governance_objective: {
      scope: "GOVERNANCE_7D_ENTRY_COHORT",
      verdict: String(objective.verdict || "N/A"),
      pass: objective.pass === true,
      enough_sample: governanceSampleReady,
      strict_enough_sample: governanceStrictSampleReady,
      activity_pass: objective.activity_pass === true,
      executed_n: toNum(objective.executed_n),
      realized_n: governanceStrictRealizedN,
      monthly_source_realized_n: governanceMonthlySourceRealizedN,
      effective_realized_n: governanceEffectiveRealizedN,
      realized_min_sample: governanceRealizedMinSample,
      win_rate: toNum(governance && governance.current && governance.current.overall && governance.current.overall.win_rate),
      avg_ret_net: toNum(governance && governance.current && governance.current.overall && governance.current.overall.avg_ret_net),
      net_pnl_quote: toNum(governance && governance.current && governance.current.overall && governance.current.overall.net_pnl_quote),
      monthly_run_rate_krw: toNum(objective.monthly_run_rate_krw),
      min_monthly_net_krw: toNum(objectiveCfg.min_monthly_net_krw),
      monthly_pass: objective.monthly_pass === true,
      failed_checks: governanceFailedChecks,
    },
    promotion: {
      ready: promotion.ready === true,
      reason: String(promotion.reason || "N/A"),
      candidate_id: String(promotion.candidate_id || "").trim() || null,
      display_candidate_id: resolveDisplayCandidateId(promotion.candidate_id, changeControl),
      streak_current: toNum(promotion.streak_current),
      streak_required: toNum(promotion.streak_required),
      replay_verdict: String(promotionReplay && promotionReplay.validation_verdict || "").trim().toUpperCase() || null,
      replay_delta: toNum(promotionReplay && promotionReplay.candidate_objective_delta),
      replay_blockers: Array.isArray(promotionReplay && promotionReplay.blockers) ? promotionReplay.blockers : [],
    },
    rollback: {
      ready: rollback.ready === true,
      reason: String(rollback.reason || "N/A"),
      rollback_file_path: String(rollback.rollback_file_path || "").trim() || null,
      based_on_patch_id: String(rollback.based_on_patch_id || "").trim() || null,
      based_on_week_key: String(rollback.based_on_week_key || "").trim() || null,
    },
    guards: {
      canary_pass: Boolean(canary && canarySummary.drift === 0 && canaryGolden.drift === 0),
      canary_shadow_drift: toNum(canarySummary.drift) || 0,
      canary_golden_drift: toNum(canaryGolden.drift) || 0,
      coverage_pass: Boolean(changeControl && changeControl.coverage_guard && changeControl.coverage_guard.pass === true),
      ai_coverage_pass: Boolean(changeControl && changeControl.coverage_guard && changeControl.coverage_guard.ai && changeControl.coverage_guard.ai.pass === true),
      market_coverage_pass: Boolean(changeControl && changeControl.coverage_guard && changeControl.coverage_guard.market && changeControl.coverage_guard.market.pass === true),
    },
    physics: physicsSummary,
    phase0: phase0Summary,
    self_evolution_dataset: selfEvolutionDatasetSummary,
    self_evolution_objective: selfEvolutionObjectiveSummary,
    self_evolution_attribution: selfEvolutionAttributionSummary,
    self_evolution_candidates: selfEvolutionCandidatesSummary,
    self_evolution_replay: selfEvolutionReplaySummary,
    self_evolution_canary: selfEvolutionCanarySummary,
    self_evolution_cycle: selfEvolutionCycleSummary,
    self_evolution_deployment: selfEvolutionDeploymentSummary,
    self_evolution_deployment_plan: selfEvolutionDeploymentPlanSummary,
    self_evolution_loop_monitor: selfEvolutionLoopMonitorSummary,
    self_evolution_weight_tuning: selfEvolutionWeightTuning,
    self_evolution_memory: selfEvolutionMemorySummary,
    retrospective_activity_context: {
      source: "RETROSPECTIVE_DAILY",
      daily_executed_n: retrospectiveSummary.daily.executed_n,
      daily_realized_n: retrospectiveSummary.daily.realized_n,
      daily_failed_checks: retrospectiveSummary.daily.failed_checks,
      daily_no_trade: retrospectiveSummary.daily_no_trade === true,
      daily_zero_idle: retrospectiveSummary.daily_zero_idle === true,
      dataset_window_source: selfEvolutionDatasetSummary.window_source || null,
      dataset_executed_n_7d: toNum(selfEvolutionDatasetSummary.executed_n),
      dataset_realized_n_7d: toNum(selfEvolutionDatasetSummary.realized_n),
    },
    sample_readiness: {
      governance_realized_n: governanceStrictRealizedN,
      governance_monthly_source_realized_n: governanceMonthlySourceRealizedN,
      governance_effective_realized_n: governanceEffectiveRealizedN,
      governance_realized_min_sample: governanceRealizedMinSample,
      governance_strict_enough_sample: governanceStrictSampleReady,
      governance_enough_sample: governanceSampleReady,
      self_evolution_realized_n: toNum(selfEvolutionObjectiveSummary.realized_n) || 0,
      self_evolution_realized_min_sample: selfEvolutionRealizedMinSample,
      self_evolution_enough_sample: selfEvolutionSampleReady,
    },
    self_evolution_policy: selfEvolutionPolicy,
    best_febt_tuning_contract: bestFebtTuningContract,
    best_febt_market_contracts: bestFebtMarketContracts,
    filter_layers: filterLayers,
    tuning: {
      ev_reason: String(ev && ev.decision_reason || "N/A"),
      wait_reason: String(wait && wait.reason || "N/A"),
      ml_quality_actions: Array.isArray(ml && ml.recommendations && ml.recommendations.QUALITY) ? ml.recommendations.QUALITY.length : 0,
      ml_market_action: String(ml && ml.recommendations && ml.recommendations.MARKET && ml.recommendations.MARKET.action || "N/A"),
      ml_ev_action: String(ml && ml.recommendations && ml.recommendations.EV && ml.recommendations.EV.action || "N/A"),
    },
    codex_review: {
      available: !!codex,
      status: codexDisplayStatus,
      verdict: codexVerdict,
      recommended_candidate_id: codexCandidateId,
      display_candidate_id: codexDisplayCandidateId,
      recommended_rollback_file_path: codexRollbackPath,
      confidence: toNum(codex && codex.confidence),
      reason: String(codex && (codex.reason || codex.summary) || "N/A"),
    },
    codex_authority: codexAuthority,
    stage_autopilot: {
      available: !!stageAutopilot,
      status: stageAutopilotFresh ? "FRESH" : (stageAutopilot ? "STALE" : "N/A"),
      objective_verdict: String(stageAutopilot && stageAutopilot.objective_verdict || "N/A"),
      action_n: Array.isArray(stageAutopilot && stageAutopilot.actions) ? stageAutopilot.actions.length : 0,
      action_types: Array.isArray(stageAutopilot && stageAutopilot.actions)
        ? Array.from(new Set(stageAutopilot.actions.map((row) => String(row && row.type || "N/A"))))
        : [],
    },
    retrospective: retrospectiveSummary,
  };
}

function renderMarkdown(report = {}) {
  const lines = [
    "# Objective Supervisor",
    "",
    `- 실행 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- verdict: ${report.verdict || "N/A"}`,
    `- reason: ${report.reason || "N/A"}`,
    `- root_cause: ${report.root_cause || "N/A"}`,
    `- blockers: ${(report.blockers || []).length ? report.blockers.join(", ") : "none"}`,
    `- action_plan: ${(report.action_plan || []).length ? report.action_plan.join(" | ") : "none"}`,
    "",
    "## Objective",
    `- objective: ${report.objective && report.objective.verdict || "N/A"}`,
    `- activity: ${report.objective && report.objective.activity_pass ? "PASS" : "FAIL"} / executed=${report.objective && report.objective.executed_n != null ? report.objective.executed_n : "N/A"}`,
    `- governance enough_sample: ${report.objective && report.objective.enough_sample ? "YES" : "NO"} / strict=${report.objective && report.objective.strict_enough_sample ? "YES" : "NO"} / realized=${report.objective && report.objective.realized_n != null ? report.objective.realized_n : "N/A"} / monthly_source=${report.objective && report.objective.monthly_source_realized_n != null ? report.objective.monthly_source_realized_n : "N/A"} / effective=${report.objective && report.objective.effective_realized_n != null ? report.objective.effective_realized_n : "N/A"} / min=${report.objective && report.objective.realized_min_sample != null ? report.objective.realized_min_sample : "N/A"}`,
    `- win_rate: ${pct(report.objective && report.objective.win_rate)}`,
    `- avg_ret_net: ${pct(report.objective && report.objective.avg_ret_net)}`,
    `- net_pnl_quote: ${signedNum(report.objective && report.objective.net_pnl_quote, 2)}`,
    `- monthly_run_rate_krw: ${signedNum(report.objective && report.objective.monthly_run_rate_krw, 0)} / target=${signedNum(report.objective && report.objective.min_monthly_net_krw, 0)}`,
    `- monthly_pass: ${report.objective && report.objective.monthly_pass ? "PASS" : "FAIL"}`,
    "",
    "## Retrospective",
    `- daily: ${report.retrospective && report.retrospective.daily ? `${report.retrospective.daily.verdict} / executed=${report.retrospective.daily.executed_n ?? "N/A"} / realized=${report.retrospective.daily.realized_n ?? "N/A"} / net=${signedNum(report.retrospective.daily.net_pnl_quote, 0)}` : "N/A"}`,
    `- activity_scope: ${report.retrospective_activity_context && report.retrospective_activity_context.source || "N/A"} / daily_no_trade=${report.retrospective_activity_context && report.retrospective_activity_context.daily_no_trade ? "YES" : "NO"} / daily_zero_idle=${report.retrospective_activity_context && report.retrospective_activity_context.daily_zero_idle ? "YES" : "NO"} / dataset_7d_executed=${report.retrospective_activity_context && report.retrospective_activity_context.dataset_executed_n_7d != null ? report.retrospective_activity_context.dataset_executed_n_7d : "N/A"}`,
    `- weekly: ${report.retrospective && report.retrospective.weekly ? `${report.retrospective.weekly.verdict} / executed=${report.retrospective.weekly.executed_n ?? "N/A"} / realized=${report.retrospective.weekly.realized_n ?? "N/A"} / net=${signedNum(report.retrospective.weekly.net_pnl_quote, 0)}` : "N/A"}`,
    `- monthly: ${report.retrospective && report.retrospective.monthly ? `${report.retrospective.monthly.verdict} / executed=${report.retrospective.monthly.executed_n ?? "N/A"} / realized=${report.retrospective.monthly.realized_n ?? "N/A"} / net=${signedNum(report.retrospective.monthly.net_pnl_quote, 0)}` : "N/A"}`,
    "",
    "## Change Control",
    `- promotion: ${report.promotion && report.promotion.ready ? "READY" : "HOLD"} / ${report.promotion && report.promotion.reason || "N/A"} / candidate=${report.promotion && (report.promotion.display_candidate_id || report.promotion.candidate_id) || "N/A"}`,
    `- promotion replay: ${report.promotion && report.promotion.replay_verdict || "N/A"} / delta=${signedNum(report.promotion && report.promotion.replay_delta, 4)} / blockers=${report.promotion && Array.isArray(report.promotion.replay_blockers) && report.promotion.replay_blockers.length ? report.promotion.replay_blockers.join(", ") : "none"}`,
    `- rollback: ${report.rollback && report.rollback.ready ? "READY" : "HOLD"} / ${report.rollback && report.rollback.reason || "N/A"} / target=${report.rollback && report.rollback.rollback_file_path || "N/A"}`,
    "",
    "## Guards",
    `- canary: ${report.guards && report.guards.canary_pass ? "PASS" : "BLOCK"} / golden=${report.guards && report.guards.canary_golden_drift != null ? report.guards.canary_golden_drift : "N/A"} / shadow=${report.guards && report.guards.canary_shadow_drift != null ? report.guards.canary_shadow_drift : "N/A"}`,
    `- coverage: ${report.guards && report.guards.coverage_pass ? "PASS" : "BLOCK"} / ai=${report.guards && report.guards.ai_coverage_pass ? "PASS" : "BLOCK"} / market=${report.guards && report.guards.market_coverage_pass ? "PASS" : "BLOCK"}`,
    "",
    "## Filter Layers",
    `- 1차 상태/무결성: ${report.filter_layers && report.filter_layers.integrity ? `${report.filter_layers.integrity.server_mode} / coverage=${report.filter_layers.integrity.coverage_pass ? "PASS" : "BLOCK"} / ${report.filter_layers.integrity.expectation}` : "N/A"}`,
    `- 2차 진입 품질: ${report.filter_layers && report.filter_layers.entry_quality ? `candidate=${report.filter_layers.entry_quality.pine_candidate_verdict} / ml_quality_actions=${report.filter_layers.entry_quality.quality_actions}` : "N/A"}`,
    `- 3차 상태 기반 Soft Sizing: ${report.filter_layers && report.filter_layers.state_soft_sizing ? `${report.filter_layers.state_soft_sizing.ml_action} / physics=${report.filter_layers.state_soft_sizing.physics_action} / qty=${report.filter_layers.state_soft_sizing.qty_scale != null ? report.filter_layers.state_soft_sizing.qty_scale : "N/A"} / dominant_state=${report.filter_layers.state_soft_sizing.dominant_state || "N/A"} / dominant_action=${report.filter_layers.state_soft_sizing.dominant_action || "N/A"}` : "N/A"}`,
    `- 4차 EV/시간가치층: ${report.filter_layers && report.filter_layers.ev_time_value ? `${report.filter_layers.ev_time_value.tuner_reason} / policy=${report.filter_layers.ev_time_value.policy_version || "N/A"} / source=${report.filter_layers.ev_time_value.policy_source || "N/A"}` : "N/A"}`,
    `- 5차 WAIT 타이밍층: ${report.filter_layers && report.filter_layers.wait_timing ? `${report.filter_layers.wait_timing.tuner_reason} / action=${report.filter_layers.wait_timing.wait_action} / FEBT calc=${pct(report.filter_layers.wait_timing.febt_calc_ok_rate)} / phase_known=${pct(report.filter_layers.wait_timing.febt_phase_known)} / fire=${report.filter_layers.wait_timing.febt_fire_n ?? 0} / late=${report.filter_layers.wait_timing.febt_late_n ?? 0} / void=${report.filter_layers.wait_timing.febt_void_n ?? 0} / disagree=${report.filter_layers.wait_timing.febt_disagreement_n ?? 0} / fallback=${report.filter_layers.wait_timing.febt_fallback_legacy_n ?? 0} / missing=${pct(report.filter_layers.wait_timing.febt_missing_rate)}` : "N/A"}`,
    "",
    "## Market Physics",
    `- state: ${report.physics && report.physics.display_state || "정보 없음"} (${report.physics && report.physics.state || "N/A"}) / executed=${report.physics && report.physics.executed_n != null ? report.physics.executed_n : "N/A"} / block=${report.physics && report.physics.block_reason || "none"}`,
    `- entropy=${pct(report.physics && report.physics.entropy)} / coherence=${pct(report.physics && report.physics.coherence)} / transition=${pct(report.physics && report.physics.transition_risk)} / align=${pct(report.physics && report.physics.field_alignment)} / wall=${pct(report.physics && report.physics.domain_wall_density)} / susc=${pct(report.physics && report.physics.susceptibility)} / free_energy=${pct(report.physics && report.physics.free_energy)}`,
    "",
    "## FEBT Phase 0",
    `- available: ${report.phase0 && report.phase0.available ? "YES" : "NO"} / fresh=${report.phase0 && report.phase0.fresh ? "YES" : "NO"} / provider=${report.phase0 && report.phase0.provider || "N/A"} / tf=${report.phase0 && report.phase0.tf || "N/A"}`,
    `- legacy_wait coverage=${pct(report.phase0 && report.phase0.legacy_wait_coverage_rate)} / observed=${report.phase0 && report.phase0.legacy_wait_observed_chain_n != null ? report.phase0.legacy_wait_observed_chain_n : "N/A"}`,
    `- legacy_wait immediate_win=${pct(report.phase0 && report.phase0.immediate_win_rate)} / saved_loss=${pct(report.phase0 && report.phase0.saved_loss_pct)} / missed_gain=${pct(report.phase0 && report.phase0.missed_gain_pct)} / delta=${signedPct(report.phase0 && report.phase0.saved_loss_minus_missed_gain)}`,
    `- bridge webhook_to_fill p95=${report.phase0 && report.phase0.webhook_to_fill_p95_ms != null ? `${Number(report.phase0.webhook_to_fill_p95_ms).toFixed(0)}ms` : "N/A"} / duplicate=${report.phase0 && report.phase0.duplicate_count != null ? report.phase0.duplicate_count : "N/A"} / reject=${report.phase0 && report.phase0.reject_count != null ? report.phase0.reject_count : "N/A"}`,
    "",
    "## BEST/FEBT Tuning Contract",
    `- mode: ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.mode || "N/A"}`,
    `- tightening_allowed: ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.tightening_allowed ? "YES" : "NO"} / recovery_priority: ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.recovery_priority ? "YES" : "NO"}`,
    `- projected_replacement_ratio: ${pct(report.best_febt_tuning_contract && report.best_febt_tuning_contract.projected_replacement_ratio)}`,
    `- projected_count_ratio_global: ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.projected_count_ratio_global != null ? Number(report.best_febt_tuning_contract.projected_count_ratio_global).toFixed(2) : "N/A"}`,
    `- projected_net_signal_delta_n: ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.projected_net_signal_delta_n != null ? report.best_febt_tuning_contract.projected_net_signal_delta_n : "N/A"}`,
    `- fire/late/void: ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.fire_n != null ? report.best_febt_tuning_contract.fire_n : "N/A"} / ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.late_n != null ? report.best_febt_tuning_contract.late_n : "N/A"} / ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.void_n != null ? report.best_febt_tuning_contract.void_n : "N/A"}`,
    `- disagreement/fallback/missing: ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.disagreement_n != null ? report.best_febt_tuning_contract.disagreement_n : "N/A"} / ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.fallback_legacy_n != null ? report.best_febt_tuning_contract.fallback_legacy_n : "N/A"} / ${pct(report.best_febt_tuning_contract && report.best_febt_tuning_contract.missing_rate)}`,
    "",
    "## Self-Evolution Policy",
    `- master_spec_path: ${report.self_evolution_policy && report.self_evolution_policy.master_spec_path || "N/A"}`,
    `- dataset_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.dataset_latest_path || "N/A"}`,
    `- objective_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.objective_latest_path || "N/A"}`,
    `- attribution_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.attribution_latest_path || "N/A"}`,
    `- candidates_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.candidates_latest_path || "N/A"}`,
    `- replay_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.replay_latest_path || "N/A"}`,
    `- canary_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.canary_latest_path || "N/A"}`,
    `- deployment_guards_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.deployment_guards_latest_path || "N/A"}`,
    `- deployment_plan_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.deployment_plan_latest_path || "N/A"}`,
    `- loop_monitor_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.loop_monitor_latest_path || "N/A"}`,
    `- loop_run_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.loop_run_latest_path || "N/A"}`,
    `- weight_tuning_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.weight_tuning_latest_path || "N/A"}`,
    `- memory_latest_path: ${report.self_evolution_policy && report.self_evolution_policy.memory_latest_path || "N/A"}`,
    `- status: ${report.self_evolution_policy && report.self_evolution_policy.status || "N/A"}`,
    `- current_focus: ${report.self_evolution_policy && report.self_evolution_policy.current_focus || "N/A"}`,
    `- next_focus: ${report.self_evolution_policy && report.self_evolution_policy.next_focus || "N/A"}`,
    ...((report.self_evolution_policy && Array.isArray(report.self_evolution_policy.linked_paths) && report.self_evolution_policy.linked_paths.length)
      ? report.self_evolution_policy.linked_paths.map((row) => `- doc: ${row}`)
      : ["- doc: none"]),
    "",
    "## Self-Evolution Dataset",
    `- rows/executed/drop/missed: ${report.self_evolution_dataset && report.self_evolution_dataset.rows_n != null ? report.self_evolution_dataset.rows_n : "N/A"} / ${report.self_evolution_dataset && report.self_evolution_dataset.executed_n != null ? report.self_evolution_dataset.executed_n : "N/A"} / ${report.self_evolution_dataset && report.self_evolution_dataset.drop_n != null ? report.self_evolution_dataset.drop_n : "N/A"} / ${report.self_evolution_dataset && report.self_evolution_dataset.missed_n != null ? report.self_evolution_dataset.missed_n : "N/A"}`,
    `- fallback/rejected/partial: ${report.self_evolution_dataset && report.self_evolution_dataset.fallback_n != null ? report.self_evolution_dataset.fallback_n : "N/A"} / ${report.self_evolution_dataset && report.self_evolution_dataset.rejected_n != null ? report.self_evolution_dataset.rejected_n : "N/A"} / ${report.self_evolution_dataset && report.self_evolution_dataset.partial_n != null ? report.self_evolution_dataset.partial_n : "N/A"}`,
    `- realized_n: ${report.self_evolution_dataset && report.self_evolution_dataset.realized_n != null ? report.self_evolution_dataset.realized_n : "N/A"} / features=${pct(report.self_evolution_dataset && report.self_evolution_dataset.features_coverage_rate)} / febt_all=${pct(report.self_evolution_dataset && report.self_evolution_dataset.febt_coverage_rate)} / febt_eligible=${pct(report.self_evolution_dataset && report.self_evolution_dataset.febt_coverage_rate_eligible)} (${report.self_evolution_dataset && report.self_evolution_dataset.febt_eligible_n != null ? report.self_evolution_dataset.febt_eligible_n : "N/A"}) / febt_active=${pct(report.self_evolution_dataset && report.self_evolution_dataset.febt_coverage_rate_active_eligible)} (${report.self_evolution_dataset && report.self_evolution_dataset.febt_active_eligible_n != null ? report.self_evolution_dataset.febt_active_eligible_n : "N/A"} / missing ${report.self_evolution_dataset && report.self_evolution_dataset.febt_active_missing_n != null ? report.self_evolution_dataset.febt_active_missing_n : "N/A"})`,
    `- active_entry: ${report.self_evolution_dataset && report.self_evolution_dataset.active_entry_n != null ? report.self_evolution_dataset.active_entry_n : "N/A"} / legacy_entry=${report.self_evolution_dataset && report.self_evolution_dataset.legacy_entry_n != null ? report.self_evolution_dataset.legacy_entry_n : "N/A"} / family=${renderSummaryLine(report.self_evolution_dataset && report.self_evolution_dataset.active_entry_family_counts)}`,
    `- entry_pending: total=${report.self_evolution_dataset && report.self_evolution_dataset.entry_pending_total_n != null ? report.self_evolution_dataset.entry_pending_total_n : "N/A"} / executed=${report.self_evolution_dataset && report.self_evolution_dataset.entry_executed_null_realized_n != null ? report.self_evolution_dataset.entry_executed_null_realized_n : "N/A"} / fallback=${report.self_evolution_dataset && report.self_evolution_dataset.entry_fallback_pending_n != null ? report.self_evolution_dataset.entry_fallback_pending_n : "N/A"} / exit_present_unlabeled=${report.self_evolution_dataset && report.self_evolution_dataset.entry_exit_present_unlabeled_n != null ? report.self_evolution_dataset.entry_exit_present_unlabeled_n : "N/A"} / open_pending=${report.self_evolution_dataset && report.self_evolution_dataset.entry_open_pending_n != null ? report.self_evolution_dataset.entry_open_pending_n : "N/A"} / link_missing=${report.self_evolution_dataset && report.self_evolution_dataset.entry_link_missing_n != null ? report.self_evolution_dataset.entry_link_missing_n : "N/A"}`,
    `- fallback_active: ${report.self_evolution_dataset && report.self_evolution_dataset.entry_fallback_pending_active_n != null ? report.self_evolution_dataset.entry_fallback_pending_active_n : "N/A"} / payload_missing=${report.self_evolution_dataset && report.self_evolution_dataset.entry_fallback_payload_missing_n != null ? report.self_evolution_dataset.entry_fallback_payload_missing_n : "N/A"} / linked_exec=${report.self_evolution_dataset && report.self_evolution_dataset.entry_fallback_payload_missing_linked_n != null ? report.self_evolution_dataset.entry_fallback_payload_missing_linked_n : "N/A"} / family=${renderSummaryLine(report.self_evolution_dataset && report.self_evolution_dataset.entry_fallback_pending_active_by_family)}`,
    `- sample_readiness: governance=${report.sample_readiness && report.sample_readiness.governance_enough_sample ? "YES" : "NO"} (strict ${report.sample_readiness && report.sample_readiness.governance_realized_n != null ? report.sample_readiness.governance_realized_n : "N/A"} / monthly ${report.sample_readiness && report.sample_readiness.governance_monthly_source_realized_n != null ? report.sample_readiness.governance_monthly_source_realized_n : "N/A"} / effective ${report.sample_readiness && report.sample_readiness.governance_effective_realized_n != null ? report.sample_readiness.governance_effective_realized_n : "N/A"} / min ${report.sample_readiness && report.sample_readiness.governance_realized_min_sample != null ? report.sample_readiness.governance_realized_min_sample : "N/A"}) / self_evolution=${report.sample_readiness && report.sample_readiness.self_evolution_enough_sample ? "YES" : "NO"} (${report.sample_readiness && report.sample_readiness.self_evolution_realized_n != null ? report.sample_readiness.self_evolution_realized_n : "N/A"} / min ${report.sample_readiness && report.sample_readiness.self_evolution_realized_min_sample != null ? report.sample_readiness.self_evolution_realized_min_sample : "N/A"})`,
    `- avg_realized_ret_net: ${signedPct(report.self_evolution_dataset && report.self_evolution_dataset.avg_realized_ret_net)} / avg_realized_pnl_quote: ${signedNum(report.self_evolution_dataset && report.self_evolution_dataset.avg_realized_pnl_quote, 0)} / avg_hold_minutes: ${report.self_evolution_dataset && report.self_evolution_dataset.avg_hold_minutes != null ? Number(report.self_evolution_dataset.avg_hold_minutes).toFixed(1) : "N/A"}`,
    "",
    "## Self-Evolution Objective",
    `- objective_score: ${signedNum(report.self_evolution_objective && report.self_evolution_objective.objective_score, 4)}`,
    `- constraints: count=${report.self_evolution_objective && report.self_evolution_objective.count_floor_pass === true ? "PASS" : (report.self_evolution_objective && report.self_evolution_objective.count_floor_pass === false ? "FAIL" : "N/A")} / replacement=${report.self_evolution_objective && report.self_evolution_objective.replacement_floor_pass === true ? "PASS" : (report.self_evolution_objective && report.self_evolution_objective.replacement_floor_pass === false ? "FAIL" : "N/A")} / latency=${report.self_evolution_objective && report.self_evolution_objective.latency_budget_pass === true ? "PASS" : (report.self_evolution_objective && report.self_evolution_objective.latency_budget_pass === false ? "FAIL" : "N/A")}`,
    `- components: profit=${signedNum(report.self_evolution_objective && report.self_evolution_objective.profit_score, 3)} / count=${signedNum(report.self_evolution_objective && report.self_evolution_objective.count_score, 3)} / replacement=${signedNum(report.self_evolution_objective && report.self_evolution_objective.replacement_score, 3)} / tp1=${signedNum(report.self_evolution_objective && report.self_evolution_objective.tp1_score, 3)} / drawdown=${signedNum(report.self_evolution_objective && report.self_evolution_objective.drawdown_penalty, 3)} / latency=${signedNum(report.self_evolution_objective && report.self_evolution_objective.latency_penalty, 3)} / instability=${signedNum(report.self_evolution_objective && report.self_evolution_objective.instability_penalty, 3)}`,
    `- fire_win/tp1/count/replacement: ${pct(report.self_evolution_objective && report.self_evolution_objective.fire_win_rate)} / ${pct(report.self_evolution_objective && report.self_evolution_objective.tp1_first_rate)} / ${report.self_evolution_objective && report.self_evolution_objective.projected_count_ratio_global != null ? Number(report.self_evolution_objective.projected_count_ratio_global).toFixed(2) : "N/A"} / ${pct(report.self_evolution_objective && report.self_evolution_objective.projected_replacement_ratio)}`,
    `- top_market: ${report.self_evolution_objective && report.self_evolution_objective.top_market ? `${report.self_evolution_objective.top_market.market} / ${signedNum(report.self_evolution_objective.top_market.objective_score, 3)}` : "N/A"}`,
    `- bottom_market: ${report.self_evolution_objective && report.self_evolution_objective.bottom_market ? `${report.self_evolution_objective.bottom_market.market} / ${signedNum(report.self_evolution_objective.bottom_market.objective_score, 3)}` : "N/A"}`,
    `- dominant_drag: ${report.self_evolution_objective && report.self_evolution_objective.market_concentration && report.self_evolution_objective.market_concentration.dominant_negative_market ? `${report.self_evolution_objective.market_concentration.dominant_negative_market.market} / share ${pct(report.self_evolution_objective.market_concentration.dominant_negative_share)} / ex-bottom ${signedNum(report.self_evolution_objective.market_concentration.objective_score_ex_bottom_market, 3)}` : "N/A"}`,
    "",
    "## Self-Evolution Attribution",
    `- drop_top_layer: ${report.self_evolution_attribution && report.self_evolution_attribution.drop_top_layer ? `${report.self_evolution_attribution.drop_top_layer.key} ${report.self_evolution_attribution.drop_top_layer.count}` : "N/A"}`,
    `- late_loss_top_market: ${report.self_evolution_attribution && report.self_evolution_attribution.late_loss_top_market ? `${report.self_evolution_attribution.late_loss_top_market.key} ${report.self_evolution_attribution.late_loss_top_market.count}` : "N/A"}`,
    `- false_fire_top_market: ${report.self_evolution_attribution && report.self_evolution_attribution.false_fire_top_market ? `${report.self_evolution_attribution.false_fire_top_market.key} ${report.self_evolution_attribution.false_fire_top_market.count}` : "N/A"}`,
    `- missed_recovery_top_reason: ${report.self_evolution_attribution && report.self_evolution_attribution.missed_recovery_top_reason ? `${report.self_evolution_attribution.missed_recovery_top_reason.key} ${report.self_evolution_attribution.missed_recovery_top_reason.count}` : "N/A"}`,
    `- fallback_cost_top_market: ${report.self_evolution_attribution && report.self_evolution_attribution.fallback_cost_top_market ? `${report.self_evolution_attribution.fallback_cost_top_market.key} ${report.self_evolution_attribution.fallback_cost_top_market.count}` : "N/A"}`,
    "",
    "## Self-Evolution Candidates",
    `- total/ready/blocked: ${report.self_evolution_candidates && report.self_evolution_candidates.total_n != null ? report.self_evolution_candidates.total_n : "N/A"} / ${report.self_evolution_candidates && report.self_evolution_candidates.ready_n != null ? report.self_evolution_candidates.ready_n : "N/A"} / ${report.self_evolution_candidates && report.self_evolution_candidates.blocked_n != null ? report.self_evolution_candidates.blocked_n : "N/A"}`,
    `- top_candidate: ${report.self_evolution_candidates && report.self_evolution_candidates.top_candidate_id || "N/A"} / scope=${report.self_evolution_candidates && report.self_evolution_candidates.top_scope || "N/A"}`,
    "",
    "## Self-Evolution Replay",
    `- mode: ${report.self_evolution_replay && report.self_evolution_replay.validation_mode || "N/A"}`,
    `- total/pass/warn/block: ${report.self_evolution_replay && report.self_evolution_replay.total_n != null ? report.self_evolution_replay.total_n : "N/A"} / ${report.self_evolution_replay && report.self_evolution_replay.pass_n != null ? report.self_evolution_replay.pass_n : "N/A"} / ${report.self_evolution_replay && report.self_evolution_replay.warn_n != null ? report.self_evolution_replay.warn_n : "N/A"} / ${report.self_evolution_replay && report.self_evolution_replay.block_n != null ? report.self_evolution_replay.block_n : "N/A"}`,
    `- best_candidate: ${report.self_evolution_replay && report.self_evolution_replay.best_candidate_id || "N/A"} / verdict=${report.self_evolution_replay && report.self_evolution_replay.best_verdict || "N/A"} / objective_delta=${signedNum(report.self_evolution_replay && report.self_evolution_replay.best_objective_delta, 4)}`,
    "",
    "## Self-Evolution Canary",
    `- total/shadow/soft/hard: ${report.self_evolution_canary && report.self_evolution_canary.total_n != null ? report.self_evolution_canary.total_n : "N/A"} / ${report.self_evolution_canary && report.self_evolution_canary.shadow_n != null ? report.self_evolution_canary.shadow_n : "N/A"} / ${report.self_evolution_canary && report.self_evolution_canary.soft_n != null ? report.self_evolution_canary.soft_n : "N/A"} / ${report.self_evolution_canary && report.self_evolution_canary.hard_n != null ? report.self_evolution_canary.hard_n : "N/A"}`,
    `- ready/blocked/rollback: ${report.self_evolution_canary && report.self_evolution_canary.ready_n != null ? report.self_evolution_canary.ready_n : "N/A"} / ${report.self_evolution_canary && report.self_evolution_canary.blocked_n != null ? report.self_evolution_canary.blocked_n : "N/A"} / ${report.self_evolution_canary && report.self_evolution_canary.rollback_ready_n != null ? report.self_evolution_canary.rollback_ready_n : "N/A"} / apply=${report.self_evolution_canary && report.self_evolution_canary.apply_pass ? "PASS" : "BLOCK"}`,
    `- open/current/next wave: ${report.self_evolution_canary && report.self_evolution_canary.open_wave != null ? report.self_evolution_canary.open_wave : "N/A"} / ${report.self_evolution_canary && report.self_evolution_canary.current_open_wave != null ? report.self_evolution_canary.current_open_wave : "N/A"} / ${report.self_evolution_canary && report.self_evolution_canary.next_wave_candidate != null ? report.self_evolution_canary.next_wave_candidate : "N/A"} / scale=${report.self_evolution_canary && report.self_evolution_canary.scale_allowed ? "YES" : "NO"}`,
    `- top_ready: ${report.self_evolution_canary && report.self_evolution_canary.top_ready_market || "N/A"} / top_rollback: ${report.self_evolution_canary && report.self_evolution_canary.top_rollback_market || "N/A"}`,
    "",
    "## Self-Evolution Deployment",
    `- target/deploy/rollback_only: ${report.self_evolution_deployment && report.self_evolution_deployment.target_candidate_id || "N/A"} / ${report.self_evolution_deployment && report.self_evolution_deployment.deploy_pass ? "PASS" : "BLOCK"} / ${report.self_evolution_deployment && report.self_evolution_deployment.rollback_only ? "YES" : "NO"}`,
    `- replay/open_wave/markets: ${report.self_evolution_deployment && report.self_evolution_deployment.replay_verdict || "N/A"} / ${report.self_evolution_deployment && report.self_evolution_deployment.canary_open_wave != null ? report.self_evolution_deployment.canary_open_wave : "N/A"} / ${report.self_evolution_deployment && report.self_evolution_deployment.market_ready_n != null ? report.self_evolution_deployment.market_ready_n : "N/A"} / ${report.self_evolution_deployment && report.self_evolution_deployment.market_total_n != null ? report.self_evolution_deployment.market_total_n : "N/A"}`,
    `- blockers: ${report.self_evolution_deployment && Array.isArray(report.self_evolution_deployment.blockers) && report.self_evolution_deployment.blockers.length ? report.self_evolution_deployment.blockers.join("|") : "none"}`,
    "",
    "## Self-Evolution Deployment Plan",
    `- status/prepare/manual: ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.plan_status || "N/A"} / ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.prepare_pass ? "PASS" : "BLOCK"} / ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.manual_step_required ? "YES" : "NO"}`,
    `- target/wave/markets: ${report.self_evolution_deployment_plan && (report.self_evolution_deployment_plan.display_candidate_id || report.self_evolution_deployment_plan.target_candidate_id) || "N/A"} / ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.open_wave != null ? report.self_evolution_deployment_plan.open_wave : "N/A"} / ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.market_scope_ready_n != null ? report.self_evolution_deployment_plan.market_scope_ready_n : "N/A"} / ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.market_scope_n != null ? report.self_evolution_deployment_plan.market_scope_n : "N/A"}`,
    `- prepared/latest/rollback: ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.prepared_file_path || "N/A"} / ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.latest_generated_file_path || "N/A"} / ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.rollback_source_file_path || "N/A"}`,
    `- blockers: ${report.self_evolution_deployment_plan && Array.isArray(report.self_evolution_deployment_plan.blockers) && report.self_evolution_deployment_plan.blockers.length ? report.self_evolution_deployment_plan.blockers.join("|") : "none"}`,
    "",
    "## Self-Evolution Loop Monitor",
    `- cycle/status/consistent: ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.cycle_id || "N/A"} / ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.overall_status || "N/A"} / ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.cycle_consistent ? "YES" : "NO"}`,
    `- fresh/stale: ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.fresh_loop_n != null ? report.self_evolution_loop_monitor.fresh_loop_n : "N/A"} / ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.loop_n != null ? report.self_evolution_loop_monitor.loop_n : "N/A"} / ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.stale_artifact_n != null ? report.self_evolution_loop_monitor.stale_artifact_n : "N/A"}`,
    `- promotion/manual: ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.promotion_path_ready ? "YES" : "NO"} / ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.manual_paste_ready ? "YES" : "NO"} / candidate ${report.self_evolution_loop_monitor && report.self_evolution_loop_monitor.ready_candidate_id || "N/A"}`,
    `- blockers: ${report.self_evolution_loop_monitor && Array.isArray(report.self_evolution_loop_monitor.critical_blockers) && report.self_evolution_loop_monitor.critical_blockers.length ? report.self_evolution_loop_monitor.critical_blockers.join("|") : "none"}`,
    "",
    "## Self-Evolution Weight Tuning",
    `- advisory_mode: ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.advisory_mode || "N/A"}`,
    `- suggestion_n/dominant_axis: ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.suggestion_n != null ? report.self_evolution_weight_tuning.summary.suggestion_n : "N/A"} / ${report.self_evolution_weight_tuning && report.self_evolution_weight_tuning.summary && report.self_evolution_weight_tuning.summary.dominant_axis || "N/A"}`,
    ...((report.self_evolution_weight_tuning && Array.isArray(report.self_evolution_weight_tuning.suggestions) && report.self_evolution_weight_tuning.suggestions.length)
      ? report.self_evolution_weight_tuning.suggestions.slice(0, 10).map((row) => `- ${row.axis}: ${row.direction} ${row.delta} / ${row.reason}`)
      : ["- none"]),
    "",
    "## Self-Evolution Memory",
    `- total/current/blocked: ${report.self_evolution_memory && report.self_evolution_memory.total_n != null ? report.self_evolution_memory.total_n : "N/A"} / ${report.self_evolution_memory && report.self_evolution_memory.current_n != null ? report.self_evolution_memory.current_n : "N/A"} / ${report.self_evolution_memory && report.self_evolution_memory.blocked_candidate_n != null ? report.self_evolution_memory.blocked_candidate_n : "N/A"}`,
    `- success/neutral/fail/rolled_back: ${report.self_evolution_memory && report.self_evolution_memory.success_n != null ? report.self_evolution_memory.success_n : "N/A"} / ${report.self_evolution_memory && report.self_evolution_memory.neutral_n != null ? report.self_evolution_memory.neutral_n : "N/A"} / ${report.self_evolution_memory && report.self_evolution_memory.fail_n != null ? report.self_evolution_memory.fail_n : "N/A"} / ${report.self_evolution_memory && report.self_evolution_memory.rolled_back_n != null ? report.self_evolution_memory.rolled_back_n : "N/A"}`,
    `- avg objective/count/replacement/ret: ${signedNum(report.self_evolution_memory && report.self_evolution_memory.avg_objective_delta, 4)} / ${signedNum(report.self_evolution_memory && report.self_evolution_memory.avg_count_delta, 4)} / ${signedNum(report.self_evolution_memory && report.self_evolution_memory.avg_replacement_delta, 4)} / ${signedNum(report.self_evolution_memory && report.self_evolution_memory.avg_ret_net_delta, 4)}`,
    `- top success: ${report.self_evolution_memory && report.self_evolution_memory.top_success_candidate_id || "N/A"} / top failed: ${report.self_evolution_memory && report.self_evolution_memory.top_failed_candidate_id || "N/A"}`,
    `- blocked_candidate_ids: ${report.self_evolution_memory && Array.isArray(report.self_evolution_memory.blocked_candidate_ids) && report.self_evolution_memory.blocked_candidate_ids.length ? report.self_evolution_memory.blocked_candidate_ids.join(", ") : "none"}`,
    "",
    "## BEST/FEBT Market Contracts",
    ...((Array.isArray(report.best_febt_market_contracts) && report.best_febt_market_contracts.length)
      ? report.best_febt_market_contracts.map((row) => `- ${formatBestFebtMarketContractLine(row)}`)
      : ["- none"]),
    "",
    "## Tuning Inputs",
    `- EV: ${report.tuning && report.tuning.ev_reason || "N/A"}`,
    `- WAIT: ${report.tuning && report.tuning.wait_reason || "N/A"}`,
    `- ML: quality=${report.tuning && report.tuning.ml_quality_actions != null ? report.tuning.ml_quality_actions : "N/A"} / market=${report.tuning && report.tuning.ml_market_action || "N/A"} / ev=${report.tuning && report.tuning.ml_ev_action || "N/A"}`,
    "",
    "## Codex Review",
    `- status: ${report.codex_review && report.codex_review.status || "N/A"}`,
    `- verdict: ${report.codex_review && report.codex_review.verdict || "N/A"}`,
    `- candidate: ${report.codex_review && (report.codex_review.display_candidate_id || report.codex_review.recommended_candidate_id) || "N/A"}`,
    `- rollback: ${report.codex_review && report.codex_review.recommended_rollback_file_path || "N/A"}`,
    `- confidence: ${report.codex_review && report.codex_review.confidence != null ? report.codex_review.confidence : "N/A"}`,
    `- reason: ${report.codex_review && report.codex_review.reason || "N/A"}`,
    "",
    "## Codex Authority",
    `- owner/mode/status/verdict: ${report.codex_authority && report.codex_authority.owner || "N/A"} / ${report.codex_authority && report.codex_authority.authority_mode || "N/A"} / ${report.codex_authority && report.codex_authority.status || "N/A"} / ${report.codex_authority && report.codex_authority.verdict || "N/A"}`,
    `- manual/ready/prepared: ${report.codex_authority && report.codex_authority.manual_step_required ? "YES" : "NO"} / ${report.codex_authority && report.codex_authority.ready_for_manual_paste ? "YES" : "NO"} / ${report.codex_authority && report.codex_authority.prepared_stage_ready ? "YES" : "NO"}`,
    `- candidate/file/rollback: ${report.codex_authority && (report.codex_authority.display_candidate_id || report.codex_authority.recommended_candidate_id) || "N/A"} / ${report.codex_authority && report.codex_authority.prepared_file_path || report.codex_authority && report.codex_authority.latest_generated_file_path || "N/A"} / ${report.codex_authority && report.codex_authority.recommended_rollback_file_path || report.codex_authority && report.codex_authority.rollback_source_file_path || "N/A"}`,
    `- blockers: ${report.codex_authority && Array.isArray(report.codex_authority.blockers) && report.codex_authority.blockers.length ? report.codex_authority.blockers.join("|") : "none"}`,
    "",
    "## Stage Autopilot",
    `- status: ${report.stage_autopilot && report.stage_autopilot.status || "N/A"}`,
    `- objective: ${report.stage_autopilot && report.stage_autopilot.objective_verdict || "N/A"}`,
    `- actions: ${report.stage_autopilot && report.stage_autopilot.action_n != null ? report.stage_autopilot.action_n : "N/A"} / ${(report.stage_autopilot && report.stage_autopilot.action_types && report.stage_autopilot.action_types.length) ? report.stage_autopilot.action_types.join(", ") : "none"}`,
    "",
    "## Artifacts",
  ];
  for (const row of report.artifacts || []) {
    lines.push(`- ${row.name}: ${row.fresh ? "fresh" : "stale"} / ${row.filePath || "N/A"}`);
  }
  return `${lines.join("\n")}\n`;
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const selfEvolutionStage = String(process.env.OBJECTIVE_SUPERVISOR_SELF_EVOLUTION_STAGE || "STANDALONE").trim().toUpperCase();
  const governanceArtifact = readArtifact("weekly_governance", GOVERNANCE_LATEST_PATH, FRESHNESS_HOURS.governance);
  const changeArtifact = readArtifact("change_control", CHANGE_CONTROL_LATEST_PATH, FRESHNESS_HOURS.changeControl);
  const canaryArtifact = readArtifact("shadow_canary", CANARY_LATEST_PATH, FRESHNESS_HOURS.canary);
  const mlArtifact = readArtifact("ml_policy", ML_LATEST_PATH, FRESHNESS_HOURS.ml);
  const evArtifact = readArtifact("ev_tuner", EV_LATEST_PATH, FRESHNESS_HOURS.ev);
  const waitArtifact = readArtifact("wait_tuner", WAIT_LATEST_PATH, FRESHNESS_HOURS.wait);
  const phase0Artifact = readArtifact("febt_phase0", FEBT_PHASE0_LATEST_PATH, FRESHNESS_HOURS.phase0);
  const selfEvolutionDatasetArtifact = readArtifact("self_evolution_dataset", SELF_EVOLUTION_DATASET_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionDataset);
  const selfEvolutionObjectiveArtifact = readArtifact("self_evolution_objective", SELF_EVOLUTION_OBJECTIVE_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionObjective);
  const selfEvolutionAttributionArtifact = readArtifact("self_evolution_attribution", SELF_EVOLUTION_ATTRIBUTION_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionAttribution);
  const selfEvolutionCandidatesArtifact = readArtifact("self_evolution_candidates", SELF_EVOLUTION_CANDIDATES_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionCandidates);
  const selfEvolutionReplayArtifact = readArtifact("self_evolution_replay", SELF_EVOLUTION_REPLAY_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionReplay);
  const selfEvolutionCanaryArtifact = readArtifact("self_evolution_canary", SELF_EVOLUTION_CANARY_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionCanary);
  const selfEvolutionMemoryArtifact = readArtifact("self_evolution_memory", SELF_EVOLUTION_MEMORY_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionMemory);
  const codexArtifact = readArtifact("codex_patch", CODEX_PATCH_LATEST_PATH, FRESHNESS_HOURS.codex);
  const stageAutopilotArtifact = readArtifact("stage_autopilot", STAGE_AUTOPILOT_LATEST_PATH, FRESHNESS_HOURS.stageAutopilot);
  const weeklyPineHistoryArtifact = readArtifact("weekly_pine_history", WEEKLY_PINE_HISTORY_PATH, FRESHNESS_HOURS.weeklyPineHistory);
  const retrospectiveArtifact = readArtifact("objective_retrospective", RETROSPECTIVE_LATEST_PATH, FRESHNESS_HOURS.retrospective);
  const selfEvolutionCycleState = summarizeSelfEvolutionArtifactCycles({
    stage: selfEvolutionStage,
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    artifacts: {
      dataset: selfEvolutionDatasetArtifact,
      objective: selfEvolutionObjectiveArtifact,
      attribution: selfEvolutionAttributionArtifact,
      candidates: selfEvolutionCandidatesArtifact,
      replay: selfEvolutionReplayArtifact,
      canary: selfEvolutionCanaryArtifact,
      memory: selfEvolutionMemoryArtifact,
      codex: codexArtifact,
      stageAutopilot: stageAutopilotArtifact,
    },
  });
  const reportCycleId = selfEvolutionCycleState.expected_cycle_id || cycleMeta.cycle_id;

  const selfEvolutionMemoryData = selfEvolutionMemoryArtifact.exists
    ? { ...selfEvolutionMemoryArtifact.data, fresh: selfEvolutionMemoryArtifact.fresh }
    : buildMemoryLedger({
      candidateChangeSet: selfEvolutionCandidatesArtifact.data,
      replayReport: selfEvolutionReplayArtifact.data,
      canaryReport: selfEvolutionCanaryArtifact.data,
      previousLedger: null,
      nowMeta,
    });

  const evaluation = evaluateSupervisor({
    governance: governanceArtifact.data,
    changeControl: changeArtifact.data,
    canary: canaryArtifact.data,
    ml: mlArtifact.data,
    ev: evArtifact.exists ? { ...evArtifact.data, fresh: evArtifact.fresh, age_hours: evArtifact.ageHours } : null,
    wait: waitArtifact.data,
    phase0: phase0Artifact.exists ? { ...phase0Artifact.data, fresh: phase0Artifact.fresh } : null,
    selfEvolutionDataset: selfEvolutionDatasetArtifact.exists ? { ...selfEvolutionDatasetArtifact.data, fresh: selfEvolutionDatasetArtifact.fresh } : null,
    selfEvolutionObjective: selfEvolutionObjectiveArtifact.exists ? { ...selfEvolutionObjectiveArtifact.data, fresh: selfEvolutionObjectiveArtifact.fresh } : null,
    selfEvolutionAttribution: selfEvolutionAttributionArtifact.exists ? { ...selfEvolutionAttributionArtifact.data, fresh: selfEvolutionAttributionArtifact.fresh } : null,
    selfEvolutionCandidates: selfEvolutionCandidatesArtifact.exists ? { ...selfEvolutionCandidatesArtifact.data, fresh: selfEvolutionCandidatesArtifact.fresh } : null,
    selfEvolutionReplay: selfEvolutionReplayArtifact.exists ? { ...selfEvolutionReplayArtifact.data, fresh: selfEvolutionReplayArtifact.fresh } : null,
    selfEvolutionCanary: selfEvolutionCanaryArtifact.exists ? { ...selfEvolutionCanaryArtifact.data, fresh: selfEvolutionCanaryArtifact.fresh } : null,
    selfEvolutionMemory: selfEvolutionMemoryData,
    selfEvolutionLoopMonitor: null,
    selfEvolutionCycleState,
    codex: codexArtifact.exists ? { ...codexArtifact.data, fresh: codexArtifact.fresh } : null,
    stageAutopilot: stageAutopilotArtifact.exists ? { ...stageAutopilotArtifact.data, fresh: stageAutopilotArtifact.fresh } : null,
    retrospective: retrospectiveArtifact.data,
    weeklyHistory: weeklyPineHistoryArtifact.data,
  });

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    source_cycle_id: selfEvolutionCycleState.expected_cycle_id || null,
    evaluation_cycle_id: cycleMeta.cycle_id,
    evaluation_scope: selfEvolutionStage,
    verdict: evaluation.verdict,
    reason: evaluation.reason,
    root_cause: evaluation.root_cause,
    action_plan: evaluation.action_plan,
    blockers: evaluation.blockers,
    objective: evaluation.objective,
    governance_objective: evaluation.governance_objective,
    promotion: evaluation.promotion,
    rollback: evaluation.rollback,
    guards: evaluation.guards,
    physics: evaluation.physics,
    phase0: evaluation.phase0,
    self_evolution_dataset: evaluation.self_evolution_dataset,
    self_evolution_objective: evaluation.self_evolution_objective,
    self_evolution_attribution: evaluation.self_evolution_attribution,
    self_evolution_candidates: evaluation.self_evolution_candidates,
    self_evolution_replay: evaluation.self_evolution_replay,
    self_evolution_canary: evaluation.self_evolution_canary,
    self_evolution_cycle: evaluation.self_evolution_cycle,
    self_evolution_deployment: evaluation.self_evolution_deployment,
    self_evolution_deployment_plan: evaluation.self_evolution_deployment_plan,
    self_evolution_loop_monitor: null,
    self_evolution_weight_tuning: evaluation.self_evolution_weight_tuning,
    self_evolution_memory: evaluation.self_evolution_memory,
    sample_readiness: evaluation.sample_readiness,
    filter_layers: evaluation.filter_layers,
    best_febt_tuning_contract: {
      ...(evaluation.best_febt_tuning_contract || {}),
      objective_verdict: evaluation.verdict,
    },
    self_evolution_policy: evaluation.self_evolution_policy,
    best_febt_market_contracts: evaluation.best_febt_market_contracts,
    tuning: evaluation.tuning,
    codex_review: evaluation.codex_review,
    codex_authority: evaluation.codex_authority,
    stage_autopilot: evaluation.stage_autopilot,
    retrospective: evaluation.retrospective,
    artifacts: [governanceArtifact, changeArtifact, canaryArtifact, mlArtifact, evArtifact, waitArtifact, phase0Artifact, selfEvolutionDatasetArtifact, selfEvolutionObjectiveArtifact, selfEvolutionAttributionArtifact, selfEvolutionCandidatesArtifact, selfEvolutionReplayArtifact, selfEvolutionCanaryArtifact, selfEvolutionMemoryArtifact, codexArtifact, stageAutopilotArtifact, weeklyPineHistoryArtifact, retrospectiveArtifact].map((row) => ({
      name: row.name,
      filePath: row.filePath,
      fresh: row.fresh,
      age_hours: row.ageHours,
    })),
  };

  report.self_evolution_loop_monitor = summarizeSelfEvolutionLoopMonitor(deriveLoopMonitor({
    artifacts: {
      objectiveSupervisor: { fresh: true },
      candidates: selfEvolutionCandidatesArtifact,
      replay: selfEvolutionReplayArtifact,
      canary: selfEvolutionCanaryArtifact,
      deployment: { fresh: true },
      deploymentPlan: { fresh: true },
      stageAutopilot: stageAutopilotArtifact,
      weightTuning: { fresh: true },
      memory: selfEvolutionMemoryArtifact.exists ? selfEvolutionMemoryArtifact : { fresh: true },
      codexPatch: codexArtifact,
    },
    reports: {
      objectiveSupervisor: report,
      candidates: selfEvolutionCandidatesArtifact.data,
      replay: selfEvolutionReplayArtifact.data,
      canary: selfEvolutionCanaryArtifact.data,
      deployment: { cycle_id: reportCycleId, summary: evaluation.self_evolution_deployment },
      deploymentPlan: { cycle_id: reportCycleId, summary: evaluation.self_evolution_deployment_plan },
      stageAutopilot: stageAutopilotArtifact.data,
      weightTuning: { cycle_id: reportCycleId, ...evaluation.self_evolution_weight_tuning },
      memory: selfEvolutionMemoryData,
      codexPatch: codexArtifact.data,
    },
  }));

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_objective_supervisor.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_objective_supervisor.md`);
  writeJson(jsonPath, wrapDisplayAndRawReport(report));
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);
  if (selfEvolutionStage !== "STANDALONE") {
    copySelfEvolutionLatest(jsonPath, SELF_EVOLUTION_REPORT_LATEST_JSON);
    copySelfEvolutionLatest(mdPath, SELF_EVOLUTION_REPORT_LATEST_MD);
  }
  const telegramSections = buildObjectiveSupervisorTelegramSections(report);

  if (String(process.env.OBJECTIVE_SUPERVISOR_SKIP_TELEGRAM || "").trim() !== "1") {
    const alert = await sendKoreanTelegramSummary({
      title: `[목표 점검] ${report.verdict}`,
      severity: report.verdict === "ROLLBACK_CANDIDATE" ? "WARN" : (report.verdict === "PATCH_CANDIDATE" ? "INFO" : "INFO"),
      dedupeKey: `objective_supervisor:${report.verdict}:${report.reason}`,
      dedupeWindowSec: 18 * 60 * 60,
      dedupeFingerprint: JSON.stringify({
        verdict: report.verdict,
        reason: report.reason,
        blockers: report.blockers,
        physics: report.physics,
        retrospective: report.retrospective,
      }),
      sections: telegramSections,
    });
    if (!alert || (alert.ok !== true && !(alert.skipped && alert.reason === "SKIP_ALERT"))) {
      throw new Error(`TELEGRAM_SEND_FAILED:${JSON.stringify(alert || {})}`);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    verdict: report.verdict,
    reason: report.reason,
    blockers: report.blockers,
    promotion_ready: report.promotion.ready,
    rollback_ready: report.rollback.ready,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
}

module.exports = {
  __test: {
    evaluateSupervisor,
    buildObjectiveSupervisorTelegramSections,
    buildFilterLayerSummary,
    deriveBestFebtTuningContract,
    deriveBestFebtMarketContracts,
    formatBestFebtMarketContractLine,
    summarizeSelfEvolutionObjective,
    summarizeSelfEvolutionAttribution,
    summarizeSelfEvolutionCandidates,
    summarizeSelfEvolutionReplay,
    summarizeSelfEvolutionCanary,
    summarizeSelfEvolutionMemory,
    summarizeSelfEvolutionDeploymentPlan,
    summarizeSelfEvolutionLoopMonitor,
    summarizeSelfEvolutionArtifactCycles,
    summarizeCodexAuthority,
  },
};
