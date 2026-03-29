const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-candidates");

function run() {
  const markdown = __test.renderMarkdown({
    generated_at_kst: "2026-03-29 19:47:00 KST",
    summary: {
      total_n: 3,
      ready_n: 1,
      blocked_n: 1,
      memory_blocked_n: 1,
      failed_fingerprint_repeat_n: 0,
      by_scope: { PINE: 1, EV: 1, WAIT: 1 },
      top_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
      top_scope: "PINE",
    },
    rows: [
      {
        candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
        scope: "PINE",
        direction: "TIGHTEN",
        status: "WATCHLIST_TIGHTEN",
        ready_for_auto_apply: false,
        count_guard_effect: { projected_count_ratio_global: 1.0 },
        replacement_effect: { projected_replacement_ratio: 0.82 },
        risk_flags: ["NOT_READY"],
      },
    ],
  });

  assert.match(markdown, /BEST Self-Evolution Candidate Change Sets/);
  assert.match(markdown, /total\/ready\/blocked: 3 \/ 1 \/ 1/);
  assert.match(markdown, /memory_blocked\/fingerprint_repeat: 1 \/ 0/);
  assert.match(markdown, /AUTO_CORE_REGIME_TIGHTEN: PINE\/TIGHTEN/);
  console.log("BEST_SELF_EVOLUTION_CANDIDATES_REPORT_TEST_OK");
}

run();
