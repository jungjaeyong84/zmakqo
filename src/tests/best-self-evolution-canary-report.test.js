const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-canary");

function run() {
  const markdown = __test.renderMarkdown({
    generated_at_kst: "2026-03-29 20:10:00 KST",
    summary: {
      total_n: 2,
      shadow_n: 1,
      soft_n: 1,
      hard_n: 0,
      ready_n: 1,
      blocked_n: 1,
      rollback_ready_n: 0,
      apply_pass: true,
      global_canary_pass: true,
      current_open_wave: 1,
      open_wave: 2,
      scale_allowed: true,
      scale_block_reason: null,
      next_wave_candidate: 3,
      top_ready_market: "BTCUSDT",
      top_rollback_market: null,
    },
    rows: [
      {
        market: "BTCUSDT",
        wave: 1,
        previous_stage: "SHADOW",
        current_stage: "SOFT",
        canary_action: "PROMOTE_SOFT",
        canary_verdict: "READY",
        candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
        replay_verdict: "PASS",
        objective_score: 0.4,
        blockers: [],
      },
    ],
  });
  assert.match(markdown, /BEST Self-Evolution Market Canary/);
  assert.match(markdown, /total\/shadow\/soft\/hard: 2 \/ 1 \/ 1 \/ 0/);
  assert.match(markdown, /wave open\/current\/next: 2 \/ 1 \/ 3/);
  assert.match(markdown, /BTCUSDT: wave=1 \/ stage SHADOW -> SOFT/);
  console.log("BEST_SELF_EVOLUTION_CANARY_REPORT_TEST_OK");
}

run();
