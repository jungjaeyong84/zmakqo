"use strict";

const assert = require("assert");
const { deriveLoopMonitor } = require("../../src/utils/bestSelfEvolutionLoopMonitor");

(() => {
  const report = deriveLoopMonitor({
    artifacts: {
      objectiveSupervisor: { fresh: true },
      candidates: { fresh: true },
      replay: { fresh: true },
      canary: { fresh: true },
      deployment: { fresh: true },
      deploymentPlan: { fresh: true },
      stageAutopilot: { fresh: true },
      weightTuning: { fresh: true },
      memory: { fresh: true },
      codexPatch: { fresh: true },
    },
    reports: {
      objectiveSupervisor: { verdict: "PATCH_CANDIDATE", reason: "AUTO_PROMOTION_READY" },
      candidates: { summary: { ready_n: 1, blocked_n: 0, top_candidate_id: "AUTO_CORE" } },
      replay: { summary: { pass_n: 1, block_n: 0, best_candidate_id: "AUTO_CORE" } },
      canary: { summary: { apply_pass: true, open_wave: 1, blocked_n: 0 } },
      deployment: { summary: { deploy_pass: true, target_candidate_id: "AUTO_CORE", blockers: [] } },
      deploymentPlan: { summary: { plan_status: "READY_FOR_MANUAL_PASTE", manual_step_required: true, target_candidate_id: "AUTO_CORE" } },
      stageAutopilot: { objective_verdict: "PATCH_CANDIDATE", actions: [] },
      weightTuning: { summary: { advisory_mode: "HOLD", suggestion_n: 0, canary_blocked: false } },
      memory: { summary: { blocked_candidate_n: 0, top_failed_candidate_id: null } },
      codexPatch: { verdict: "PROMOTE", recommended_candidate_id: "AUTO_CORE" },
    },
  });

  assert.strictEqual(report.summary.overall_status, "READY_FOR_MANUAL_PASTE");
  assert.strictEqual(report.summary.manual_paste_ready, true);
  assert.strictEqual(report.summary.ready_candidate_id, "AUTO_CORE");
  console.log("BEST_SELF_EVOLUTION_LOOP_MONITOR_TEST_OK");
})();
