"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-loop-monitor");

(() => {
  const md = __test.renderMarkdown({
    generated_at_kst: "2026-03-29 21:00:00 KST",
    summary: {
      overall_status: "READY_FOR_MANUAL_PASTE",
      fresh_loop_n: 10,
      loop_n: 10,
      stale_artifacts: [],
      critical_blockers: [],
      promotion_path_ready: true,
      manual_paste_ready: true,
      ready_candidate_id: "AUTO_CORE",
      canary_open_wave: 1,
    },
    rows: [
      { loop: "DEPLOYMENT_PLAN", status: "READY_FOR_MANUAL_PASTE", fresh: true, reason: "candidate=AUTO_CORE" },
    ],
  });
  assert.ok(md.includes("READY_FOR_MANUAL_PASTE"));
  assert.ok(md.includes("AUTO_CORE"));
  console.log("BEST_SELF_EVOLUTION_LOOP_MONITOR_REPORT_TEST_OK");
})();
