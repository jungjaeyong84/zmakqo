"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-deployment-guards");

(() => {
  const markdown = __test.renderMarkdown({
    generated_at_kst: "2026-03-29 23:00:00 KST",
    summary: {
      target_candidate_id: "WAIT_ONE_BAR_TUNE",
      deploy_pass: true,
      rollback_only: false,
      replay_verdict: "PASS",
      canary_open_wave: 2,
      market_ready_n: 2,
      market_total_n: 3,
      memory_blocked_candidate_n: 0,
      blockers: [],
    },
    rows: [
      { market: "BTCUSDT", wave: 1, current_stage: "SOFT", deploy_pass: true, candidate_id: "WAIT_ONE_BAR_TUNE", blockers: [] },
    ],
  });
  assert.match(markdown, /BEST Self-Evolution Deployment Guards/);
  assert.match(markdown, /target: WAIT_ONE_BAR_TUNE/);
  assert.match(markdown, /deploy_pass: YES/);
  assert.match(markdown, /BTCUSDT: wave=1 \/ stage=SOFT/);
  console.log("BEST_SELF_EVOLUTION_DEPLOYMENT_GUARDS_REPORT_TEST_OK");
})();
