#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const { normalizeCanonicalEngineMarketOverrides } = require("../src/services/canonicalEngine");
const {
  OPS_DAILY_DIR,
  OPS_RUNTIME_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  sendKoreanTelegramSummary,
  selfEvolutionSnapshotLatestPath,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { readBestFebtSupervisorContext } = require("./lib/best-febt-supervisor");
const { wrapDisplayAndRawReport } = require("../src/utils/jsonDisplayFields");
const { normalizePreparedOverride } = require("../src/utils/selfEvolutionPreparedOverride");
const {
  STATE_MACHINE,
  appendStageHistory,
  buildRollbackPrepared,
  computeSignatureStreak,
  evaluateCommonAutoApply,
  getStageState,
  normalizeSignature,
  pickSettingsSnapshot,
  readWeeklyPineLatestHistoryRow,
  readAutopilotState,
  readStageSnapshot,
  shouldAutoRollback,
  updateProviderSettings,
  writeAutopilotState,
  writeStageSnapshot,
} = require("./lib/stage-autopilot");

loadLocalEnv();

const PROVIDER = String(process.env.STAGE_AUTOPILOT_PROVIDER || "BINANCEFUT").trim().toUpperCase();
const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "stage_autopilot_latest.json");
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "stage_autopilot_latest.md");
const AI_STAGE_SAMPLE_MIN = Math.max(20, Number(process.env.STAGE_AUTOPILOT_AI_MIN_SAMPLE || 40));
const MARKET_STAGE_SAMPLE_MIN = Math.max(16, Number(process.env.STAGE_AUTOPILOT_MARKET_MIN_SAMPLE || 30));
const MARKET_AI_BIAS_MIN_COVERAGE = Math.max(0, Math.min(1, Number(process.env.STAGE_AUTOPILOT_MARKET_AI_BIAS_MIN_COVERAGE || 0.05)));
const STREAK_REQUIRED = Math.max(2, Number(process.env.STAGE_AUTOPILOT_STREAK_REQUIRED || 2));
const CHANGE_BUDGET_WINDOW_HOURS = Math.max(12, Number(process.env.STAGE_AUTOPILOT_CHANGE_BUDGET_WINDOW_HOURS || 24));
const CHANGE_BUDGET_LIMIT = Math.max(1, Number(process.env.STAGE_AUTOPILOT_CHANGE_BUDGET_LIMIT || 2));
const SAME_STAGE_COOLDOWN_HOURS = Math.max(12, Number(process.env.STAGE_AUTOPILOT_STAGE_COOLDOWN_HOURS || 36));
const PINE_REVIEW_MAX_AGE_HOURS = Math.max(6, Number(process.env.STAGE_AUTOPILOT_PINE_REVIEW_MAX_AGE_HOURS || 36));
const FRESHNESS_HOURS = Object.freeze({
  objective: Math.max(6, Number(process.env.STAGE_AUTOPILOT_OBJECTIVE_MAX_AGE_HOURS || 18)),
  ml: Math.max(6, Number(process.env.STAGE_AUTOPILOT_ML_MAX_AGE_HOURS || 18)),
  ev: Math.max(24, Number(process.env.STAGE_AUTOPILOT_EV_MAX_AGE_HOURS || 96)),
  wait: Math.max(24, Number(process.env.STAGE_AUTOPILOT_WAIT_MAX_AGE_HOURS || 144)),
  change: Math.max(12, Number(process.env.STAGE_AUTOPILOT_CHANGE_MAX_AGE_HOURS || 48)),
  canary: Math.max(4, Number(process.env.STAGE_AUTOPILOT_CANARY_MAX_AGE_HOURS || 12)),
  selfEvolutionCanary: Math.max(4, Number(process.env.STAGE_AUTOPILOT_SELF_EVOLUTION_CANARY_MAX_AGE_HOURS || 12)),
  serverPrimaryCanary: Math.max(4, Number(process.env.STAGE_AUTOPILOT_SERVER_PRIMARY_CANARY_MAX_AGE_HOURS || 12)),
  codex: Math.max(12, Number(process.env.STAGE_AUTOPILOT_CODEX_MAX_AGE_HOURS || 48)),
});
const SELF_EVOLUTION_CANARY_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json");
const SELF_EVOLUTION_CANONICAL_PARITY_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_canonical_engine_parity_latest.json");
const SELF_EVOLUTION_SERVER_PRIMARY_CANARY_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_server_primary_canary_latest.json");
const SELF_EVOLUTION_OBJECTIVE_SUPERVISOR_LATEST_PATH = selfEvolutionSnapshotLatestPath("objective_supervisor_latest.json");
const SELF_EVOLUTION_LOOP_MONITOR_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_loop_monitor_latest.json");
const SELF_EVOLUTION_DEPLOYMENT_PLAN_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_plan_latest.json");
const SELF_EVOLUTION_CANDIDATES_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json");
const SELF_EVOLUTION_PREPARED_OVERRIDE_PATH = path.join(OPS_RUNTIME_DIR, "self_evolution_prepared_override.json");
const AI_SNAPSHOT_KEYS = Object.freeze([
  "ai_missing_policy",
  "ai_missing_reduce_pct",
]);
const MARKET_SNAPSHOT_KEYS = Object.freeze([
  "ai_bias_gate_enabled",
  "ai_bias_gate_neutral_policy",
  "ai_bias_gate_score_threshold",
  "ai_bias_gate_conf_min",
  "ai_bias_gate_core_enabled",
  "ai_bias_gate_pre_real_enabled",
  "ai_bias_gate_real_enabled",
  "ai_bias_gate_early_enabled",
  "ai_bias_gate_emo_enabled",
  "ai_bias_gate_neutral_mult",
  "ai_bias_gate_opposite_mult",
  "ai_bias_gate_strong_opposite_score",
  "ai_bias_gate_strong_opposite_conf",
]);
const CANONICAL_POLICY_SNAPSHOT_KEYS = Object.freeze([
  "canonical_engine_enabled",
  "canonical_engine_shadow_enabled",
  "canonical_engine_source_mode",
  "canonical_engine_core_score_abs",
  "canonical_engine_transition_core_score_abs",
  "canonical_engine_market_overrides",
]);
const SOURCE_MODE_SNAPSHOT_KEYS = CANONICAL_POLICY_SNAPSHOT_KEYS;
const EV_SNAPSHOT_KEYS = Object.freeze([
  "ev_gate_tp1_prob_min",
  "ev_gate_tp1_prob_full",
  "ev_gate_tp1_prob_kill",
  "ev_gate_qty_scale_mid",
  "ev_gate_qty_scale_low",
]);

function buildLoopMonitorView({ objectiveArtifact = null, loopMonitorArtifact = null, cycleMeta = null } = {}) {
  const expectedCycleId = String(cycleMeta && cycleMeta.cycle_id || "").trim() || null;
  const loopMonitorData = loopMonitorArtifact && loopMonitorArtifact.data && typeof loopMonitorArtifact.data === "object"
    ? (loopMonitorArtifact.data.raw && typeof loopMonitorArtifact.data.raw === "object" ? loopMonitorArtifact.data.raw : loopMonitorArtifact.data)
    : null;
  const loopSummary = loopMonitorData && loopMonitorData.summary && typeof loopMonitorData.summary === "object"
    ? loopMonitorData.summary
    : null;
  if (
    loopMonitorArtifact
    && loopMonitorArtifact.fresh === true
    && loopSummary
    && String(loopSummary.cycle_id || "").trim()
    && String(loopSummary.cycle_id || "").trim() === expectedCycleId
  ) {
    return {
      available: true,
      source: "FINAL_LOOP_MONITOR",
      cycle_id: String(loopSummary.cycle_id || "").trim() || expectedCycleId,
      overall_status: String(loopSummary.overall_status || "").trim().toUpperCase() || null,
      cycle_consistent: loopSummary.cycle_consistent === true
        ? true
        : (loopSummary.cycle_consistent === false ? false : null),
      stale_artifact_n: toNum(loopSummary.stale_artifact_n),
      critical_blockers: Array.isArray(loopSummary.critical_blockers) ? loopSummary.critical_blockers : [],
      promotion_path_ready: loopSummary.promotion_path_ready === true,
      manual_paste_ready: loopSummary.manual_paste_ready === true,
      ready_candidate_id: String(loopSummary.ready_candidate_id || "").trim() || null,
    };
  }
  return {
    available: false,
    source: "PENDING_FINAL_LOOP_MONITOR",
    cycle_id: expectedCycleId,
    overall_status: "PENDING_FINAL_LOOP_MONITOR",
    cycle_consistent: null,
    stale_artifact_n: null,
    critical_blockers: [],
    promotion_path_ready: false,
    manual_paste_ready: false,
    ready_candidate_id: null,
  };
}

function resolveReportCycleId({ preferredCycleId = null, objectiveArtifact = null, deploymentPlan = null, loopMonitor = null, fallbackCycleId = null } = {}) {
  const objectiveData = objectiveArtifact && objectiveArtifact.data && typeof objectiveArtifact.data === "object"
    ? objectiveArtifact.data
    : {};
  const deploymentData = deploymentPlan && typeof deploymentPlan === "object"
    ? deploymentPlan
    : {};
  const loopData = loopMonitor && typeof loopMonitor === "object"
    ? loopMonitor
    : {};
  return String(
    preferredCycleId
    || objectiveData.source_cycle_id
    || objectiveData.cycle_id
    || deploymentData.source_cycle_id
    || deploymentData.cycle_id
    || loopData.cycle_id
    || fallbackCycleId
    || ""
  ).trim() || null;
}

function applyPreparedOverrideToPineArtifacts({ pineHandoff = null, pineStageRow = null, preparedOverride = null } = {}) {
  const override = preparedOverride && typeof preparedOverride === "object" ? preparedOverride : {};
  if (override.active !== true) return { pineHandoff, pineStageRow };

  const nextHandoff = pineHandoff && typeof pineHandoff === "object" ? { ...pineHandoff } : {};
  nextHandoff.stage_ready = true;
  nextHandoff.target_candidate_id = override.target_candidate_id || nextHandoff.target_candidate_id || null;
  nextHandoff.display_candidate_id = override.display_candidate_id || nextHandoff.display_candidate_id || null;
  nextHandoff.prepared_file_path = override.prepared_file_path || nextHandoff.prepared_file_path || null;
  nextHandoff.prepared_strategy_id = override.prepared_strategy_id || nextHandoff.prepared_strategy_id || null;
  nextHandoff.latest_generated_file_path = override.latest_generated_file_path || nextHandoff.latest_generated_file_path || null;
  nextHandoff.rollback_source_file_path = override.rollback_source_file_path || nextHandoff.rollback_source_file_path || null;
  nextHandoff.candidate_signature = override.target_candidate_id || nextHandoff.candidate_signature || null;

  const nextStageRow = pineStageRow && typeof pineStageRow === "object" ? { ...pineStageRow } : {};
  nextStageRow.machine_state = "READY";
  nextStageRow.reason = "MANUAL_PREPARED_OVERRIDE";
  nextStageRow.last_action = nextStageRow.last_action || "HOLD";
  nextStageRow.prepared_file_path = override.prepared_file_path || nextStageRow.prepared_file_path || null;
  nextStageRow.prepared_strategy_id = override.prepared_strategy_id || nextStageRow.prepared_strategy_id || null;
  nextStageRow.latest_generated_file_path = override.latest_generated_file_path || nextStageRow.latest_generated_file_path || null;
  nextStageRow.rollback_source_file_path = override.rollback_source_file_path || nextStageRow.rollback_source_file_path || null;
  nextStageRow.signature = override.target_candidate_id || nextStageRow.signature || null;
  nextStageRow.display_signature = override.display_candidate_id || nextStageRow.display_signature || null;
  return { pineHandoff: nextHandoff, pineStageRow: nextStageRow };
}

function toNum(v) {
  if (v === null || v === undefined || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function pct(v, digits = 2) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "N/A";
  return `${(n * 100).toFixed(digits)}%`;
}

function readArtifact(name, filePath, maxAgeHours) {
  const data = readJsonRawSafe(filePath, null);
  if (!data) return { name, filePath, data: null, exists: false, fresh: false, ageHours: null };
  try {
    const st = fs.statSync(filePath);
    const ageHours = (Date.now() - Number(st.mtimeMs || 0)) / (60 * 60 * 1000);
    return {
      name,
      filePath,
      data,
      exists: true,
      fresh: Number.isFinite(ageHours) && ageHours <= maxAgeHours,
      ageHours,
    };
  } catch (_err) {
    return { name, filePath, data, exists: true, fresh: false, ageHours: null };
  }
}

function stableSignature(obj = {}) {
  const keys = Object.keys(obj || {}).sort();
  return keys.map((key) => `${key}=${JSON.stringify(obj[key])}`).join("|");
}

function countRecentMutations(history = [], nowMs, hours, stage = null) {
  const cutoff = nowMs - (hours * 60 * 60 * 1000);
  return (Array.isArray(history) ? history : []).filter((row) => {
    const ts = Number(row && row.ts_ms);
    if (!Number.isFinite(ts) || ts < cutoff) return false;
    if (stage && String(row && row.stage || "") !== String(stage)) return false;
    const action = String(row && row.action || "").toUpperCase();
    return action === "AUTO_APPLY" || action === "AUTO_ROLLBACK" || action === "PINE_PREPARE";
  }).length;
}

function stageChangeBudgetOk(history = [], nowMs, stage) {
  if (countRecentMutations(history, nowMs, CHANGE_BUDGET_WINDOW_HOURS) >= CHANGE_BUDGET_LIMIT) return false;
  if (countRecentMutations(history, nowMs, SAME_STAGE_COOLDOWN_HOURS, stage) > 0) return false;
  return true;
}

function buildAiStageCandidate(mlArtifact, currentSys = {}, objectiveSupervisor = {}) {
  const rec = mlArtifact && mlArtifact.data && mlArtifact.data.recommendations ? mlArtifact.data.recommendations.AI : null;
  const aiSamples = toNum(mlArtifact && mlArtifact.data && mlArtifact.data.stage_samples && mlArtifact.data.stage_samples.ai_n) || 0;
  const selfValidationOk = Boolean(mlArtifact && mlArtifact.data && mlArtifact.data.self_validation && mlArtifact.data.self_validation.ok === true);
  const action = String(rec && rec.action || "KEEP").toUpperCase();
  const nextPolicy = String(rec && (rec.next_policy || rec.next) || currentSys.ai_missing_policy || "ALLOW").trim().toUpperCase();
  const nextReducePct = toNum(rec && (rec.next_reduce_pct != null ? rec.next_reduce_pct : (rec && rec.key === "ai_missing_reduce_pct" ? rec.next : currentSys.ai_missing_reduce_pct)));
  const currentPolicy = String(currentSys.ai_missing_policy || "ALLOW").trim().toUpperCase();
  const currentReducePct = toNum(currentSys.ai_missing_reduce_pct) ?? 0.5;
  const actionable = action === "REVIEW_UPDATE" && !!rec && !rec.blocked_action;
  const nextSettings = actionable
    ? {
      ai_missing_policy: nextPolicy || currentPolicy,
      ai_missing_reduce_pct: nextReducePct == null ? currentReducePct : nextReducePct,
    }
    : {};
  return {
    stage: "AI",
    actionable,
    action,
    reason: String(rec && rec.reason || "NO_ACTIONABLE_AI_RECOMMENDATION"),
    signature: actionable ? stableSignature(nextSettings) : null,
    nextSettings,
    streakRequired: STREAK_REQUIRED,
    sampleSufficient: aiSamples >= AI_STAGE_SAMPLE_MIN,
    coverageSufficient: selfValidationOk,
    objectiveEnoughSample: Boolean(objectiveSupervisor && objectiveSupervisor.objective && objectiveSupervisor.objective.enough_sample === true),
    objectiveDirectionOk: actionable,
    challengerBeatsCurrent: actionable,
    support_n: toNum(rec && rec.support_n),
    support_rate: toNum(rec && rec.support_rate),
  };
}

function buildMarketStageCandidate(mlArtifact, currentSys = {}, objectiveSupervisor = {}) {
  const rec = mlArtifact && mlArtifact.data && mlArtifact.data.recommendations ? mlArtifact.data.recommendations.MARKET : null;
  const marketSamples = toNum(mlArtifact && mlArtifact.data && mlArtifact.data.stage_samples && mlArtifact.data.stage_samples.market_n) || 0;
  const aiBiasCoverage = toNum(mlArtifact && mlArtifact.data && mlArtifact.data.coverage && mlArtifact.data.coverage.ai_bias_rate) || 0;
  const selfValidationOk = Boolean(mlArtifact && mlArtifact.data && mlArtifact.data.self_validation && mlArtifact.data.self_validation.ok === true);
  const action = String(rec && rec.action || "KEEP").toUpperCase();
  const actionable = (action === "REVIEW_SOFTEN" || action === "REVIEW_TIGHTEN") && !!rec && !!rec.key && !rec.blocked_action;
  const nextSettings = actionable ? { [rec.key]: rec.next } : {};
  return {
    stage: "MARKET",
    actionable,
    action,
    reason: String(rec && rec.reason || "NO_ACTIONABLE_MARKET_RECOMMENDATION"),
    signature: actionable ? stableSignature(nextSettings) : null,
    nextSettings,
    streakRequired: STREAK_REQUIRED,
    sampleSufficient: marketSamples >= MARKET_STAGE_SAMPLE_MIN,
    coverageSufficient: selfValidationOk && aiBiasCoverage >= MARKET_AI_BIAS_MIN_COVERAGE && Boolean(objectiveSupervisor && objectiveSupervisor.guards && objectiveSupervisor.guards.market_coverage_pass === true),
    objectiveEnoughSample: Boolean(objectiveSupervisor && objectiveSupervisor.objective && objectiveSupervisor.objective.enough_sample === true),
    objectiveDirectionOk: actionable,
    challengerBeatsCurrent: actionable,
  };
}

function toCanonicalThresholdDelta(change = {}) {
  const current = toNum(change && change.current);
  const next = toNum(change && change.next);
  if (current == null && next == null) return null;
  if (current == null) return next;
  if (next == null) return null;
  return next - current;
}

function clampCanonicalThreshold(value, fallback) {
  const n = toNum(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(100, n));
}

function normalizeCandidateMarkets(markets = []) {
  const rows = Array.isArray(markets) ? markets : [];
  const normalized = rows
    .map((row) => String(row || "").trim().toUpperCase().replace(/\\.P$/, ""))
    .filter(Boolean);
  return normalized.length ? normalized : ["ALL"];
}

function sortCanonicalPolicyCandidates(rows = []) {
  return rows.slice().sort((a, b) => {
    const priorityDelta = (toNum(b && b.evidence && b.evidence.priority_score) ?? -Infinity) - (toNum(a && a.evidence && a.evidence.priority_score) ?? -Infinity);
    if (priorityDelta !== 0) return priorityDelta;
    const supportDelta = (toNum(b && b.evidence && b.evidence.support_n) ?? -Infinity) - (toNum(a && a.evidence && a.evidence.support_n) ?? -Infinity);
    if (supportDelta !== 0) return supportDelta;
    return String(a && a.candidate_id || "").localeCompare(String(b && b.candidate_id || ""));
  });
}

function applyCanonicalThresholdChanges({ currentSys = {}, candidate = {} } = {}) {
  const changes = Array.isArray(candidate && candidate.changes) ? candidate.changes : [];
  if (!changes.length) return { nextSettings: {}, unsupportedKeys: [] };

  const nextSettings = {};
  const markets = normalizeCandidateMarkets(candidate && candidate.markets);
  const marketSpecific = !(markets.length === 1 && markets[0] === "ALL");
  const currentOverrides = normalizeCanonicalEngineMarketOverrides(currentSys && currentSys.canonical_engine_market_overrides);
  const nextOverrides = { ...currentOverrides };
  const unsupportedKeys = [];

  const applyGlobal = (field, delta, fallback) => {
    const currentValue = clampCanonicalThreshold(currentSys && currentSys[field], fallback);
    nextSettings[field] = clampCanonicalThreshold(currentValue + delta, fallback);
  };

  const applyMarketOverride = (field, delta, fallback) => {
    for (const market of markets) {
      const currentRow = nextOverrides[market] && typeof nextOverrides[market] === "object"
        ? { ...nextOverrides[market] }
        : {};
      const currentValue = clampCanonicalThreshold(currentRow[field], fallback);
      currentRow[field] = clampCanonicalThreshold(currentValue + delta, fallback);
      nextOverrides[market] = currentRow;
    }
  };

  for (const change of changes) {
    const key = String(change && change.key || "").trim().toUpperCase();
    const delta = toCanonicalThresholdDelta(change);
    if (!Number.isFinite(delta) || delta === 0) continue;

    if (key === "ENTRY_CORE_SCORE_ABS" || key === "GATE_CORE_SCORE_ABS") {
      if (marketSpecific) applyMarketOverride("core_score_abs", delta, 33);
      else applyGlobal("canonical_engine_core_score_abs", delta, 33);
      continue;
    }
    if (key === "SHARED_REGIME_TRANSITION_CONFIRMATION") {
      if (marketSpecific) applyMarketOverride("transition_core_score_abs", delta, 29);
      else applyGlobal("canonical_engine_transition_core_score_abs", delta, 29);
      continue;
    }
    unsupportedKeys.push(key || "UNKNOWN");
  }

  if (marketSpecific) nextSettings.canonical_engine_market_overrides = nextOverrides;
  return { nextSettings, unsupportedKeys };
}

function resolveCanonicalSourceModeForMarket(currentSys = {}, market = "ALL") {
  const marketKey = String(market || "").trim().toUpperCase();
  const overrides = normalizeCanonicalEngineMarketOverrides(currentSys && currentSys.canonical_engine_market_overrides);
  const marketOverride = marketKey && overrides[marketKey] && typeof overrides[marketKey] === "object"
    ? overrides[marketKey]
    : null;
  const overrideMode = String(marketOverride && marketOverride.source_mode || "").trim().toUpperCase();
  if (overrideMode === "PINE_PRIMARY" || overrideMode === "SERVER_PRIMARY" || overrideMode === "SERVER_SHADOW") return overrideMode;
  const globalMode = String(currentSys && currentSys.canonical_engine_source_mode || "").trim().toUpperCase();
  if (globalMode === "PINE_PRIMARY" || globalMode === "SERVER_PRIMARY" || globalMode === "SERVER_SHADOW") return globalMode;
  return "PINE_PRIMARY";
}

function applyCanonicalSourceModeChanges({ currentSys = {}, candidate = {}, nextSourceMode = "SERVER_PRIMARY" } = {}) {
  const targetMode = String(nextSourceMode || "SERVER_PRIMARY").trim().toUpperCase() || "SERVER_PRIMARY";
  const markets = normalizeCandidateMarkets(candidate && candidate.markets);
  const marketSpecific = !(markets.length === 1 && markets[0] === "ALL");
  const nextSettings = {};
  if (!marketSpecific) {
    const currentMode = resolveCanonicalSourceModeForMarket(currentSys, "ALL");
    if (currentMode !== targetMode) nextSettings.canonical_engine_source_mode = targetMode;
    return {
      nextSettings,
      current_modes: [{ market: "ALL", current_source_mode: currentMode, next_source_mode: targetMode }],
    };
  }

  const currentOverrides = normalizeCanonicalEngineMarketOverrides(currentSys && currentSys.canonical_engine_market_overrides);
  const nextOverrides = { ...currentOverrides };
  const currentModes = [];
  for (const market of markets) {
    const currentMode = resolveCanonicalSourceModeForMarket(currentSys, market);
    currentModes.push({ market, current_source_mode: currentMode, next_source_mode: targetMode });
    if (currentMode === targetMode) continue;
    const currentRow = nextOverrides[market] && typeof nextOverrides[market] === "object"
      ? { ...nextOverrides[market] }
      : {};
    currentRow.source_mode = targetMode;
    nextOverrides[market] = currentRow;
  }
  if (stableSignature(nextOverrides) !== stableSignature(currentOverrides)) {
    nextSettings.canonical_engine_market_overrides = nextOverrides;
  }
  return {
    nextSettings,
    current_modes: currentModes,
  };
}

function buildCanonicalPolicyStageCandidate(candidatesArtifact, currentSys = {}, objectiveSupervisor = {}) {
  const raw = candidatesArtifact && candidatesArtifact.data && typeof candidatesArtifact.data === "object"
    ? candidatesArtifact.data
    : {};
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  const eligible = sortCanonicalPolicyCandidates(rows.filter((row) =>
    row
    && row.canonical_migration_class === "PINE_THRESHOLD"
    && row.target_deploy_unit === "SERVER_SETTINGS"
    && row.ready_for_auto_apply === true
    && row.memory_blocked !== true
  ));
  const selected = eligible[0] || null;
  if (!selected) {
    return {
      stage: "CANONICAL_POLICY",
      actionable: false,
      action: "HOLD",
      reason: "NO_ACTIONABLE_CANONICAL_POLICY_CANDIDATE",
      signature: null,
      display_signature: null,
      nextSettings: {},
      streakRequired: STREAK_REQUIRED,
      sampleSufficient: true,
      coverageSufficient: true,
      objectiveEnoughSample: Boolean(objectiveSupervisor && objectiveSupervisor.objective && objectiveSupervisor.objective.enough_sample === true),
      objectiveDirectionOk: false,
      challengerBeatsCurrent: false,
      direction: "SHIFT",
      candidate_id: null,
      source: null,
      unsupported_keys: [],
    };
  }

  const { nextSettings, unsupportedKeys } = applyCanonicalThresholdChanges({ currentSys, candidate: selected });
  const actionable = unsupportedKeys.length === 0 && Object.keys(nextSettings).length > 0;
  return {
    stage: "CANONICAL_POLICY",
    actionable,
    action: actionable ? "AUTO_APPLY" : "HOLD",
    reason: actionable
      ? String(selected.status || selected.source || selected.candidate_id || "CANONICAL_POLICY_READY")
      : (unsupportedKeys.length ? `UNSUPPORTED_CANONICAL_THRESHOLD_KEYS:${unsupportedKeys.join("|")}` : "CANONICAL_POLICY_NOOP"),
    signature: actionable ? stableSignature(nextSettings) : null,
    display_signature: String(selected.display_candidate_id || selected.candidate_id || "").trim() || null,
    nextSettings,
    streakRequired: STREAK_REQUIRED,
    sampleSufficient: true,
    coverageSufficient: true,
    objectiveEnoughSample: Boolean(objectiveSupervisor && objectiveSupervisor.objective && objectiveSupervisor.objective.enough_sample === true),
    objectiveDirectionOk: actionable,
    challengerBeatsCurrent: actionable,
    direction: String(selected.direction || "SHIFT").trim().toUpperCase() || "SHIFT",
    candidate_id: String(selected.candidate_id || "").trim() || null,
    source: String(selected.source || "").trim() || null,
    unsupported_keys: unsupportedKeys,
  };
}

function buildSourceModeStageCandidate({
  candidatesArtifact,
  parityArtifact,
  currentSys = {},
  objectiveSupervisor = {},
} = {}) {
  const raw = candidatesArtifact && candidatesArtifact.data && typeof candidatesArtifact.data === "object"
    ? candidatesArtifact.data
    : {};
  const rows = Array.isArray(raw.rows) ? raw.rows : [];
  const eligible = sortCanonicalPolicyCandidates(rows.filter((row) =>
    row
    && row.canonical_migration_class === "PINE_THRESHOLD"
    && row.target_deploy_unit === "SERVER_SETTINGS"
    && row.ready_for_auto_apply === true
    && row.memory_blocked !== true
  ));
  const selected = eligible[0] || null;
  const paritySummary = parityArtifact && parityArtifact.data && parityArtifact.data.summary && typeof parityArtifact.data.summary === "object"
    ? parityArtifact.data.summary
    : {};
  const sourceParityMismatchN = toNum(paritySummary.source_parity_mismatch_n) || 0;
  const shadowObservedN = toNum(paritySummary.shadow_observed_n) || 0;
  const shadowObservedMin = Math.max(5, Number(process.env.STAGE_AUTOPILOT_SOURCE_MODE_PARITY_MIN || 5));
  if (!selected) {
    return {
      stage: "SOURCE_MODE",
      actionable: false,
      action: "HOLD",
      reason: "NO_ACTIONABLE_SOURCE_MODE_CANDIDATE",
      signature: null,
      display_signature: null,
      nextSettings: {},
      streakRequired: STREAK_REQUIRED,
      sampleSufficient: false,
      coverageSufficient: false,
      objectiveEnoughSample: Boolean(objectiveSupervisor && objectiveSupervisor.objective && objectiveSupervisor.objective.enough_sample === true),
      objectiveDirectionOk: false,
      challengerBeatsCurrent: false,
      direction: "SHIFT",
      candidate_id: null,
      source: "CANONICAL_PARITY_SOURCE_MODE_PROMOTION",
      support_n: shadowObservedN,
      source_parity_mismatch_n: sourceParityMismatchN,
      current_source_modes: [],
    };
  }

  const { nextSettings, current_modes } = applyCanonicalSourceModeChanges({
    currentSys,
    candidate: selected,
    nextSourceMode: "SERVER_PRIMARY",
  });
  const alreadyServerPrimary = current_modes.length > 0 && current_modes.every((row) => row.current_source_mode === "SERVER_PRIMARY");
  const actionable = !alreadyServerPrimary
    && sourceParityMismatchN === 0
    && shadowObservedN >= shadowObservedMin
    && Object.keys(nextSettings).length > 0;
  let reason = "SOURCE_MODE_NOOP";
  if (actionable) reason = "SERVER_PRIMARY_PROMOTION_READY";
  else if (alreadyServerPrimary) reason = "SOURCE_MODE_ALREADY_SERVER_PRIMARY";
  else if (sourceParityMismatchN > 0) reason = "SOURCE_MODE_SOURCE_PARITY_BLOCK";
  else if (shadowObservedN < shadowObservedMin) reason = "SOURCE_MODE_PARITY_SAMPLE_SHORT";
  return {
    stage: "SOURCE_MODE",
    actionable,
    action: actionable ? "AUTO_APPLY" : "HOLD",
    reason,
    signature: actionable ? stableSignature(nextSettings) : null,
    display_signature: String(selected.display_candidate_id || selected.candidate_id || "").trim() || null,
    nextSettings,
    streakRequired: STREAK_REQUIRED,
    sampleSufficient: shadowObservedN >= shadowObservedMin,
    coverageSufficient: sourceParityMismatchN === 0,
    objectiveEnoughSample: Boolean(objectiveSupervisor && objectiveSupervisor.objective && objectiveSupervisor.objective.enough_sample === true),
    objectiveDirectionOk: actionable,
    challengerBeatsCurrent: actionable,
    direction: "SHIFT",
    candidate_id: String(selected.candidate_id || "").trim() || null,
    source: "CANONICAL_PARITY_SOURCE_MODE_PROMOTION",
    support_n: shadowObservedN,
    source_parity_mismatch_n: sourceParityMismatchN,
    current_source_modes: current_modes,
  };
}

function clampProb(value, fallback) {
  const n = toNum(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.min(1, n));
}

function readParityFamilyCount(summary = {}, key) {
  const rows = Array.isArray(summary && summary.by_actual_drop_reason_family) ? summary.by_actual_drop_reason_family : [];
  const matched = rows.find((row) => String(row && row.key || "").trim().toUpperCase() === String(key || "").trim().toUpperCase());
  return matched ? (toNum(matched.count) || 0) : 0;
}

function buildEvParityCandidate(parityArtifact, currentSys = {}, objectiveSupervisor = {}) {
  const raw = parityArtifact && parityArtifact.data && typeof parityArtifact.data === "object"
    ? parityArtifact.data
    : {};
  const summary = raw && raw.summary && typeof raw.summary === "object" ? raw.summary : {};
  const evPolicyMismatchN = readParityFamilyCount(summary, "EV_POLICY");
  const sourceParityMismatchN = toNum(summary.source_parity_mismatch_n) || 0;
  const shadowObservedN = toNum(summary.shadow_observed_n) || 0;
  const actionable = evPolicyMismatchN >= 2 && sourceParityMismatchN === 0;
  const currentMin = clampProb(currentSys && currentSys.ev_gate_tp1_prob_min, 0.55);
  const currentFull = clampProb(currentSys && currentSys.ev_gate_tp1_prob_full, 0.60);
  const nextSettings = actionable
    ? {
      ev_gate_tp1_prob_min: Number(Math.max(0.30, currentMin - 0.01).toFixed(4)),
      ev_gate_tp1_prob_full: Number(Math.max(0.35, currentFull - 0.01).toFixed(4)),
    }
    : {};
  return {
    stage: "EV",
    actionable,
    action: actionable ? "AUTO_APPLY" : "HOLD",
    reason: actionable
      ? "CANONICAL_PARITY_EV_POLICY_RESCUE"
      : "NO_ACTIONABLE_EV_PARITY_RESCUE",
    signature: actionable ? stableSignature(nextSettings) : null,
    nextSettings,
    streakRequired: STREAK_REQUIRED,
    sampleSufficient: evPolicyMismatchN >= 2,
    coverageSufficient: shadowObservedN >= evPolicyMismatchN && sourceParityMismatchN === 0,
    objectiveEnoughSample: actionable,
    objectiveDirectionOk: actionable,
    challengerBeatsCurrent: actionable,
    support_n: evPolicyMismatchN,
    support_rate: summary && toNum(summary.parity_mismatch_rate),
    source: "CANONICAL_PARITY_EV_POLICY_RESCUE",
    current_ev_policy_mismatch_n: evPolicyMismatchN,
    source_parity_mismatch_n: sourceParityMismatchN,
  };
}

function buildObservedStageCandidate(stage, artifact, currentObj = {}) {
  const data = artifact && artifact.data ? artifact.data : null;
  if (!data) {
    return {
      stage,
      actionable: false,
      observedUpdate: false,
      signature: null,
      reason: `${stage}_ARTIFACT_MISSING`,
      objectiveEnoughSample: Boolean(currentObj && currentObj.enough_sample === true),
    };
  }
  if (stage === "EV") {
    const next = {
      ev_gate_tp1_prob_min: toNum(data.next_threshold),
      ev_gate_tp1_prob_full: toNum(data.next_band && data.next_band.fullThreshold),
      ev_gate_tp1_prob_kill: toNum(data.next_band && data.next_band.killThreshold),
      ev_gate_qty_scale_mid: toNum(data.next_band && data.next_band.midScale),
      ev_gate_qty_scale_low: toNum(data.next_band && data.next_band.lowScale),
    };
    return {
      stage,
      actionable: false,
      observedUpdate: data.settings_updated === true,
      signature: stableSignature(next),
      nextSettings: next,
      reason: String(data.decision_reason || "N/A"),
      snapshotPath: data.artifacts && data.artifacts.autopilot_snapshot_path,
      objectiveEnoughSample: Boolean(currentObj && currentObj.enough_sample === true),
    };
  }
  const next = {
    wait_one_bar_same_dir_streak_min: toNum(data.next && data.next.wait_one_bar_same_dir_streak_min),
    wait_one_bar_chase_ratio_min: toNum(data.next && data.next.wait_one_bar_chase_ratio_min),
    wait_one_bar_last_close_control_min: toNum(data.next && data.next.wait_one_bar_last_close_control_min),
    wait_one_bar_last_dir_body_min: toNum(data.next && data.next.wait_one_bar_last_dir_body_min),
    wait_one_bar_last_opposite_wick_max: toNum(data.next && data.next.wait_one_bar_last_opposite_wick_max),
    wait_one_bar_recent_move1_pct_min: toNum(data.next && data.next.wait_one_bar_recent_move1_pct_min),
    wait_one_bar_counter_dir_bars_max: toNum(data.next && data.next.wait_one_bar_counter_dir_bars_max),
  };
  return {
    stage,
    actionable: false,
    observedUpdate: data.changed === true,
    signature: stableSignature(next),
    nextSettings: next,
    reason: String(data.reason || "N/A"),
    snapshotPath: data.artifacts && data.artifacts.autopilot_snapshot_path,
    objectiveEnoughSample: Boolean(currentObj && currentObj.enough_sample === true),
  };
}

function readSnapshotFromArtifactPath(filePath) {
  const data = readJsonRawSafe(String(filePath || ""), null);
  return data && data.snapshot && typeof data.snapshot === "object" ? data.snapshot : null;
}

function summarizeTransition(prevState, nextState) {
  if (!prevState) return `${nextState.machine_state}`;
  const before = `${prevState.machine_state}:${prevState.last_reason || "N/A"}`;
  const after = `${nextState.machine_state}:${nextState.last_reason || "N/A"}`;
  return `${before} -> ${after}`;
}

function renderMarkdown(report = {}) {
  const lines = [
    "# Stage Autopilot",
    "",
    `- 실행 시각: ${report.generated_at_kst || "N/A"}`,
    `- provider: ${report.provider || "N/A"}`,
    `- objective: ${report.objective_verdict || "N/A"}`,
    `- canary: ${report.canary_pass ? "PASS" : "BLOCK"}`,
    `- self_evolution_canary: ${report.self_evolution_canary && report.self_evolution_canary.apply_pass ? "PASS" : "BLOCK"} / rollback_ready ${report.self_evolution_canary && report.self_evolution_canary.rollback_ready_n != null ? report.self_evolution_canary.rollback_ready_n : "N/A"}`,
    `- server_primary_canary: ${report.self_evolution_server_primary_canary && report.self_evolution_server_primary_canary.apply_pass === true ? "PASS" : (report.self_evolution_server_primary_canary && report.self_evolution_server_primary_canary.apply_pass === false ? "BLOCK" : "N/A")} / executed ${report.self_evolution_server_primary_canary && report.self_evolution_server_primary_canary.executed_n != null ? report.self_evolution_server_primary_canary.executed_n : "N/A"} / rollback ${report.self_evolution_server_primary_canary && report.self_evolution_server_primary_canary.rollback_trigger_n != null ? report.self_evolution_server_primary_canary.rollback_trigger_n : "N/A"}`,
    `- self_evolution_deployment: ${report.self_evolution_deployment && report.self_evolution_deployment.deploy_pass ? "PASS" : "BLOCK"} / target ${report.self_evolution_deployment && report.self_evolution_deployment.target_candidate_id || "N/A"}`,
    `- deployment plan: ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.plan_status || "N/A"} / manual ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.manual_step_required ? "YES" : "NO"} / file ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.prepared_file_path || report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.latest_generated_file_path || "N/A"}`,
    `- pine handoff: ${report.self_evolution_pine_handoff && report.self_evolution_pine_handoff.stage_ready ? "READY" : "HOLD"} / file ${report.self_evolution_pine_handoff && report.self_evolution_pine_handoff.prepared_file_path || "N/A"} / latest ${report.self_evolution_pine_handoff && report.self_evolution_pine_handoff.latest_generated_file_path || "N/A"}`,
    `- codex authority: ${report.codex_authority && report.codex_authority.authority_mode || "N/A"} / ${report.codex_authority && report.codex_authority.verdict || "N/A"} / manual ${report.codex_authority && report.codex_authority.manual_step_required ? "YES" : "NO"}`,
    `- BEST/FEBT contract: ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.mode || "N/A"} / tightening ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.tightening_allowed ? "ALLOW" : "BLOCK"} / recovery ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.recovery_priority ? "FIRST" : "NORMAL"} / replacement ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.projected_replacement_ratio != null ? Number(report.best_febt_tuning_contract.projected_replacement_ratio).toFixed(2) : "N/A"} / count ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.projected_count_ratio_global != null ? Number(report.best_febt_tuning_contract.projected_count_ratio_global).toFixed(2) : "N/A"}x`,
    "",
    "## Stages",
  ];
  for (const row of report.stage_rows || []) {
    lines.push(`- ${row.stage}: ${row.machine_state} / ${row.reason} / action=${row.last_action || "N/A"} / streak=${row.streak_current || 0}`);
    if (row.blockers && row.blockers.length) lines.push(`  - blockers: ${row.blockers.join(", ")}`);
    if (row.signature) lines.push(`  - signature: ${row.signature}`);
    if (row.snapshot_path) lines.push(`  - snapshot: ${row.snapshot_path}`);
    if (row.prepared_file_path || row.latest_generated_file_path) lines.push(`  - handoff: ${row.prepared_file_path || "N/A"} / latest ${row.latest_generated_file_path || "N/A"}`);
  }
  lines.push("");
  lines.push("## Actions");
  if (Array.isArray(report.actions) && report.actions.length) {
    for (const row of report.actions) lines.push(`- ${row.stage}: ${row.type} / ${row.detail}`);
  } else {
    lines.push("- none");
  }
  lines.push("");
  lines.push("## Artifacts");
  for (const row of report.artifacts || []) {
    lines.push(`- ${row.name}: ${row.fresh ? "fresh" : "stale"} / ${row.filePath}`);
  }
  return `${lines.join("\n")}\n`;
}

function isAiAutopilotTightening(currentSys = {}, nextSettings = {}) {
  const currentPolicy = String(currentSys.ai_missing_policy || "ALLOW").trim().toUpperCase();
  const nextPolicy = String(nextSettings.ai_missing_policy || currentPolicy).trim().toUpperCase();
  const currentReducePct = toNum(currentSys.ai_missing_reduce_pct) ?? 0.5;
  const nextReducePct = toNum(nextSettings.ai_missing_reduce_pct);
  if (currentPolicy === "ALLOW" && (nextPolicy === "REDUCE" || nextPolicy === "BLOCK")) return true;
  if (currentPolicy === "REDUCE" && nextPolicy === "BLOCK") return true;
  if (currentPolicy === nextPolicy && nextPolicy === "REDUCE" && nextReducePct != null && nextReducePct < currentReducePct) return true;
  return false;
}

function bestFebtAutopilotGuard({ stage, candidate, currentSys = {}, bestFebtContract = null } = {}) {
  if (!candidate || candidate.actionable !== true || !bestFebtContract || typeof bestFebtContract !== "object") {
    return { blocked: false, reason: null };
  }
  const tighteningAllowed = bestFebtContract.tightening_allowed !== false;
  const recoveryPriority = bestFebtContract.recovery_priority === true;
  if (stage === "AI" && !tighteningAllowed && isAiAutopilotTightening(currentSys, candidate.nextSettings || {})) {
    return { blocked: true, reason: "BEST_FEBT_COUNT_GUARD_BLOCK" };
  }
  if (stage === "MARKET" && !tighteningAllowed && String(candidate.action || "").toUpperCase() === "REVIEW_TIGHTEN") {
    return { blocked: true, reason: "BEST_FEBT_COUNT_GUARD_BLOCK" };
  }
  if (stage === "CANONICAL_POLICY" && String(candidate.direction || "").toUpperCase() === "TIGHTEN") {
    if (!tighteningAllowed) return { blocked: true, reason: "BEST_FEBT_COUNT_GUARD_BLOCK" };
    if (recoveryPriority) return { blocked: true, reason: "BEST_FEBT_RECOVERY_GUARD_BLOCK" };
  }
  if (stage === "SOURCE_MODE") {
    if (!tighteningAllowed) return { blocked: true, reason: "BEST_FEBT_COUNT_GUARD_BLOCK" };
    if (recoveryPriority) return { blocked: true, reason: "BEST_FEBT_RECOVERY_GUARD_BLOCK" };
  }
  if (stage === "PINE" && candidate.kind === "PROMOTE") {
    if (!tighteningAllowed) return { blocked: true, reason: "BEST_FEBT_COUNT_GUARD_BLOCK" };
    if (recoveryPriority) return { blocked: true, reason: "BEST_FEBT_RECOVERY_GUARD_BLOCK" };
  }
  return { blocked: false, reason: null };
}

function buildPineCandidate(objectiveArtifact, codexArtifact, changeArtifact) {
  const objective = objectiveArtifact && objectiveArtifact.data ? objectiveArtifact.data : {};
  const change = changeArtifact && changeArtifact.data ? changeArtifact.data : {};
  const codex = codexArtifact && codexArtifact.data ? codexArtifact.data : {};
  const codexAuthority = objective && objective.codex_authority && typeof objective.codex_authority === "object"
    ? objective.codex_authority
    : {};
  const verdict = String(objective.verdict || "HOLD").toUpperCase();
  const codexVerdict = String(codexAuthority.verdict || codex.verdict || "HOLD").toUpperCase();
  const codexFresh = Boolean(
    (codexArtifact && codexArtifact.fresh === true)
    || String(codexAuthority.status || "").toUpperCase() === "FRESH"
  );
  if (verdict === "PATCH_CANDIDATE") {
    const candidateId = String(
      codexAuthority.recommended_candidate_id
      || objective.promotion && objective.promotion.candidate_id
      || change.auto_promotion && change.auto_promotion.candidate_id
      || ""
    ).trim();
    const displayCandidateId = String(
      codexAuthority.display_candidate_id
      || objective.promotion && objective.promotion.display_candidate_id
      || change.auto_promotion && change.auto_promotion.display_candidate_id
      || candidateId
      || ""
    ).trim() || null;
    return {
      actionable: !!candidateId && codexFresh && codexVerdict === "PROMOTE",
      kind: "PROMOTE",
      signature: candidateId || null,
      display_signature: displayCandidateId,
      reason: String(objective.reason || "PATCH_CANDIDATE"),
      detail: displayCandidateId || candidateId || "N/A",
    };
  }
  if (verdict === "ROLLBACK_CANDIDATE") {
    const rollbackPath = String(
      codexAuthority.recommended_rollback_file_path
      || objective.rollback && objective.rollback.rollback_file_path
      || change.auto_rollback && change.auto_rollback.rollback_file_path
      || ""
    ).trim();
    return {
      actionable: !!rollbackPath && codexFresh && codexVerdict === "ROLLBACK",
      kind: "ROLLBACK",
      signature: rollbackPath || null,
      reason: String(objective.reason || "ROLLBACK_CANDIDATE"),
      detail: rollbackPath || "N/A",
    };
  }
  return {
    actionable: false,
    kind: "HOLD",
    signature: null,
    reason: String(objective.reason || "HOLD"),
    detail: "N/A",
  };
}

function runWeeklyPinePreparation() {
  const res = spawnSync("node", ["scripts/automation-weekly-pine-upgrade.js"], {
    cwd: path.resolve(__dirname, ".."),
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    timeout: PINE_REVIEW_MAX_AGE_HOURS * 60 * 60 * 1000,
  });
  return {
    ok: !res.error && Number(res.status) === 0,
    status: Number(res.status),
    error: res.error ? String(res.error.message || res.error) : null,
    stdout: String(res.stdout || "").trim(),
    stderr: String(res.stderr || "").trim(),
  };
}

function isPreparedPineAligned(latestWeeklyHistory = {}, candidate = {}) {
  if (!candidate || String(candidate.kind || "").toUpperCase() === "ROLLBACK") return true;
  const recommendedPatchId = String(latestWeeklyHistory && latestWeeklyHistory.recommended_patch_id || "").trim() || null;
  const displayRecommendedPatchId = String(latestWeeklyHistory && latestWeeklyHistory.display_recommended_patch_id || "").trim() || null;
  const candidateSignature = String(candidate && candidate.signature || "").trim() || null;
  const candidateDisplaySignature = String(candidate && candidate.display_signature || "").trim() || null;
  if (!candidateSignature) return false;
  return recommendedPatchId === candidateSignature
    || displayRecommendedPatchId === candidateSignature
    || (candidateDisplaySignature && recommendedPatchId === candidateDisplaySignature)
    || (candidateDisplaySignature && displayRecommendedPatchId === candidateDisplaySignature);
}

async function applyStageCandidate({ stage, candidate, stageState, history, nowMeta, nowMs, canaryPass, objectiveArtifact, currentSys, snapshotKeys, selfEvolutionRollbackReady = false }) {
  const snapshot = pickSettingsSnapshot(currentSys, snapshotKeys);
  const changeBudgetOk = stageChangeBudgetOk(history, nowMs, stage);
  const nextHistory = candidate.signature
    ? appendStageHistory(history, {
      stage,
      run_key: String(candidate.run_key || nowMeta.kst),
      signature: candidate.signature,
      action: candidate.action || candidate.kind || "WATCH",
      reason: candidate.reason,
      ts_ms: nowMs,
    })
    : history;
  const streakCurrent = candidate.signature ? computeSignatureStreak(nextHistory, stage, candidate.signature) : 0;
  const guard = evaluateCommonAutoApply({
    stageKey: stage,
    objectiveEnoughSample: candidate.objectiveEnoughSample === true,
    objectiveDirectionOk: candidate.objectiveDirectionOk === true,
    sampleSufficient: candidate.sampleSufficient === true,
    coverageSufficient: candidate.coverageSufficient === true,
    canaryPass,
    streakCurrent,
    streakRequired: Number(candidate.streakRequired || STREAK_REQUIRED),
    changeBudgetOk,
    challengerBeatsCurrent: candidate.challengerBeatsCurrent === true,
    rollbackPrepared: buildRollbackPrepared(snapshot),
  });

  if (candidate.actionable && guard.ready && stageState.applied_signature !== candidate.signature) {
    const snapshotWrite = writeStageSnapshot({
      stage,
      provider: PROVIDER,
      snapshot,
      meta: {
        source: "automation-stage-autopilot",
        next_settings: candidate.nextSettings,
        reason: candidate.reason,
      },
    });
    await updateProviderSettings({
      provider: PROVIDER,
      kv: candidate.nextSettings,
      updatedBy: `automation-stage-autopilot:${stage.toLowerCase()}`,
    });
    return {
      stageState: {
        ...stageState,
        stage,
        machine_state: STATE_MACHINE.AUTO_APPLY,
        last_signature: candidate.signature,
        last_action: "AUTO_APPLY",
        last_reason: candidate.reason,
        streak_current: streakCurrent,
        applied_at_kst: nowMeta.kst,
        applied_signature: candidate.signature,
        pre_apply_snapshot: snapshotWrite.data.snapshot,
        adverse_streak_n: 0,
        monitor_window_runs: 0,
        last_snapshot_path: snapshotWrite.filePath,
        blockers: [],
      },
      history: appendStageHistory(nextHistory, {
        stage,
        run_key: `${nowMeta.kst}__AUTO_APPLY`,
        signature: candidate.signature,
        action: "AUTO_APPLY",
        reason: candidate.reason,
        ts_ms: nowMs,
      }),
      action: { stage, type: "AUTO_APPLY", detail: stableSignature(candidate.nextSettings) },
    };
  }

  const rollback = shouldAutoRollback({
    stageState,
    objectiveSupervisor: objectiveArtifact && objectiveArtifact.data ? objectiveArtifact.data : {},
    canaryPass,
    selfEvolutionRollbackReady,
  });
  if (rollback.rollback && stageState.pre_apply_snapshot && Object.keys(stageState.pre_apply_snapshot).length) {
    await updateProviderSettings({
      provider: PROVIDER,
      kv: stageState.pre_apply_snapshot,
      updatedBy: `automation-stage-autopilot:${stage.toLowerCase()}:rollback`,
    });
    return {
      stageState: {
        ...stageState,
        stage,
        machine_state: STATE_MACHINE.AUTO_ROLLBACK,
        last_signature: candidate.signature || stageState.last_signature,
        last_action: "AUTO_ROLLBACK",
        last_reason: "AUTO_ROLLBACK_TRIGGERED",
        streak_current: streakCurrent,
        adverse_streak_n: 0,
        monitor_window_runs: Number(stageState.monitor_window_runs || 0) + 1,
        blockers: ["OBJECTIVE_OR_CANARY_ADVERSE"],
      },
      history: appendStageHistory(nextHistory, {
        stage,
        run_key: `${nowMeta.kst}__AUTO_ROLLBACK`,
        signature: stageState.applied_signature || candidate.signature,
        action: "AUTO_ROLLBACK",
        reason: "OBJECTIVE_OR_CANARY_ADVERSE",
        ts_ms: nowMs,
      }),
      action: { stage, type: "AUTO_ROLLBACK", detail: stableSignature(stageState.pre_apply_snapshot) },
    };
  }

  let machineState = STATE_MACHINE.HOLD;
  if (stageState.applied_signature) machineState = STATE_MACHINE.MONITOR;
  else if (candidate.actionable && guard.blockers.length && guard.blockers.every((row) => row.endsWith("_STREAK_SHORT"))) machineState = STATE_MACHINE.WATCH;
  else if (candidate.actionable && guard.blockers.filter((row) => !row.endsWith("_STREAK_SHORT")).length === 0) machineState = STATE_MACHINE.WATCH;

  return {
    stageState: {
      ...stageState,
      stage,
      machine_state: machineState,
      last_signature: candidate.signature,
      last_action: candidate.action || stageState.last_action || "HOLD",
      last_reason: candidate.actionable ? (guard.ready ? candidate.reason : (guard.blockers[0] || candidate.reason)) : candidate.reason,
      streak_current: streakCurrent,
      adverse_streak_n: rollback.nextAdverseStreak || 0,
      monitor_window_runs: stageState.applied_signature ? Number(stageState.monitor_window_runs || 0) + 1 : Number(stageState.monitor_window_runs || 0),
      blockers: guard.blockers,
    },
    history: nextHistory,
    action: null,
  };
}

async function processObservedStage({ stage, artifact, stateData, currentSys, objectiveArtifact, canaryPass, nowMeta, nowMs, selfEvolutionRollbackReady = false }) {
  const currentObjective = objectiveArtifact && objectiveArtifact.data ? objectiveArtifact.data.objective : null;
  const stageState = getStageState(stateData, stage);
  const candidate = buildObservedStageCandidate(stage, artifact, currentObjective);
  const runKey = String(candidate && candidate.reason || artifact && artifact.data && artifact.data.generated_at_kst || nowMeta.kst);
  let history = stateData.history || [];
  if (candidate.signature) {
    history = appendStageHistory(history, {
      stage,
      run_key: runKey,
      signature: candidate.signature,
      action: candidate.observedUpdate ? "OBSERVED_UPDATE" : "MONITOR",
      reason: candidate.reason,
      ts_ms: nowMs,
    });
  }
  if (candidate.observedUpdate && stageState.applied_signature !== candidate.signature) {
    const snapshot = readSnapshotFromArtifactPath(candidate.snapshotPath) || (readStageSnapshot({ stage, provider: PROVIDER }).data || {}).snapshot || null;
    const nextState = {
      ...stageState,
      stage,
      machine_state: STATE_MACHINE.AUTO_APPLY,
      last_signature: candidate.signature,
      last_action: "AUTO_APPLY",
      last_reason: candidate.reason,
      streak_current: candidate.signature ? computeSignatureStreak(history, stage, candidate.signature) : 0,
      applied_at_kst: nowMeta.kst,
      applied_signature: candidate.signature,
      pre_apply_snapshot: snapshot,
      adverse_streak_n: 0,
      monitor_window_runs: 0,
      last_snapshot_path: candidate.snapshotPath || null,
      blockers: [],
    };
    return {
      stageState: nextState,
      history: appendStageHistory(history, {
        stage,
        run_key: `${nowMeta.kst}__AUTO_APPLY`,
        signature: candidate.signature,
        action: "AUTO_APPLY",
        reason: candidate.reason,
        ts_ms: nowMs,
      }),
      action: { stage, type: "AUTO_APPLY", detail: candidate.signature },
    };
  }

  const rollback = shouldAutoRollback({
    stageState,
    objectiveSupervisor: objectiveArtifact && objectiveArtifact.data ? objectiveArtifact.data : {},
    canaryPass,
    selfEvolutionRollbackReady,
  });
  if (rollback.rollback && stageState.pre_apply_snapshot && Object.keys(stageState.pre_apply_snapshot).length) {
    await updateProviderSettings({
      provider: PROVIDER,
      kv: stageState.pre_apply_snapshot,
      updatedBy: `automation-stage-autopilot:${stage.toLowerCase()}:rollback`,
    });
    return {
      stageState: {
        ...stageState,
        stage,
        machine_state: STATE_MACHINE.AUTO_ROLLBACK,
        last_signature: candidate.signature || stageState.last_signature,
        last_action: "AUTO_ROLLBACK",
        last_reason: "AUTO_ROLLBACK_TRIGGERED",
        adverse_streak_n: 0,
        monitor_window_runs: Number(stageState.monitor_window_runs || 0) + 1,
        blockers: ["OBJECTIVE_OR_CANARY_ADVERSE"],
      },
      history: appendStageHistory(history, {
        stage,
        run_key: `${nowMeta.kst}__AUTO_ROLLBACK`,
        signature: stageState.applied_signature || candidate.signature,
        action: "AUTO_ROLLBACK",
        reason: "OBJECTIVE_OR_CANARY_ADVERSE",
        ts_ms: nowMs,
      }),
      action: { stage, type: "AUTO_ROLLBACK", detail: stableSignature(stageState.pre_apply_snapshot) },
    };
  }

  return {
    stageState: {
      ...stageState,
      stage,
      machine_state: stageState.applied_signature ? STATE_MACHINE.MONITOR : STATE_MACHINE.HOLD,
      last_signature: candidate.signature || stageState.last_signature,
      last_action: candidate.observedUpdate ? "OBSERVED_UPDATE" : (stageState.last_action || "HOLD"),
      last_reason: candidate.reason,
      adverse_streak_n: rollback.nextAdverseStreak || 0,
      monitor_window_runs: stageState.applied_signature ? Number(stageState.monitor_window_runs || 0) + 1 : Number(stageState.monitor_window_runs || 0),
      blockers: [],
    },
    history,
    action: null,
  };
}

async function processPineStage({
  objectiveArtifact,
  codexArtifact,
  changeArtifact,
  stateData,
  canaryPass,
  canaryReason = null,
  nowMeta,
  nowMs,
  candidateOverride = null,
}) {
  const candidate = candidateOverride || buildPineCandidate(objectiveArtifact, codexArtifact, changeArtifact);
  const stage = "PINE";
  const stageState = getStageState(stateData, stage);
  let history = stateData.history || [];
  if (candidate.signature) {
    history = appendStageHistory(history, {
      stage,
      run_key: `${nowMeta.kst}__${candidate.kind}`,
      signature: candidate.signature,
      action: candidate.kind,
      reason: candidate.reason,
      ts_ms: nowMs,
    });
  }
  if (!candidate.actionable || !canaryPass) {
    const resolvedCanaryReason = !canaryPass
      ? (String(canaryReason || "").trim() || "CANARY_DRIFT")
      : null;
    return {
      stageState: {
        ...stageState,
        stage,
        machine_state: STATE_MACHINE.HOLD,
        last_signature: candidate.signature,
        last_action: candidate.kind,
        last_reason: resolvedCanaryReason || candidate.reason,
        streak_current: candidate.signature ? computeSignatureStreak(history, stage, candidate.signature) : 0,
        blockers: canaryPass ? [] : [resolvedCanaryReason],
      },
      history,
      action: null,
    };
  }
  const stageAlreadyPrepared = Boolean(
    stageState.prepared_file_path
    || stageState.latest_generated_file_path
    || stageState.rollback_source_file_path
  );
  if (stageState.applied_signature === candidate.signature && stageState.machine_state === STATE_MACHINE.READY && stageAlreadyPrepared) {
    const latestWeeklyHistory = readWeeklyPineLatestHistoryRow() || {};
    const preparedFilePath = candidate.kind === "ROLLBACK"
      ? (String(latestWeeklyHistory.rollback_source_file_path || "").trim() || stageState.prepared_file_path || String(candidate.detail || "").trim() || null)
      : (String(latestWeeklyHistory.created_file_path || "").trim() || stageState.prepared_file_path || null);
    const preparedStrategyId = candidate.kind === "ROLLBACK"
      ? null
      : (String(latestWeeklyHistory.created_strategy_id || "").trim() || stageState.prepared_strategy_id || null);
    const latestGeneratedFilePath = String(latestWeeklyHistory.latest_generated_file_path || "").trim() || stageState.latest_generated_file_path || null;
    const rollbackSourceFilePath = String(latestWeeklyHistory.rollback_source_file_path || "").trim() || stageState.rollback_source_file_path || null;
    return {
      stageState: {
        ...stageState,
        last_signature: candidate.signature,
        display_signature: candidate.display_signature || stageState.display_signature || null,
        prepared_file_path: preparedFilePath,
        prepared_strategy_id: preparedStrategyId,
        latest_generated_file_path: latestGeneratedFilePath,
        rollback_source_file_path: rollbackSourceFilePath,
      },
      history,
      action: null,
    };
  }

  const prep = runWeeklyPinePreparation();
  const latestWeeklyHistory = readWeeklyPineLatestHistoryRow() || {};
  const preparedAligned = isPreparedPineAligned(latestWeeklyHistory, candidate);
  const preparedFilePath = candidate.kind === "ROLLBACK"
    ? (String(latestWeeklyHistory.rollback_source_file_path || "").trim() || String(candidate.detail || "").trim() || null)
    : (String(latestWeeklyHistory.created_file_path || "").trim() || null);
  const preparedStrategyId = candidate.kind === "ROLLBACK"
    ? null
    : (String(latestWeeklyHistory.created_strategy_id || "").trim() || null);
  const latestGeneratedFilePath = String(latestWeeklyHistory.latest_generated_file_path || "").trim() || null;
  const rollbackSourceFilePath = String(latestWeeklyHistory.rollback_source_file_path || "").trim() || null;
  const preparedArtifactAvailable = Boolean(preparedFilePath || latestGeneratedFilePath || rollbackSourceFilePath)
    && preparedAligned;
  const nextState = {
    ...stageState,
    stage,
    machine_state: prep.ok && preparedArtifactAvailable ? STATE_MACHINE.READY : STATE_MACHINE.HOLD,
    last_signature: candidate.signature,
    last_action: "PINE_PREPARE",
    last_reason: prep.ok
      ? (preparedArtifactAvailable ? `${candidate.kind}_PREPARED` : (preparedAligned ? "PINE_PREPARE_PENDING" : "PINE_TARGET_MISMATCH"))
      : `PINE_PREPARE_FAILED:${prep.error || prep.status || "UNKNOWN"}`,
    streak_current: candidate.signature ? computeSignatureStreak(history, stage, candidate.signature) : 0,
    applied_signature: candidate.signature,
    applied_at_kst: nowMeta.kst,
    blockers: prep.ok
      ? (preparedArtifactAvailable ? [] : [preparedAligned ? "PINE_PREPARE_PENDING" : "PINE_TARGET_MISMATCH"])
      : ["PINE_PREPARE_FAILED"],
    prep_stdout: prep.stdout ? prep.stdout.slice(-4000) : "",
    prep_stderr: prep.stderr ? prep.stderr.slice(-4000) : "",
    prepared_file_path: preparedFilePath,
    prepared_strategy_id: preparedStrategyId,
    latest_generated_file_path: latestGeneratedFilePath,
    rollback_source_file_path: rollbackSourceFilePath,
    display_signature: candidate.display_signature || null,
  };
  return {
    stageState: nextState,
    history: appendStageHistory(history, {
      stage,
      run_key: `${nowMeta.kst}__PINE_PREPARE`,
      signature: candidate.signature,
      action: "PINE_PREPARE",
      reason: nextState.last_reason,
      ts_ms: nowMs,
    }),
    action: {
      stage,
      type: "PINE_PREPARE",
      detail: `${candidate.kind} / ${candidate.detail} / file ${preparedFilePath || latestGeneratedFilePath || "N/A"}`,
    },
  };
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const nowMs = nowMeta.nowMs;
  const bestFebtContext = readBestFebtSupervisorContext(nowMs, {
    weeklyMaxAgeHours: FRESHNESS_HOURS.objective,
    objectiveSupervisorMaxAgeHours: FRESHNESS_HOURS.objective,
  });
  const bestFebtContract = bestFebtContext && bestFebtContext.contract && typeof bestFebtContext.contract === "object"
    ? bestFebtContext.contract
    : null;
  const objectiveArtifact = readArtifact("objective_supervisor", path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"), FRESHNESS_HOURS.objective);
  const selfEvolutionObjectiveArtifact = readArtifact("self_evolution_objective_supervisor", SELF_EVOLUTION_OBJECTIVE_SUPERVISOR_LATEST_PATH, FRESHNESS_HOURS.objective);
  const mlArtifact = readArtifact("ml_filter_policy", path.join(OPS_DAILY_DIR, "ml_filter_policy_latest.json"), FRESHNESS_HOURS.ml);
  const evArtifact = readArtifact("ev_tp1_threshold_tune", path.join(OPS_DAILY_DIR, "ev_tp1_threshold_tune_latest.json"), FRESHNESS_HOURS.ev);
  const waitArtifact = readArtifact("wait_one_bar_tune", path.join(OPS_DAILY_DIR, "wait_one_bar_tune_latest.json"), FRESHNESS_HOURS.wait);
  const canaryArtifact = readArtifact("filter_shadow_canary", path.join(OPS_DAILY_DIR, "filter_shadow_canary_latest.json"), FRESHNESS_HOURS.canary);
  const selfEvolutionCanaryArtifact = readArtifact("best_self_evolution_canary", SELF_EVOLUTION_CANARY_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionCanary);
  const selfEvolutionCanonicalParityArtifact = readArtifact("best_self_evolution_canonical_parity", SELF_EVOLUTION_CANONICAL_PARITY_LATEST_PATH, FRESHNESS_HOURS.objective);
  const selfEvolutionServerPrimaryCanaryArtifact = readArtifact("best_self_evolution_server_primary_canary", SELF_EVOLUTION_SERVER_PRIMARY_CANARY_LATEST_PATH, FRESHNESS_HOURS.serverPrimaryCanary);
  const selfEvolutionDeploymentPlanArtifact = readArtifact("best_self_evolution_deployment_plan", SELF_EVOLUTION_DEPLOYMENT_PLAN_LATEST_PATH, FRESHNESS_HOURS.objective);
  const selfEvolutionLoopMonitorArtifact = readArtifact("best_self_evolution_loop_monitor", SELF_EVOLUTION_LOOP_MONITOR_LATEST_PATH, FRESHNESS_HOURS.objective);
  const selfEvolutionCandidatesArtifact = readArtifact("best_self_evolution_candidates", SELF_EVOLUTION_CANDIDATES_LATEST_PATH, FRESHNESS_HOURS.objective);
  const changeArtifact = readArtifact("pine_quality_change_control", path.join(OPS_DAILY_DIR, "pine_quality_change_control_latest.json"), FRESHNESS_HOURS.change);
  const codexArtifact = readArtifact("self_evolution_authority", selfEvolutionSnapshotLatestPath("self_evolution_authority_latest.json"), FRESHNESS_HOURS.codex);
  const objectiveArtifactForLoop = selfEvolutionObjectiveArtifact.exists ? selfEvolutionObjectiveArtifact : objectiveArtifact;
  const currentSysRes = await getSystemSettingsForProvider(PROVIDER, 0);
  const currentSys = currentSysRes && currentSysRes.data ? currentSysRes.data : {};
  const autopilotStore = readAutopilotState();
  const stateData = autopilotStore.data || { stages: {}, history: [] };
  let history = Array.isArray(stateData.history) ? stateData.history : [];
  const shadowCanaryPass = Boolean(
    canaryArtifact && canaryArtifact.data
    && canaryArtifact.data.golden && canaryArtifact.data.golden.summary && Number(canaryArtifact.data.golden.summary.drift || 0) === 0
    && canaryArtifact.data.shadow && canaryArtifact.data.shadow.summary && Number(canaryArtifact.data.shadow.summary.drift || 0) === 0
  );
  const selfEvolutionCanary = selfEvolutionCanaryArtifact && selfEvolutionCanaryArtifact.data && selfEvolutionCanaryArtifact.data.summary
    ? selfEvolutionCanaryArtifact.data.summary
    : {};
  const selfEvolutionDeployment = objectiveArtifactForLoop && objectiveArtifactForLoop.data && objectiveArtifactForLoop.data.self_evolution_deployment
    && typeof objectiveArtifactForLoop.data.self_evolution_deployment === "object"
      ? objectiveArtifactForLoop.data.self_evolution_deployment
      : {};
  const selfEvolutionDeploymentPlan = selfEvolutionDeploymentPlanArtifact
    && selfEvolutionDeploymentPlanArtifact.exists
    && selfEvolutionDeploymentPlanArtifact.fresh === true
    && selfEvolutionDeploymentPlanArtifact.data
    && selfEvolutionDeploymentPlanArtifact.data.summary
    && typeof selfEvolutionDeploymentPlanArtifact.data.summary === "object"
      ? selfEvolutionDeploymentPlanArtifact.data.summary
      : (objectiveArtifactForLoop && objectiveArtifactForLoop.data && objectiveArtifactForLoop.data.self_evolution_deployment_plan
        && typeof objectiveArtifactForLoop.data.self_evolution_deployment_plan === "object"
          ? objectiveArtifactForLoop.data.self_evolution_deployment_plan
          : {});
  const selfEvolutionLoopMonitor = buildLoopMonitorView({ objectiveArtifact: objectiveArtifactForLoop, loopMonitorArtifact: selfEvolutionLoopMonitorArtifact, cycleMeta });
  const selfEvolutionServerPrimaryCanary = selfEvolutionServerPrimaryCanaryArtifact && selfEvolutionServerPrimaryCanaryArtifact.data && selfEvolutionServerPrimaryCanaryArtifact.data.summary
    ? selfEvolutionServerPrimaryCanaryArtifact.data.summary
    : {};
  const codexAuthority = objectiveArtifactForLoop && objectiveArtifactForLoop.data && objectiveArtifactForLoop.data.codex_authority
    && typeof objectiveArtifactForLoop.data.codex_authority === "object"
      ? objectiveArtifactForLoop.data.codex_authority
      : {};
  const canaryPass = shadowCanaryPass && Boolean(selfEvolutionCanary.apply_pass === true);
  const canaryReason = !shadowCanaryPass
    ? "CANARY_DRIFT"
    : (selfEvolutionCanary.apply_pass === true ? null : "SELF_EVOLUTION_CANARY_BLOCK");
  const selfEvolutionRollbackReady = Number(selfEvolutionCanary.rollback_ready_n || 0) > 0;
  const serverPrimaryRollbackReady = Number(selfEvolutionServerPrimaryCanary.rollback_trigger_n || 0) > 0 && selfEvolutionServerPrimaryCanary.apply_pass === false;
  const preparedOverride = normalizePreparedOverride(readJsonRawSafe(SELF_EVOLUTION_PREPARED_OVERRIDE_PATH, null));

  const actions = [];
  const stageRows = [];

  const aiCandidate = buildAiStageCandidate(mlArtifact, currentSys, objectiveArtifactForLoop.data || {});
  const aiBestFebtGuard = bestFebtAutopilotGuard({ stage: "AI", candidate: aiCandidate, currentSys, bestFebtContract });
  if (aiBestFebtGuard.blocked) {
    aiCandidate.actionable = false;
    aiCandidate.reason = aiBestFebtGuard.reason;
  }
  aiCandidate.run_key = mlArtifact && mlArtifact.data && mlArtifact.data.generated_at_kst || nowMeta.kst;
  let result = await applyStageCandidate({
    stage: "AI",
    candidate: aiCandidate,
    stageState: getStageState(stateData, "AI"),
    history,
    nowMeta,
    nowMs,
    canaryPass,
    objectiveArtifact: objectiveArtifactForLoop,
    currentSys,
    snapshotKeys: AI_SNAPSHOT_KEYS,
    selfEvolutionRollbackReady,
  });
  history = result.history;
  stateData.stages.AI = result.stageState;
  if (result.action) actions.push(result.action);
  stageRows.push({
    stage: "AI",
    machine_state: result.stageState.machine_state,
    reason: result.stageState.last_reason,
    last_action: result.stageState.last_action,
    streak_current: result.stageState.streak_current,
    blockers: result.stageState.blockers || [],
    signature: result.stageState.last_signature,
    snapshot_path: result.stageState.last_snapshot_path || null,
    best_febt_guard: aiBestFebtGuard.reason,
  });

  const marketCandidate = buildMarketStageCandidate(mlArtifact, currentSys, objectiveArtifactForLoop.data || {});
  const marketBestFebtGuard = bestFebtAutopilotGuard({ stage: "MARKET", candidate: marketCandidate, currentSys, bestFebtContract });
  if (marketBestFebtGuard.blocked) {
    marketCandidate.actionable = false;
    marketCandidate.reason = marketBestFebtGuard.reason;
  }
  marketCandidate.run_key = mlArtifact && mlArtifact.data && mlArtifact.data.generated_at_kst || nowMeta.kst;
  result = await applyStageCandidate({
    stage: "MARKET",
    candidate: marketCandidate,
    stageState: getStageState(stateData, "MARKET"),
    history,
    nowMeta,
    nowMs,
    canaryPass,
    objectiveArtifact: objectiveArtifactForLoop,
    currentSys,
    snapshotKeys: MARKET_SNAPSHOT_KEYS,
    selfEvolutionRollbackReady,
  });
  history = result.history;
  stateData.stages.MARKET = result.stageState;
  if (result.action) actions.push(result.action);
  stageRows.push({
    stage: "MARKET",
    machine_state: result.stageState.machine_state,
    reason: result.stageState.last_reason,
    last_action: result.stageState.last_action,
    streak_current: result.stageState.streak_current,
    blockers: result.stageState.blockers || [],
    signature: result.stageState.last_signature,
    snapshot_path: result.stageState.last_snapshot_path || null,
    best_febt_guard: marketBestFebtGuard.reason,
  });

  const evObservedCandidate = buildObservedStageCandidate("EV", evArtifact, objectiveArtifactForLoop.data && objectiveArtifactForLoop.data.objective ? objectiveArtifactForLoop.data.objective : null);
  const evParityCandidate = buildEvParityCandidate(selfEvolutionCanonicalParityArtifact, currentSys, objectiveArtifactForLoop.data || {});
  if (evObservedCandidate.observedUpdate === true) {
    result = await processObservedStage({
      stage: "EV",
      artifact: evArtifact,
      stateData,
      currentSys,
      objectiveArtifact: objectiveArtifactForLoop,
      canaryPass,
      nowMeta,
      nowMs,
      selfEvolutionRollbackReady,
    });
  } else {
    result = await applyStageCandidate({
      stage: "EV",
      candidate: evParityCandidate,
      stageState: getStageState(stateData, "EV"),
      history,
      nowMeta,
      nowMs,
      canaryPass,
      objectiveArtifact: objectiveArtifactForLoop,
      currentSys,
      snapshotKeys: EV_SNAPSHOT_KEYS,
      selfEvolutionRollbackReady,
    });
  }
  history = result.history;
  stateData.stages.EV = result.stageState;
  if (result.action) actions.push(result.action);
  stageRows.push({
    stage: "EV",
    machine_state: result.stageState.machine_state,
    reason: result.stageState.last_reason,
    last_action: result.stageState.last_action,
    streak_current: result.stageState.streak_current,
    blockers: result.stageState.blockers || [],
    signature: result.stageState.last_signature,
    snapshot_path: result.stageState.last_snapshot_path || null,
    source: evObservedCandidate.observedUpdate === true ? "EV_TUNER" : evParityCandidate.source,
    support_n: evObservedCandidate.observedUpdate === true ? null : evParityCandidate.support_n,
  });

  result = await processObservedStage({
    stage: "WAIT",
    artifact: waitArtifact,
    stateData,
    currentSys,
    objectiveArtifact: objectiveArtifactForLoop,
    canaryPass,
    nowMeta,
    nowMs,
    selfEvolutionRollbackReady,
  });
  history = result.history;
  stateData.stages.WAIT = result.stageState;
  if (result.action) actions.push(result.action);
  stageRows.push({
    stage: "WAIT",
    machine_state: result.stageState.machine_state,
    reason: result.stageState.last_reason,
    last_action: result.stageState.last_action,
    streak_current: result.stageState.streak_current,
    blockers: result.stageState.blockers || [],
    signature: result.stageState.last_signature,
    snapshot_path: result.stageState.last_snapshot_path || null,
  });

  const canonicalPolicyCandidate = buildCanonicalPolicyStageCandidate(selfEvolutionCandidatesArtifact, currentSys, objectiveArtifactForLoop.data || {});
  const canonicalPolicyBestFebtGuard = bestFebtAutopilotGuard({
    stage: "CANONICAL_POLICY",
    candidate: canonicalPolicyCandidate,
    currentSys,
    bestFebtContract,
  });
  if (canonicalPolicyBestFebtGuard.blocked) {
    canonicalPolicyCandidate.actionable = false;
    canonicalPolicyCandidate.reason = canonicalPolicyBestFebtGuard.reason;
  }
  canonicalPolicyCandidate.run_key = selfEvolutionCandidatesArtifact && selfEvolutionCandidatesArtifact.data && selfEvolutionCandidatesArtifact.data.generated_at_kst || nowMeta.kst;
  result = await applyStageCandidate({
    stage: "CANONICAL_POLICY",
    candidate: canonicalPolicyCandidate,
    stageState: getStageState(stateData, "CANONICAL_POLICY"),
    history,
    nowMeta,
    nowMs,
    canaryPass,
    objectiveArtifact: objectiveArtifactForLoop,
    currentSys,
    snapshotKeys: CANONICAL_POLICY_SNAPSHOT_KEYS,
    selfEvolutionRollbackReady,
  });
  history = result.history;
  stateData.stages.CANONICAL_POLICY = result.stageState;
  if (result.action) actions.push(result.action);
  stageRows.push({
    stage: "CANONICAL_POLICY",
    machine_state: result.stageState.machine_state,
    reason: result.stageState.last_reason,
    last_action: result.stageState.last_action,
    streak_current: result.stageState.streak_current,
    blockers: result.stageState.blockers || [],
    signature: result.stageState.last_signature,
    snapshot_path: result.stageState.last_snapshot_path || null,
    display_signature: canonicalPolicyCandidate.display_signature || null,
    candidate_id: canonicalPolicyCandidate.candidate_id || null,
    source: canonicalPolicyCandidate.source || null,
    best_febt_guard: canonicalPolicyBestFebtGuard.reason,
  });

  const sourceModeCandidate = buildSourceModeStageCandidate({
    candidatesArtifact: selfEvolutionCandidatesArtifact,
    parityArtifact: selfEvolutionCanonicalParityArtifact,
    currentSys,
    objectiveSupervisor: objectiveArtifactForLoop.data || {},
  });
  const sourceModeBestFebtGuard = bestFebtAutopilotGuard({
    stage: "SOURCE_MODE",
    candidate: sourceModeCandidate,
    currentSys,
    bestFebtContract,
  });
  if (sourceModeBestFebtGuard.blocked) {
    sourceModeCandidate.actionable = false;
    sourceModeCandidate.reason = sourceModeBestFebtGuard.reason;
  }
  sourceModeCandidate.run_key = selfEvolutionCanonicalParityArtifact && selfEvolutionCanonicalParityArtifact.data && selfEvolutionCanonicalParityArtifact.data.generated_at_kst || nowMeta.kst;
  result = await applyStageCandidate({
    stage: "SOURCE_MODE",
    candidate: sourceModeCandidate,
    stageState: getStageState(stateData, "SOURCE_MODE"),
    history,
    nowMeta,
    nowMs,
    canaryPass,
    objectiveArtifact: objectiveArtifactForLoop,
    currentSys,
    snapshotKeys: SOURCE_MODE_SNAPSHOT_KEYS,
    selfEvolutionRollbackReady: serverPrimaryRollbackReady,
  });
  history = result.history;
  stateData.stages.SOURCE_MODE = result.stageState;
  if (result.action) actions.push(result.action);
  stageRows.push({
    stage: "SOURCE_MODE",
    machine_state: result.stageState.machine_state,
    reason: result.stageState.last_reason,
    last_action: result.stageState.last_action,
    streak_current: result.stageState.streak_current,
    blockers: result.stageState.blockers || [],
    signature: result.stageState.last_signature,
    snapshot_path: result.stageState.last_snapshot_path || null,
    display_signature: sourceModeCandidate.display_signature || null,
    candidate_id: sourceModeCandidate.candidate_id || null,
    source: sourceModeCandidate.source || null,
    support_n: sourceModeCandidate.support_n || 0,
    source_parity_mismatch_n: sourceModeCandidate.source_parity_mismatch_n || 0,
    current_source_modes: sourceModeCandidate.current_source_modes || [],
    server_primary_rollback_ready: serverPrimaryRollbackReady,
    best_febt_guard: sourceModeBestFebtGuard.reason,
  });

  const pineCandidate = buildPineCandidate(objectiveArtifactForLoop, codexArtifact, changeArtifact);
  if (pineCandidate.actionable && pineCandidate.kind === "PROMOTE" && selfEvolutionDeployment.deploy_pass !== true) {
    pineCandidate.actionable = false;
    pineCandidate.reason = Array.isArray(selfEvolutionDeployment.blockers) && selfEvolutionDeployment.blockers.length
      ? selfEvolutionDeployment.blockers[0]
      : "SELF_EVOLUTION_DEPLOYMENT_BLOCK";
  }
  const pineBestFebtGuard = bestFebtAutopilotGuard({
    stage: "PINE",
    candidate: pineCandidate,
    currentSys,
    bestFebtContract,
  });
  if (pineBestFebtGuard.blocked) {
    pineCandidate.actionable = false;
    pineCandidate.reason = pineBestFebtGuard.reason;
  }
  if (pineCandidate.actionable && selfEvolutionLoopMonitor.cycle_consistent === false) {
    pineCandidate.actionable = false;
    pineCandidate.reason = "SELF_EVOLUTION_LOOP_CYCLE_MISMATCH";
  }
  if (pineCandidate.actionable && Number(selfEvolutionLoopMonitor.stale_artifact_n || 0) > 0) {
    pineCandidate.actionable = false;
    pineCandidate.reason = "SELF_EVOLUTION_LOOP_STALE";
  }
  result = await processPineStage({
    objectiveArtifact: objectiveArtifactForLoop,
    codexArtifact,
    changeArtifact,
    stateData,
    canaryPass,
    canaryReason,
    nowMeta,
    nowMs,
    candidateOverride: pineCandidate,
  });
  history = result.history;
  stateData.stages.PINE = result.stageState;
  if (result.action) actions.push(result.action);

  const pineStageRow = {
    stage: "PINE",
    machine_state: result.stageState.machine_state,
    reason: result.stageState.last_reason,
    last_action: result.stageState.last_action,
    streak_current: result.stageState.streak_current,
    blockers: result.stageState.blockers || [],
    signature: result.stageState.last_signature,
    snapshot_path: null,
    prepared_file_path: result.stageState.prepared_file_path || null,
    prepared_strategy_id: result.stageState.prepared_strategy_id || null,
    latest_generated_file_path: result.stageState.latest_generated_file_path || null,
    rollback_source_file_path: result.stageState.rollback_source_file_path || null,
    display_signature: result.stageState.display_signature || pineCandidate.display_signature || null,
    best_febt_guard: pineBestFebtGuard.reason,
  };

  stateData.history = history;
  writeAutopilotState(autopilotStore.filePath, stateData);

  const pineHandoff = {
    stage_ready: result.stageState.machine_state === STATE_MACHINE.READY,
    target_candidate_id: pineCandidate.signature || null,
    display_candidate_id: pineCandidate.display_signature || pineCandidate.signature || null,
    prepared_file_path: result.stageState.prepared_file_path || null,
    prepared_strategy_id: result.stageState.prepared_strategy_id || null,
    latest_generated_file_path: result.stageState.latest_generated_file_path || null,
    rollback_source_file_path: result.stageState.rollback_source_file_path || null,
    candidate_signature: result.stageState.last_signature || null,
  };
  const overrideApplied = applyPreparedOverrideToPineArtifacts({ pineHandoff, pineStageRow, preparedOverride });
  stageRows.push(overrideApplied.pineStageRow);

  const reportCycleId = resolveReportCycleId({
    preferredCycleId: String(process.env.BEST_SELF_EVOLUTION_CYCLE_ID || "").trim() || null,
    objectiveArtifact: objectiveArtifactForLoop,
    deploymentPlan: selfEvolutionDeploymentPlan,
    loopMonitor: selfEvolutionLoopMonitor,
    fallbackCycleId: cycleMeta.cycle_id,
  });

  const sourceCycleId = String(
    selfEvolutionDeploymentPlan.source_cycle_id
    || (objectiveArtifactForLoop && objectiveArtifactForLoop.data && objectiveArtifactForLoop.data.source_cycle_id)
    || (objectiveArtifactForLoop && objectiveArtifactForLoop.data && objectiveArtifactForLoop.data.cycle_id)
    || reportCycleId
    || ""
  ).trim() || null;

  const evaluationCycleId = cycleMeta.cycle_id;

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: reportCycleId,
    generation_id: reportCycleId,
    source_cycle_id: sourceCycleId,
    evaluation_cycle_id: evaluationCycleId,
    provider: PROVIDER,
    objective_verdict: String(objectiveArtifactForLoop && objectiveArtifactForLoop.data && objectiveArtifactForLoop.data.verdict || "N/A"),
    canary_pass: canaryPass,
    self_evolution_canary: {
      available: !!(selfEvolutionCanaryArtifact && selfEvolutionCanaryArtifact.data),
      apply_pass: Boolean(selfEvolutionCanary.apply_pass === true),
      rollback_ready_n: toNum(selfEvolutionCanary.rollback_ready_n) || 0,
      ready_n: toNum(selfEvolutionCanary.ready_n) || 0,
      blocked_n: toNum(selfEvolutionCanary.blocked_n) || 0,
      top_ready_market: String(selfEvolutionCanary.top_ready_market || "").trim() || null,
      top_rollback_market: String(selfEvolutionCanary.top_rollback_market || "").trim() || null,
    },
    self_evolution_server_primary_canary: {
      available: selfEvolutionServerPrimaryCanaryArtifact.exists === true,
      executed_n: toNum(selfEvolutionServerPrimaryCanary.server_primary_executed_n),
      realized_n: toNum(selfEvolutionServerPrimaryCanary.server_primary_realized_n),
      disagreement_n: toNum(selfEvolutionServerPrimaryCanary.pine_shadow_disagreement_n),
      disagreement_rate: toNum(selfEvolutionServerPrimaryCanary.pine_shadow_disagreement_rate),
      rollback_trigger_n: toNum(selfEvolutionServerPrimaryCanary.rollback_trigger_n) || 0,
      rollback_trigger_markets: Array.isArray(selfEvolutionServerPrimaryCanary.rollback_trigger_markets) ? selfEvolutionServerPrimaryCanary.rollback_trigger_markets : [],
      apply_pass: selfEvolutionServerPrimaryCanary.apply_pass === true ? true : (selfEvolutionServerPrimaryCanary.apply_pass === false ? false : null),
    },
    self_evolution_deployment: {
      available: !!(objectiveArtifactForLoop && objectiveArtifactForLoop.data && objectiveArtifactForLoop.data.self_evolution_deployment),
      deploy_pass: selfEvolutionDeployment.deploy_pass === true,
      rollback_only: selfEvolutionDeployment.rollback_only === true,
      target_candidate_id: String(selfEvolutionDeployment.target_candidate_id || "").trim() || null,
      blockers: Array.isArray(selfEvolutionDeployment.blockers) ? selfEvolutionDeployment.blockers : [],
      canary_open_wave: toNum(selfEvolutionDeployment.canary_open_wave) || 1,
    },
    self_evolution_deployment_plan: {
      available: !!(
        (selfEvolutionDeploymentPlanArtifact && selfEvolutionDeploymentPlanArtifact.exists && selfEvolutionDeploymentPlanArtifact.data && selfEvolutionDeploymentPlanArtifact.data.summary)
        || (objectiveArtifactForLoop && objectiveArtifactForLoop.data && objectiveArtifactForLoop.data.self_evolution_deployment_plan)
      ),
      plan_status: String(selfEvolutionDeploymentPlan.plan_status || "").trim().toUpperCase() || null,
      prepare_pass: selfEvolutionDeploymentPlan.prepare_pass === true,
      manual_step_required: selfEvolutionDeploymentPlan.manual_step_required === true,
      target_candidate_id: String(selfEvolutionDeploymentPlan.target_candidate_id || "").trim() || null,
      prepared_file_path: String(selfEvolutionDeploymentPlan.prepared_file_path || "").trim() || null,
      prepared_strategy_id: String(selfEvolutionDeploymentPlan.prepared_strategy_id || "").trim() || null,
      applied_strategy_id: String(selfEvolutionDeploymentPlan.applied_strategy_id || "").trim() || null,
      manual_paste_acknowledged: selfEvolutionDeploymentPlan.manual_paste_acknowledged === true,
      live_signal_confirmed: selfEvolutionDeploymentPlan.live_signal_confirmed === true,
      latest_generated_file_path: String(selfEvolutionDeploymentPlan.latest_generated_file_path || "").trim() || null,
      rollback_source_file_path: String(selfEvolutionDeploymentPlan.rollback_source_file_path || "").trim() || null,
      blockers: Array.isArray(selfEvolutionDeploymentPlan.blockers) ? selfEvolutionDeploymentPlan.blockers : [],
    },
    self_evolution_loop_monitor: {
      available: selfEvolutionLoopMonitor.available === true,
      source: String(selfEvolutionLoopMonitor.source || "").trim() || null,
      cycle_id: String(selfEvolutionLoopMonitor.cycle_id || "").trim() || null,
      overall_status: String(selfEvolutionLoopMonitor.overall_status || "").trim().toUpperCase() || null,
      cycle_consistent: selfEvolutionLoopMonitor.cycle_consistent === true
        ? true
        : (selfEvolutionLoopMonitor.cycle_consistent === false ? false : null),
      stale_artifact_n: toNum(selfEvolutionLoopMonitor.stale_artifact_n),
      critical_blockers: Array.isArray(selfEvolutionLoopMonitor.critical_blockers) ? selfEvolutionLoopMonitor.critical_blockers : [],
      promotion_path_ready: selfEvolutionLoopMonitor.promotion_path_ready === true,
      manual_paste_ready: selfEvolutionLoopMonitor.manual_paste_ready === true,
      ready_candidate_id: String(selfEvolutionLoopMonitor.ready_candidate_id || "").trim() || null,
    },
    self_evolution_pine_handoff: overrideApplied.pineHandoff,
    codex_authority: {
      owner: String(codexAuthority.owner || "").trim() || "CODEX",
      authority_mode: String(codexAuthority.authority_mode || "").trim().toUpperCase() || null,
      status: String(codexAuthority.status || "").trim().toUpperCase() || null,
      verdict: String(codexAuthority.verdict || "").trim().toUpperCase() || null,
      recommended_candidate_id: String(codexAuthority.recommended_candidate_id || "").trim() || null,
      recommended_rollback_file_path: String(codexAuthority.recommended_rollback_file_path || "").trim() || null,
      manual_step_required: codexAuthority.manual_step_required === true,
      prepared_file_path: String(codexAuthority.prepared_file_path || "").trim() || null,
      latest_generated_file_path: String(codexAuthority.latest_generated_file_path || "").trim() || null,
      blockers: Array.isArray(codexAuthority.blockers) ? codexAuthority.blockers : [],
    },
    best_febt_tuning_contract: bestFebtContract,
    stage_rows: stageRows,
    actions,
    artifacts: [objectiveArtifactForLoop, mlArtifact, evArtifact, waitArtifact, canaryArtifact, selfEvolutionCanaryArtifact, selfEvolutionCanonicalParityArtifact, selfEvolutionServerPrimaryCanaryArtifact, selfEvolutionLoopMonitorArtifact, selfEvolutionCandidatesArtifact, changeArtifact, codexArtifact].map((row) => ({
      name: row.name,
      filePath: row.filePath,
      fresh: row.fresh,
      age_hours: row.ageHours,
    })),
  };

  const jsonPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_stage_autopilot.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${nowMeta.dateKey}_${nowMeta.hhmm}_stage_autopilot.md`);
  writeJson(jsonPath, wrapDisplayAndRawReport(report));
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);

  if (actions.length && String(process.env.STAGE_AUTOPILOT_SKIP_TELEGRAM || "").trim() !== "1") {
    const alert = await sendKoreanTelegramSummary({
      title: `[자동 변경 반영] ${actions.length}건 처리`,
      provider: PROVIDER,
      severity: actions.some((row) => row.type === "AUTO_ROLLBACK") ? "WARN" : "INFO",
      sections: [
        { header: "공통 상태", lines: [`전체 목표 판정은 ${report.objective_verdict} 입니다.`, `변경 안전 검증은 ${report.canary_pass ? "정상" : "차단"} 입니다.`] },
        { header: "자기 진화 canary", lines: [`apply ${report.self_evolution_canary && report.self_evolution_canary.apply_pass ? "PASS" : "BLOCK"} / ready ${report.self_evolution_canary && report.self_evolution_canary.ready_n != null ? report.self_evolution_canary.ready_n : "N/A"} / blocked ${report.self_evolution_canary && report.self_evolution_canary.blocked_n != null ? report.self_evolution_canary.blocked_n : "N/A"}`, `rollback ${report.self_evolution_canary && report.self_evolution_canary.rollback_ready_n != null ? report.self_evolution_canary.rollback_ready_n : "N/A"} / top ready ${report.self_evolution_canary && report.self_evolution_canary.top_ready_market || "N/A"} / top rollback ${report.self_evolution_canary && report.self_evolution_canary.top_rollback_market || "N/A"}`] },
        { header: "server-primary canary", lines: [`apply ${report.self_evolution_server_primary_canary && report.self_evolution_server_primary_canary.apply_pass === true ? "PASS" : (report.self_evolution_server_primary_canary && report.self_evolution_server_primary_canary.apply_pass === false ? "BLOCK" : "N/A")} / executed ${report.self_evolution_server_primary_canary && report.self_evolution_server_primary_canary.executed_n != null ? report.self_evolution_server_primary_canary.executed_n : "N/A"} / realized ${report.self_evolution_server_primary_canary && report.self_evolution_server_primary_canary.realized_n != null ? report.self_evolution_server_primary_canary.realized_n : "N/A"}`, `disagreement ${report.self_evolution_server_primary_canary && report.self_evolution_server_primary_canary.disagreement_n != null ? report.self_evolution_server_primary_canary.disagreement_n : "N/A"} / rollback ${report.self_evolution_server_primary_canary && report.self_evolution_server_primary_canary.rollback_trigger_n != null ? report.self_evolution_server_primary_canary.rollback_trigger_n : "N/A"} / markets ${report.self_evolution_server_primary_canary && Array.isArray(report.self_evolution_server_primary_canary.rollback_trigger_markets) && report.self_evolution_server_primary_canary.rollback_trigger_markets.length ? report.self_evolution_server_primary_canary.rollback_trigger_markets.join("|") : "none"}`] },
        { header: "자기 진화 배포 가드", lines: [`deploy ${report.self_evolution_deployment && report.self_evolution_deployment.deploy_pass ? "PASS" : "BLOCK"} / target ${report.self_evolution_deployment && report.self_evolution_deployment.target_candidate_id || "N/A"} / open wave ${report.self_evolution_deployment && report.self_evolution_deployment.canary_open_wave != null ? report.self_evolution_deployment.canary_open_wave : "N/A"}`, `blockers ${report.self_evolution_deployment && Array.isArray(report.self_evolution_deployment.blockers) && report.self_evolution_deployment.blockers.length ? report.self_evolution_deployment.blockers.join("|") : "none"}`] },
        { header: "자기 진화 배포 handoff", lines: [`status ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.plan_status || "N/A"} / prepare ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.prepare_pass ? "PASS" : "BLOCK"} / manual ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.manual_step_required ? "YES" : "NO"}`, `file ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.prepared_file_path || report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.latest_generated_file_path || "N/A"} / rollback ${report.self_evolution_deployment_plan && report.self_evolution_deployment_plan.rollback_source_file_path || "N/A"}`] },
        { header: "Pine 수동 handoff", lines: [`ready ${report.self_evolution_pine_handoff && report.self_evolution_pine_handoff.stage_ready ? "YES" : "NO"} / candidate ${report.self_evolution_pine_handoff && report.self_evolution_pine_handoff.candidate_signature || "N/A"}`, `file ${report.self_evolution_pine_handoff && report.self_evolution_pine_handoff.prepared_file_path || "N/A"} / latest ${report.self_evolution_pine_handoff && report.self_evolution_pine_handoff.latest_generated_file_path || "N/A"}`] },
        { header: "외부 권한", lines: [`mode ${report.codex_authority && report.codex_authority.authority_mode || "N/A"} / status ${report.codex_authority && report.codex_authority.status || "N/A"} / verdict ${report.codex_authority && report.codex_authority.verdict || "N/A"}`, `manual ${report.codex_authority && report.codex_authority.manual_step_required ? "YES" : "NO"} / file ${report.codex_authority && report.codex_authority.prepared_file_path || report.codex_authority && report.codex_authority.latest_generated_file_path || "N/A"}`] },
        { header: "BEST/FEBT 공통 계약", lines: [`mode ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.mode || "N/A"} / tightening ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.tightening_allowed ? "ALLOW" : "BLOCK"} / recovery ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.recovery_priority ? "FIRST" : "NORMAL"}`, `replacement ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.projected_replacement_ratio != null ? Number(report.best_febt_tuning_contract.projected_replacement_ratio).toFixed(2) : "N/A"} / count ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.projected_count_ratio_global != null ? `${Number(report.best_febt_tuning_contract.projected_count_ratio_global).toFixed(2)}x` : "N/A"}`] },
        { header: "이번에 실제로 한 일", lines: actions.map((row) => `${row.stage} 단계에서 ${row.type} 처리: ${row.detail}`) },
        { header: "각 단계 상태", lines: stageRows.map((row) => `${row.stage} 단계는 ${row.machine_state} 상태이며 사유는 ${row.reason} 입니다.`) },
      ],
    });
    if (!alert || (alert.ok !== true && !(alert.skipped && alert.reason === "SKIP_ALERT"))) {
      throw new Error(`TELEGRAM_SEND_FAILED:${JSON.stringify(alert || {})}`);
    }
  }

  console.log(JSON.stringify({
    ok: true,
    provider: PROVIDER,
    actions: actions.length,
    objective: report.objective_verdict,
    canary_pass: report.canary_pass,
    self_evolution_canary_apply_pass: report.self_evolution_canary.apply_pass,
    self_evolution_canary_rollback_ready_n: report.self_evolution_canary.rollback_ready_n,
    self_evolution_server_primary_canary_rollback_trigger_n: report.self_evolution_server_primary_canary.rollback_trigger_n,
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
    buildAiStageCandidate,
    buildMarketStageCandidate,
    buildObservedStageCandidate,
    buildPineCandidate,
    buildLoopMonitorView,
    resolveReportCycleId,
    applyPreparedOverrideToPineArtifacts,
    stageChangeBudgetOk,
    stableSignature,
    isAiAutopilotTightening,
    bestFebtAutopilotGuard,
    applyCanonicalThresholdChanges,
    buildCanonicalPolicyStageCandidate,
    applyCanonicalSourceModeChanges,
    buildSourceModeStageCandidate,
    buildEvParityCandidate,
  },
};
