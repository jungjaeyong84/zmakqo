"use strict";

function unwrapRawReport(value) {
  if (!value || typeof value !== "object") return value || null;
  if (value.raw && typeof value.raw === "object") return value.raw;
  if (value.display && typeof value.display === "object") return value.display;
  return value;
}

function readSummary(value) {
  const raw = unwrapRawReport(value) || {};
  return raw.summary && typeof raw.summary === "object" ? raw.summary : raw;
}

function readDisplay(value) {
  const raw = unwrapRawReport(value) || {};
  return raw.display && typeof raw.display === "object" ? raw.display : raw;
}

function toNum(value) {
  if (value === null || value === undefined || value === "") return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function derivePerformanceKpiUpgradeContract({
  objectiveRetrospective = null,
  executionStructureUpgradeContract = null,
  costControlEngineContract = null,
} = {}) {
  const display = readDisplay(objectiveRetrospective);
  const daily = display.periods && display.periods.DAILY && typeof display.periods.DAILY === "object"
    ? display.periods.DAILY
    : (display.execution_microstructure ? display : {});
  const micro = daily.execution_microstructure && typeof daily.execution_microstructure === "object"
    ? daily.execution_microstructure
    : {};
  const realized = daily.realized_trades && typeof daily.realized_trades === "object"
    ? daily.realized_trades
    : {};
  const objective = daily.objective && typeof daily.objective === "object"
    ? daily.objective
    : {};
  const executionStructure = readSummary(executionStructureUpgradeContract);
  const costControl = readSummary(costControlEngineContract);

  const tp0HitRate = toNum(micro.tp0_hit_rate);
  const tp1HitRate = toNum(micro.tp1_hit_rate);
  const conversionRate = toNum(micro.tp0_to_tp1_conversion_rate);
  const preTp1TimeStopRate = toNum(micro.pre_tp1_time_stop_rate);
  const feeAdjustedExpectancy = toNum(realized.avg_ret_net);
  const microstructureKpiReady = tp0HitRate != null && tp1HitRate != null && conversionRate != null;
  const survivabilityKpiReady = preTp1TimeStopRate != null;
  const expectancyKpiReady = feeAdjustedExpectancy != null;
  const structureAlignmentReady = executionStructure.stage_sequence_ready === true;
  const costAlignmentReady = costControl.automatic_entry_suppression_ready === true;

  const blockingReasons = [];
  if (!microstructureKpiReady) blockingReasons.push("MICROSTRUCTURE_KPI_NOT_READY");
  if (!survivabilityKpiReady) blockingReasons.push("SURVIVABILITY_KPI_NOT_READY");
  if (!expectancyKpiReady) blockingReasons.push("EXPECTANCY_KPI_NOT_READY");
  if (!structureAlignmentReady) blockingReasons.push("EXECUTION_STRUCTURE_NOT_ALIGNED");
  if (!costAlignmentReady) blockingReasons.push("COST_CONTROL_NOT_ALIGNED");

  const status = blockingReasons.length === 0
    ? "PERFORMANCE_KPI_UPGRADE_CONTRACT_READY"
    : ((microstructureKpiReady || expectancyKpiReady)
      ? "PERFORMANCE_KPI_UPGRADE_CONTRACT_BOOTSTRAPPING"
      : "PERFORMANCE_KPI_UPGRADE_CONTRACT_BLOCKED");

  return {
    status,
    contract_mode: "TP0_TP1_CONVERSION_EXPECTANCY_KPI",
    microstructure_kpi_ready: microstructureKpiReady,
    survivability_kpi_ready: survivabilityKpiReady,
    expectancy_kpi_ready: expectancyKpiReady,
    structure_alignment_ready: structureAlignmentReady,
    cost_alignment_ready: costAlignmentReady,
    primary_kpis: [
      "TP0_HIT_RATE",
      "TP1_HIT_RATE",
      "TP0_TO_TP1_CONVERSION",
      "PRE_TP1_TIME_STOP_RATE",
      "FEE_ADJUSTED_EXPECTANCY",
    ],
    tp0_hit_rate: tp0HitRate,
    tp1_hit_rate: tp1HitRate,
    tp0_to_tp1_conversion_rate: conversionRate,
    pre_tp1_time_stop_rate: preTp1TimeStopRate,
    fee_adjusted_expectancy: feeAdjustedExpectancy,
    fee_adjusted_net_pnl_quote: toNum(realized.net_pnl_quote),
    realized_trade_n: toNum(realized.realized_n),
    legacy_win_rate_reference: toNum(realized.win_rate),
    objective_verdict: String(objective.verdict || "").trim() || null,
    blocking_reason_n: blockingReasons.length,
    blocking_reasons: blockingReasons,
  };
}

module.exports = {
  derivePerformanceKpiUpgradeContract,
};
