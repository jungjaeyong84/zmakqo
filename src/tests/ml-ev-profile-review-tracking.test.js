"use strict";

const assert = require("assert");
const { buildMlEvProfileReviewTracking } = require("../utils/mlEvProfileReviewTracking");

(() => {
  const report = buildMlEvProfileReviewTracking({
    policyParameterPlan: {
      summary: {
        ev_policy_review_mode: "PROFILE_CONDITIONAL_REVIEW",
        ev_policy_top_return_drag_profile: "EARLY|LONG|PINE_DROP_STALE_POS_TO_ENTRY|PREPARE",
        ev_policy_top_return_drag_driver: "FAILURE_RISK_HEAVY",
        ev_policy_top_mixed_profile: "EARLY|SHORT|PINE_DROP_STALE_POS_TO_ENTRY|ARMED",
        ev_policy_top_mixed_driver: "DELAY_LATE_RISK_HEAVY",
      },
    },
    mlReplayEvidence: {
      summary: {
        best_candidate_review_mode: "PROFILE_CONDITIONAL_REVIEW",
        best_candidate_top_return_drag_profile: "EARLY|LONG|PINE_DROP_STALE_POS_TO_ENTRY|PREPARE",
        best_candidate_top_return_drag_driver: "FAILURE_RISK_HEAVY",
        best_candidate_top_mixed_profile: "EARLY|SHORT|PINE_DROP_STALE_POS_TO_ENTRY|ARMED",
        best_candidate_top_mixed_driver: "DELAY_LATE_RISK_HEAVY",
      },
    },
    mlEvReplayProfileContribution: {
      summary: {
        top_return_drag_profile_rows_delta: 1,
        top_return_drag_profile_avg_ret_net_delta: -0.02,
        top_mixed_profile_rows_delta: 1,
        top_mixed_profile_avg_ret_net_delta: -0.01,
      },
    },
    mlEvReplayStalePosDiagnostics: {
      summary: {
        top_return_drag_avg_ev_lb: 0.45,
        top_return_drag_avg_delay_cost: 0.2,
        top_return_drag_avg_late_risk: 0.26,
        top_return_drag_avg_failure_risk: 0.57,
        top_mixed_avg_ev_lb: 0.43,
        top_mixed_avg_delay_cost: 0.51,
        top_mixed_avg_late_risk: 0.42,
        top_mixed_avg_failure_risk: 0.28,
      },
    },
  });

  assert.strictEqual(report.status, "ML_EV_PROFILE_REVIEW_TRACKING_READY");
  assert.strictEqual(report.review_mode, "PROFILE_CONDITIONAL_REVIEW");
  assert.strictEqual(report.target_n, 2);
  assert.strictEqual(report.split_ready, false);
  assert.strictEqual(report.split_blocker, "PROFILE_REALIZED_DELTA_TOO_SMALL");
  assert.strictEqual(report.targets[0].driver, "FAILURE_RISK_HEAVY");
  assert.strictEqual(report.targets[1].driver, "DELAY_LATE_RISK_HEAVY");
  console.log("ML_EV_PROFILE_REVIEW_TRACKING_TEST_OK");
})();
