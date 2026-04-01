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

(() => {
  const report = deriveOpenClawAutonomyContract({
    objective: { global_objective_score: { objective_score: -1.2, snapshot: { win_rate: 0.5 } } },
    objectiveSupervisor: {
      display: {
        objective: { monthly_run_rate_krw: 1000 },
        self_evolution_objective: { objective_score: -1.2, win_rate: 0.5 },
      },
    },
    deploymentPlan: { summary: { plan_status: "APPLIED_ACTIVE", authority_state: "APPROVED", external_authority_pending: false, authority_approved: true } },
    serverPrimaryCanary: { summary: { acceptance_ready: false, acceptance_reason: "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT", server_primary_executed_n: 0, pine_shadow_disagreement_rate: 0, rollback_trigger_n: 0 } },
    watchdog: { display: { verdict: "PASS", scheduler_mode: "OPENCLAW_CRON" } },
  });

  assert.strictEqual(report.current_status.authority_pending, false);
  assert.strictEqual(report.current_status.authority_state, "APPROVED");
  assert.strictEqual(report.summary.authority_state, "APPROVED");
})();

(() => {
  const report = deriveOpenClawAutonomyContract({
    objective: { global_objective_score: { objective_score: -0.4, snapshot: { win_rate: 0.58 } } },
    objectiveSupervisor: {
      display: {
        objective: { monthly_run_rate_krw: 1200000 },
        self_evolution_objective: { objective_score: -0.4, win_rate: 0.58 },
      },
    },
    deploymentPlan: { summary: { plan_status: "APPLIED_ACTIVE", authority_state: "APPROVED", external_authority_pending: false } },
    serverPrimaryCanary: { summary: { acceptance_ready: false, acceptance_reason: "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT", server_primary_executed_n: 1, pine_shadow_disagreement_rate: 0.08, rollback_trigger_n: 0 } },
    watchdog: { display: { verdict: "PASS", scheduler_mode: "OPENCLAW_CRON" } },
    serverSignalAuthority: { summary: { source_mode: "PINE_PRIMARY", drift_status: "PARITY_WATCH", authoritative_server_24h_n: 12, pine_shadow_24h_n: 2 } },
    serverSignalQuality: { summary: { quality_status: "WATCH_PARITY_DRIFT", authoritative_entry_signal_24h_n: 10, order_intent_24h_n: 4, fill_24h_n: 3 } },
  });

  assert.strictEqual(report.current_status.server_signal_source_mode, "PINE_PRIMARY");
  assert.strictEqual(report.current_status.server_signal_quality_status, "WATCH_PARITY_DRIFT");
  assert.strictEqual(report.summary.server_signal_transition_status, "IN_PROGRESS");
  assert.strictEqual(report.summary.server_signal_transition_progress_pct, 88);
  assert.strictEqual(Array.isArray(report.server_signal_transition.phases), true);
  assert.strictEqual(report.server_signal_transition.phases.length, 4);
})();
