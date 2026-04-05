"use strict";

const assert = require("assert");
const { deriveObjectiveRecoveryGovernor } = require("../../src/utils/objectiveRecoveryGovernor");

(() => {
  const blocked = deriveObjectiveRecoveryGovernor({
    autonomyContract: {
      summary: { goal_state: "OBJECTIVE_RECOVERY_REQUIRED" },
      current_status: { recovery_required: true },
      authority_policy: { degraded_timeout_policy: { enabled: true, require_replay_pass: true, require_canary_ready: true, require_deployment_guards_pass: true, require_memory_clear: true, require_openclaw_ops_healthy: true, allow_target_deploy_units: ["SERVER_SETTINGS", "ENGINE_POLICY_BUNDLE"] } },
    },
    objective: { global_objective_score: { objective_score: -2 } },
    objectiveSupervisor: { promotion: { display_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN", replay_verdict: "PASS" } },
    candidates: { rows: [{ candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN", target_deploy_unit: "SERVER_SETTINGS", canonical_migration_class: "PINE_THRESHOLD", memory_blocked: true }] },
    replay: { validations: [{ candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN", validation_verdict: "PASS" }] },
    canary: { summary: { apply_pass: true, ready_n: 1 } },
    deploymentGuards: { summary: { deploy_pass: true } },
    memory: { summary: { blocked_candidate_n: 1 } },
    serverPrimaryAcceptanceWatch: { summary: { phase_d_status: "PENDING", phase_d_ready: false } },
    watchdog: { display: { verdict: "PASS" } },
  });
  assert.strictEqual(blocked.summary.objective_score, -2);
  assert.strictEqual(blocked.summary.objective_score_source, "OBJECTIVE");
  assert.strictEqual(blocked.summary.governor_status, "RECOVERY_TARGET_MEMORY_BLOCKED");
  assert.strictEqual(blocked.summary.degraded_authority_eligible, false);
  assert.strictEqual(blocked.summary.target_memory_blocked, true);
  assert.strictEqual(blocked.summary.unrelated_memory_blocked_candidate_n, 0);

  const ready = deriveObjectiveRecoveryGovernor({
    autonomyContract: {
      summary: { goal_state: "OBJECTIVE_RECOVERY_REQUIRED" },
      current_status: { recovery_required: true },
      authority_policy: { degraded_timeout_policy: { enabled: true, require_replay_pass: true, require_canary_ready: true, require_deployment_guards_pass: true, require_memory_clear: true, require_openclaw_ops_healthy: true, allow_target_deploy_units: ["SERVER_SETTINGS", "ENGINE_POLICY_BUNDLE"] } },
    },
    objective: { global_objective_score: { objective_score: -2 } },
    objectiveSupervisor: { promotion: { display_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN", replay_verdict: "PASS" } },
    candidates: { rows: [{ candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN", target_deploy_unit: "SERVER_SETTINGS", canonical_migration_class: "PINE_THRESHOLD", memory_blocked: false }] },
    replay: { validations: [{ candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN", validation_verdict: "PASS" }] },
    canary: { summary: { apply_pass: true, ready_n: 1 } },
    deploymentGuards: { summary: { deploy_pass: true } },
    memory: { summary: { blocked_candidate_n: 0 } },
    serverPrimaryAcceptanceWatch: { summary: { phase_d_status: "PENDING", phase_d_ready: false } },
    watchdog: { display: { verdict: "PASS" } },
  });
  assert.strictEqual(ready.summary.governor_status, "RECOVERY_PROMOTION_READY");
  assert.strictEqual(ready.summary.degraded_authority_eligible, true);

  const unrelatedBlocked = deriveObjectiveRecoveryGovernor({
    autonomyContract: {
      summary: { goal_state: "OBJECTIVE_RECOVERY_REQUIRED" },
      current_status: { recovery_required: true },
      authority_policy: { degraded_timeout_policy: { enabled: true, require_replay_pass: true, require_canary_ready: true, require_deployment_guards_pass: true, require_memory_clear: true, require_openclaw_ops_healthy: true, allow_target_deploy_units: ["SERVER_SETTINGS", "ENGINE_POLICY_BUNDLE"] } },
    },
    objective: { global_objective_score: { objective_score: -2 } },
    objectiveSupervisor: { promotion: { display_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN", replay_verdict: "PASS" } },
    candidates: { rows: [{ candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN", target_deploy_unit: "SERVER_SETTINGS", canonical_migration_class: "PINE_THRESHOLD", memory_blocked: false }] },
    replay: { validations: [{ candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN", validation_verdict: "PASS" }] },
    canary: { summary: { apply_pass: true, ready_n: 1 } },
    deploymentGuards: { summary: { deploy_pass: true } },
    memory: {
      summary: { blocked_candidate_n: 1, blocked_candidate_ids: ["AI_AI"] },
      current_rows: [{ candidate_id: "AI_AI", memory_blocked: true, memory_block_reason: "RECENT_FAIL_FINGERPRINT_WITHIN_TTL" }],
    },
    serverPrimaryAcceptanceWatch: { summary: { phase_d_status: "PENDING", phase_d_ready: false } },
    watchdog: { display: { verdict: "PASS" } },
  });
  assert.strictEqual(unrelatedBlocked.summary.governor_status, "RECOVERY_PROMOTION_READY");
  assert.strictEqual(unrelatedBlocked.summary.memory_blocked, false);
  assert.strictEqual(unrelatedBlocked.summary.unrelated_memory_blocked_candidate_n, 1);

  const serverPrimaryAcceptanceReady = deriveObjectiveRecoveryGovernor({
    autonomyContract: {
      summary: { goal_state: "OBJECTIVE_RECOVERY_REQUIRED" },
      current_status: { recovery_required: true },
      authority_policy: { degraded_timeout_policy: { enabled: true, require_replay_pass: true, require_canary_ready: true, require_deployment_guards_pass: true, require_memory_clear: true, require_openclaw_ops_healthy: true, allow_target_deploy_units: ["SERVER_SETTINGS", "ENGINE_POLICY_BUNDLE"] } },
    },
    objective: { global_objective_score: { objective_score: -2 } },
    objectiveSupervisor: { promotion: { display_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN", replay_verdict: "PASS" } },
    candidates: { rows: [{ candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN", target_deploy_unit: "SERVER_SETTINGS", canonical_migration_class: "PINE_THRESHOLD", memory_blocked: false }] },
    replay: { validations: [{ candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN", validation_verdict: "PASS" }] },
    canary: { summary: { apply_pass: false, ready_n: 0 } },
    deploymentGuards: { summary: { deploy_pass: true } },
    memory: { summary: { blocked_candidate_n: 0 } },
    serverPrimaryCanary: { summary: { apply_pass: true, server_primary_executed_n: 3 } },
    serverPrimaryAcceptanceWatch: { summary: { phase_d_status: "READY", phase_d_ready: true } },
    watchdog: { display: { verdict: "PASS" } },
  });
  assert.strictEqual(serverPrimaryAcceptanceReady.summary.canary_ready, true);
  assert.strictEqual(serverPrimaryAcceptanceReady.summary.canary_ready_mode, "SERVER_PRIMARY_ACCEPTANCE");
  assert.strictEqual(serverPrimaryAcceptanceReady.summary.governor_status, "RECOVERY_PROMOTION_READY");

  const prefersBestReadyReplay = deriveObjectiveRecoveryGovernor({
    autonomyContract: {
      summary: { goal_state: "OBJECTIVE_RECOVERY_REQUIRED" },
      current_status: { recovery_required: true },
      authority_policy: { degraded_timeout_policy: { enabled: true, require_replay_pass: true, require_canary_ready: true, require_deployment_guards_pass: true, require_memory_clear: true, require_openclaw_ops_healthy: true, allow_target_deploy_units: ["SERVER_SETTINGS"] } },
    },
    objective: { global_objective_score: { objective_score: -2 } },
    objectiveSupervisor: { promotion: { ready: false, candidate_id: null, display_candidate_id: null } },
    candidates: {
      summary: { top_candidate_id: "ML_GATE_CORE_SCORE_ABS" },
      rows: [
        { candidate_id: "ML_GATE_CORE_SCORE_ABS", target_deploy_unit: "SERVER_SETTINGS", ready_for_auto_apply: true, memory_blocked: false, failed_fingerprint_repeat: false },
        { candidate_id: "EV_TP1_THRESHOLD_TUNE", canonical_candidate_id: "EV_COMPOSITE_THRESHOLD_TUNE", display_candidate_id: null, target_deploy_unit: "SERVER_SETTINGS", ready_for_auto_apply: true, memory_blocked: false, failed_fingerprint_repeat: false },
      ],
    },
    replay: {
      summary: { best_candidate_id: "EV_TP1_THRESHOLD_TUNE", best_verdict: "PASS" },
      validations: [
        { candidate_id: "ML_GATE_CORE_SCORE_ABS", validation_verdict: "BLOCK", candidate_objective_delta: 0.1 },
        { candidate_id: "EV_TP1_THRESHOLD_TUNE", validation_verdict: "PASS", candidate_objective_delta: 2.5 },
      ],
    },
    canary: { summary: { apply_pass: true, ready_n: 1 } },
    deploymentGuards: { summary: { deploy_pass: true } },
    memory: { summary: { blocked_candidate_n: 0 } },
    watchdog: { display: { verdict: "PASS" } },
  });
  assert.strictEqual(prefersBestReadyReplay.summary.target_candidate_id, "EV_TP1_THRESHOLD_TUNE");
  assert.strictEqual(prefersBestReadyReplay.summary.display_candidate_id, "EV_COMPOSITE_THRESHOLD_TUNE");
  assert.strictEqual(prefersBestReadyReplay.summary.replay_pass, true);
  assert.strictEqual(prefersBestReadyReplay.summary.governor_status, "RECOVERY_PROMOTION_READY");

  console.log("OBJECTIVE_RECOVERY_GOVERNOR_TEST_OK");
})();
