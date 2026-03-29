"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-memory-ledger");

(() => {
  const markdown = __test.renderMarkdown({
    generated_at_kst: "2026-03-29 20:40:00 KST",
    summary: {
      total_n: 3,
      current_n: 2,
      success_n: 1,
      neutral_n: 1,
      fail_n: 1,
      rolled_back_n: 0,
      blocked_candidate_n: 1,
      top_success_candidate_id: "WAIT_ONE_BAR_TUNE",
      top_failed_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
      blocked_candidate_ids: ["AUTO_CORE_REGIME_TIGHTEN"],
      avg_objective_delta: 0.15,
      avg_count_delta: 0.01,
      avg_replacement_delta: 0.03,
      avg_ret_net_delta: 0.02,
    },
    current_rows: [
      {
        candidate_id: "WAIT_ONE_BAR_TUNE",
        verdict: "SUCCESS",
        scope: "WAIT",
        applied_week_key: "2026W13",
        objective_delta: 0.7,
        count_delta: 0.02,
        replacement_delta: 0.12,
        avg_ret_net_delta: 0.02,
        memory_blocked: false,
        memory_block_reason: null,
        rollback_reason: null,
      },
    ],
  });
  assert.match(markdown, /BEST Self-Evolution Memory Ledger/);
  assert.match(markdown, /total\/current: 3 \/ 2/);
  assert.match(markdown, /blocked candidates: AUTO_CORE_REGIME_TIGHTEN/);
  assert.match(markdown, /WAIT_ONE_BAR_TUNE: verdict=SUCCESS/);
  console.log("BEST_SELF_EVOLUTION_MEMORY_LEDGER_REPORT_TEST_OK");
})();
