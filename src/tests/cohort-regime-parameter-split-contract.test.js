"use strict";

const assert = require("assert");
const {
  deriveCohortRegimeParameterSplitContract,
} = require("../../src/utils/cohortRegimeParameterSplitContract");

(() => {
  const report = deriveCohortRegimeParameterSplitContract({
    marketRegimeBoard: {
      summary: {
        status: "RESCUE_COHORT_ACTIVE",
        has_market_split: true,
        active_market_n: 7,
        rescue_market_n: 2,
        mixed_market_n: 1,
        keep_drop_market_n: 3,
        top_watch_markets: [
          { cohort: "RESCUE", allocation_action: "HOLD", objective_score: -2.5 },
          { cohort: "RESCUE", allocation_action: "QUARANTINE", objective_score: -5.9 },
          { cohort: "MIXED", allocation_action: "INCREASE", objective_score: 0.14 },
          { cohort: "KEEP_DROP", allocation_action: "QUARANTINE", objective_score: -8.5 },
          { cohort: "KEEP_DROP", allocation_action: "HOLD", objective_score: -1.4 },
        ],
      },
    },
    policyParameterPlan: {
      summary: {
        status: "HOLD",
        mode: "ADVISORY_ONLY",
        global_qty_scale: 0.55,
        market_action_n: 7,
        watch_only_review_market_n: 4,
        quarantine_market_n: 3,
      },
    },
  });

  assert.strictEqual(report.status, "COHORT_REGIME_PARAMETER_SPLIT_CONTRACT_READY");
  assert.strictEqual(report.contract_mode, "COHORT_REGIME_AUTO_SWITCH");
  assert.strictEqual(report.cohort_parameterization_ready, true);
  assert.strictEqual(report.regime_switch_ready, true);
  assert.strictEqual(report.policy_scoped_ready, true);
  assert.strictEqual(report.auto_switch_observability_ready, true);
  assert.strictEqual(report.automatic_transition_ready, true);
  assert.strictEqual(report.active_cohort_n, 3);
  assert.strictEqual(report.cohort_action_profile_n, 3);
  assert.deepStrictEqual(report.blocking_reasons, []);
})();

(() => {
  const report = deriveCohortRegimeParameterSplitContract({
    marketRegimeBoard: {
      summary: {
        status: "HOLD_SAMPLE_ONLY",
        has_market_split: false,
        active_market_n: 0,
        rescue_market_n: 0,
        mixed_market_n: 0,
        keep_drop_market_n: 1,
        top_watch_markets: [],
      },
    },
    policyParameterPlan: {
      summary: {
        status: null,
        mode: null,
        global_qty_scale: null,
        market_action_n: null,
      },
    },
  });

  assert.strictEqual(report.status, "COHORT_REGIME_PARAMETER_SPLIT_CONTRACT_BLOCKED");
  assert.strictEqual(report.cohort_parameterization_ready, false);
  assert.strictEqual(report.regime_switch_ready, false);
  assert.strictEqual(report.policy_scoped_ready, false);
  assert.strictEqual(report.auto_switch_observability_ready, false);
  assert.ok(report.blocking_reasons.includes("MARKET_REGIME_BOARD_NOT_ACTIVE"));
  assert.ok(report.blocking_reasons.includes("COHORT_PARAMETERIZATION_INCOMPLETE"));
})();

console.log("COHORT_REGIME_PARAMETER_SPLIT_CONTRACT_TEST_OK");
