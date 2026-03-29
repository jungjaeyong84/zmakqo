#!/usr/bin/env node
/* eslint-disable no-console */
"use strict";

const fs = require("fs");
const path = require("path");
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
const CODEX_PATCH_LATEST_PATH = path.join(OPS_DAILY_DIR, "codex_weekly_patch_engine_latest.json");
const STAGE_AUTOPILOT_LATEST_PATH = path.join(OPS_DAILY_DIR, "stage_autopilot_latest.json");
const RETROSPECTIVE_LATEST_PATH = path.join(OPS_DAILY_DIR, "objective_retrospective_latest.json");
const REPORT_LATEST_MD = path.join(OPS_DAILY_DIR, "objective_supervisor_latest.md");
const REPORT_LATEST_JSON = path.join(OPS_DAILY_DIR, "objective_supervisor_latest.json");
const FRESHNESS_HOURS = Object.freeze({
  governance: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_GOVERNANCE_MAX_AGE_HOURS || 30)),
  changeControl: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_CHANGE_CONTROL_MAX_AGE_HOURS || 36)),
  canary: Math.max(4, Number(process.env.OBJECTIVE_SUPERVISOR_CANARY_MAX_AGE_HOURS || 12)),
  ml: Math.max(4, Number(process.env.OBJECTIVE_SUPERVISOR_ML_MAX_AGE_HOURS || 12)),
  ev: Math.max(24, Number(process.env.OBJECTIVE_SUPERVISOR_EV_MAX_AGE_HOURS || 96)),
  wait: Math.max(24, Number(process.env.OBJECTIVE_SUPERVISOR_WAIT_MAX_AGE_HOURS || 144)),
  phase0: Math.max(12, Number(process.env.OBJECTIVE_SUPERVISOR_FEBT_PHASE0_MAX_AGE_HOURS || 36)),
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
    const ageHours = (Date.now() - Number(st.mtimeMs || 0)) / (60 * 60 * 1000);
    return {
      name,
      filePath,
      data,
      exists: true,
      ageHours,
      fresh: Number.isFinite(ageHours) && ageHours <= maxAgeHours,
    };
  } catch (_err) {
    return { name, filePath, data, exists: true, fresh: false, ageHours: null };
  }
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
    any_no_trade: [dailyRow, weeklyRow, monthlyRow].some((row) => row.failed_checks.includes("NO_TRADE_ACTIVITY")),
    any_zero_idle: [dailyRow, weeklyRow, monthlyRow].some((row) => row.failed_checks.includes("ZERO_KRW_IDLE")),
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
  return {
    executed,
    calc_ok_rate: executed > 0 ? (calcOk / executed) : null,
    phase_known: phaseKnown,
    fire,
    late,
    void_n: voidN,
    missing_rate: executed > 0 ? (missing / executed) : null,
  };
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
      tuner_reason: String(ev && ev.decision_reason || "N/A"),
      policy_version: topBreakdownValue(featureBreakdown.ev_policy_version),
      policy_source: topBreakdownValue(featureBreakdown.ev_policy_source),
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
        `5차 WAIT 타이밍층 ${report.filter_layers && report.filter_layers.wait_timing ? `${report.filter_layers.wait_timing.tuner_reason} / ${report.filter_layers.wait_timing.wait_action} / FEBT calc ${pct(report.filter_layers.wait_timing.febt_calc_ok_rate)} / phase_known ${pct(report.filter_layers.wait_timing.febt_phase_known)} / fire ${report.filter_layers.wait_timing.febt_fire_n ?? 0} / late ${report.filter_layers.wait_timing.febt_late_n ?? 0} / void ${report.filter_layers.wait_timing.febt_void_n ?? 0} / missing ${pct(report.filter_layers.wait_timing.febt_missing_rate)}` : "N/A"}`,
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
      header: "Codex 검토",
      lines: [
        `상태 ${report.codex_review.status} / 결론 ${report.codex_review.verdict} / 사유 ${report.codex_review.reason}`,
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

function evaluateSupervisor({ governance, changeControl, canary, ml, ev, wait, phase0, codex, stageAutopilot, retrospective } = {}) {
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

  const blockers = [];
  if (!objective || objective.enough_sample !== true) blockers.push("OBJECTIVE_SAMPLE_NOT_READY");
  if (objective && objective.monthly_pass === false) blockers.push("MONTHLY_TARGET_NOT_MET");
  if (objective && objective.pass === false) blockers.push("OBJECTIVE_NOT_MET");
  if (!retrospectiveSummary.available) blockers.push("RETROSPECTIVE_MISSING");
  if (retrospectiveSummary.daily.pass === false) blockers.push("DAILY_OBJECTIVE_FAIL");
  if (retrospectiveSummary.weekly.pass === false) blockers.push("WEEKLY_OBJECTIVE_FAIL");
  if (retrospectiveSummary.monthly.pass === false) blockers.push("RETROSPECTIVE_MONTHLY_FAIL");
  if (retrospectiveSummary.any_no_trade) blockers.push("DAILY_NO_TRADE_ACTIVITY");
  if (retrospectiveSummary.any_zero_idle) blockers.push("ZERO_KRW_IDLE");
  if (!canary || canarySummary.drift > 0 || canaryGolden.drift > 0) blockers.push("CANARY_DRIFT");
  if (!changeControl || String(changeControl.verdict || "").toUpperCase() === "HOLD") blockers.push("CHANGE_CONTROL_HOLD");
  if (changeControl && changeControl.coverage_guard && changeControl.coverage_guard.pass !== true) blockers.push("COVERAGE_GUARD_BLOCK");
  if (physicsSummary.block_reason) blockers.push(physicsSummary.block_reason);
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
      : retrospectiveSummary.any_fail
        ? "RETROSPECTIVE_OBJECTIVE_FAIL"
        : (!objective || objective.enough_sample !== true)
          ? "OBJECTIVE_SAMPLE_NOT_READY"
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
    } else if (codexVerdict === "PROMOTE") {
      verdict = "PATCH_CANDIDATE";
      reason = "AUTO_PROMOTION_READY";
    } else {
      verdict = "HOLD";
      reason = "CODEX_REVIEW_BLOCK_PROMOTION";
      blockers.push("CODEX_BLOCK_PROMOTION");
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

  return {
    verdict,
    reason,
    blockers: Array.from(new Set(blockers)),
    objective: {
      verdict: String(objective.verdict || "N/A"),
      pass: objective.pass === true,
      enough_sample: objective.enough_sample === true,
      activity_pass: objective.activity_pass === true,
      executed_n: toNum(objective.executed_n),
      realized_n: toNum(objective.realized_n),
      win_rate: toNum(governance && governance.current && governance.current.overall && governance.current.overall.win_rate),
      avg_ret_net: toNum(governance && governance.current && governance.current.overall && governance.current.overall.avg_ret_net),
      net_pnl_quote: toNum(governance && governance.current && governance.current.overall && governance.current.overall.net_pnl_quote),
      monthly_run_rate_krw: toNum(objective.monthly_run_rate_krw),
      min_monthly_net_krw: toNum(objectiveCfg.min_monthly_net_krw),
      monthly_pass: objective.monthly_pass === true,
      failed_checks: Array.isArray(objective.failed_checks) ? objective.failed_checks : [],
    },
    promotion: {
      ready: promotion.ready === true,
      reason: String(promotion.reason || "N/A"),
      candidate_id: String(promotion.candidate_id || "").trim() || null,
      display_candidate_id: resolveDisplayCandidateId(promotion.candidate_id, changeControl),
      streak_current: toNum(promotion.streak_current),
      streak_required: toNum(promotion.streak_required),
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
    `- verdict: ${report.verdict || "N/A"}`,
    `- reason: ${report.reason || "N/A"}`,
    `- blockers: ${(report.blockers || []).length ? report.blockers.join(", ") : "none"}`,
    "",
    "## Objective",
    `- objective: ${report.objective && report.objective.verdict || "N/A"}`,
    `- activity: ${report.objective && report.objective.activity_pass ? "PASS" : "FAIL"} / executed=${report.objective && report.objective.executed_n != null ? report.objective.executed_n : "N/A"}`,
    `- enough_sample: ${report.objective && report.objective.enough_sample ? "YES" : "NO"} / realized=${report.objective && report.objective.realized_n != null ? report.objective.realized_n : "N/A"}`,
    `- win_rate: ${pct(report.objective && report.objective.win_rate)}`,
    `- avg_ret_net: ${pct(report.objective && report.objective.avg_ret_net)}`,
    `- net_pnl_quote: ${signedNum(report.objective && report.objective.net_pnl_quote, 2)}`,
    `- monthly_run_rate_krw: ${signedNum(report.objective && report.objective.monthly_run_rate_krw, 0)} / target=${signedNum(report.objective && report.objective.min_monthly_net_krw, 0)}`,
    `- monthly_pass: ${report.objective && report.objective.monthly_pass ? "PASS" : "FAIL"}`,
    "",
    "## Retrospective",
    `- daily: ${report.retrospective && report.retrospective.daily ? `${report.retrospective.daily.verdict} / executed=${report.retrospective.daily.executed_n ?? "N/A"} / realized=${report.retrospective.daily.realized_n ?? "N/A"} / net=${signedNum(report.retrospective.daily.net_pnl_quote, 0)}` : "N/A"}`,
    `- weekly: ${report.retrospective && report.retrospective.weekly ? `${report.retrospective.weekly.verdict} / executed=${report.retrospective.weekly.executed_n ?? "N/A"} / realized=${report.retrospective.weekly.realized_n ?? "N/A"} / net=${signedNum(report.retrospective.weekly.net_pnl_quote, 0)}` : "N/A"}`,
    `- monthly: ${report.retrospective && report.retrospective.monthly ? `${report.retrospective.monthly.verdict} / executed=${report.retrospective.monthly.executed_n ?? "N/A"} / realized=${report.retrospective.monthly.realized_n ?? "N/A"} / net=${signedNum(report.retrospective.monthly.net_pnl_quote, 0)}` : "N/A"}`,
    "",
    "## Change Control",
    `- promotion: ${report.promotion && report.promotion.ready ? "READY" : "HOLD"} / ${report.promotion && report.promotion.reason || "N/A"} / candidate=${report.promotion && (report.promotion.display_candidate_id || report.promotion.candidate_id) || "N/A"}`,
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
    `- 5차 WAIT 타이밍층: ${report.filter_layers && report.filter_layers.wait_timing ? `${report.filter_layers.wait_timing.tuner_reason} / action=${report.filter_layers.wait_timing.wait_action} / FEBT calc=${pct(report.filter_layers.wait_timing.febt_calc_ok_rate)} / phase_known=${pct(report.filter_layers.wait_timing.febt_phase_known)} / fire=${report.filter_layers.wait_timing.febt_fire_n ?? 0} / late=${report.filter_layers.wait_timing.febt_late_n ?? 0} / void=${report.filter_layers.wait_timing.febt_void_n ?? 0} / missing=${pct(report.filter_layers.wait_timing.febt_missing_rate)}` : "N/A"}`,
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
  const governanceArtifact = readArtifact("weekly_governance", GOVERNANCE_LATEST_PATH, FRESHNESS_HOURS.governance);
  const changeArtifact = readArtifact("change_control", CHANGE_CONTROL_LATEST_PATH, FRESHNESS_HOURS.changeControl);
  const canaryArtifact = readArtifact("shadow_canary", CANARY_LATEST_PATH, FRESHNESS_HOURS.canary);
  const mlArtifact = readArtifact("ml_policy", ML_LATEST_PATH, FRESHNESS_HOURS.ml);
  const evArtifact = readArtifact("ev_tuner", EV_LATEST_PATH, FRESHNESS_HOURS.ev);
  const waitArtifact = readArtifact("wait_tuner", WAIT_LATEST_PATH, FRESHNESS_HOURS.wait);
  const phase0Artifact = readArtifact("febt_phase0", FEBT_PHASE0_LATEST_PATH, FRESHNESS_HOURS.phase0);
  const codexArtifact = readArtifact("codex_patch", CODEX_PATCH_LATEST_PATH, FRESHNESS_HOURS.codex);
  const stageAutopilotArtifact = readArtifact("stage_autopilot", STAGE_AUTOPILOT_LATEST_PATH, FRESHNESS_HOURS.stageAutopilot);
  const retrospectiveArtifact = readArtifact("objective_retrospective", RETROSPECTIVE_LATEST_PATH, FRESHNESS_HOURS.retrospective);

  const evaluation = evaluateSupervisor({
    governance: governanceArtifact.data,
    changeControl: changeArtifact.data,
    canary: canaryArtifact.data,
    ml: mlArtifact.data,
    ev: evArtifact.data,
    wait: waitArtifact.data,
    phase0: phase0Artifact.exists ? { ...phase0Artifact.data, fresh: phase0Artifact.fresh } : null,
    codex: codexArtifact.exists ? { ...codexArtifact.data, fresh: codexArtifact.fresh } : null,
    stageAutopilot: stageAutopilotArtifact.exists ? { ...stageAutopilotArtifact.data, fresh: stageAutopilotArtifact.fresh } : null,
    retrospective: retrospectiveArtifact.data,
  });

  const report = {
    ok: true,
    generated_at_kst: nowMeta.kst,
    verdict: evaluation.verdict,
    reason: evaluation.reason,
    blockers: evaluation.blockers,
    objective: evaluation.objective,
    promotion: evaluation.promotion,
    rollback: evaluation.rollback,
    guards: evaluation.guards,
    physics: evaluation.physics,
    phase0: evaluation.phase0,
    tuning: evaluation.tuning,
    codex_review: evaluation.codex_review,
    stage_autopilot: evaluation.stage_autopilot,
    retrospective: evaluation.retrospective,
    artifacts: [governanceArtifact, changeArtifact, canaryArtifact, mlArtifact, evArtifact, waitArtifact, phase0Artifact, codexArtifact, stageAutopilotArtifact, retrospectiveArtifact].map((row) => ({
      name: row.name,
      filePath: row.filePath,
      fresh: row.fresh,
      age_hours: row.ageHours,
    })),
  };

  const base = `${nowMeta.dateKey}_${nowMeta.hhmm}`;
  const jsonPath = path.join(OPS_DAILY_DIR, `${base}_objective_supervisor.json`);
  const mdPath = path.join(OPS_DAILY_DIR, `${base}_objective_supervisor.md`);
  writeJson(jsonPath, wrapDisplayAndRawReport(report));
  writeText(mdPath, renderMarkdown(report));
  copyLatest(jsonPath, REPORT_LATEST_JSON);
  copyLatest(mdPath, REPORT_LATEST_MD);
  const telegramSections = buildObjectiveSupervisorTelegramSections(report);

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
  },
};
