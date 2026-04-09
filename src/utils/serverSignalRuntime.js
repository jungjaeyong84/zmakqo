"use strict";

function toUpper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNum(value) {
  if (value == null || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toBool(value, fallback = false) {
  if (value == null || value === "") return fallback;
  if (typeof value === "boolean") return value;
  const s = String(value).trim().toLowerCase();
  if (!s) return fallback;
  if (["1", "true", "yes", "y", "on"].includes(s)) return true;
  if (["0", "false", "no", "n", "off"].includes(s)) return false;
  return fallback;
}

function parseTimeMs(value) {
  if (value == null || value === "") return null;
  if (Number.isFinite(Number(value))) return Number(value);
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function list(value) {
  if (Array.isArray(value)) return value.map((x) => String(x || "").trim()).filter(Boolean);
  return String(value || "")
    .split(",")
    .map((x) => String(x || "").trim())
    .filter(Boolean);
}

function phaseStatus(done, active) {
  if (done) return "DONE";
  if (active) return "IN_PROGRESS";
  return "PENDING";
}

function deriveServerSignalRuntime({
  provider = "BINANCEFUT",
  systemSettings = {},
  exchangeSettings = {},
  watchdog = null,
  livePolicyConfig = null,
  cycleId = null,
} = {}) {
  const schedulerEnabled = toBool(systemSettings.scheduler_enabled, true);
  const schedulerIntervalSec = Math.max(10, toNum(systemSettings.scheduler_interval_sec) || 900);
  const sourceMode = toUpper(systemSettings.canonical_engine_source_mode || "PINE_PRIMARY") || "PINE_PRIMARY";
  const shadowEnabled = toBool(systemSettings.canonical_engine_shadow_enabled, true);
  const execTf = String(exchangeSettings.exec_tf || "15m").trim() || "15m";
  const tfAllowlist = list(exchangeSettings.tf_allowlist).length ? list(exchangeSettings.tf_allowlist) : [execTf];
  const markets = list(exchangeSettings.markets);
  const watchdogSummary = watchdog && typeof watchdog === "object"
    ? ((watchdog.summary && typeof watchdog.summary === "object") ? watchdog.summary : watchdog)
    : {};
  const watchdogVerdict = toUpper(watchdogSummary.verdict || watchdogSummary.status || watchdogSummary.summary_verdict || "N/A") || "N/A";
  const watchdogGeneratedAtKst = String(
    watchdogSummary.generated_at_kst
    || (watchdog && watchdog.generated_at_kst)
    || ""
  ).trim() || null;
  const pineIngressShadowOnly = true;
  const executionShadowPolicy = "EXCLUDE_FROM_EXECUTION_DEFAULT";
  const livePolicy = livePolicyConfig && typeof livePolicyConfig === "object"
    ? livePolicyConfig
    : {};
  const runtimeCycleId = String(cycleId || "").trim() || null;
  const livePolicyMode = livePolicy.enabled === true
    ? ((livePolicy.quarantine_hard_block !== false || livePolicy.quality_hard_block !== false || livePolicy.policy_plan_apply === true)
      ? "ENFORCING"
      : "ADVISORY")
    : "DISABLED";

  const transition = {
    server_15m_runtime: phaseStatus(schedulerEnabled && execTf === "15m" && markets.length > 0, schedulerEnabled || markets.length > 0),
    server_source_authority: phaseStatus(sourceMode === "SERVER_PRIMARY", sourceMode === "SERVER_PRIMARY" || sourceMode === "PINE_PRIMARY"),
    pine_shadow_only: phaseStatus(pineIngressShadowOnly && executionShadowPolicy === "EXCLUDE_FROM_EXECUTION_DEFAULT", pineIngressShadowOnly),
  };
  const completedN = Object.values(transition).filter((x) => x === "DONE").length;
  const progressPct = Math.round((completedN / Object.keys(transition).length) * 100);
  const genRelaxEnabled = toBool(systemSettings.ev_gate_unknown_gen_relax_enabled, false);
  const evGateGlobalReportOnlyEnabled = toBool(systemSettings.ev_gate_global_report_only_enabled, true);
  const genRelaxStartAt = systemSettings.ev_gate_unknown_gen_relax_started_at || null;
  const genRelaxStartMs = parseTimeMs(systemSettings.ev_gate_unknown_gen_relax_started_at_ms || genRelaxStartAt);
  const genRelaxWindowHours = toNum(systemSettings.ev_gate_unknown_gen_relax_window_hours) || 6;
  const genRelaxReviewAfterHours = toNum(systemSettings.ev_gate_unknown_gen_relax_review_after_hours)
    || toNum(systemSettings.ev_gate_unknown_gen_relax_rollback_after_hours)
    || 4;
  const genRelaxActiveWindow = genRelaxEnabled
    && Number.isFinite(genRelaxStartMs)
    && Date.now() < (genRelaxStartMs + (genRelaxWindowHours * 3600000));
  const tp1LadderEnabled = toBool(systemSettings.tp1_ladder_enabled, true);
  const tp1LadderFreeze = toBool(systemSettings.tp1_ladder_freeze, false);
  const tp1LadderStage1RealizedNMin = toNum(systemSettings.tp1_ladder_stage1_realized_n_min) || 12;
  const tp1LadderStage1Tp0HitRateMin = toNum(systemSettings.tp1_ladder_stage1_tp0_hit_rate_min) || 0.60;
  const tp1LadderStage1Tp0ToTp1ConversionMin = toNum(systemSettings.tp1_ladder_stage1_tp0_to_tp1_conversion_min) || 0.28;
  const tp1LadderStage1FeeAdjustedExpectancyMin = toNum(systemSettings.tp1_ladder_stage1_fee_adjusted_expectancy_min);
  const tp1LadderStage2RealizedNMin = toNum(systemSettings.tp1_ladder_stage2_realized_n_min) || 24;
  const tp1LadderStage2Tp0HitRateMin = toNum(systemSettings.tp1_ladder_stage2_tp0_hit_rate_min) || 0.68;
  const tp1LadderStage2Tp1HitRateMin = toNum(systemSettings.tp1_ladder_stage2_tp1_hit_rate_min) || 0.38;
  const tp1LadderStage2Tp0ToTp1ConversionMin = toNum(systemSettings.tp1_ladder_stage2_tp0_to_tp1_conversion_min) || 0.45;
  const tp1LadderStage2FeeAdjustedExpectancyMin = toNum(systemSettings.tp1_ladder_stage2_fee_adjusted_expectancy_min) || 0.001;
  const signalOverlapEnabled = toBool(systemSettings.signal_overlap_enabled, true);
  const signalOverlapBars = Math.max(0, toNum(systemSettings.signal_overlap_bars) || 3);
  const sameDirectionTrailProfitCooldownEnabled = toBool(systemSettings.same_direction_trail_profit_cooldown_enabled, true);
  const sameDirectionTrailProfitCooldownMs = Math.max(0, toNum(systemSettings.same_direction_trail_profit_cooldown_ms) || (4 * 60 * 60 * 1000));
  const oppositeCooldownBarsBase = toNum(systemSettings.opposite_signal_cooldown_bars) || 4;
  const oppositeCooldownBarsMixed = toNum(systemSettings.opposite_signal_cooldown_bars_mixed) ?? 2;
  const oppositeCooldownBarsRescue = toNum(systemSettings.opposite_signal_cooldown_bars_rescue) ?? 1;
  const oppositeCooldownMsBase = toNum(systemSettings.opposite_time_cooldown_ms) || 900000;
  const oppositeCooldownMsMixed = toNum(systemSettings.opposite_time_cooldown_ms_mixed) ?? 300000;
  const oppositeCooldownMsRescue = toNum(systemSettings.opposite_time_cooldown_ms_rescue) ?? 60000;
  const oppositeTransitionEnabled = toBool(systemSettings.opposite_transition_enabled, true);
  const oppositeTransitionReduceFraction = toNum(systemSettings.opposite_transition_reduce_fraction);
  const oppositeTransitionConfirmBars = Math.max(1, toNum(systemSettings.opposite_transition_confirm_bars) || 3);
  const autoScoreFreeze = toBool(systemSettings.auto_score_freeze, false);
  const reverseExceptionMixedBypassTierBlock = toBool(systemSettings.reverse_exception_mixed_bypass_tier_block, true);
  const reverseExceptionRescueBypassTierBlock = toBool(systemSettings.reverse_exception_rescue_bypass_tier_block, true);
  const operationalDropWatchReasons = ["POSITION_FULL", "LIVE_RESCUE_ADD_*", "DROP_OVERLAP"];

  return {
    contract_version: "SERVER_SIGNAL_RUNTIME_V1",
    provider: toUpper(provider) || "BINANCEFUT",
    current_status: {
      cycle_id: runtimeCycleId,
      scheduler_enabled: schedulerEnabled,
      scheduler_interval_sec: schedulerIntervalSec,
      watchdog_verdict: watchdogVerdict,
      watchdog_generated_at_kst: watchdogGeneratedAtKst,
      canonical_engine_source_mode: sourceMode,
      canonical_engine_shadow_enabled: shadowEnabled,
      exec_tf: execTf,
      tf_allowlist: tfAllowlist,
      market_count: markets.length,
      markets_preview: markets.slice(0, 8),
      execution_shadow_policy: executionShadowPolicy,
      pine_ingress_shadow_only: pineIngressShadowOnly,
      live_execution_policy: {
        enabled: livePolicy.enabled === true,
        binance_only: livePolicy.binance_only !== false,
        quarantine_hard_block: livePolicy.quarantine_hard_block !== false,
        quality_hard_block: livePolicy.quality_hard_block !== false,
        execution_quality_global_guard_enabled: livePolicy.execution_quality_global_guard_enabled !== false,
        objective_scale_enabled: livePolicy.objective_scale_enabled !== false,
        lineage_slo_enabled: livePolicy.lineage_slo_enabled !== false,
        lineage_slo_fail_closed: livePolicy.lineage_slo_fail_closed !== false,
        lineage_slo_require_fresh: livePolicy.lineage_slo_require_fresh !== false,
        drift_remediation_enabled: livePolicy.drift_remediation_enabled !== false,
        drift_remediation_watch_only_block: livePolicy.drift_remediation_watch_only_block !== false,
        learning_epoch_exception_release_enabled: livePolicy.learning_epoch_exception_release_enabled !== false,
        policy_plan_enabled: livePolicy.policy_plan_enabled !== false,
        policy_plan_apply: livePolicy.policy_plan_apply === true,
        policy_plan_watch_only_block: livePolicy.policy_plan_watch_only_block !== false,
        policy_plan_hold_block: livePolicy.policy_plan_hold_block !== false,
        effective_mode: livePolicyMode,
        policy_profile: toUpper(livePolicy.policy_profile || "RISK_GUARD_V2") || "RISK_GUARD_V2",
      },
      ev_gate_tp1_prob_min_by_market_n: Object.keys(systemSettings.ev_gate_tp1_prob_min_by_market || {}).length,
      ev_gate_global_report_only_enabled: evGateGlobalReportOnlyEnabled,
      ev_gate_global_report_only_mode: evGateGlobalReportOnlyEnabled ? "REPORT_ONLY" : "ENFORCING",
      ev_gate_tp1_prob_min_by_market_report_only_n: Object.keys(systemSettings.ev_gate_tp1_prob_min_by_market_report_only || {}).length,
      ev_gate_tp1_prob_min_by_market_report_only_enabled: toBool(systemSettings.ev_gate_tp1_prob_min_by_market_report_only_enabled, false),
      ev_gate_unknown_gen_relax_enabled: genRelaxEnabled,
      ev_gate_unknown_gen_relax_mode: genRelaxEnabled ? "REPORT_ONLY" : "DISABLED",
      ev_gate_unknown_gen_relax_started_at: genRelaxStartAt,
      ev_gate_unknown_gen_relax_window_hours: genRelaxWindowHours,
      ev_gate_unknown_gen_relax_review_after_hours: genRelaxReviewAfterHours,
      ev_gate_unknown_gen_relax_active_window: genRelaxActiveWindow,
      ev_gate_unknown_gen_relax_auto_rollback_enabled: false,
      ev_gate_unknown_gen_relax_tp1_prob_min_delta: toNum(systemSettings.ev_gate_unknown_gen_relax_tp1_prob_min_delta) || 0.04,
      ev_gate_unknown_gen_relax_tp1_prob_full_delta: toNum(systemSettings.ev_gate_unknown_gen_relax_tp1_prob_full_delta) || 0.03,
      ev_gate_unknown_gen_relax_tp1_prob_kill_delta: toNum(systemSettings.ev_gate_unknown_gen_relax_tp1_prob_kill_delta) || 0.02,
    tp1_ladder_enabled: tp1LadderEnabled,
    tp1_ladder_freeze: tp1LadderFreeze,
    tp1_ladder_stage1_realized_n_min: tp1LadderStage1RealizedNMin,
      tp1_ladder_stage1_tp0_hit_rate_min: tp1LadderStage1Tp0HitRateMin,
      tp1_ladder_stage1_tp0_to_tp1_conversion_min: tp1LadderStage1Tp0ToTp1ConversionMin,
      tp1_ladder_stage1_fee_adjusted_expectancy_min: tp1LadderStage1FeeAdjustedExpectancyMin,
      tp1_ladder_stage2_realized_n_min: tp1LadderStage2RealizedNMin,
      tp1_ladder_stage2_tp0_hit_rate_min: tp1LadderStage2Tp0HitRateMin,
      tp1_ladder_stage2_tp1_hit_rate_min: tp1LadderStage2Tp1HitRateMin,
      tp1_ladder_stage2_tp0_to_tp1_conversion_min: tp1LadderStage2Tp0ToTp1ConversionMin,
    tp1_ladder_stage2_fee_adjusted_expectancy_min: tp1LadderStage2FeeAdjustedExpectancyMin,
    tp1_ladder_default_profile: "RESCUE",
    tp1_ladder_promotion_mode: tp1LadderFreeze ? "RESCUE_FIRST_FROZEN" : "RESCUE_FIRST_PROMOTION",
      signal_overlap_enabled: signalOverlapEnabled,
      signal_overlap_bars: signalOverlapBars,
      same_direction_trail_profit_cooldown_enabled: sameDirectionTrailProfitCooldownEnabled,
      same_direction_trail_profit_cooldown_ms: sameDirectionTrailProfitCooldownMs,
      opposite_cooldown_bars_base: oppositeCooldownBarsBase,
      opposite_cooldown_bars_mixed: oppositeCooldownBarsMixed,
      opposite_cooldown_bars_rescue: oppositeCooldownBarsRescue,
      opposite_cooldown_ms_base: oppositeCooldownMsBase,
      opposite_cooldown_ms_mixed: oppositeCooldownMsMixed,
      opposite_cooldown_ms_rescue: oppositeCooldownMsRescue,
      opposite_cooldown_default_profile: "RESCUE",
      opposite_cooldown_promotion_mode: tp1LadderFreeze ? "RESCUE_FIRST_FROZEN" : "RESCUE_FIRST_PROMOTION",
      opposite_transition_enabled: oppositeTransitionEnabled,
      opposite_transition_reduce_fraction: oppositeTransitionReduceFraction,
      opposite_transition_confirm_bars: oppositeTransitionConfirmBars,
      auto_score_freeze: autoScoreFreeze,
      reverse_exception_mixed_bypass_tier_block: reverseExceptionMixedBypassTierBlock,
      reverse_exception_rescue_bypass_tier_block: reverseExceptionRescueBypassTierBlock,
      operational_drop_watch_reasons: operationalDropWatchReasons,
    },
    summary: {
      cycle_id: runtimeCycleId,
      runtime_status: schedulerEnabled && execTf === "15m" && markets.length > 0 ? "READY" : "HOLD",
      canonical_engine_source_mode: sourceMode,
      exec_tf: execTf,
      market_count: markets.length,
      scheduler_status: schedulerEnabled ? "ENABLED" : "DISABLED",
      watchdog_verdict: watchdogVerdict,
      watchdog_generated_at_kst: watchdogGeneratedAtKst,
      live_execution_policy_enabled: livePolicy.enabled === true,
      live_execution_policy_mode: livePolicyMode,
      live_execution_policy_policy_plan_apply: livePolicy.policy_plan_apply === true,
      live_execution_policy_quarantine_hard_block: livePolicy.quarantine_hard_block !== false,
      live_execution_policy_quality_hard_block: livePolicy.quality_hard_block !== false,
      live_execution_policy_exec_quality_global_guard_enabled: livePolicy.execution_quality_global_guard_enabled !== false,
      live_execution_policy_objective_scale_enabled: livePolicy.objective_scale_enabled !== false,
      live_execution_policy_lineage_slo_enabled: livePolicy.lineage_slo_enabled !== false,
      live_execution_policy_lineage_slo_fail_closed: livePolicy.lineage_slo_fail_closed !== false,
      live_execution_policy_drift_remediation_enabled: livePolicy.drift_remediation_enabled !== false,
      live_execution_policy_drift_remediation_watch_only_block: livePolicy.drift_remediation_watch_only_block !== false,
      live_execution_policy_learning_epoch_exception_release_enabled: livePolicy.learning_epoch_exception_release_enabled !== false,
      ev_gate_tp1_prob_min_by_market_n: Object.keys(systemSettings.ev_gate_tp1_prob_min_by_market || {}).length,
      ev_gate_global_report_only_enabled: evGateGlobalReportOnlyEnabled,
      ev_gate_global_report_only_mode: evGateGlobalReportOnlyEnabled ? "REPORT_ONLY" : "ENFORCING",
      ev_gate_tp1_prob_min_by_market_report_only_n: Object.keys(systemSettings.ev_gate_tp1_prob_min_by_market_report_only || {}).length,
      ev_gate_tp1_prob_min_by_market_report_only_enabled: toBool(systemSettings.ev_gate_tp1_prob_min_by_market_report_only_enabled, false),
      ev_gate_unknown_gen_relax_enabled: genRelaxEnabled,
      ev_gate_unknown_gen_relax_mode: genRelaxEnabled ? "REPORT_ONLY" : "DISABLED",
      ev_gate_unknown_gen_relax_started_at: genRelaxStartAt,
      ev_gate_unknown_gen_relax_window_hours: genRelaxWindowHours,
      ev_gate_unknown_gen_relax_review_after_hours: genRelaxReviewAfterHours,
      ev_gate_unknown_gen_relax_active_window: genRelaxActiveWindow,
      ev_gate_unknown_gen_relax_auto_rollback_enabled: false,
      ev_gate_unknown_gen_relax_tp1_prob_min_delta: toNum(systemSettings.ev_gate_unknown_gen_relax_tp1_prob_min_delta) || 0.04,
      ev_gate_unknown_gen_relax_tp1_prob_full_delta: toNum(systemSettings.ev_gate_unknown_gen_relax_tp1_prob_full_delta) || 0.03,
      ev_gate_unknown_gen_relax_tp1_prob_kill_delta: toNum(systemSettings.ev_gate_unknown_gen_relax_tp1_prob_kill_delta) || 0.02,
      tp1_ladder_enabled: tp1LadderEnabled,
      tp1_ladder_stage1_realized_n_min: tp1LadderStage1RealizedNMin,
      tp1_ladder_stage1_tp0_hit_rate_min: tp1LadderStage1Tp0HitRateMin,
      tp1_ladder_stage1_tp0_to_tp1_conversion_min: tp1LadderStage1Tp0ToTp1ConversionMin,
      tp1_ladder_stage1_fee_adjusted_expectancy_min: tp1LadderStage1FeeAdjustedExpectancyMin,
      tp1_ladder_stage2_realized_n_min: tp1LadderStage2RealizedNMin,
      tp1_ladder_stage2_tp0_hit_rate_min: tp1LadderStage2Tp0HitRateMin,
      tp1_ladder_stage2_tp1_hit_rate_min: tp1LadderStage2Tp1HitRateMin,
      tp1_ladder_stage2_tp0_to_tp1_conversion_min: tp1LadderStage2Tp0ToTp1ConversionMin,
      tp1_ladder_stage2_fee_adjusted_expectancy_min: tp1LadderStage2FeeAdjustedExpectancyMin,
      tp1_ladder_default_profile: "RESCUE",
      tp1_ladder_freeze: tp1LadderFreeze,
      tp1_ladder_promotion_mode: tp1LadderFreeze ? "RESCUE_FIRST_FROZEN" : "RESCUE_FIRST_PROMOTION",
      signal_overlap_enabled: signalOverlapEnabled,
      signal_overlap_bars: signalOverlapBars,
      same_direction_trail_profit_cooldown_enabled: sameDirectionTrailProfitCooldownEnabled,
      same_direction_trail_profit_cooldown_ms: sameDirectionTrailProfitCooldownMs,
      opposite_cooldown_bars_base: oppositeCooldownBarsBase,
      opposite_cooldown_bars_mixed: oppositeCooldownBarsMixed,
      opposite_cooldown_bars_rescue: oppositeCooldownBarsRescue,
      opposite_cooldown_ms_base: oppositeCooldownMsBase,
      opposite_cooldown_ms_mixed: oppositeCooldownMsMixed,
      opposite_cooldown_ms_rescue: oppositeCooldownMsRescue,
      opposite_cooldown_default_profile: "RESCUE",
      opposite_cooldown_promotion_mode: tp1LadderFreeze ? "RESCUE_FIRST_FROZEN" : "RESCUE_FIRST_PROMOTION",
      opposite_transition_enabled: oppositeTransitionEnabled,
      opposite_transition_reduce_fraction: oppositeTransitionReduceFraction,
      opposite_transition_confirm_bars: oppositeTransitionConfirmBars,
      auto_score_freeze: autoScoreFreeze,
      reverse_exception_mixed_bypass_tier_block: reverseExceptionMixedBypassTierBlock,
      reverse_exception_rescue_bypass_tier_block: reverseExceptionRescueBypassTierBlock,
      operational_drop_watch_reasons: operationalDropWatchReasons,
      pine_shadow_transition_status: completedN === Object.keys(transition).length ? "COMPLETE" : "IN_PROGRESS",
      pine_shadow_transition_progress_pct: progressPct,
    },
    rows: {
      markets,
      transition: Object.entries(transition).map(([key, status]) => ({ key, status })),
    },
  };
}

module.exports = {
  deriveServerSignalRuntime,
};
