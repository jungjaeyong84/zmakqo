"use strict";

const assert = require("assert");
const { deriveOpenClawAutonomyContract } = require("../../src/utils/openclawAutonomyContract");

(() => {
  const report = deriveOpenClawAutonomyContract({
    objective: { global_objective_score: { objective_score: -7.4, snapshot: { win_rate: 0.44 } } },
    objectiveSupervisor: {
      display: {
        objective: { monthly_run_rate_krw: -436.19 },
        self_evolution_objective: { objective_score: -7.4, win_rate: 0.44 },
      },
    },
    deploymentPlan: { summary: { plan_status: "APPLIED_ACTIVE_PENDING_AUTHORITY", authority_state: "PENDING", external_authority_pending: true } },
    serverPrimaryCanary: { summary: { acceptance_ready: false, acceptance_reason: "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT", server_primary_executed_n: 0, pine_shadow_disagreement_rate: 0, rollback_trigger_n: 0 } },
    watchdog: { display: { verdict: "PASS", scheduler_mode: "OPENCLAW_CRON" } },
  });

  assert.strictEqual(report.current_status.objective_score, -7.4);
  assert.strictEqual(report.current_status.monthly_run_rate_krw, -436.19);
  assert.strictEqual(report.current_status.win_rate, 0.44);
  assert.strictEqual(report.summary.goal_state, "OBJECTIVE_RECOVERY_REQUIRED");
  assert.strictEqual(report.summary.authority_state, "PENDING");
  assert.strictEqual(report.summary.phase_d_status, "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT");
  assert.strictEqual(report.summary.ops_status, "PASS");
  assert.strictEqual(report.authority_policy.degraded_timeout_policy.enabled, true);
  console.log("OPENCLAW_AUTONOMY_CONTRACT_TEST_OK");
})();
