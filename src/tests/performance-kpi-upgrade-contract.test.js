"use strict";

const assert = require("assert");
const {
  derivePerformanceKpiUpgradeContract,
} = require("../../src/utils/performanceKpiUpgradeContract");

(() => {
  const report = derivePerformanceKpiUpgradeContract({
    objectiveRetrospective: {
      display: {
        periods: {
          DAILY: {
            objective: { verdict: "FAIL" },
            execution_microstructure: {
              tp0_hit_rate: 0.75,
              tp1_hit_rate: 0.375,
              tp0_to_tp1_conversion_rate: 0,
              pre_tp1_time_stop_rate: 0,
            },
            realized_trades: {
              realized_n: 24,
              win_rate: 0.3333,
              avg_ret_net: -0.0011,
              net_pnl_quote: -81679.9,
            },
          },
        },
      },
    },
    executionStructureUpgradeContract: { summary: { stage_sequence_ready: true } },
    costControlEngineContract: { summary: { automatic_entry_suppression_ready: true } },
  });

  assert.strictEqual(report.status, "PERFORMANCE_KPI_UPGRADE_CONTRACT_READY");
  assert.strictEqual(report.contract_mode, "TP0_TP1_CONVERSION_EXPECTANCY_KPI");
  assert.strictEqual(report.microstructure_kpi_ready, true);
  assert.strictEqual(report.expectancy_kpi_ready, true);
  assert.strictEqual(report.structure_alignment_ready, true);
  assert.strictEqual(report.cost_alignment_ready, true);
  assert.strictEqual(report.tp0_hit_rate, 0.75);
  assert.strictEqual(report.fee_adjusted_expectancy, -0.0011);
})();

(() => {
  const report = derivePerformanceKpiUpgradeContract({
    objectiveRetrospective: { display: { periods: { DAILY: { execution_microstructure: {}, realized_trades: {} } } } },
    executionStructureUpgradeContract: { summary: { stage_sequence_ready: false } },
    costControlEngineContract: { summary: { automatic_entry_suppression_ready: false } },
  });

  assert.strictEqual(report.status, "PERFORMANCE_KPI_UPGRADE_CONTRACT_BLOCKED");
  assert.ok(report.blocking_reasons.includes("MICROSTRUCTURE_KPI_NOT_READY"));
  assert.ok(report.blocking_reasons.includes("EXPECTANCY_KPI_NOT_READY"));
  assert.ok(report.blocking_reasons.includes("EXECUTION_STRUCTURE_NOT_ALIGNED"));
  assert.ok(report.blocking_reasons.includes("COST_CONTROL_NOT_ALIGNED"));
})();

console.log("PERFORMANCE_KPI_UPGRADE_CONTRACT_TEST_OK");
