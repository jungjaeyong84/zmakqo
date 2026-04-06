"use strict";

function readSummary(value) {
  if (!value || typeof value !== "object") return {};
  return value.summary && typeof value.summary === "object" ? value.summary : value;
}

function readDisplay(value) {
  if (!value || typeof value !== "object") return {};
  if (value.display && typeof value.display === "object") return value.display;
  return value;
}

function readRetrospectiveMicrostructure(value) {
  const display = readDisplay(value);
  if (display.execution_microstructure && typeof display.execution_microstructure === "object") {
    return display.execution_microstructure;
  }
  const daily = display.periods && display.periods.DAILY && typeof display.periods.DAILY === "object"
    ? display.periods.DAILY
    : null;
  if (daily && daily.execution_microstructure && typeof daily.execution_microstructure === "object") {
    return daily.execution_microstructure;
  }
  return {};
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function buildExecutionStructureUpgradeContract({
  exitTrailingContract = null,
  objectiveRetrospective = null,
  evGateCompositePolicy = null,
  modelReadiness = null,
} = {}) {
  const exitSummary = readSummary(exitTrailingContract);
  const micro = readRetrospectiveMicrostructure(objectiveRetrospective);
  const evSummary = readSummary(evGateCompositePolicy);
  const readinessSummary = readSummary(modelReadiness);
  const activeContract = exitSummary.active_binance_entry_exit_contract && typeof exitSummary.active_binance_entry_exit_contract === "object"
    ? exitSummary.active_binance_entry_exit_contract
    : {};

  const tp0Pct = toNum(evSummary.default_tp0_pct);
  const tp0QtyRatio = toNum(evSummary.default_tp0_qty_ratio);
  const tp1Pct = toNum(evSummary.default_tp1_pct) ?? toNum(activeContract.tp1_pct);
  const trailRMultiple = toNum(activeContract.trail_r_multiple);
  const runnerMinProfitPct = toNum(activeContract.runner_min_profit_pct);

  const tp0StageActive = tp0Pct != null && tp0Pct > 0 && tp0QtyRatio != null && tp0QtyRatio > 0 && tp0QtyRatio < 1;
  const tp1StageActive = tp1Pct != null && tp1Pct > 0 && (tp0Pct == null || tp1Pct > tp0Pct);
  const trailStageActive = String(exitSummary.status || "").trim().toUpperCase() === "EXIT_TRAILING_CONTRACT_ACTIVE"
    && String(exitSummary.canonical_mode || "").trim().toUpperCase() === "TRAIL_R_MULTIPLE"
    && exitSummary.leverage_invariant_r === true
    && exitSummary.generic_trail_event_when_r_enabled === true
    && trailRMultiple != null
    && trailRMultiple > 0;
  const stageSequenceReady = tp0StageActive && tp1StageActive && trailStageActive;

  const tp0HitRate = toNum(micro.tp0_hit_rate);
  const tp1HitRate = toNum(micro.tp1_hit_rate);
  const tp0ToTp1ConversionRate = toNum(micro.tp0_to_tp1_conversion_rate);
  const preTp1TimeStopRate = toNum(micro.pre_tp1_time_stop_rate);
  const chaseRejectN = toNum(micro.chase_reject_n);
  const clusterReduceN = toNum(micro.portfolio_cluster_reduce_n);
  const clusterBlockN = toNum(micro.portfolio_cluster_block_n);

  const conversionObservable = tp0ToTp1ConversionRate != null;
  const preTp1SurvivabilityObservable = preTp1TimeStopRate != null
    && chaseRejectN != null
    && clusterReduceN != null
    && clusterBlockN != null;
  const labelSupportReady = String(readinessSummary.status || "").trim().toUpperCase() === "MODEL_READINESS_READY"
    && (toNum(readinessSummary.tp0_time_labeled_n) || 0) > 0
    && (toNum(readinessSummary.tp1_time_labeled_n) || 0) > 0;
  const survivabilityReady = conversionObservable && preTp1SurvivabilityObservable && labelSupportReady;

  const blockingReasons = [];
  if (!tp0StageActive) blockingReasons.push("TP0_STAGE_NOT_ACTIVE");
  if (!tp1StageActive) blockingReasons.push("TP1_STAGE_NOT_ACTIVE");
  if (!trailStageActive) blockingReasons.push("TRAIL_STAGE_NOT_ACTIVE");
  if (!conversionObservable) blockingReasons.push("TP0_TO_TP1_CONVERSION_NOT_OBSERVABLE");
  if (!preTp1SurvivabilityObservable) blockingReasons.push("PRE_TP1_SURVIVABILITY_NOT_OBSERVABLE");
  if (!labelSupportReady) blockingReasons.push("TP_LABEL_SUPPORT_NOT_READY");

  const status = stageSequenceReady && survivabilityReady
    ? "EXECUTION_STRUCTURE_UPGRADE_CONTRACT_READY"
    : (stageSequenceReady
      ? "EXECUTION_STRUCTURE_UPGRADE_CONTRACT_BOOTSTRAPPING"
      : "EXECUTION_STRUCTURE_UPGRADE_CONTRACT_BLOCKED");

  return {
    status,
    structure_mode: "ENTRY_TP0_TP1_TRAIL",
    survivability_priority: "PRE_TP1_SURVIVABILITY_FIRST",
    stage_sequence_ready: stageSequenceReady,
    tp0_stage_active: tp0StageActive,
    tp1_stage_active: tp1StageActive,
    trail_stage_active: trailStageActive,
    survivability_ready: survivabilityReady,
    conversion_observable: conversionObservable,
    pre_tp1_survivability_observable: preTp1SurvivabilityObservable,
    label_support_ready: labelSupportReady,
    tp0_pct: tp0Pct,
    tp0_qty_ratio: tp0QtyRatio,
    tp1_pct: tp1Pct,
    trail_r_multiple: trailRMultiple,
    runner_min_profit_pct: runnerMinProfitPct,
    tp0_hit_rate: tp0HitRate,
    tp1_hit_rate: tp1HitRate,
    tp0_to_tp1_conversion_rate: tp0ToTp1ConversionRate,
    pre_tp1_time_stop_rate: preTp1TimeStopRate,
    chase_reject_n: chaseRejectN,
    portfolio_cluster_reduce_n: clusterReduceN,
    portfolio_cluster_block_n: clusterBlockN,
    model_readiness_status: String(readinessSummary.status || "").trim() || null,
    model_tp0_time_labeled_n: toNum(readinessSummary.tp0_time_labeled_n),
    model_tp1_time_labeled_n: toNum(readinessSummary.tp1_time_labeled_n),
    model_tp0_to_tp1_converted_n: toNum(readinessSummary.tp0_to_tp1_converted_n),
    model_pre_tp1_time_stop_n: toNum(readinessSummary.pre_tp1_time_stop_n),
    exit_trailing_contract_status: String(exitSummary.status || "").trim() || null,
    ev_gate_policy_status: String(evSummary.status || "").trim() || null,
    blocking_reason_n: blockingReasons.length,
    blocking_reasons: blockingReasons,
  };
}

module.exports = {
  buildExecutionStructureUpgradeContract,
};
