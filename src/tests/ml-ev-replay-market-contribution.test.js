"use strict";

const assert = require("assert");
const { buildMlEvReplayMarketContribution } = require("../utils/mlEvReplayMarketContribution");

(() => {
  const report = buildMlEvReplayMarketContribution({
    replay: {
      summary: {
        best_candidate_id: "EV_TP1_THRESHOLD_TUNE",
      },
      validations: [
        {
          candidate_id: "EV_TP1_THRESHOLD_TUNE",
          display_candidate_id: "EV_COMPOSITE_THRESHOLD_TUNE",
          candidate_objective_delta: -0.0584,
          count_delta: 0.0635,
          avg_ret_net_delta: -0.0012,
          before_metrics: { avg_ret_net: 0.0006 },
          after_metrics: { avg_ret_net: -0.0006 },
          market_objective_deltas: [
            { market: "DOGEUSDT", candidate_objective_delta: 2.715, count_delta: 0.1429, avg_ret_net_delta: 0.0086 },
            { market: "SOLUSDT", candidate_objective_delta: 0.5153, count_delta: 0.125, avg_ret_net_delta: -0.0023 },
            { market: "XRPUSDT", candidate_objective_delta: 0.0273, count_delta: 0.0667, avg_ret_net_delta: -0.0037 },
            { market: "ETHUSDT", candidate_objective_delta: 0, count_delta: 0, avg_ret_net_delta: 0 },
          ],
        },
      ],
    },
    mlEvReplayDeltaDiagnostics: {
      summary: {
        driver_class: "COUNT_UP_RETURN_DOWN",
      },
    },
  });

  assert.strictEqual(report.status, "ML_EV_REPLAY_MARKET_CONTRIBUTION_READY");
  assert.strictEqual(report.driver_class, "COUNT_UP_RETURN_DOWN");
  assert.strictEqual(report.positive_objective_market_n, 3);
  assert.strictEqual(report.flat_objective_market_n, 1);
  assert.strictEqual(report.return_drag_market_n, 2);
  assert.strictEqual(report.count_up_return_down_market_n, 2);
  assert.strictEqual(report.positive_objective_with_return_drag_market_n, 2);
  assert.strictEqual(report.dominant_drag_pattern, "POSITIVE_OBJECTIVE_WITH_RETURN_DRAG");
  assert.strictEqual(report.top_positive_market, "DOGEUSDT");
  assert.strictEqual(report.top_return_drag_market, "XRPUSDT");
  assert.strictEqual(report.top_mixed_market, "SOLUSDT");

  console.log("ML_EV_REPLAY_MARKET_CONTRIBUTION_TEST_OK");
})();
