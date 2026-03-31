"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-deployment-plan");

(() => {
  const cycleId = __test.resolveReportCycleId({
    objectiveSupervisor: { source_cycle_id: "cycle-source", cycle_id: "cycle-objective" },
    runtimeState: { cycle_id: "cycle-runtime" },
    fallbackCycleId: "cycle-fallback",
  });
  assert.strictEqual(cycleId, "cycle-source");
})();

(() => {
  const md = __test.renderMarkdown({
    generated_at_kst: "2026-03-29 21:00:00 KST",
    summary: {
      plan_status: "READY_FOR_MANUAL_PASTE",
      display_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
      prepare_pass: true,
      ready_for_manual_paste: true,
      manual_step_required: true,
      open_wave: 1,
      target_wave: 1,
      market_scope_ready_n: 1,
      market_scope_blocked_n: 0,
      market_scope_n: 1,
      prepared_file_path: "/tmp/prepared.pine",
      latest_generated_file_path: "/tmp/latest.pine",
      blockers: [],
    },
    rows: [{ market: "BTCUSDT", wave: 1, canary_verdict: "READY", current_stage: "SOFT", blockers: [] }],
    handoff: { checklist: ["paste file"] },
  });
  assert.ok(md.includes("READY_FOR_MANUAL_PASTE"));
  assert.ok(md.includes("/tmp/prepared.pine"));
  assert.ok(md.includes("BTCUSDT"));
  console.log("BEST_SELF_EVOLUTION_DEPLOYMENT_PLAN_REPORT_TEST_OK");
})();
