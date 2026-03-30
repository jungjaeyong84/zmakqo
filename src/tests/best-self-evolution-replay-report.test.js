const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-replay");

function run() {
  const markdown = __test.renderMarkdown({
    generated_at_kst: "2026-03-29 19:47:00 KST",
    validation_mode: "HISTORICAL_ENTRY_COHORT_V1",
    summary: {
      total_n: 3,
      pass_n: 1,
      warn_n: 1,
      block_n: 1,
      best_candidate_id: "WAIT_ONE_BAR_TUNE",
      best_verdict: "PASS",
      best_objective_delta: 0.6251,
    },
    validations: [
      {
        candidate_id: "WAIT_ONE_BAR_TUNE",
        validation_verdict: "PASS",
        candidate_objective_delta: 0.6251,
        market_objective_deltas: [
          { market: "BTCUSDT", candidate_objective_delta: 0.8123 },
        ],
        projected_objective_score: -4.0123,
        historical_match_n: 4,
        historical_applied_n: 2,
        blockers: [],
        risk_flags: ["NOT_READY"],
      },
    ],
  });

  assert.match(markdown, /BEST Self-Evolution Replay Validation/);
  assert.match(markdown, /total\/pass\/warn\/block: 3 \/ 1 \/ 1 \/ 1/);
  assert.match(markdown, /WAIT_ONE_BAR_TUNE: PASS \/ delta=0.6251/);
  assert.match(markdown, /top_market=BTCUSDT:0.8123/);
  console.log("BEST_SELF_EVOLUTION_REPLAY_REPORT_TEST_OK");
}

run();
