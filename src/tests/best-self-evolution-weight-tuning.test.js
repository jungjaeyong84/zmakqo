"use strict";

const assert = require("assert");
const { deriveWeightTuningPlan } = require("../../src/utils/bestSelfEvolutionWeightTuning");

(() => {
  const hold = deriveWeightTuningPlan({
    objective: { count_floor_pass: false, replacement_floor_pass: true, latency_budget_pass: true },
    attribution: { late_loss_top_market: { key: "DOGEUSDT", count: 4 } },
    canary: { apply_pass: true },
    memoryLedger: { blocked_candidate_n: 0 },
  });
  assert.strictEqual(hold.summary.advisory_mode, "HOLD");

  const adjust = deriveWeightTuningPlan({
    objective: { count_floor_pass: true, replacement_floor_pass: true, latency_budget_pass: true },
    attribution: {
      late_loss_top_market: { key: "DOGEUSDT", count: 4 },
      false_fire_top_market: { key: "ETHUSDT", count: 2 },
      missed_recovery_top_reason: { key: "DROP_WAIT_ONE_BAR_TIMING", count: 3 },
    },
    canary: { apply_pass: true },
    memoryLedger: { blocked_candidate_n: 0 },
  });
  assert.strictEqual(adjust.summary.advisory_mode, "ADJUST");
  assert.ok(adjust.suggestions.some((row) => row.axis === "delay_cost_weight"));
  assert.ok(adjust.suggestions.some((row) => row.axis === "failure_risk_weight"));

  const advisoryOnly = deriveWeightTuningPlan({
    objective: { count_floor_pass: true, replacement_floor_pass: true, latency_budget_pass: true },
    attribution: {
      missed_recovery_top_reason: { key: "DROP_EV_GATE_TP1_PROB", count: 4 },
      fallback_cost_top_market: { key: "SOLUSDT", count: 2 },
    },
    canary: { apply_pass: true },
    memoryLedger: { blocked_candidate_n: 3 },
  });
  assert.strictEqual(advisoryOnly.summary.advisory_mode, "ADVISORY_ONLY");
  assert.strictEqual(advisoryOnly.summary.memory_blocked, true);
  assert.ok(advisoryOnly.suggestions.length > 0);

  console.log("BEST_SELF_EVOLUTION_WEIGHT_TUNING_TEST_OK");
})();
