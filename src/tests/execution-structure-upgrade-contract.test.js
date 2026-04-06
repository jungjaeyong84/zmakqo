"use strict";

const assert = require("assert");
const { buildExecutionStructureUpgradeContract } = require("../utils/executionStructureUpgradeContract");

(() => {
  const report = buildExecutionStructureUpgradeContract({
    exitTrailingContract: {
      summary: {
        status: "EXIT_TRAILING_CONTRACT_ACTIVE",
        canonical_mode: "TRAIL_R_MULTIPLE",
        leverage_invariant_r: true,
        generic_trail_event_when_r_enabled: true,
        active_binance_entry_exit_contract: {
          tp1_pct: 3.25,
          trail_r_multiple: 0.9,
          runner_min_profit_pct: 2,
        },
      },
    },
    objectiveRetrospective: {
      display: {
        execution_microstructure: {
          tp0_hit_rate: 0.75,
          tp1_hit_rate: 0.375,
          tp0_to_tp1_conversion_rate: 0.5,
          pre_tp1_time_stop_rate: 0.125,
          chase_reject_n: 1,
          portfolio_cluster_reduce_n: 2,
          portfolio_cluster_block_n: 0,
        },
      },
    },
    evGateCompositePolicy: {
      summary: {
        status: "EV_GATE_COMPOSITE_POLICY_READY",
        default_tp0_pct: 0.8,
        default_tp0_qty_ratio: 0.25,
        default_tp1_pct: 3.25,
      },
    },
    modelReadiness: {
      summary: {
        status: "MODEL_READINESS_READY",
        tp0_time_labeled_n: 3,
        tp1_time_labeled_n: 5,
        tp0_to_tp1_converted_n: 2,
        pre_tp1_time_stop_n: 1,
      },
    },
  });

  assert.strictEqual(report.status, "EXECUTION_STRUCTURE_UPGRADE_CONTRACT_READY");
  assert.strictEqual(report.structure_mode, "ENTRY_TP0_TP1_TRAIL");
  assert.strictEqual(report.stage_sequence_ready, true);
  assert.strictEqual(report.survivability_ready, true);
  assert.strictEqual(report.label_support_ready, true);
  assert.strictEqual(report.tp0_stage_active, true);
  assert.strictEqual(report.tp1_stage_active, true);
  assert.strictEqual(report.trail_stage_active, true);
  assert.deepStrictEqual(report.blocking_reasons, []);
  console.log("EXECUTION_STRUCTURE_UPGRADE_CONTRACT_TEST_OK");
})();

(() => {
  const report = buildExecutionStructureUpgradeContract({
    exitTrailingContract: {
      summary: {
        status: "EXIT_TRAILING_CONTRACT_ACTIVE",
        canonical_mode: "TRAIL_R_MULTIPLE",
        leverage_invariant_r: true,
        generic_trail_event_when_r_enabled: true,
        active_binance_entry_exit_contract: {
          tp1_pct: 3.25,
          trail_r_multiple: 0.9,
        },
      },
    },
    objectiveRetrospective: {
      display: {
        execution_microstructure: {
          tp0_hit_rate: 0.75,
          tp1_hit_rate: 0.375,
          tp0_to_tp1_conversion_rate: 0,
          pre_tp1_time_stop_rate: 0,
          chase_reject_n: 0,
          portfolio_cluster_reduce_n: 0,
          portfolio_cluster_block_n: 0,
        },
      },
    },
    evGateCompositePolicy: {
      summary: {
        status: "EV_GATE_COMPOSITE_POLICY_READY",
        default_tp0_pct: 0.8,
        default_tp0_qty_ratio: 0.25,
        default_tp1_pct: 3.25,
      },
    },
    modelReadiness: {
      summary: {
        status: "MODEL_READINESS_READY",
        tp0_time_labeled_n: 0,
        tp1_time_labeled_n: 5,
      },
    },
  });

  assert.strictEqual(report.status, "EXECUTION_STRUCTURE_UPGRADE_CONTRACT_BOOTSTRAPPING");
  assert.strictEqual(report.stage_sequence_ready, true);
  assert.strictEqual(report.survivability_ready, false);
  assert.strictEqual(report.label_support_ready, false);
  assert.ok(report.blocking_reasons.includes("TP_LABEL_SUPPORT_NOT_READY"));
  console.log("EXECUTION_STRUCTURE_UPGRADE_CONTRACT_BOOTSTRAP_TEST_OK");
})();
