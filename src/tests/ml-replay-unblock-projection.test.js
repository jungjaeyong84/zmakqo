"use strict";

const assert = require("assert");
const { buildMlReplayUnblockProjection } = require("../utils/mlReplayUnblockProjection");

(() => {
  const blocked = buildMlReplayUnblockProjection({
    replayEvidence: {
      summary: {
        evidence_status: "REPLAY_WARN_INSUFFICIENT_SAMPLE",
        dominant_issue: "EV_TUNER_INSUFFICIENT_SAMPLE",
        best_objective_delta: -0.0584,
        blocking_reasons: [
          "REPLAY_VERDICT_WARN",
          "REPLAY_ISSUE_EV_TUNER_INSUFFICIENT_SAMPLE",
          "REPLAY_OBJECTIVE_DELTA_NOT_POSITIVE",
        ],
      },
    },
    evReplaySampleGap: {
      summary: {
        governance_effective_gap_n: 1,
      },
    },
  });

  assert.strictEqual(blocked.status, "ML_REPLAY_UNBLOCK_PROJECTION_READY");
  assert.strictEqual(blocked.projected_replay_ready_if_sample_gap_closed, false);
  assert.strictEqual(blocked.projected_residual_issue_after_sample_gap_closed, "NEGATIVE_OBJECTIVE_DELTA");
  assert.ok(blocked.projected_residual_blocking_reasons.includes("REPLAY_OBJECTIVE_DELTA_NOT_POSITIVE"));

  const autoReady = buildMlReplayUnblockProjection({
    replayEvidence: {
      summary: {
        evidence_status: "REPLAY_WARN_INSUFFICIENT_SAMPLE",
        dominant_issue: "EV_TUNER_INSUFFICIENT_SAMPLE",
        best_objective_delta: 0.12,
        blocking_reasons: [
          "REPLAY_VERDICT_WARN",
          "REPLAY_ISSUE_EV_TUNER_INSUFFICIENT_SAMPLE",
        ],
      },
    },
    evReplaySampleGap: {
      summary: {
        governance_effective_gap_n: 1,
      },
    },
  });

  assert.strictEqual(autoReady.projected_replay_ready_if_sample_gap_closed, true);
  assert.strictEqual(autoReady.evidence_status, "REPLAY_UNBLOCK_PROJECTION_AUTO_READY");

  console.log("ML_REPLAY_UNBLOCK_PROJECTION_TEST_OK");
})();
