"use strict";

const assert = require("assert");
const { deriveDeploymentPlan } = require("../../src/utils/bestSelfEvolutionDeploymentPlan");

(() => {
  const report = deriveDeploymentPlan({
    objectiveSupervisor: {
      promotion: { ready: true, candidate_id: "AUTO_CORE_REGIME_TIGHTEN", display_candidate_id: "AUTO_CORE_REGIME_TIGHTEN" },
      rollback: { ready: false },
      self_evolution_deployment: { deploy_pass: true },
    },
    changeControl: {},
    codexPatchReview: { verdict: "PROMOTE", recommended_candidate_id: "AUTO_CORE_REGIME_TIGHTEN" },
    deploymentGuards: { summary: { deploy_pass: true, target_candidate_id: "AUTO_CORE_REGIME_TIGHTEN", canary_open_wave: 1 } },
    canaryReport: {
      summary: { open_wave: 1 },
      rows: [
        { candidate_id: "AUTO_CORE_REGIME_TIGHTEN", market: "BTCUSDT", wave: 1, canary_verdict: "READY", current_stage: "SOFT", blockers: [] },
      ],
    },
    stageAutopilot: {
      raw: {
        stage_rows: [
          {
            stage: "PINE",
            machine_state: "READY",
            prepared_file_path: "/tmp/prepared.pine",
            latest_generated_file_path: "/tmp/latest.pine",
            rollback_source_file_path: "/tmp/rollback.pine",
            signature: "AUTO_CORE_REGIME_TIGHTEN",
          },
        ],
      },
    },
    weeklyHistory: {
      weeks: [
        {
          week_key: "2026W13",
          recommended_patch_id: "AUTO_CORE_REGIME_TIGHTEN",
          created_file_path: "/tmp/prepared.pine",
          latest_generated_file_path: "/tmp/latest.pine",
          rollback_source_file_path: "/tmp/rollback.pine",
        },
      ],
    },
  });

  assert.strictEqual(report.summary.plan_status, "READY_FOR_MANUAL_PASTE");
  assert.strictEqual(report.summary.manual_step_required, true);
  assert.strictEqual(report.summary.prepared_file_path, "/tmp/prepared.pine");
  assert.strictEqual(report.summary.market_scope_ready_n, 1);
  assert.strictEqual(report.handoff.checklist.length > 0, true);
  console.log("BEST_SELF_EVOLUTION_DEPLOYMENT_PLAN_TEST_OK");
})();
