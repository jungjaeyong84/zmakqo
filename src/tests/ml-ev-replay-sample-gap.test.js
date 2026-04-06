"use strict";

const assert = require("assert");
const { buildMlEvReplaySampleGap } = require("../utils/mlEvReplaySampleGap");

(() => {
  const blocked = buildMlEvReplaySampleGap({
    objectiveSupervisor: {
      raw: {
        sample_readiness: {
          governance_realized_n: 1,
          governance_monthly_source_realized_n: 7,
          governance_effective_realized_n: 7,
          governance_realized_min_sample: 8,
        },
      },
    },
    replayEvidence: {
      summary: {
        dominant_issue: "EV_TUNER_INSUFFICIENT_SAMPLE",
        best_candidate_id: "EV_TP1_THRESHOLD_TUNE",
        best_display_candidate_id: "EV_COMPOSITE_THRESHOLD_TUNE",
        best_historical_realized_match_n: 13,
        best_historical_applied_n: 4,
      },
    },
  });

  assert.strictEqual(blocked.status, "ML_EV_REPLAY_SAMPLE_GAP_READY");
  assert.strictEqual(blocked.sample_gap_ready, false);
  assert.strictEqual(blocked.evidence_status, "EV_REPLAY_SAMPLE_GAP");
  assert.strictEqual(blocked.governance_effective_gap_n, 1);
  assert.strictEqual(blocked.historical_applied_gap_n, 4);
  assert.strictEqual(blocked.historical_realized_match_gap_n, 0);
  assert.strictEqual(blocked.dominant_sample_dimension, "GOVERNANCE_EFFECTIVE_REALIZED");

  const ready = buildMlEvReplaySampleGap({
    objectiveSupervisor: {
      raw: {
        sample_readiness: {
          governance_realized_n: 8,
          governance_monthly_source_realized_n: 9,
          governance_effective_realized_n: 9,
          governance_realized_min_sample: 8,
        },
      },
    },
    replayEvidence: {
      summary: {
        dominant_issue: "NONE",
        best_historical_realized_match_n: 12,
        best_historical_applied_n: 9,
      },
    },
  });

  assert.strictEqual(ready.sample_gap_ready, true);
  assert.strictEqual(ready.evidence_status, "EV_REPLAY_SAMPLE_READY");

  console.log("ML_EV_REPLAY_SAMPLE_GAP_TEST_OK");
})();
