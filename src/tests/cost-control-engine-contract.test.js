"use strict";

const assert = require("assert");
const { buildCostControlEngineContract } = require("../utils/costControlEngineContract");

(() => {
  const report = buildCostControlEngineContract({
    evGateCompositePolicy: {
      summary: {
        status: "EV_GATE_COMPOSITE_POLICY_READY",
        ev_gate_enabled: true,
        threshold_metric: "exit_value_lower_bound",
        threshold_metric_family: "TP_COMPOSITE_EXIT_VALUE",
      },
    },
    overallAccountReport: {
      operations: {
        status: "보류",
        mode: "비용 차단",
        error_count_24h: 1,
      },
    },
    cooldownPolicyReview: {
      summary: {
        status: "MONITOR_WITH_TARGETED_REVIEW",
        cooldown_policy_mismatch_n: 1,
      },
    },
    serverSignalCutoverReadiness: {
      summary: {
        readiness_status: "SERVER_PRIMARY_ACTIVE",
        blockers: ["COOLDOWN_POLICY_DRIFT_ACTIVE"],
      },
    },
    reversePolicy: {
      summary: {
        status: "REVERSE_POLICY_REVIEW",
        reverse_blocked_n: 274,
        reverse_cooldown_n: 22,
      },
    },
    executionQuality: {
      summary: {
        status: "EXECUTION_QUALITY_REVIEW",
        review_reasons: ["ADVERSE_SLIPPAGE_P95_HIGH", "PARTIAL_FILL_RATE_HIGH"],
      },
    },
  });

  assert.strictEqual(report.status, "COST_CONTROL_ENGINE_CONTRACT_READY");
  assert.strictEqual(report.automatic_entry_suppression_ready, true);
  assert.strictEqual(report.system_reentry_control_ready, true);
  assert.strictEqual(report.expectancy_gate_active, true);
  assert.strictEqual(report.cost_block_mode_active, true);
  assert.strictEqual(report.cooldown_reentry_control_active, true);
  assert.strictEqual(report.reverse_reentry_control_active, true);
  assert.strictEqual(report.fill_cost_pressure_active, true);
  assert.deepStrictEqual(report.blocking_reasons, []);
  console.log("COST_CONTROL_ENGINE_CONTRACT_TEST_OK");
})();

(() => {
  const report = buildCostControlEngineContract({
    evGateCompositePolicy: {
      summary: {
        status: "EV_GATE_COMPOSITE_POLICY_READY",
        ev_gate_enabled: true,
        threshold_metric: "exit_value_lower_bound",
        threshold_metric_family: "TP_COMPOSITE_EXIT_VALUE",
      },
    },
    overallAccountReport: {
      operations: {
        status: "진행",
        mode: "수익 확대 가능",
      },
    },
    cooldownPolicyReview: {
      summary: {
        status: "N_A",
        cooldown_policy_mismatch_n: 0,
      },
    },
    serverSignalCutoverReadiness: {
      summary: {
        blockers: [],
      },
    },
    reversePolicy: {
      summary: {
        status: "N_A",
        reverse_blocked_n: 0,
        reverse_cooldown_n: 0,
      },
    },
    executionQuality: {
      summary: {
        status: "PASS",
        review_reasons: [],
      },
    },
  });

  assert.strictEqual(report.status, "COST_CONTROL_ENGINE_CONTRACT_BLOCKED");
  assert.strictEqual(report.automatic_entry_suppression_ready, false);
  assert.strictEqual(report.system_reentry_control_ready, false);
  assert.ok(report.blocking_reasons.includes("OPS_COST_BLOCK_MODE_NOT_ACTIVE"));
  assert.ok(report.blocking_reasons.includes("COOLDOWN_REENTRY_CONTROL_NOT_ACTIVE"));
  console.log("COST_CONTROL_ENGINE_CONTRACT_BOOTSTRAP_TEST_OK");
})();
