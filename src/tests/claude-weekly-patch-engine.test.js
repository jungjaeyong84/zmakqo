"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-claude-weekly-patch-engine");

(() => {
  const plain = __test.parseClaudeJson("{\"verdict\":\"HOLD\"}");
  assert.deepStrictEqual(plain, { verdict: "HOLD" });

  const fenced = __test.parseClaudeJson("```json\n{\"verdict\":\"PROMOTE\",\"recommended_candidate_id\":\"AUTO_CORE\"}\n```");
  assert.strictEqual(fenced.verdict, "PROMOTE");
  assert.strictEqual(fenced.recommended_candidate_id, "AUTO_CORE");

  const invalid = __test.parseClaudeJson("not-json");
  assert.strictEqual(invalid, null);

  const reviewReady = __test.deriveReviewReadiness({
    changeControl: {
      auto_promotion: { ready: false },
      auto_rollback: { ready: false },
    },
    selfEvolutionCanary: {
      summary: { ready_n: 2, apply_pass: true, rollback_ready_n: 0 },
    },
  });
  assert.strictEqual(reviewReady.reviewReady, true);
  assert.strictEqual(reviewReady.selfEvolutionPromotionReady, true);
  assert.strictEqual(reviewReady.selfEvolutionRollbackReady, false);

  const bypassReady = __test.deriveReviewReadiness({
    changeControl: {
      auto_promotion: { ready: false },
      auto_rollback: { ready: false },
    },
    selfEvolutionCanary: {
      summary: { ready_n: 0, apply_pass: false, rollback_ready_n: 0 },
    },
    deploymentPlan: {
      summary: { plan_status: "APPLIED_CONFIRMED_PENDING_AUTHORITY", authority_bypass_active: true, external_authority_pending: true, authority_state: "PENDING" },
    },
  });
  assert.strictEqual(bypassReady.reviewReady, true);
  assert.strictEqual(bypassReady.selfEvolutionAuthorityBypass, true);

  const pendingBlock = __test.deriveReviewReadiness({
    changeControl: {
      auto_promotion: { ready: false },
      auto_rollback: { ready: true },
    },
    selfEvolutionCanary: {
      summary: { ready_n: 0, apply_pass: false, rollback_ready_n: 1 },
    },
    deploymentPlan: {
      summary: { plan_status: "APPLIED_PENDING_BUNDLE_ACTIVATION_PENDING_AUTHORITY", authority_bypass_active: true, external_authority_pending: true, authority_state: "PENDING" },
    },
  });
  assert.strictEqual(pendingBlock.pendingSignalConfirmation, true);
  assert.strictEqual(pendingBlock.reviewReady, false);
  assert.strictEqual(pendingBlock.blockedReason, "BUNDLE_ACTIVATION_PENDING_BLOCK");

  const pendingAuthorityClosure = __test.derivePendingAuthorityClosure({
    deploymentPlan: {
      summary: {
        plan_status: "APPLIED_ACTIVE_PENDING_AUTHORITY",
        external_authority_pending: true,
        authority_state: "PENDING",
        activation_confirmed: true,
        activation_pending: false,
        engine_bundle_loaded: true,
        policy_bundle_loaded: true,
        probe_pass: true,
        applied_origin_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN",
        recommended_target_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN",
      },
    },
    autonomyContract: {
      current_status: { ops_healthy: true },
      summary: { ops_status: "PASS" },
      authority_policy: {
        degraded_timeout_policy: {
          enabled: true,
          allow_target_deploy_units: ["SERVER_SETTINGS", "ENGINE_POLICY_BUNDLE"],
        },
      },
    },
    recoveryGovernor: {
      summary: {
        target_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN",
        target_deploy_unit: "SERVER_SETTINGS",
        governor_status: "RECOVERY_PROMOTION_READY",
        degraded_authority_eligible: true,
        replay_pass: true,
        canary_ready: true,
        deployment_guards_pass: true,
        target_memory_blocked: false,
      },
    },
    loopMonitor: {
      summary: {
        cycle_consistent: true,
        critical_blockers: [
          "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK",
          "SELF_EVOLUTION_EXTERNAL_AUTHORITY_PENDING",
        ],
      },
    },
  });
  assert.strictEqual(pendingAuthorityClosure.applied, true);

  const pendingAuthorityClosureByServerPrimaryRuntime = __test.derivePendingAuthorityClosure({
    deploymentPlan: {
      summary: {
        plan_status: "HOLD",
        external_authority_pending: true,
        authority_state: "PENDING",
        activation_confirmed: false,
        activation_pending: false,
        engine_bundle_loaded: true,
        policy_bundle_loaded: true,
        probe_pass: true,
        live_signal_confirmed: true,
        applied_origin_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN",
        recommended_target_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN",
      },
    },
    autonomyContract: {
      current_status: { ops_healthy: true, phase_d_acceptance_ready: true },
      summary: { ops_status: "PASS", phase_d_status: "READY" },
      authority_policy: {
        degraded_timeout_policy: {
          enabled: true,
          allow_target_deploy_units: ["SERVER_SETTINGS", "ENGINE_POLICY_BUNDLE"],
        },
      },
    },
    recoveryGovernor: {
      summary: {
        target_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN",
        target_deploy_unit: "SERVER_SETTINGS",
        governor_status: "RECOVERY_PROMOTION_READY",
        degraded_authority_eligible: true,
        replay_pass: true,
        canary_ready: true,
        deployment_guards_pass: true,
        target_memory_blocked: false,
      },
    },
    loopMonitor: {
      summary: {
        cycle_consistent: true,
        critical_blockers: [
          "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK",
          "SELF_EVOLUTION_EXTERNAL_AUTHORITY_PENDING",
        ],
      },
    },
  });
  assert.strictEqual(pendingAuthorityClosureByServerPrimaryRuntime.applied, true);

  const recoveryPromotionApproval = __test.deriveRecoveryPromotionApproval({
    deploymentPlan: {
      summary: {
        plan_status: "READY_FOR_MANUAL_ROLLBACK",
        recommended_target_candidate_id: "EV_TP1_THRESHOLD_TUNE",
        target_candidate_id: "EV_TP1_THRESHOLD_TUNE",
        prepare_pass: true,
      },
    },
    autonomyContract: {
      current_status: { ops_healthy: true },
      summary: { ops_status: "PASS" },
      authority_policy: {
        degraded_timeout_policy: {
          confidence_floor: 0.55,
        },
      },
    },
    recoveryGovernor: {
      summary: {
        target_candidate_id: "EV_TP1_THRESHOLD_TUNE",
        governor_status: "RECOVERY_PROMOTION_READY",
        replay_pass: true,
        canary_ready: true,
        deployment_guards_pass: true,
        target_memory_blocked: false,
      },
    },
    loopMonitor: {
      summary: {
        cycle_consistent: true,
        critical_blockers: ["AUTO_ROLLBACK_READY"],
      },
    },
  });
  assert.strictEqual(recoveryPromotionApproval.applied, true);
  assert.strictEqual(recoveryPromotionApproval.reason, "RECOVERY_PROMOTION_LOCAL_APPROVAL_READY");

  console.log("CLAUDE_WEEKLY_PATCH_ENGINE_TEST_OK");
})();
