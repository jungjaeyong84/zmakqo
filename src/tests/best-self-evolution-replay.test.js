"use strict";

const assert = require("assert");
const { deriveCandidateObjectiveDelta, buildReplayValidationReport } = require("../../src/utils/bestSelfEvolutionReplay");

function run() {
  const candidate = {
    candidate_id: "WAIT_ONE_BAR_TUNE",
    display_candidate_id: "WAIT_ONE_BAR_TUNE",
    scope: "WAIT",
    direction: "LOOSEN",
    markets: ["DOGEUSDT"],
    risk_flags: [],
    count_guard_effect: { projected_count_ratio_global: 1.02, tightening_allowed: true },
    replacement_effect: { projected_replacement_ratio: 0.9, recovery_priority: false },
    evidence: { support_n: 18, support_rate: 0.62, rationale: "late loss recovery" },
  };
  const objective = {
    objective_score: 1.2,
    count_floor_pass: true,
    replacement_floor_pass: true,
    latency_budget_pass: true,
  };
  const attribution = {
    late_loss_top_market: { key: "DOGEUSDT", count: 5 },
    false_fire_top_market: { key: "ETHUSDT", count: 2 },
  };
  const result = deriveCandidateObjectiveDelta(candidate, { objective, attribution });
  assert.strictEqual(result.validation_verdict, "PASS");
  assert.strictEqual(result.projected_objective_score > result.current_objective_score, true);

  const report = buildReplayValidationReport({
    candidateChangeSet: {
      rows: [
        candidate,
        {
          candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
          display_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
          scope: "PINE",
          direction: "TIGHTEN",
          markets: ["ALL"],
          risk_flags: ["COUNT_GUARD_ACTIVE"],
          count_guard_effect: { projected_count_ratio_global: 0.95, tightening_allowed: false },
          replacement_effect: { projected_replacement_ratio: 0.6, recovery_priority: true },
          evidence: { priority_score: 0.5, avg_dropped_ret_net: -0.01, rationale: "tighten pine" },
        },
      ],
    },
    objective,
    attribution,
  });
  assert.strictEqual(report.summary.total_n, 2);
  assert.strictEqual(report.summary.pass_n, 1);
  assert.strictEqual(report.summary.block_n, 1);
  assert.strictEqual(report.summary.best_candidate_id, "WAIT_ONE_BAR_TUNE");

  console.log("BEST_SELF_EVOLUTION_REPLAY_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("BEST_SELF_EVOLUTION_REPLAY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
