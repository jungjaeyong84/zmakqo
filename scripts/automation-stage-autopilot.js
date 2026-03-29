#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const { getSystemSettingsForProvider } = require("../src/storage/settings");
const {
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  sendKoreanTelegramSummary,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { readBestFebtSupervisorContext } = require("./lib/best-febt-supervisor");
const { wrapDisplayAndRawReport } = require("../src/utils/jsonDisplayFields");
const {
  STATE_MACHINE,
  appendStageHistory,
  buildRollbackPrepared,
  computeSignatureStreak,
  evaluateCommonAutoApply,
  getStageState,
  normalizeSignature,
  pickSettingsSnapshot,
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
  codex: Math.max(12, Number(process.env.STAGE_AUTOPILOT_CODEX_MAX_AGE_HOURS || 48)),
});
const SELF_EVOLUTION_CANARY_LATEST_PATH = path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json");
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
    `- BEST/FEBT contract: ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.mode || "N/A"} / tightening ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.tightening_allowed ? "ALLOW" : "BLOCK"} / recovery ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.recovery_priority ? "FIRST" : "NORMAL"} / replacement ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.projected_replacement_ratio != null ? Number(report.best_febt_tuning_contract.projected_replacement_ratio).toFixed(2) : "N/A"} / count ${report.best_febt_tuning_contract && report.best_febt_tuning_contract.projected_count_ratio_global != null ? Number(report.best_febt_tuning_contract.projected_count_ratio_global).toFixed(2) : "N/A"}x`,
    "",
    "## Stages",
  ];
  for (const row of report.stage_rows || []) {
    lines.push(`- ${row.stage}: ${row.machine_state} / ${row.reason} / action=${row.last_action || "N/A"} / streak=${row.streak_current || 0}`);
    if (row.blockers && row.blockers.length) lines.push(`  - blockers: ${row.blockers.join(", ")}`);
    if (row.signature) lines.push(`  - signature: ${row.signature}`);
    if (row.snapshot_path) lines.push(`  - snapshot: ${row.snapshot_path}`);
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
  const verdict = String(objective.verdict || "HOLD").toUpperCase();
  const codexVerdict = String(codex.verdict || "HOLD").toUpperCase();
  const codexFresh = Boolean(codexArtifact && codexArtifact.fresh === true);
  if (verdict === "PATCH_CANDIDATE") {
    const candidateId = String(objective.promotion && objective.promotion.candidate_id || change.auto_promotion && change.auto_promotion.candidate_id || "").trim();
    return {
      actionable: !!candidateId && codexFresh && codexVerdict === "PROMOTE",
      kind: "PROMOTE",
      signature: candidateId || null,
      reason: String(objective.reason || "PATCH_CANDIDATE"),
      detail: candidateId || "N/A",
    };
  }
  if (verdict === "ROLLBACK_CANDIDATE") {
    const rollbackPath = String(objective.rollback && objective.rollback.rollback_file_path || change.auto_rollback && change.auto_rollback.rollback_file_path || "").trim();
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
  if (stageState.applied_signature === candidate.signature && stageState.machine_state === STATE_MACHINE.READY) {
    return {
      stageState: stageState,
      history,
      action: null,
    };
  }

  const prep = runWeeklyPinePreparation();
  const nextState = {
    ...stageState,
    stage,
    machine_state: prep.ok ? STATE_MACHINE.READY : STATE_MACHINE.HOLD,
    last_signature: candidate.signature,
    last_action: "PINE_PREPARE",
    last_reason: prep.ok ? `${candidate.kind}_PREPARED` : `PINE_PREPARE_FAILED:${prep.error || prep.status || "UNKNOWN"}`,
    streak_current: candidate.signature ? computeSignatureStreak(history, stage, candidate.signature) : 0,
    applied_signature: candidate.signature,
    applied_at_kst: nowMeta.kst,
    blockers: prep.ok ? [] : ["PINE_PREPARE_FAILED"],
    prep_stdout: prep.stdout ? prep.stdout.slice(-4000) : "",
    prep_stderr: prep.stderr ? prep.stderr.slice(-4000) : "",
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
    action: { stage, type: "PINE_PREPARE", detail: `${candidate.kind} / ${candidate.detail}` },
  };
}

async function main() {
  const nowMeta = nowKstMeta();
  const nowMs = nowMeta.nowMs;
  const bestFebtContext = readBestFebtSupervisorContext(nowMs, {
    weeklyMaxAgeHours: FRESHNESS_HOURS.objective,
    objectiveSupervisorMaxAgeHours: FRESHNESS_HOURS.objective,
  });
  const bestFebtContract = bestFebtContext && bestFebtContext.contract && typeof bestFebtContext.contract === "object"
    ? bestFebtContext.contract
    : null;
  const objectiveArtifact = readArtifact("objective_supervisor", path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"), FRESHNESS_HOURS.objective);
  const mlArtifact = readArtifact("ml_filter_policy", path.join(OPS_DAILY_DIR, "ml_filter_policy_latest.json"), FRESHNESS_HOURS.ml);
  const evArtifact = readArtifact("ev_tp1_threshold_tune", path.join(OPS_DAILY_DIR, "ev_tp1_threshold_tune_latest.json"), FRESHNESS_HOURS.ev);
  const waitArtifact = readArtifact("wait_one_bar_tune", path.join(OPS_DAILY_DIR, "wait_one_bar_tune_latest.json"), FRESHNESS_HOURS.wait);
  const canaryArtifact = readArtifact("filter_shadow_canary", path.join(OPS_DAILY_DIR, "filter_shadow_canary_latest.json"), FRESHNESS_HOURS.canary);
  const selfEvolutionCanaryArtifact = readArtifact("best_self_evolution_canary", SELF_EVOLUTION_CANARY_LATEST_PATH, FRESHNESS_HOURS.selfEvolutionCanary);
  const changeArtifact = readArtifact("pine_quality_change_control", path.join(OPS_DAILY_DIR, "pine_quality_change_control_latest.json"), FRESHNESS_HOURS.change);
  const codexArtifact = readArtifact("codex_weekly_patch_engine", path.join(OPS_DAILY_DIR, "codex_weekly_patch_engine_latest.json"), FRESHNESS_HOURS.codex);
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
  const canaryPass = shadowCanaryPass && Boolean(selfEvolutionCanary.apply_pass === true);
  const canaryReason = !shadowCanaryPass
    ? "CANARY_DRIFT"
    : (selfEvolutionCanary.apply_pass === true ? null : "SELF_EVOLUTION_CANARY_BLOCK");
  const selfEvolutionRollbackReady = Number(selfEvolutionCanary.rollback_ready_n || 0) > 0;

  const actions = [];
  const stageRows = [];

  const aiCandidate = buildAiStageCandidate(mlArtifact, currentSys, objectiveArtifact.data || {});
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
    objectiveArtifact,
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

  const marketCandidate = buildMarketStageCandidate(mlArtifact, currentSys, objectiveArtifact.data || {});
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
    objectiveArtifact,
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

  result = await processObservedStage({
    stage: "EV",
    artifact: evArtifact,
    stateData,
    currentSys,
    objectiveArtifact,
    canaryPass,
    nowMeta,
    nowMs,
    selfEvolutionRollbackReady,
  });
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
  });

  result = await processObservedStage({
    stage: "WAIT",
    artifact: waitArtifact,
    stateData,
    currentSys,
    objectiveArtifact,
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

  const pineCandidate = buildPineCandidate(objectiveArtifact, codexArtifact, changeArtifact);
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
  result = await processPineStage({
    objectiveArtifact,
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
  stageRows.push({
    stage: "PINE",
    machine_state: result.stageState.machine_state,
    reason: result.stageState.last_reason,
    last_action: result.stageState.last_action,
    streak_current: result.stageState.streak_current,
    blockers: result.stageState.blockers || [],
    signature: result.stageState.last_signature,
    snapshot_path: null,
    best_febt_guard: pineBestFebtGuard.reason,
  });

  stateData.history = history;
  writeAutopilotState(autopilotStore.filePath, stateData);

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    provider: PROVIDER,
    objective_verdict: String(objectiveArtifact && objectiveArtifact.data && objectiveArtifact.data.verdict || "N/A"),
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
    best_febt_tuning_contract: bestFebtContract,
    stage_rows: stageRows,
    actions,
    artifacts: [objectiveArtifact, mlArtifact, evArtifact, waitArtifact, canaryArtifact, selfEvolutionCanaryArtifact, changeArtifact, codexArtifact].map((row) => ({
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

  if (actions.length) {
    const alert = await sendKoreanTelegramSummary({
      title: `[자동 변경 반영] ${actions.length}건 처리`,
      provider: PROVIDER,
      severity: actions.some((row) => row.type === "AUTO_ROLLBACK") ? "WARN" : "INFO",
      sections: [
        { header: "공통 상태", lines: [`전체 목표 판정은 ${report.objective_verdict} 입니다.`, `변경 안전 검증은 ${report.canary_pass ? "정상" : "차단"} 입니다.`] },
        { header: "자기 진화 canary", lines: [`apply ${report.self_evolution_canary && report.self_evolution_canary.apply_pass ? "PASS" : "BLOCK"} / ready ${report.self_evolution_canary && report.self_evolution_canary.ready_n != null ? report.self_evolution_canary.ready_n : "N/A"} / blocked ${report.self_evolution_canary && report.self_evolution_canary.blocked_n != null ? report.self_evolution_canary.blocked_n : "N/A"}`, `rollback ${report.self_evolution_canary && report.self_evolution_canary.rollback_ready_n != null ? report.self_evolution_canary.rollback_ready_n : "N/A"} / top ready ${report.self_evolution_canary && report.self_evolution_canary.top_ready_market || "N/A"} / top rollback ${report.self_evolution_canary && report.self_evolution_canary.top_rollback_market || "N/A"}`] },
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
    stageChangeBudgetOk,
    stableSignature,
    isAiAutopilotTightening,
    bestFebtAutopilotGuard,
  },
};
