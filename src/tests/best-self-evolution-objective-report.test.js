"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-objective");

function run() {
  const markdown = __test.renderMarkdown({
    generated_at_kst: "2026-03-29 21:00:00 KST",
    dataset_path: "/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_dataset_latest.json",
    global_objective_score: {
      objective_score: 3.2145,
      constraints: {
        count_floor_pass: true,
        replacement_floor_pass: false,
        latency_budget_pass: true,
      },
      components: {
        profit_score: 2.1,
        count_score: 0.9,
        replacement_score: -0.2,
        tp1_score: 0.7,
        drawdown_penalty: 0.1,
        latency_penalty: 0.05,
        instability_penalty: 0.1355,
      },
      snapshot: {
        fire_win_rate: 0.58,
        tp1_first_rate: 0.61,
        projected_count_ratio_global: 0.98,
        projected_replacement_ratio: 0.74,
      },
    },
    market_objective_scores: [
      {
        market: "BTCUSDT",
        objective_score: 4.5,
        mode: "NORMAL",
        win_rate: 0.61,
        tp1_first_rate: 0.66,
        projected_count_ratio_global: 1.02,
        projected_replacement_ratio: 0.95,
      },
      {
        market: "DOGEUSDT",
        objective_score: -0.8,
        mode: "COUNT_GUARD_ACTIVE",
        win_rate: 0.45,
        tp1_first_rate: 0.42,
        projected_count_ratio_global: 0.85,
        projected_replacement_ratio: 0.50,
      },
    ],
  });

  assert.ok(markdown.includes("BEST Self-Evolution Objective Score"));
  assert.ok(markdown.includes("objective_score: +3.2145"));
  assert.ok(markdown.includes("replacement floor: FAIL"));
  assert.ok(markdown.includes("BTCUSDT: score +4.5000"));
  assert.ok(markdown.includes("DOGEUSDT: score -0.8000"));

  console.log("BEST_SELF_EVOLUTION_OBJECTIVE_REPORT_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("BEST_SELF_EVOLUTION_OBJECTIVE_REPORT_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
