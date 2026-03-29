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
      objectiveSupervisor: { cycle_id: "cycle-1", verdict: "PATCH_CANDIDATE", reason: "AUTO_PROMOTION_READY" },
      candidates: { cycle_id: "cycle-1", summary: { ready_n: 1, blocked_n: 0, top_candidate_id: "AUTO_CORE" } },
      replay: { cycle_id: "cycle-1", summary: { pass_n: 1, block_n: 0, best_candidate_id: "AUTO_CORE" } },
      canary: { cycle_id: "cycle-1", summary: { apply_pass: true, open_wave: 1, blocked_n: 0 } },
      deployment: { cycle_id: "cycle-1", summary: { deploy_pass: true, target_candidate_id: "AUTO_CORE", blockers: [] } },
      deploymentPlan: { cycle_id: "cycle-1", summary: { plan_status: "READY_FOR_MANUAL_PASTE", manual_step_required: true, target_candidate_id: "AUTO_CORE" } },
      stageAutopilot: { cycle_id: "cycle-1", objective_verdict: "PATCH_CANDIDATE", actions: [] },
      weightTuning: { cycle_id: "cycle-1", summary: { advisory_mode: "HOLD", suggestion_n: 0, canary_blocked: false } },
      memory: { cycle_id: "cycle-1", summary: { blocked_candidate_n: 0, top_failed_candidate_id: null } },
      codexPatch: { cycle_id: "cycle-1", verdict: "PROMOTE", recommended_candidate_id: "AUTO_CORE" },
    },
  });

  assert.strictEqual(report.summary.overall_status, "READY_FOR_MANUAL_PASTE");
  assert.strictEqual(report.summary.manual_paste_ready, true);
  assert.strictEqual(report.summary.ready_candidate_id, "AUTO_CORE");
  assert.strictEqual(report.summary.cycle_consistent, true);

  const mismatch = deriveLoopMonitor({
    artifacts: {
      objectiveSupervisor: { fresh: true },
      candidates: { fresh: true },
    },
    reports: {
      objectiveSupervisor: { cycle_id: "cycle-a", verdict: "HOLD", reason: "X" },
      candidates: { cycle_id: "cycle-b", summary: { ready_n: 0, blocked_n: 1, top_candidate_id: "AUTO_CORE" } },
    },
  });
  assert.strictEqual(mismatch.summary.cycle_consistent, false);
  assert.strictEqual(mismatch.summary.overall_status, "BLOCKED");
  console.log("BEST_SELF_EVOLUTION_LOOP_MONITOR_TEST_OK");
})();
