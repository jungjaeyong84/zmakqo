#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
const { spawnSync } = require("child_process");
const {
  REPO_ROOT,
  OPS_DAILY_DIR,
  copyLatest,
  loadLocalEnv,
  nowKstMeta,
  readJsonRawSafe,
  resolveAutomationCycleMeta,
  sendKoreanTelegramSummary,
  writeJson,
  writeText,
} = require("./lib/automation-utils");
const { buildSelfEvolutionPolicySpec } = require("./lib/best-febt-supervisor");
const { wrapDisplayAndRawReport } = require("../src/utils/jsonDisplayFields");

loadLocalEnv();

const CODEX_BIN = String(process.env.CODEX_BIN || "/Applications/Codex.app/Contents/Resources/codex").trim();
const CODEX_MODEL = String(process.env.CODEX_PATCH_ENGINE_MODEL || "").trim();
const CODEX_REASONING_EFFORT = String(process.env.CODEX_PATCH_ENGINE_REASONING_EFFORT || "medium").trim().toLowerCase();
const EXEC_TIMEOUT_MS = Math.max(60_000, Number(process.env.CODEX_PATCH_ENGINE_TIMEOUT_MS || 900_000));
const MAX_AGE_HOURS = Math.max(12, Number(process.env.CODEX_PATCH_ENGINE_INPUT_MAX_AGE_HOURS || 48));
const RETRY_COUNT = Math.max(1, Number(process.env.CODEX_PATCH_ENGINE_RETRY_COUNT || 2));
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "codex_weekly_patch_engine_latest.md");
const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "codex_weekly_patch_engine_latest.json");

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  return value;
}

function resolveLatestArtifactPath(...names) {
  for (const name of names) {
    const candidate = path.join(OPS_DAILY_DIR, name);
    if (fs.existsSync(candidate)) return candidate;
  }
  return path.join(OPS_DAILY_DIR, names[0]);
}
const INPUT_PATHS = Object.freeze({
  objectiveSupervisor: path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json"),
  governance: path.join(OPS_DAILY_DIR, "weekly_filter_governance_latest.json"),
  changeControl: resolveLatestArtifactPath("pine_quality_change_control_latest.json", "pine_stage1_change_control_latest.json"),
  patchCandidates: resolveLatestArtifactPath("pine_quality_patch_candidates_latest.json", "pine_stage1_patch_candidates_latest.json"),
  ml: path.join(OPS_DAILY_DIR, "ml_filter_policy_latest.json"),
  ev: path.join(OPS_DAILY_DIR, "ev_tp1_threshold_tune_latest.json"),
  wait: path.join(OPS_DAILY_DIR, "wait_one_bar_tune_latest.json"),
  canary: path.join(OPS_DAILY_DIR, "filter_shadow_canary_latest.json"),
  stageAutopilot: path.join(OPS_DAILY_DIR, "stage_autopilot_latest.json"),
  selfEvolutionCandidates: path.join(OPS_DAILY_DIR, "best_self_evolution_candidates_latest.json"),
  selfEvolutionCanary: path.join(OPS_DAILY_DIR, "best_self_evolution_canary_latest.json"),
  deploymentPlan: path.join(OPS_DAILY_DIR, "best_self_evolution_deployment_plan_latest.json"),
  loopMonitor: path.join(OPS_DAILY_DIR, "best_self_evolution_loop_monitor_latest.json"),
  retrospective: path.join(OPS_DAILY_DIR, "objective_retrospective_latest.json"),
});

function buildCandidateDisplayMap(changeControl = null, patchCandidates = null) {
  const map = new Map();
  const ccId = String(changeControl && changeControl.auto_promotion && changeControl.auto_promotion.candidate_id || "").trim();
  const ccDisplay = String(changeControl && changeControl.auto_promotion && changeControl.auto_promotion.display_candidate_id || "").trim();
  if (ccId && ccDisplay) map.set(ccId, ccDisplay);
  const rows = Array.isArray(patchCandidates && patchCandidates.candidates) ? patchCandidates.candidates : [];
  for (const row of rows) {
    const raw = String(row && row.candidate_id || "").trim();
    const display = String(row && row.display_candidate_id || "").trim();
    if (raw && display) map.set(raw, display);
  }
  return map;
}

function toDisplayCandidateId(candidateId, displayMap) {
  const raw = String(candidateId || "").trim();
  if (!raw) return null;
  return displayMap.get(raw) || raw;
}

function replaceCandidateIdsInText(text, displayMap) {
  let out = String(text || "");
  for (const [raw, display] of displayMap.entries()) {
    if (!raw || !display || raw === display) continue;
    out = out.split(raw).join(display);
  }
  out = out.replace(/\b(AUTO_[A-Z0-9_]+)\s*\/\s*\1\b/g, "$1");
  return out;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function deriveInlineLoopMonitorSummary(objectiveSupervisor = null, standaloneLoopMonitor = null) {
  const inlineSummary = objectiveSupervisor
    && objectiveSupervisor.self_evolution_loop_monitor
    && typeof objectiveSupervisor.self_evolution_loop_monitor === "object"
    ? objectiveSupervisor.self_evolution_loop_monitor
    : null;
  if (inlineSummary) return inlineSummary;
  const standalone = unwrapRawReport(standaloneLoopMonitor);
  if (standalone && standalone.summary && typeof standalone.summary === "object") return standalone.summary;
  if (standalone && typeof standalone === "object") return standalone;
  return {};
}

function readCycleId(report = null) {
  const raw = unwrapRawReport(report) || {};
  const cycleId = String(raw.cycle_id || raw.generation_id || "").trim();
  return cycleId || null;
}

function deriveCycleConsistency(reports = []) {
  const cycleIds = Array.from(new Set(reports.map((row) => readCycleId(row)).filter(Boolean)));
  return {
    cycle_consistent: cycleIds.length <= 1,
    cycle_id: cycleIds.length === 1 ? cycleIds[0] : null,
    cycle_ids: cycleIds,
  };
}

function deriveReviewReadiness({ changeControl = null, selfEvolutionCanary = null, deploymentPlan = null } = {}) {
  const readyPromotion = Boolean(changeControl && changeControl.auto_promotion && changeControl.auto_promotion.ready === true);
  const readyRollback = Boolean(changeControl && changeControl.auto_rollback && changeControl.auto_rollback.ready === true);
  const selfEvolutionSummary = selfEvolutionCanary && selfEvolutionCanary.summary && typeof selfEvolutionCanary.summary === "object"
    ? selfEvolutionCanary.summary
    : {};
  const deploymentPlanSummary = deploymentPlan && deploymentPlan.summary && typeof deploymentPlan.summary === "object"
    ? deploymentPlan.summary
    : (deploymentPlan && typeof deploymentPlan === "object" ? deploymentPlan : {});
  const planStatus = String(deploymentPlanSummary.plan_status || "").trim().toUpperCase();
  const selfEvolutionPromotionReady = Boolean(
    toNum(selfEvolutionSummary.ready_n) > 0
    && selfEvolutionSummary.apply_pass === true
  );
  const selfEvolutionRollbackReady = Boolean(toNum(selfEvolutionSummary.rollback_ready_n) > 0);
  const selfEvolutionAuthorityBypass = Boolean(
    deploymentPlanSummary.authority_bypass_active === true
    || /AUTHORITY_BYPASS/.test(planStatus)
  );
  const pendingSignalConfirmation = (
    planStatus === "APPLIED_PENDING_SIGNAL_CONFIRMATION"
    || planStatus === "APPLIED_PENDING_SIGNAL_CONFIRMATION_AUTHORITY_BYPASS"
  );
  const reviewReady = !pendingSignalConfirmation && (
    readyPromotion || readyRollback || selfEvolutionPromotionReady || selfEvolutionRollbackReady || selfEvolutionAuthorityBypass
  );
  return {
    readyPromotion,
    readyRollback,
    selfEvolutionPromotionReady,
    selfEvolutionRollbackReady,
    selfEvolutionAuthorityBypass,
    pendingSignalConfirmation,
    reviewReady,
    blockedReason: pendingSignalConfirmation ? "PENDING_SIGNAL_CONFIRMATION_BLOCK" : null,
  };
}

function readFreshJson(filePath, maxAgeHours = MAX_AGE_HOURS) {
  const data = readJsonRawSafe(filePath, null);
  if (!data) return { filePath, data: null, exists: false, fresh: false, ageHours: null };
  try {
    const st = fs.statSync(filePath);
    const ageHours = (Date.now() - Number(st.mtimeMs || 0)) / (60 * 60 * 1000);
    return { filePath, data, exists: true, fresh: Number.isFinite(ageHours) && ageHours <= maxAgeHours, ageHours };
  } catch (_err) {
    return { filePath, data, exists: true, fresh: false, ageHours: null };
  }
}

function buildObjectiveSupervisorLayerLines(objectiveSupervisor = null) {
  const layers = objectiveSupervisor && objectiveSupervisor.filter_layers && typeof objectiveSupervisor.filter_layers === "object"
    ? objectiveSupervisor.filter_layers
    : {};
  return [
    `- current filter layer model: 1차 상태/무결성 -> 2차 진입 품질 -> 3차 상태 기반 Soft Sizing -> 4차 EV/시간가치층 -> 5차 WAIT 타이밍층`,
    `- legacy mapping: '3차 시황' == '3차 상태 기반 Soft Sizing', '4차 EV' == '4차 EV/시간가치층', '5차 WAIT' == '5차 WAIT 타이밍층'`,
    `- layer 1 integrity: ${layers.integrity ? `${layers.integrity.server_mode || "N/A"} / coverage ${layers.integrity.coverage_pass ? "PASS" : "BLOCK"}` : "N/A"}`,
    `- layer 2 entry quality: ${layers.entry_quality ? `candidate ${layers.entry_quality.pine_candidate_verdict || "N/A"} / ml quality ${layers.entry_quality.quality_actions != null ? layers.entry_quality.quality_actions : "N/A"}` : "N/A"}`,
    `- layer 3 state soft sizing: ${layers.state_soft_sizing ? `${layers.state_soft_sizing.ml_action || "N/A"} / physics ${layers.state_soft_sizing.physics_action || "N/A"} / qty ${layers.state_soft_sizing.qty_scale != null ? layers.state_soft_sizing.qty_scale : "N/A"}` : "N/A"}`,
    `- layer 4 EV/time value: ${layers.ev_time_value ? `${layers.ev_time_value.tuner_reason || "N/A"} / policy ${layers.ev_time_value.policy_version || "N/A"} / source ${layers.ev_time_value.policy_source || "N/A"}` : "N/A"}`,
    `- layer 5 wait timing: ${layers.wait_timing ? `${layers.wait_timing.tuner_reason || "N/A"} / ${layers.wait_timing.wait_action || "N/A"}` : "N/A"}`,
  ];
}

function buildBestFebtMarketContractLines(objectiveSupervisor = null) {
  const rows = Array.isArray(objectiveSupervisor && objectiveSupervisor.best_febt_market_contracts)
    ? objectiveSupervisor.best_febt_market_contracts
    : [];
  if (!rows.length) return ["- market contract: N/A"];
  return rows.slice(0, 5).map((row) =>
    `- market ${row.market || "UNKNOWN"}: ${row.mode || "N/A"} / replacement ${row.projected_replacement_ratio != null ? row.projected_replacement_ratio : "N/A"} / count ${row.projected_count_ratio_global != null ? row.projected_count_ratio_global : "N/A"} / fire ${row.fire_n != null ? row.fire_n : "N/A"} / late ${row.late_n != null ? row.late_n : "N/A"} / disagree ${row.disagreement_n != null ? row.disagreement_n : "N/A"} / reason ${row.dominant_disagreement_reason || "N/A"}`
  );
}

function buildPrompt(context = {}) {
  const { objectiveSupervisor, governance, changeControl, patchCandidates, ml, ev, wait, canary, stageAutopilot, deploymentPlan, loopMonitor, retrospective } = context;
  const displayMap = buildCandidateDisplayMap(changeControl, patchCandidates);
  const promotionDisplayId = toDisplayCandidateId(changeControl && changeControl.auto_promotion && changeControl.auto_promotion.candidate_id, displayMap);
  const objectiveLayerLines = buildObjectiveSupervisorLayerLines(objectiveSupervisor);
  const febtShadow = governance && governance.current && governance.current.febt_shadow && typeof governance.current.febt_shadow === "object"
    ? governance.current.febt_shadow
    : {};
  const waitLayer = objectiveSupervisor && objectiveSupervisor.filter_layers && objectiveSupervisor.filter_layers.wait_timing && typeof objectiveSupervisor.filter_layers.wait_timing === "object"
    ? objectiveSupervisor.filter_layers.wait_timing
    : {};
  const bestFebtContract = objectiveSupervisor && objectiveSupervisor.best_febt_tuning_contract && typeof objectiveSupervisor.best_febt_tuning_contract === "object"
    ? objectiveSupervisor.best_febt_tuning_contract
    : null;
  const bestFebtMarketLines = buildBestFebtMarketContractLines(objectiveSupervisor);
  const selfEvolutionPolicy = objectiveSupervisor && objectiveSupervisor.self_evolution_policy && typeof objectiveSupervisor.self_evolution_policy === "object"
    ? objectiveSupervisor.self_evolution_policy
    : buildSelfEvolutionPolicySpec();
  const selfEvolutionObjective = objectiveSupervisor && objectiveSupervisor.self_evolution_objective && typeof objectiveSupervisor.self_evolution_objective === "object"
    ? objectiveSupervisor.self_evolution_objective
    : {};
  const selfEvolutionAttribution = objectiveSupervisor && objectiveSupervisor.self_evolution_attribution && typeof objectiveSupervisor.self_evolution_attribution === "object"
    ? objectiveSupervisor.self_evolution_attribution
    : {};
  const selfEvolutionCandidates = context.selfEvolutionCandidatesDirect
    && context.selfEvolutionCandidatesDirect.summary
    && typeof context.selfEvolutionCandidatesDirect.summary === "object"
    ? context.selfEvolutionCandidatesDirect.summary
    : (objectiveSupervisor && objectiveSupervisor.self_evolution_candidates && typeof objectiveSupervisor.self_evolution_candidates === "object"
      ? objectiveSupervisor.self_evolution_candidates
      : {});
  const selfEvolutionReplay = objectiveSupervisor && objectiveSupervisor.self_evolution_replay && typeof objectiveSupervisor.self_evolution_replay === "object"
    ? objectiveSupervisor.self_evolution_replay
    : {};
  const selfEvolutionCanary = context.selfEvolutionCanaryDirect
    && context.selfEvolutionCanaryDirect.summary
    && typeof context.selfEvolutionCanaryDirect.summary === "object"
    ? context.selfEvolutionCanaryDirect.summary
    : (objectiveSupervisor && objectiveSupervisor.self_evolution_canary && typeof objectiveSupervisor.self_evolution_canary === "object"
      ? objectiveSupervisor.self_evolution_canary
      : {});
  const selfEvolutionDeployment = objectiveSupervisor && objectiveSupervisor.self_evolution_deployment && typeof objectiveSupervisor.self_evolution_deployment === "object"
    ? objectiveSupervisor.self_evolution_deployment
    : {};
  const selfEvolutionDeploymentPlan = objectiveSupervisor && objectiveSupervisor.self_evolution_deployment_plan && typeof objectiveSupervisor.self_evolution_deployment_plan === "object"
    ? objectiveSupervisor.self_evolution_deployment_plan
    : (deploymentPlan && deploymentPlan.summary ? deploymentPlan.summary : {});
  const selfEvolutionWeightTuning = objectiveSupervisor && objectiveSupervisor.self_evolution_weight_tuning && typeof objectiveSupervisor.self_evolution_weight_tuning === "object"
    ? objectiveSupervisor.self_evolution_weight_tuning
    : {};
  const selfEvolutionMemory = objectiveSupervisor && objectiveSupervisor.self_evolution_memory && typeof objectiveSupervisor.self_evolution_memory === "object"
    ? objectiveSupervisor.self_evolution_memory
    : {};
  const codexAuthority = objectiveSupervisor && objectiveSupervisor.codex_authority && typeof objectiveSupervisor.codex_authority === "object"
    ? objectiveSupervisor.codex_authority
    : {};
  const loopMonitorSummary = loopMonitor && loopMonitor.summary && typeof loopMonitor.summary === "object"
    ? loopMonitor.summary
    : {};
  return [
    "You are the weekly Codex patch engine for DONBEOLJA.",
    "Task: inspect the provided latest reports and return a single JSON decision only.",
    "Do not modify files. Do not propose new parameter names. Use only existing candidate IDs or rollback file paths from the reports.",
    "Decision enum: HOLD | PROMOTE | ROLLBACK.",
    "Constraints:",
    "- Use every safe lever available to move the system toward the shared objective, but never bypass the existing guards.",
    "- Maintain long/short symmetry.",
    "- Respect change budget and change-control guards.",
    "- Treat patch candidates as Pine full-quality bundle candidates; server 1차 remains integrity-only and must not be semantically retuned here.",
    "- BEST/FEBT weekly tuning must follow /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_FEBT_WEEKLY_TUNING_POLICY.md.",
    `- BEST self-evolution master spec must be treated as the higher-level autonomy roadmap: ${selfEvolutionPolicy.master_spec_path}.`,
    "- BEST/FEBT weekly tuning may only use these automatic levers: febt_lock_arm_min, febt_lock_fire_min, febt_fire_edge_min, febt_late_hard_max, febt_fail_max.",
    "- Do not recommend automatic weight changes for lock_score, delay_cost, late_risk, or failure_risk in the weekly loop.",
    "- If count_ratio_global < 1.00, tightening recommendations are disallowed; prefer HOLD or rollback-compatible reasoning.",
    "- Favor replacement_ratio and count preservation ahead of marginal win-rate gains.",
    "- Prefer HOLD on weak/conflicting evidence.",
    "- PROMOTE only when existing change-control already indicates a ready promotion candidate, or the current BEST self-evolution candidate set is replay/canary-ready for recovery promotion.",
    "- ROLLBACK only when existing change-control already indicates a ready rollback target, or the current BEST self-evolution canary marks rollback ready.",
    "- Optimize for: 1) expectancy positive, 2) win rate >= 60%, 3) monthly net >= 1,500,000 KRW, 4) lower drawdown.",
    "Required JSON keys:",
    JSON.stringify({
      verdict: "HOLD",
      recommended_candidate_id: null,
      recommended_rollback_file_path: null,
      confidence: 0.0,
      reason: "short reason",
      summary: "short summary",
      checks: ["check"],
      risks: ["risk"],
    }, null, 2),
    "Artifacts:",
    `- objective supervisor: ${INPUT_PATHS.objectiveSupervisor}`,
    `- weekly governance: ${INPUT_PATHS.governance}`,
    `- Pine quality change control: ${INPUT_PATHS.changeControl}`,
    `- Pine quality patch candidates: ${INPUT_PATHS.patchCandidates}`,
    `- ml policy: ${INPUT_PATHS.ml}`,
    `- ev tuner: ${INPUT_PATHS.ev}`,
    `- wait tuner: ${INPUT_PATHS.wait}`,
    `- shadow canary: ${INPUT_PATHS.canary}`,
    `- stage autopilot: ${INPUT_PATHS.stageAutopilot}`,
    `- objective retrospective: ${INPUT_PATHS.retrospective}`,
    `- BEST/FEBT weekly tuning policy: /Users/jeongjaeyong/Projects/donbeolja/docs/BEST_FEBT_WEEKLY_TUNING_POLICY.md`,
    `- BEST self-evolution master spec: ${selfEvolutionPolicy.master_spec_path}`,
    `- BEST self-evolution objective score spec: ${selfEvolutionPolicy.objective_latest_path || "N/A"}`,
    `- BEST self-evolution attribution spec: ${selfEvolutionPolicy.attribution_latest_path || "N/A"}`,
    `- BEST self-evolution canary spec: ${selfEvolutionPolicy.canary_latest_path || "N/A"}`,
    `- BEST self-evolution deployment guards spec: ${selfEvolutionPolicy.deployment_guards_latest_path || "N/A"}`,
    `- BEST self-evolution deployment plan spec: ${selfEvolutionPolicy.deployment_plan_latest_path || "N/A"}`,
    `- BEST self-evolution loop monitor spec: ${selfEvolutionPolicy.loop_monitor_latest_path || "N/A"}`,
    `- BEST self-evolution weight tuning spec: ${selfEvolutionPolicy.weight_tuning_latest_path || "N/A"}`,
    `- BEST self-evolution memory ledger spec: ${selfEvolutionPolicy.memory_latest_path || "N/A"}`,
    `- self-evolution deployment plan latest: ${INPUT_PATHS.deploymentPlan}`,
    `- self-evolution loop monitor latest: ${INPUT_PATHS.loopMonitor}`,
    "Filter layer interpretation:",
    ...objectiveLayerLines,
    "Quick context:",
    `- objective supervisor verdict: ${objectiveSupervisor && objectiveSupervisor.verdict || "N/A"} / reason=${objectiveSupervisor && objectiveSupervisor.reason || "N/A"}`,
    `- governance objective: ${governance && governance.current && governance.current.objective ? governance.current.objective.verdict : "N/A"}`,
    `- governance monthly run-rate KRW: ${governance && governance.current && governance.current.objective && governance.current.objective.monthly_run_rate_krw != null ? governance.current.objective.monthly_run_rate_krw : "N/A"}`,
    `- change control: ${changeControl && changeControl.verdict || "N/A"}`,
    `- auto promotion: ${changeControl && changeControl.auto_promotion ? `${changeControl.auto_promotion.ready ? "READY" : "HOLD"} / ${changeControl.auto_promotion.reason} / ${promotionDisplayId || "N/A"}` : "N/A"}`,
    `- auto rollback: ${changeControl && changeControl.auto_rollback ? `${changeControl.auto_rollback.ready ? "READY" : "HOLD"} / ${changeControl.auto_rollback.reason} / ${changeControl.auto_rollback.rollback_file_path || "N/A"}` : "N/A"}`,
    `- patch candidates verdict: ${patchCandidates && patchCandidates.verdict || "N/A"}`,
    `- ml quality actions: ${ml && ml.recommendations && ml.recommendations.QUALITY ? ml.recommendations.QUALITY.length : 0}`,
    `- ev tuner: ${ev && ev.decision_reason || "N/A"}`,
    `- wait tuner: ${wait && wait.reason || "N/A"}`,
    `- canary shadow drift: ${canary && canary.shadow && canary.shadow.summary ? canary.shadow.summary.drift : "N/A"}`,
    `- stage autopilot objective: ${stageAutopilot && stageAutopilot.objective_verdict || "N/A"} / actions=${stageAutopilot && Array.isArray(stageAutopilot.actions) ? stageAutopilot.actions.length : "N/A"}`,
    `- retrospective daily: ${retrospective && retrospective.periods && retrospective.periods.DAILY && retrospective.periods.DAILY.objective ? retrospective.periods.DAILY.objective.verdict : "N/A"} / net=${retrospective && retrospective.periods && retrospective.periods.DAILY && retrospective.periods.DAILY.realized_trades ? retrospective.periods.DAILY.realized_trades.net_pnl_quote : "N/A"}`,
    `- retrospective weekly: ${retrospective && retrospective.periods && retrospective.periods.WEEKLY && retrospective.periods.WEEKLY.objective ? retrospective.periods.WEEKLY.objective.verdict : "N/A"} / net=${retrospective && retrospective.periods && retrospective.periods.WEEKLY && retrospective.periods.WEEKLY.realized_trades ? retrospective.periods.WEEKLY.realized_trades.net_pnl_quote : "N/A"}`,
    `- retrospective monthly: ${retrospective && retrospective.periods && retrospective.periods.MONTHLY && retrospective.periods.MONTHLY.objective ? retrospective.periods.MONTHLY.objective.verdict : "N/A"} / net=${retrospective && retrospective.periods && retrospective.periods.MONTHLY && retrospective.periods.MONTHLY.realized_trades ? retrospective.periods.MONTHLY.realized_trades.net_pnl_quote : "N/A"}`,
    "BEST/FEBT weekly tuning snapshot:",
    `- febt contract mode: ${bestFebtContract && bestFebtContract.mode || "N/A"}`,
    `- febt tightening allowed: ${bestFebtContract ? (bestFebtContract.tightening_allowed ? "YES" : "NO") : "N/A"}`,
    `- febt recovery priority: ${bestFebtContract ? (bestFebtContract.recovery_priority ? "YES" : "NO") : "N/A"}`,
    `- febt projected replacement_ratio: ${bestFebtContract && bestFebtContract.projected_replacement_ratio != null ? bestFebtContract.projected_replacement_ratio : (febtShadow.projected_replacement_ratio != null ? febtShadow.projected_replacement_ratio : "N/A")}`,
    `- febt projected count_ratio_global: ${bestFebtContract && bestFebtContract.projected_count_ratio_global != null ? bestFebtContract.projected_count_ratio_global : (febtShadow.projected_count_ratio != null ? febtShadow.projected_count_ratio : "N/A")}`,
    `- febt projected net signal delta: ${bestFebtContract && bestFebtContract.projected_net_signal_delta_n != null ? bestFebtContract.projected_net_signal_delta_n : (febtShadow.projected_net_signal_delta_n != null ? febtShadow.projected_net_signal_delta_n : "N/A")}`,
    `- febt candidate recovered / blocked / wait: ${febtShadow.candidate_recovered_n != null ? febtShadow.candidate_recovered_n : "N/A"} / ${febtShadow.candidate_blocked_n != null ? febtShadow.candidate_blocked_n : "N/A"} / ${febtShadow.candidate_wait_n != null ? febtShadow.candidate_wait_n : "N/A"}`,
    `- wait layer febt fire / late / void: ${waitLayer.febt_fire_n != null ? waitLayer.febt_fire_n : "N/A"} / ${waitLayer.febt_late_n != null ? waitLayer.febt_late_n : "N/A"} / ${waitLayer.febt_void_n != null ? waitLayer.febt_void_n : "N/A"}`,
    `- wait layer febt disagreement / fallback / missing: ${waitLayer.febt_disagreement_n != null ? waitLayer.febt_disagreement_n : "N/A"} / ${waitLayer.febt_fallback_legacy_n != null ? waitLayer.febt_fallback_legacy_n : "N/A"} / ${waitLayer.febt_missing_rate != null ? waitLayer.febt_missing_rate : "N/A"}`,
    "BEST/FEBT market contracts:",
    ...bestFebtMarketLines,
    "Self-evolution policy docs:",
    ...((Array.isArray(selfEvolutionPolicy.linked_paths) && selfEvolutionPolicy.linked_paths.length)
      ? selfEvolutionPolicy.linked_paths.map((row) => `- ${row}`)
      : ["- N/A"]),
    "Self-evolution objective snapshot:",
    `- objective score: ${selfEvolutionObjective.objective_score != null ? selfEvolutionObjective.objective_score : "N/A"}`,
    `- constraints count/replacement/latency: ${selfEvolutionObjective.count_floor_pass === true ? "PASS" : (selfEvolutionObjective.count_floor_pass === false ? "FAIL" : "N/A")} / ${selfEvolutionObjective.replacement_floor_pass === true ? "PASS" : (selfEvolutionObjective.replacement_floor_pass === false ? "FAIL" : "N/A")} / ${selfEvolutionObjective.latency_budget_pass === true ? "PASS" : (selfEvolutionObjective.latency_budget_pass === false ? "FAIL" : "N/A")}`,
    `- fire win / tp1 / count / replacement: ${selfEvolutionObjective.fire_win_rate != null ? selfEvolutionObjective.fire_win_rate : "N/A"} / ${selfEvolutionObjective.tp1_first_rate != null ? selfEvolutionObjective.tp1_first_rate : "N/A"} / ${selfEvolutionObjective.projected_count_ratio_global != null ? selfEvolutionObjective.projected_count_ratio_global : "N/A"} / ${selfEvolutionObjective.projected_replacement_ratio != null ? selfEvolutionObjective.projected_replacement_ratio : "N/A"}`,
    `- top market: ${selfEvolutionObjective.top_market ? `${selfEvolutionObjective.top_market.market} ${selfEvolutionObjective.top_market.objective_score}` : "N/A"} / bottom market: ${selfEvolutionObjective.bottom_market ? `${selfEvolutionObjective.bottom_market.market} ${selfEvolutionObjective.bottom_market.objective_score}` : "N/A"}`,
    "Self-evolution attribution summary:",
    `- drop top layer: ${selfEvolutionAttribution.drop_top_layer ? `${selfEvolutionAttribution.drop_top_layer.key} ${selfEvolutionAttribution.drop_top_layer.count}` : "N/A"}`,
    `- late loss top market: ${selfEvolutionAttribution.late_loss_top_market ? `${selfEvolutionAttribution.late_loss_top_market.key} ${selfEvolutionAttribution.late_loss_top_market.count}` : "N/A"}`,
    `- false fire top market: ${selfEvolutionAttribution.false_fire_top_market ? `${selfEvolutionAttribution.false_fire_top_market.key} ${selfEvolutionAttribution.false_fire_top_market.count}` : "N/A"}`,
    `- missed recovery top reason: ${selfEvolutionAttribution.missed_recovery_top_reason ? `${selfEvolutionAttribution.missed_recovery_top_reason.key} ${selfEvolutionAttribution.missed_recovery_top_reason.count}` : "N/A"}`,
    `- fallback cost top market: ${selfEvolutionAttribution.fallback_cost_top_market ? `${selfEvolutionAttribution.fallback_cost_top_market.key} ${selfEvolutionAttribution.fallback_cost_top_market.count}` : "N/A"}`,
    "Self-evolution candidate snapshot:",
    `- total / ready / blocked: ${selfEvolutionCandidates.total_n != null ? selfEvolutionCandidates.total_n : "N/A"} / ${selfEvolutionCandidates.ready_n != null ? selfEvolutionCandidates.ready_n : "N/A"} / ${selfEvolutionCandidates.blocked_n != null ? selfEvolutionCandidates.blocked_n : "N/A"}`,
    `- top candidate: ${selfEvolutionCandidates.top_candidate_id || "N/A"} / scope ${selfEvolutionCandidates.top_scope || "N/A"}`,
    "Self-evolution replay snapshot:",
    `- mode: ${selfEvolutionReplay.validation_mode || "N/A"}`,
    `- total/pass/warn/block: ${selfEvolutionReplay.total_n != null ? selfEvolutionReplay.total_n : "N/A"} / ${selfEvolutionReplay.pass_n != null ? selfEvolutionReplay.pass_n : "N/A"} / ${selfEvolutionReplay.warn_n != null ? selfEvolutionReplay.warn_n : "N/A"} / ${selfEvolutionReplay.block_n != null ? selfEvolutionReplay.block_n : "N/A"}`,
    `- best candidate: ${selfEvolutionReplay.best_candidate_id || "N/A"} / verdict ${selfEvolutionReplay.best_verdict || "N/A"} / delta ${selfEvolutionReplay.best_objective_delta != null ? selfEvolutionReplay.best_objective_delta : "N/A"}`,
    "Self-evolution canary snapshot:",
    `- total/shadow/soft/hard: ${selfEvolutionCanary.total_n != null ? selfEvolutionCanary.total_n : "N/A"} / ${selfEvolutionCanary.shadow_n != null ? selfEvolutionCanary.shadow_n : "N/A"} / ${selfEvolutionCanary.soft_n != null ? selfEvolutionCanary.soft_n : "N/A"} / ${selfEvolutionCanary.hard_n != null ? selfEvolutionCanary.hard_n : "N/A"}`,
    `- ready/blocked/rollback: ${selfEvolutionCanary.ready_n != null ? selfEvolutionCanary.ready_n : "N/A"} / ${selfEvolutionCanary.blocked_n != null ? selfEvolutionCanary.blocked_n : "N/A"} / ${selfEvolutionCanary.rollback_ready_n != null ? selfEvolutionCanary.rollback_ready_n : "N/A"} / apply ${selfEvolutionCanary.apply_pass === true ? "PASS" : "BLOCK"}`,
    `- wave open/current/next: ${selfEvolutionCanary.open_wave != null ? selfEvolutionCanary.open_wave : "N/A"} / ${selfEvolutionCanary.current_open_wave != null ? selfEvolutionCanary.current_open_wave : "N/A"} / ${selfEvolutionCanary.next_wave_candidate != null ? selfEvolutionCanary.next_wave_candidate : "N/A"} / scale ${selfEvolutionCanary.scale_allowed === true ? "YES" : "NO"}`,
    `- top ready: ${selfEvolutionCanary.top_ready_market || "N/A"} / top rollback: ${selfEvolutionCanary.top_rollback_market || "N/A"}`,
    "Self-evolution deployment guards snapshot:",
    `- target/deploy/rollback_only: ${selfEvolutionDeployment.target_candidate_id || "N/A"} / ${selfEvolutionDeployment.deploy_pass === true ? "PASS" : "BLOCK"} / ${selfEvolutionDeployment.rollback_only === true ? "YES" : "NO"}`,
    `- replay/open_wave/markets: ${selfEvolutionDeployment.replay_verdict || "N/A"} / ${selfEvolutionDeployment.canary_open_wave != null ? selfEvolutionDeployment.canary_open_wave : "N/A"} / ${selfEvolutionDeployment.market_ready_n != null ? selfEvolutionDeployment.market_ready_n : "N/A"} / ${selfEvolutionDeployment.market_total_n != null ? selfEvolutionDeployment.market_total_n : "N/A"}`,
    `- blockers: ${Array.isArray(selfEvolutionDeployment.blockers) && selfEvolutionDeployment.blockers.length ? selfEvolutionDeployment.blockers.join(", ") : "none"}`,
    "Self-evolution deployment plan snapshot:",
    `- status/prepare/manual: ${selfEvolutionDeploymentPlan.plan_status || "N/A"} / ${selfEvolutionDeploymentPlan.prepare_pass === true ? "PASS" : "BLOCK"} / ${selfEvolutionDeploymentPlan.manual_step_required === true ? "YES" : "NO"}`,
    `- candidate/wave/markets: ${selfEvolutionDeploymentPlan.display_candidate_id || selfEvolutionDeploymentPlan.target_candidate_id || "N/A"} / ${selfEvolutionDeploymentPlan.open_wave != null ? selfEvolutionDeploymentPlan.open_wave : "N/A"} / ${selfEvolutionDeploymentPlan.market_scope_ready_n != null ? selfEvolutionDeploymentPlan.market_scope_ready_n : "N/A"} / ${selfEvolutionDeploymentPlan.market_scope_n != null ? selfEvolutionDeploymentPlan.market_scope_n : "N/A"}`,
    `- applied origin / recommended target / authority bypass: ${selfEvolutionDeploymentPlan.applied_origin_display_candidate_id || selfEvolutionDeploymentPlan.applied_origin_candidate_id || "N/A"} / ${selfEvolutionDeploymentPlan.display_candidate_id || selfEvolutionDeploymentPlan.recommended_target_candidate_id || selfEvolutionDeploymentPlan.target_candidate_id || "N/A"} / ${selfEvolutionDeploymentPlan.authority_bypass_active === true ? "YES" : "NO"}`,
    `- prepared/latest/rollback: ${selfEvolutionDeploymentPlan.prepared_file_path || "N/A"} / ${selfEvolutionDeploymentPlan.latest_generated_file_path || "N/A"} / ${selfEvolutionDeploymentPlan.rollback_source_file_path || "N/A"}`,
    "Self-evolution weight tuning snapshot:",
    `- advisory/suggestions/dominant: ${selfEvolutionWeightTuning.summary && selfEvolutionWeightTuning.summary.advisory_mode || "N/A"} / ${selfEvolutionWeightTuning.summary && selfEvolutionWeightTuning.summary.suggestion_n != null ? selfEvolutionWeightTuning.summary.suggestion_n : "N/A"} / ${selfEvolutionWeightTuning.summary && selfEvolutionWeightTuning.summary.dominant_axis || "N/A"}`,
    ...((Array.isArray(selfEvolutionWeightTuning.suggestions) && selfEvolutionWeightTuning.suggestions.length)
      ? selfEvolutionWeightTuning.suggestions.slice(0, 5).map((row) => `- ${row.axis}: ${row.direction} ${row.delta} / ${row.reason}`)
      : ["- none"]),
    "Self-evolution memory ledger snapshot:",
    `- total/current/blocked: ${selfEvolutionMemory.total_n != null ? selfEvolutionMemory.total_n : "N/A"} / ${selfEvolutionMemory.current_n != null ? selfEvolutionMemory.current_n : "N/A"} / ${selfEvolutionMemory.blocked_candidate_n != null ? selfEvolutionMemory.blocked_candidate_n : "N/A"}`,
    `- success/neutral/fail/rolled_back: ${selfEvolutionMemory.success_n != null ? selfEvolutionMemory.success_n : "N/A"} / ${selfEvolutionMemory.neutral_n != null ? selfEvolutionMemory.neutral_n : "N/A"} / ${selfEvolutionMemory.fail_n != null ? selfEvolutionMemory.fail_n : "N/A"} / ${selfEvolutionMemory.rolled_back_n != null ? selfEvolutionMemory.rolled_back_n : "N/A"}`,
    `- top success: ${selfEvolutionMemory.top_success_candidate_id || "N/A"} / top failed: ${selfEvolutionMemory.top_failed_candidate_id || "N/A"}`,
    `- blocked candidates: ${Array.isArray(selfEvolutionMemory.blocked_candidate_ids) && selfEvolutionMemory.blocked_candidate_ids.length ? selfEvolutionMemory.blocked_candidate_ids.join(", ") : "none"}`,
    "- Never retry a blocked candidate or a candidate that reuses a recent failed fingerprint unless there is explicit contrary evidence in the current objective/replay/canary outputs.",
    "Codex authority snapshot:",
    `- owner/mode/status/verdict: ${codexAuthority.owner || "N/A"} / ${codexAuthority.authority_mode || "N/A"} / ${codexAuthority.status || "N/A"} / ${codexAuthority.verdict || "N/A"}`,
    `- candidate/file/rollback: ${codexAuthority.display_candidate_id || codexAuthority.recommended_candidate_id || "N/A"} / ${codexAuthority.prepared_file_path || codexAuthority.latest_generated_file_path || "N/A"} / ${codexAuthority.recommended_rollback_file_path || codexAuthority.rollback_source_file_path || "N/A"}`,
    "Self-evolution loop monitor snapshot:",
    `- overall/fresh/blockers: ${loopMonitorSummary.overall_status || "N/A"} / ${loopMonitorSummary.fresh_loop_n != null ? loopMonitorSummary.fresh_loop_n : "N/A"} / ${loopMonitorSummary.loop_n != null ? loopMonitorSummary.loop_n : "N/A"} / ${Array.isArray(loopMonitorSummary.critical_blockers) && loopMonitorSummary.critical_blockers.length ? loopMonitorSummary.critical_blockers.join("|") : "none"}`,
    `- manual ready/candidate/open wave: ${loopMonitorSummary.manual_paste_ready === true ? "YES" : "NO"} / ${loopMonitorSummary.ready_candidate_id || "N/A"} / ${loopMonitorSummary.canary_open_wave != null ? loopMonitorSummary.canary_open_wave : "N/A"}`,
  ].join("\n");
}

function renderMarkdown(report = {}) {
  const lines = [
    "# Codex Weekly Patch Engine",
    "",
    `- 실행 시각: ${report.generated_at_kst || "N/A"}`,
    `- cycle_id: ${report.cycle_id || "N/A"}`,
    `- status: ${report.status || "N/A"}`,
    `- verdict: ${report.verdict || "N/A"}`,
    `- reason: ${report.reason || "N/A"}`,
    `- recommended_candidate_id: ${report.display_candidate_id || report.recommended_candidate_id || "N/A"}`,
    `- recommended_rollback_file_path: ${report.recommended_rollback_file_path || "N/A"}`,
    `- confidence: ${report.confidence != null ? report.confidence : "N/A"}`,
    "",
    "## Summary",
    `- ${report.summary || "N/A"}`,
    "",
    "## Checks",
    ...((report.checks || []).length ? report.checks.map((row) => `- ${row}`) : ["- none"]),
    "",
    "## Risks",
    ...((report.risks || []).length ? report.risks.map((row) => `- ${row}`) : ["- none"]),
    "",
    "## Inputs",
    ...((report.inputs || []).map((row) => `- ${row.name}: ${row.fresh ? "fresh" : "stale"} / ${row.filePath}`)),
  ];
  if (report.command) {
    lines.push("", "## Command", `- ${report.command}`);
  }
  return `${lines.join("\n")}\n`;
}

function parseCodexJson(raw) {
  const text = String(raw || "").trim();
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (_err) {
    const fenced = text.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
    if (fenced && fenced[1]) {
      try {
        return JSON.parse(String(fenced[1]).trim());
      } catch (_inner) {}
    }
  }
  return null;
}

function runCodexExec({ args, prompt, lastMessagePath } = {}) {
  let res = null;
  let parsed = null;
  let finalRaw = "";
  let attempts = 0;
  for (let i = 0; i < RETRY_COUNT; i += 1) {
    attempts += 1;
    res = spawnSync(CODEX_BIN, args, {
      cwd: REPO_ROOT,
      encoding: "utf8",
      input: prompt,
      stdio: ["pipe", "pipe", "pipe"],
      timeout: EXEC_TIMEOUT_MS,
      maxBuffer: 1024 * 1024 * 8,
    });
    finalRaw = fs.existsSync(lastMessagePath) ? fs.readFileSync(lastMessagePath, "utf8") : String(res.stdout || "");
    parsed = parseCodexJson(finalRaw);
    if (parsed) break;
  }
  return { res, parsed, finalRaw, attempts };
}

async function main() {
  const nowMeta = nowKstMeta();
  const cycleMeta = resolveAutomationCycleMeta({ envKey: "BEST_SELF_EVOLUTION_CYCLE_ID", prefix: "best_self_evolution", nowMeta });
  const objectiveSupervisor = readFreshJson(INPUT_PATHS.objectiveSupervisor, MAX_AGE_HOURS);
  const governance = readFreshJson(INPUT_PATHS.governance, MAX_AGE_HOURS);
  const changeControl = readFreshJson(INPUT_PATHS.changeControl, MAX_AGE_HOURS);
  const patchCandidates = readFreshJson(INPUT_PATHS.patchCandidates, MAX_AGE_HOURS);
  const ml = readFreshJson(INPUT_PATHS.ml, MAX_AGE_HOURS);
  const ev = readFreshJson(INPUT_PATHS.ev, MAX_AGE_HOURS);
  const wait = readFreshJson(INPUT_PATHS.wait, MAX_AGE_HOURS);
  const canary = readFreshJson(INPUT_PATHS.canary, MAX_AGE_HOURS);
  const stageAutopilot = readFreshJson(INPUT_PATHS.stageAutopilot, MAX_AGE_HOURS);
  const selfEvolutionCandidatesArtifact = readFreshJson(INPUT_PATHS.selfEvolutionCandidates, MAX_AGE_HOURS);
  const selfEvolutionCanaryArtifact = readFreshJson(INPUT_PATHS.selfEvolutionCanary, MAX_AGE_HOURS);
  const deploymentPlan = readFreshJson(INPUT_PATHS.deploymentPlan, MAX_AGE_HOURS);
  const loopMonitor = readFreshJson(INPUT_PATHS.loopMonitor, MAX_AGE_HOURS);
  const retrospective = readFreshJson(INPUT_PATHS.retrospective, MAX_AGE_HOURS);
  const objectiveSupervisorData = unwrapRawReport(objectiveSupervisor.data);
  const governanceData = unwrapRawReport(governance.data);
  const loopMonitorData = unwrapRawReport(loopMonitor.data);
  const selfEvolutionCandidatesData = unwrapRawReport(selfEvolutionCandidatesArtifact.data);
  const selfEvolutionCanaryData = unwrapRawReport(selfEvolutionCanaryArtifact.data);
  const deploymentPlanData = unwrapRawReport(deploymentPlan.data);
  const deploymentPlanSummary = deploymentPlanData && deploymentPlanData.summary && typeof deploymentPlanData.summary === "object"
    ? deploymentPlanData.summary
    : {};
  const candidateDisplayMap = buildCandidateDisplayMap(changeControl.data, patchCandidates.data);
  const inputs = [objectiveSupervisor, governance, changeControl, patchCandidates, ml, ev, wait, canary, stageAutopilot, selfEvolutionCandidatesArtifact, selfEvolutionCanaryArtifact, deploymentPlan, loopMonitor, retrospective];
  const reviewReadiness = deriveReviewReadiness({
    changeControl: changeControl.data,
    selfEvolutionCanary: selfEvolutionCanaryData,
    deploymentPlan: deploymentPlanData,
  });
  const {
    readyPromotion,
    readyRollback,
    selfEvolutionPromotionReady,
    selfEvolutionRollbackReady,
    selfEvolutionAuthorityBypass,
    pendingSignalConfirmation,
    reviewReady,
    blockedReason,
  } = reviewReadiness;
  const anyWatchlist = Boolean(patchCandidates.data && Array.isArray(patchCandidates.data.candidates) && patchCandidates.data.candidates.length > 0);

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_codex_weekly_patch_engine.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_codex_weekly_patch_engine.md`);

  const baseReport = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    status: "SKIPPED",
    verdict: "HOLD",
    recommended_candidate_id: null,
    recommended_rollback_file_path: null,
    confidence: null,
    reason: "NO_REVIEW_NEEDED",
    summary: "자동 승격/롤백 준비 상태가 아니어서 Codex 검토를 생략했습니다.",
    checks: [],
    risks: [],
    inputs: inputs.map((row) => ({ name: path.basename(row.filePath, ".json"), filePath: row.filePath, fresh: row.fresh, age_hours: row.ageHours })),
    command: null,
  };

  if (pendingSignalConfirmation) {
    const blocked = {
      ...baseReport,
      status: "FRESH",
      reason: blockedReason,
      summary: "현재 적용 전략이 첫 live LONG/SHORT 신호 확인 전이라 외부 권위의 승격/롤백 심사를 보류합니다.",
      checks: [
        `plan_status=${deploymentPlanSummary.plan_status || "N/A"}`,
        `ready_promotion=${readyPromotion ? "YES" : "NO"} / ready_rollback=${readyRollback ? "YES" : "NO"}`,
        `se_recovery=${selfEvolutionPromotionReady ? "YES" : "NO"} / se_rollback=${selfEvolutionRollbackReady ? "YES" : "NO"} / se_bypass=${selfEvolutionAuthorityBypass ? "YES" : "NO"}`,
      ],
      risks: [
        "live signal confirmation 전 rollback/promotion verdict를 확정하면 false authority disagreement가 발생할 수 있음",
      ],
    };
    writeJson(jsonPath, wrapDisplayAndRawReport(blocked));
    writeText(mdPath, renderMarkdown(blocked));
    copyLatest(jsonPath, REPORT_LATEST_JSON);
    copyLatest(mdPath, REPORT_LATEST_MD);
    console.log(JSON.stringify({ ok: true, status: blocked.status, reason: blocked.reason }));
    return;
  }

  if (!(reviewReady || anyWatchlist)) {
    writeJson(jsonPath, wrapDisplayAndRawReport(baseReport));
    writeText(mdPath, renderMarkdown(baseReport));
    copyLatest(jsonPath, REPORT_LATEST_JSON);
    copyLatest(mdPath, REPORT_LATEST_MD);
    console.log(JSON.stringify({ ok: true, status: "SKIPPED", reason: baseReport.reason }));
    return;
  }

  if (!reviewReady) {
    const selfEvolutionCandidates = selfEvolutionCandidatesData && selfEvolutionCandidatesData.summary && typeof selfEvolutionCandidatesData.summary === "object"
      ? selfEvolutionCandidatesData.summary
      : objectiveSupervisorData && objectiveSupervisorData.self_evolution_candidates && typeof objectiveSupervisorData.self_evolution_candidates === "object"
        ? objectiveSupervisorData.self_evolution_candidates
      : {};
    const selfEvolutionDeploymentPlan = objectiveSupervisorData && objectiveSupervisorData.self_evolution_deployment_plan && typeof objectiveSupervisorData.self_evolution_deployment_plan === "object"
      ? objectiveSupervisorData.self_evolution_deployment_plan
      : (deploymentPlan.data && deploymentPlan.data.summary && typeof deploymentPlan.data.summary === "object" ? deploymentPlan.data.summary : {});
    const selfEvolutionCanary = selfEvolutionCanaryData && selfEvolutionCanaryData.summary && typeof selfEvolutionCanaryData.summary === "object"
      ? selfEvolutionCanaryData.summary
      : objectiveSupervisorData && objectiveSupervisorData.self_evolution_canary && typeof objectiveSupervisorData.self_evolution_canary === "object"
        ? objectiveSupervisorData.self_evolution_canary
      : {};
    const currentCycle = deriveCycleConsistency([
      objectiveSupervisor.data,
      selfEvolutionCandidatesArtifact.data,
      selfEvolutionCanaryArtifact.data,
      deploymentPlan.data,
    ]);
    const objectiveBlockers = Array.isArray(objectiveSupervisorData && objectiveSupervisorData.blockers)
      ? objectiveSupervisorData.blockers.filter(Boolean)
      : [];
    const topCandidateId = toDisplayCandidateId(selfEvolutionCandidates.top_candidate_id, candidateDisplayMap);
    const localHold = {
      ...baseReport,
      status: "LOCAL_HOLD",
      reason: anyWatchlist ? "SELF_EVOLUTION_NOT_READY" : "NO_REVIEW_NEEDED",
      summary: anyWatchlist
        ? "self-evolution watchlist는 있지만 promotion/rollback 경로가 아직 준비되지 않아 외부 Codex 검토를 생략했습니다."
        : baseReport.summary,
      checks: [
        `ready_promotion=${readyPromotion ? "YES" : "NO"} / ready_rollback=${readyRollback ? "YES" : "NO"} / se_recovery=${selfEvolutionPromotionReady ? "YES" : "NO"} / se_rollback=${selfEvolutionRollbackReady ? "YES" : "NO"} / se_bypass=${selfEvolutionAuthorityBypass ? "YES" : "NO"}`,
        `candidate_ready_n=${selfEvolutionCandidates.ready_n != null ? selfEvolutionCandidates.ready_n : "N/A"} / top=${topCandidateId || "N/A"}`,
        `deployment_plan=${selfEvolutionDeploymentPlan.plan_status || "N/A"} / prepare=${selfEvolutionDeploymentPlan.prepare_pass === true ? "PASS" : "BLOCK"}`,
        `canary_apply=${selfEvolutionCanary.apply_pass === true ? "PASS" : "BLOCK"} / ready_markets=${selfEvolutionCanary.ready_n != null ? selfEvolutionCanary.ready_n : "N/A"}`,
        `supervisor=${objectiveSupervisorData && objectiveSupervisorData.verdict || "N/A"} / blockers=${objectiveBlockers.length ? objectiveBlockers.join("|") : (objectiveSupervisorData && objectiveSupervisorData.reason || "none")} / cycle_consistent=${currentCycle.cycle_consistent ? "YES" : "NO"}`,
      ],
      risks: anyWatchlist ? ["Promotion path is not ready; defer external Codex review until the objective and governance gates recover."] : [],
    };
    writeJson(jsonPath, wrapDisplayAndRawReport(localHold));
    writeText(mdPath, renderMarkdown(localHold));
    copyLatest(jsonPath, REPORT_LATEST_JSON);
    copyLatest(mdPath, REPORT_LATEST_MD);
    console.log(JSON.stringify({ ok: true, status: localHold.status, reason: localHold.reason }));
    return;
  }

  if (!fs.existsSync(CODEX_BIN)) {
    const failed = { ...baseReport, ok: false, status: "FAILED", reason: "CODEX_BIN_MISSING", summary: CODEX_BIN };
    writeJson(jsonPath, wrapDisplayAndRawReport(failed));
    writeText(mdPath, renderMarkdown(failed));
    copyLatest(jsonPath, REPORT_LATEST_JSON);
    copyLatest(mdPath, REPORT_LATEST_MD);
    throw new Error(`CODEX_BIN_MISSING:${CODEX_BIN}`);
  }

  const schemaPath = path.join("/tmp", `codex_patch_engine_schema_${process.pid}.json`);
  const lastMessagePath = path.join("/tmp", `codex_patch_engine_last_${process.pid}.json`);
  const schema = {
    type: "object",
    additionalProperties: false,
    required: ["verdict", "recommended_candidate_id", "recommended_rollback_file_path", "confidence", "reason", "summary", "checks", "risks"],
    properties: {
      verdict: { type: "string", enum: ["HOLD", "PROMOTE", "ROLLBACK"] },
      recommended_candidate_id: { type: ["string", "null"] },
      recommended_rollback_file_path: { type: ["string", "null"] },
      confidence: { type: "number" },
      reason: { type: "string" },
      summary: { type: "string" },
      checks: { type: "array", items: { type: "string" } },
      risks: { type: "array", items: { type: "string" } }
    }
  };
  writeJson(schemaPath, schema);

  const prompt = buildPrompt({
    objectiveSupervisor: objectiveSupervisorData,
    governance: governanceData,
    changeControl: changeControl.data,
    patchCandidates: patchCandidates.data,
    ml: ml.data,
    ev: ev.data,
    wait: wait.data,
    canary: canary.data,
    stageAutopilot: stageAutopilot.data,
    deploymentPlan: deploymentPlan.data,
    loopMonitor: loopMonitorData,
    retrospective: retrospective.data,
    selfEvolutionCandidatesDirect: selfEvolutionCandidatesData,
    selfEvolutionCanaryDirect: selfEvolutionCanaryData,
  });

  const args = [
    "exec",
    "--ephemeral",
    "--dangerously-bypass-approvals-and-sandbox",
    "-C", REPO_ROOT,
    "--color", "never",
  ];
  if (CODEX_MODEL) args.push("-m", CODEX_MODEL);
  if (CODEX_REASONING_EFFORT) args.push("-c", `model_reasoning_effort=\"${CODEX_REASONING_EFFORT}\"`);
  args.push(
    "--output-schema", schemaPath,
    "--output-last-message", lastMessagePath,
    "-",
  );
  const promptNormalized = replaceCandidateIdsInText(prompt, candidateDisplayMap);
  const execResult = runCodexExec({ args, prompt: promptNormalized, lastMessagePath });
  const { res, parsed, finalRaw, attempts } = execResult;
  const report = {
    ok: !!parsed,
    generated_at_kst: nowMeta.kst,
    cycle_id: cycleMeta.cycle_id,
    generation_id: cycleMeta.generation_id,
    status: parsed ? "OK" : (res.error ? "FAILED" : `EXIT_${res.status}`),
    verdict: parsed ? String(parsed.verdict || "HOLD").toUpperCase() : "HOLD",
    recommended_candidate_id: parsed ? (String(parsed.recommended_candidate_id || "").trim() || null) : null,
    display_candidate_id: parsed ? toDisplayCandidateId(parsed.recommended_candidate_id, candidateDisplayMap) : null,
    recommended_rollback_file_path: parsed ? (String(parsed.recommended_rollback_file_path || "").trim() || null) : null,
    confidence: parsed ? toNum(parsed.confidence) : null,
    reason: parsed ? replaceCandidateIdsInText(String(parsed.reason || "N/A"), candidateDisplayMap) : (res.error && res.error.message ? String(res.error.message) : "PARSE_FAILED"),
    summary: parsed ? replaceCandidateIdsInText(String(parsed.summary || "N/A"), candidateDisplayMap) : replaceCandidateIdsInText(String(finalRaw || res.stderr || "N/A").trim().slice(0, 1000), candidateDisplayMap),
    checks: parsed && Array.isArray(parsed.checks) ? parsed.checks.map((row) => replaceCandidateIdsInText(String(row), candidateDisplayMap)) : [],
    risks: parsed && Array.isArray(parsed.risks) ? parsed.risks.map((row) => replaceCandidateIdsInText(String(row), candidateDisplayMap)) : [],
    inputs: baseReport.inputs,
    attempts,
    command: [CODEX_BIN, ...args].join(" "),
    stderr_tail: String(res.stderr || "").trim().split(/\r?\n/).filter(Boolean).slice(-20),
  };

  writeJson(jsonPath, wrapDisplayAndRawReport(report));
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);

  if (String(process.env.CODEX_PATCH_ENGINE_SKIP_TELEGRAM || "0").trim() !== "1") {
    const alert = await sendKoreanTelegramSummary({
      title: `[Codex 주간 패치 엔진] ${report.verdict}`,
      severity: report.verdict === "ROLLBACK" ? "WARN" : "INFO",
      sections: [
        { header: "판정", lines: [`${report.verdict} / ${report.reason}`] },
        { header: "추천", lines: [`candidate ${report.display_candidate_id || report.recommended_candidate_id || "N/A"}`, `rollback ${report.recommended_rollback_file_path || "N/A"}`] },
        { header: "요약", lines: [report.summary || "N/A"] },
        { header: "점검", lines: (report.checks || []).slice(0, 5) },
        { header: "리스크", lines: (report.risks || []).slice(0, 5) },
      ],
    });
    if (!alert || (alert.ok !== true && !(alert.skipped && alert.reason === "SKIP_ALERT"))) {
      throw new Error(`TELEGRAM_SEND_FAILED:${JSON.stringify(alert || {})}`);
    }
  }

  console.log(JSON.stringify({
    ok: report.ok,
    status: report.status,
    verdict: report.verdict,
    candidate: report.display_candidate_id || report.recommended_candidate_id,
    rollback: report.recommended_rollback_file_path,
  }));
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err && err.stack ? err.stack : err);
    process.exit(1);
  });
} else {
  module.exports = {
    buildPrompt,
    buildCandidateDisplayMap,
    deriveReviewReadiness,
    replaceCandidateIdsInText,
    buildObjectiveSupervisorLayerLines,
    buildBestFebtMarketContractLines,
    deriveInlineLoopMonitorSummary,
    renderMarkdown,
    parseCodexJson,
    __test: {
      buildPrompt,
      buildCandidateDisplayMap,
      replaceCandidateIdsInText,
      buildObjectiveSupervisorLayerLines,
      buildBestFebtMarketContractLines,
      deriveInlineLoopMonitorSummary,
      deriveReviewReadiness,
    },
  };
}
