"use strict";

const assert = require("assert");
const { deriveDeploymentGuards } = require("../../src/utils/bestSelfEvolutionDeploymentGuards");

(() => {
  const allow = deriveDeploymentGuards({
    objectiveSupervisor: {
      promotion: { ready: true, candidate_id: "WAIT_ONE_BAR_TUNE" },
      rollback: { ready: false },
      guards: { canary_pass: true },
      self_evolution_objective: {
        count_floor_pass: true,
        replacement_floor_pass: true,
        latency_budget_pass: true,
      },
    },
    replayReport: {
      validations: [{ candidate_id: "WAIT_ONE_BAR_TUNE", validation_verdict: "PASS" }],
    },
    canaryReport: {
      summary: { apply_pass: true, rollback_ready_n: 0, open_wave: 2 },
      rows: [{ market: "BTCUSDT", wave: 1, current_stage: "SOFT", candidate_id: "WAIT_ONE_BAR_TUNE", canary_verdict: "READY", blockers: [] }],
    },
    memoryLedger: {
      summary: { blocked_candidate_ids: [], blocked_candidate_n: 0 },
    },
  });
  assert.strictEqual(allow.summary.deploy_pass, true);
  assert.strictEqual(allow.summary.canary_open_wave, 2);
  assert.strictEqual(allow.summary.root_cause, null);
  assert.deepStrictEqual(allow.summary.next_actions, []);

  const blocked = deriveDeploymentGuards({
    objectiveSupervisor: {
      promotion: { ready: true, candidate_id: "AUTO_CORE_REGIME_TIGHTEN" },
      rollback: { ready: false },
      guards: { canary_pass: true },
      self_evolution_objective: {
        count_floor_pass: true,
        replacement_floor_pass: true,
        latency_budget_pass: true,
      },
    },
    replayReport: {
      validations: [{ candidate_id: "AUTO_CORE_REGIME_TIGHTEN", validation_verdict: "BLOCK" }],
    },
    canaryReport: {
      summary: { apply_pass: false, rollback_ready_n: 1, open_wave: 1, global_canary_pass: true },
      rows: [],
    },
    memoryLedger: {
      summary: { blocked_candidate_ids: ["AUTO_CORE_REGIME_TIGHTEN"], blocked_candidate_n: 1 },
    },
  });
  assert.strictEqual(blocked.summary.deploy_pass, false);
  assert.ok(blocked.summary.blockers.includes("SELF_EVOLUTION_REPLAY_NOT_PASS"));
  assert.ok(blocked.summary.blockers.includes("SELF_EVOLUTION_MEMORY_BLOCK"));
  assert.ok(blocked.summary.blockers.includes("SELF_EVOLUTION_CANARY_ROLLBACK_READY"));
  assert.strictEqual(blocked.summary.root_cause, "SELF_EVOLUTION_REPLAY_NOT_PASS");
  assert.strictEqual(blocked.summary.next_actions.some((row) => row.includes("Resolve replay blockers")), true);

  const explicitDriftBlock = deriveDeploymentGuards({
    objectiveSupervisor: {
      promotion: { ready: true, candidate_id: "WAIT_ONE_BAR_TUNE" },
      rollback: { ready: false },
      self_evolution_objective: {
        count_floor_pass: true,
        replacement_floor_pass: true,
        latency_budget_pass: true,
      },
    },
    replayReport: {
      validations: [{ candidate_id: "WAIT_ONE_BAR_TUNE", validation_verdict: "PASS" }],
    },
    canaryReport: {
      summary: {
        apply_pass: true,
        rollback_ready_n: 0,
        open_wave: 2,
        global_canary_pass: false,
        shadow_global_drift: 0,
        golden_global_drift: 0,
      },
      rows: [{ market: "BTCUSDT", wave: 2, current_stage: "SOFT", candidate_id: "WAIT_ONE_BAR_TUNE", canary_verdict: "READY", blockers: [] }],
    },
    memoryLedger: {
      summary: { blocked_candidate_ids: [], blocked_candidate_n: 0 },
    },
  });
  assert.strictEqual(explicitDriftBlock.summary.deploy_pass, false);
  assert.ok(explicitDriftBlock.summary.blockers.includes("FILTER_CANARY_DRIFT"));

  const backwardCompatibleDriftPass = deriveDeploymentGuards({
    objectiveSupervisor: {
      promotion: { ready: true, candidate_id: "WAIT_ONE_BAR_TUNE" },
      rollback: { ready: false },
      self_evolution_objective: {
        count_floor_pass: true,
        replacement_floor_pass: true,
        latency_budget_pass: true,
      },
    },
    replayReport: {
      validations: [{ candidate_id: "WAIT_ONE_BAR_TUNE", validation_verdict: "PASS" }],
    },
    canaryReport: {
      summary: {
        apply_pass: true,
        rollback_ready_n: 0,
        open_wave: 2,
        shadow_global_drift: 0,
        golden_global_drift: 0,
      },
      rows: [{ market: "BTCUSDT", wave: 2, current_stage: "SOFT", candidate_id: "WAIT_ONE_BAR_TUNE", canary_verdict: "READY", blockers: [] }],
    },
    memoryLedger: {
      summary: { blocked_candidate_ids: [], blocked_candidate_n: 0 },
    },
  });
  assert.strictEqual(backwardCompatibleDriftPass.summary.deploy_pass, true);

  const promotionNotReady = deriveDeploymentGuards({
    objectiveSupervisor: {
      promotion: { ready: false, reason: "DAILY_NO_TRADE_ACTIVITY", candidate_id: "WAIT_ONE_BAR_TUNE" },
      rollback: { ready: false },
      self_evolution_objective: {
        count_floor_pass: true,
        replacement_floor_pass: true,
        latency_budget_pass: true,
      },
    },
    replayReport: {
      validations: [{ candidate_id: "WAIT_ONE_BAR_TUNE", validation_verdict: "PASS" }],
    },
    canaryReport: {
      summary: { apply_pass: true, rollback_ready_n: 0, open_wave: 2, shadow_global_drift: 0, golden_global_drift: 0 },
      rows: [{ market: "BTCUSDT", wave: 2, current_stage: "SOFT", candidate_id: "WAIT_ONE_BAR_TUNE", canary_verdict: "READY", blockers: [] }],
    },
    memoryLedger: {
      summary: { blocked_candidate_ids: [], blocked_candidate_n: 0 },
    },
  });
  assert.strictEqual(promotionNotReady.summary.deploy_pass, false);
  assert.strictEqual(promotionNotReady.summary.root_cause, "DAILY_NO_TRADE_ACTIVITY");
  assert.strictEqual(promotionNotReady.summary.promotion_ready, false);
  assert.strictEqual(promotionNotReady.summary.promotion_not_ready_reason, "DAILY_NO_TRADE_ACTIVITY");
  assert.ok(promotionNotReady.summary.next_actions[0].includes("DAILY_NO_TRADE_ACTIVITY"));

  console.log("BEST_SELF_EVOLUTION_DEPLOYMENT_GUARDS_TEST_OK");
})();
