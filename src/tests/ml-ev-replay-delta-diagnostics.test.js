"use strict";

const assert = require("assert");
const { buildMlEvReplayDeltaDiagnostics } = require("../utils/mlEvReplayDeltaDiagnostics");

(() => {
  const report = buildMlEvReplayDeltaDiagnostics({
    replay: {
      summary: {
        best_candidate_id: "EV_TP1_THRESHOLD_TUNE",
      },
      validations: [
        {
          candidate_id: "EV_TP1_THRESHOLD_TUNE",
          display_candidate_id: "EV_COMPOSITE_THRESHOLD_TUNE",
          validation_verdict: "WARN",
          candidate_objective_delta: -0.0584,
          projected_objective_score: -8.3188,
          count_delta: 0.0635,
          avg_ret_net_delta: -0.0012,
          historical_applied_n: 4,
          blockers: [],
          before_metrics: { avg_ret_net: 0.0006, win_rate: 0.4286 },
          after_metrics: { avg_ret_net: -0.0006, win_rate: 0.3889 },
          market_objective_deltas: [
            { market: "DOGEUSDT", candidate_objective_delta: 2.715 },
            { market: "AXSUSDT", candidate_objective_delta: 0.7859 },
            { market: "SOLUSDT", candidate_objective_delta: 0.5153 },
            { market: "BNBUSDT", candidate_objective_delta: -1.25 },
          ],
        },
      ],
    },
    evReplaySampleGap: {
      summary: {
        historical_applied_gap_n: 4,
      },
    },
  });

  assert.strictEqual(report.status, "ML_EV_REPLAY_DELTA_DIAGNOSTICS_READY");
  assert.strictEqual(report.driver_class, "COUNT_UP_RETURN_DOWN");
  assert.strictEqual(report.historical_applied_gap_role, "REFERENCE_ONLY");
  assert.strictEqual(report.top_positive_market, "DOGEUSDT");
  assert.strictEqual(report.top_negative_market, "BNBUSDT");

  console.log("ML_EV_REPLAY_DELTA_DIAGNOSTICS_TEST_OK");
})();
