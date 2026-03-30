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
  const deploymentRow = report.rows.find((row) => row.loop === "DEPLOYMENT_GUARDS");
  assert.ok(deploymentRow);
  assert.strictEqual(deploymentRow.status, "PASS");

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

  const holdDeployment = deriveLoopMonitor({
    artifacts: {
      objectiveSupervisor: { fresh: true },
      deployment: { fresh: true },
    },
    reports: {
      objectiveSupervisor: { cycle_id: "cycle-h", verdict: "HOLD", reason: "DAILY_NO_TRADE_ACTIVITY" },
      deployment: { cycle_id: "cycle-h", summary: { deploy_pass: false, target_candidate_id: "AUTO_CORE", blockers: [] } },
    },
  });
  const holdDeploymentRow = holdDeployment.rows.find((row) => row.loop === "DEPLOYMENT_GUARDS");
  assert.ok(holdDeploymentRow);
  assert.strictEqual(holdDeploymentRow.status, "HOLD");
  assert.strictEqual(holdDeploymentRow.reason, "none");

  const pendingStage = deriveLoopMonitor({
    artifacts: {
      objectiveSupervisor: { fresh: true },
      stageAutopilot: { fresh: true },
      memory: { fresh: true },
    },
    reports: {
      objectiveSupervisor: { cycle_id: "cycle-new", verdict: "HOLD", reason: "DAILY_NO_TRADE_ACTIVITY", evaluation_scope: "LOOP" },
      stageAutopilot: { cycle_id: "cycle-old", objective_verdict: "HOLD", actions: [] },
      memory: { cycle_id: "cycle-new", summary: { blocked_candidate_n: 2, blocked_candidate_ids: ["AI_AI", "WAIT_ONE_BAR_TUNE"], top_failed_candidate_id: "EV_TP1_THRESHOLD_TUNE" } },
    },
  });
  const stageRow = pendingStage.rows.find((row) => row.loop === "STAGE_AUTOPILOT");
  const memoryRow = pendingStage.rows.find((row) => row.loop === "MEMORY_LEDGER");
  assert.ok(stageRow);
  assert.strictEqual(stageRow.status, "PENDING");
  assert.strictEqual(stageRow.cycle_id, null);
  assert.strictEqual(stageRow.source_cycle_id, "cycle-old");
  assert.strictEqual(stageRow.reason, "post_stage_pending / latest=cycle-old");
  assert.ok(memoryRow);
  assert.strictEqual(memoryRow.reason, "blocked=2 / ids=AI_AI|WAIT_ONE_BAR_TUNE");

  const absent = deriveLoopMonitor({
    artifacts: {
      objectiveSupervisor: { fresh: true },
      codexPatch: { fresh: true },
    },
    reports: {
      objectiveSupervisor: { cycle_id: "cycle-z", verdict: "HOLD", reason: "X" },
      codexPatch: { verdict: "HOLD", recommended_candidate_id: null },
    },
  });
  assert.strictEqual(absent.summary.cycle_id_absent_n, 1);
  assert.strictEqual(absent.summary.overall_status, "BLOCKED");
  assert.ok(absent.summary.critical_blockers.includes("SELF_EVOLUTION_CYCLE_ID_ABSENT"));
  console.log("BEST_SELF_EVOLUTION_LOOP_MONITOR_TEST_OK");
})();
