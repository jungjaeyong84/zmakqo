"use strict";

const assert = require("assert");
const { buildMlReplayEvidence } = require("../utils/mlReplayEvidence");

(() => {
  const blocked = buildMlReplayEvidence({
    replay: {
      summary: {
        total_n: 2,
        pass_n: 0,
        warn_n: 1,
        block_n: 1,
        best_candidate_id: "EV_TP1_THRESHOLD_TUNE",
        best_verdict: "WARN",
      },
      validations: [
        {
          candidate_id: "EV_TP1_THRESHOLD_TUNE",
          display_candidate_id: "EV_COMPOSITE_THRESHOLD_TUNE",
          canonical_candidate_id: "EV_COMPOSITE_THRESHOLD_TUNE",
          ev_policy_review_mode: "PROFILE_CONDITIONAL_REVIEW",
          ev_profile_review_target_n: 2,
          ev_profile_top_return_drag_profile: "EARLY|LONG|PINE_DROP_STALE_POS_TO_ENTRY|PREPARE",
          ev_profile_top_return_drag_driver: "FAILURE_RISK_HEAVY",
          ev_profile_top_mixed_profile: "EARLY|SHORT|PINE_DROP_STALE_POS_TO_ENTRY|ARMED",
          ev_profile_top_mixed_driver: "DELAY_LATE_RISK_HEAVY",
          validation_verdict: "WARN",
          candidate_objective_delta: -0.0584,
          risk_flags: ["EV_TUNER_STALE", "EV_TUNER_INSUFFICIENT_SAMPLE"],
          blockers: [],
          summary: "INSUFFICIENT_SAMPLE",
          validation_mode: "HISTORICAL_ENTRY_COHORT_V1",
          historical_match_n: 174,
          historical_realized_match_n: 13,
          historical_applied_n: 4,
        },
      ],
    },
  });

  assert.strictEqual(blocked.status, "ML_REPLAY_EVIDENCE_READY");
  assert.strictEqual(blocked.replay_ready, false);
  assert.strictEqual(blocked.evidence_status, "REPLAY_WARN_INSUFFICIENT_SAMPLE");
  assert.strictEqual(blocked.dominant_issue, "EV_TUNER_INSUFFICIENT_SAMPLE");
  assert.strictEqual(blocked.best_candidate_review_mode, "PROFILE_CONDITIONAL_REVIEW");
  assert.strictEqual(blocked.best_candidate_profile_target_n, 2);
  assert.strictEqual(blocked.best_candidate_top_return_drag_driver, "FAILURE_RISK_HEAVY");
  assert.strictEqual(blocked.best_candidate_top_mixed_driver, "DELAY_LATE_RISK_HEAVY");
  assert.ok(blocked.blocking_reasons.includes("REPLAY_VERDICT_WARN"));

  const ready = buildMlReplayEvidence({
    replay: {
      summary: {
        total_n: 1,
        pass_n: 1,
        warn_n: 0,
        block_n: 0,
        best_candidate_id: "AUTO_WAIT",
        best_verdict: "PASS",
      },
      validations: [
        {
          candidate_id: "AUTO_WAIT",
          display_candidate_id: "AUTO_WAIT",
          validation_verdict: "PASS",
          candidate_objective_delta: 0.32,
          blockers: [],
          risk_flags: [],
        },
      ],
    },
  });

  assert.strictEqual(ready.replay_ready, true);
  assert.strictEqual(ready.evidence_status, "REPLAY_PASS_READY");

  console.log("ML_REPLAY_EVIDENCE_TEST_OK");
})();
