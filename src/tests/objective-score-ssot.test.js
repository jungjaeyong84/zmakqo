"use strict";

const assert = require("assert");
const { deriveObjectiveRecoveryGovernor } = require("../../src/utils/objectiveRecoveryGovernor");
const { deriveObjectiveRecoveryEffect } = require("../../src/utils/objectiveRecoveryEffect");
const { deriveOpenClawAutonomyContract } = require("../../src/utils/openclawAutonomyContract");
const { derivePolicyParameterEvolutionPlan } = require("../../src/utils/policyParameterEvolutionPlan");

(() => {
  const objective = { global_objective_score: { objective_score: -4.75, monthly_run_rate_krw: 1200, snapshot: { win_rate: 0.51 } } };
  const objectiveSupervisor = {
    self_evolution_objective: { objective_score: -3.5 },
    objective: { objective_score: -3.5 },
    promotion: { display_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN", replay_verdict: "PASS" },
  };

  const autonomyContract = deriveOpenClawAutonomyContract({
    objective,
    objectiveSupervisor,
    deploymentPlan: { summary: { plan_status: "APPLIED_ACTIVE_PENDING_AUTHORITY", authority_state: "PENDING", external_authority_pending: true } },
    serverPrimaryCanary: { summary: { acceptance_ready: false, acceptance_reason: "SERVER_PRIMARY_ACCEPTANCE_SAMPLE_SHORT", server_primary_executed_n: 0, pine_shadow_disagreement_rate: 0, rollback_trigger_n: 0 } },
    watchdog: { display: { verdict: "PASS", scheduler_mode: "OPENCLAW_CRON" } },
  });

  const governor = deriveObjectiveRecoveryGovernor({
    autonomyContract,
    objective,
    objectiveSupervisor,
    candidates: { rows: [{ candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN", target_deploy_unit: "SERVER_SETTINGS", canonical_migration_class: "PINE_THRESHOLD", memory_blocked: false }] },
    replay: { validations: [{ candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN", validation_verdict: "PASS" }] },
    canary: { summary: { apply_pass: true, ready_n: 1 } },
    deploymentGuards: { summary: { deploy_pass: true } },
    memory: { summary: { blocked_candidate_n: 0 } },
    serverPrimaryAcceptanceWatch: { summary: { phase_d_status: "PENDING", phase_d_ready: false } },
    watchdog: { display: { verdict: "PASS" } },
  });

  const effect = deriveObjectiveRecoveryEffect({
    autonomyContract,
    objective,
    objectiveSupervisor,
    objectiveRecoveryGovernor: governor,
    candidates: { rows: [{ candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN", display_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN", target_market: "AXSUSDT", ready_for_auto_apply: true, memory_blocked: false, failed_fingerprint_repeat: false }] },
    replay: { validations: [{ candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN", validation_verdict: "PASS", candidate_objective_delta: 1.2, projected_objective_score: -3.55 }] },
    retrospective: { periods: { MONTHLY: { objective: { failed_checks: [] }, drops: { top_reasons: [] } } } },
  });

  const plan = derivePolicyParameterEvolutionPlan({
    objective,
    objectiveSupervisor,
    autonomyContract,
    objectiveRecoveryGovernor: governor,
    objectiveRecoveryEffect: effect,
    executionQuality: { summary: { status: "EXECUTION_QUALITY_PASS" }, by_market: [] },
    serverMarketCapitalAllocator: { summary: { by_market: [] } },
    serverMarketQuarantine: { summary: { by_market: [] } },
    explorationApplyCandidate: { summary: { manual_confirm_required: false, auto_apply_allowed: false } },
  });

  assert.strictEqual(governor.summary.objective_score, -4.75);
  assert.strictEqual(effect.summary.current_objective_score, -4.75);
  assert.strictEqual(autonomyContract.current_status.objective_score, -4.75);
  assert.strictEqual(plan.summary.current_objective_score, -4.75);
  assert.strictEqual(governor.summary.objective_score_source, "OBJECTIVE");
  assert.strictEqual(effect.summary.current_objective_score_source, "OBJECTIVE");
  assert.strictEqual(autonomyContract.current_status.objective_score_source, "OBJECTIVE");
  assert.strictEqual(plan.summary.current_objective_score_source, "OBJECTIVE");
  console.log("OBJECTIVE_SCORE_SSOT_TEST_OK");
})();
