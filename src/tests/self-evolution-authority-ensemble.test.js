"use strict";

const assert = require("assert");
const { deriveAuthorityEnsemble } = require("../../src/utils/selfEvolutionAuthorityEnsemble");

(() => {
  const consensus = deriveAuthorityEnsemble({
    authorityMode: "CODEX_CLAUDE_ENSEMBLE",
    codexReview: {
      status: "FRESH",
      verdict: "PROMOTE",
      recommended_candidate_id: "AUTO_CORE",
      confidence: 0.8,
      review_unit: "ENGINE_POLICY_BUNDLE",
      source_mode_change: "canonical_engine_market_overrides={\"AXSUSDT\":{\"source_mode\":\"SERVER_PRIMARY\"}}",
      canonical_threshold_signature: "canonical_engine_market_overrides={\"AXSUSDT\":{\"transition_core_score_abs\":30,\"core_score_abs\":34}}",
    },
    claudeReview: {
      status: "FRESH",
      verdict: "PROMOTE",
      recommended_candidate_id: "AUTO_CORE",
      confidence: 0.6,
      review_unit: "ENGINE_POLICY_BUNDLE",
      source_mode_change: "canonical_engine_market_overrides={\"AXSUSDT\":{\"source_mode\":\"SERVER_PRIMARY\"}}",
      canonical_threshold_signature: "canonical_engine_market_overrides={\"AXSUSDT\":{\"transition_core_score_abs\":30,\"core_score_abs\":34}}",
    },
  });
  assert.strictEqual(consensus.owner, "CODEX_CLAUDE_ENSEMBLE");
  assert.strictEqual(consensus.verdict, "PROMOTE");
  assert.strictEqual(consensus.recommended_candidate_id, "AUTO_CORE");
  assert.strictEqual(consensus.consensus, true);
  assert.strictEqual(consensus.review_unit, "ENGINE_POLICY_BUNDLE");
  assert.strictEqual(consensus.source_mode_change, "canonical_engine_market_overrides={\"AXSUSDT\":{\"source_mode\":\"SERVER_PRIMARY\"}}");
  assert.strictEqual(consensus.canonical_threshold_signature, "canonical_engine_market_overrides={\"AXSUSDT\":{\"transition_core_score_abs\":30,\"core_score_abs\":34}}");

  const disagreement = deriveAuthorityEnsemble({
    authorityMode: "CODEX_CLAUDE_ENSEMBLE",
    codexReview: { status: "FRESH", verdict: "PROMOTE", recommended_candidate_id: "AUTO_CORE" },
    claudeReview: { status: "FRESH", verdict: "HOLD" },
  });
  assert.strictEqual(disagreement.verdict, "HOLD");
  assert.strictEqual(disagreement.reason, "AUTHORITY_DISAGREEMENT");
  assert.ok(disagreement.blockers.includes("AUTHORITY_DISAGREEMENT"));

  const degraded = deriveAuthorityEnsemble({
    authorityMode: "CODEX_CLAUDE_ENSEMBLE",
    codexReview: { status: "FRESH", verdict: "PROMOTE", recommended_candidate_id: "AUTO_CORE" },
    claudeReview: { status: "SKIPPED", verdict: "HOLD" },
  });
  assert.strictEqual(degraded.verdict, "HOLD");
  assert.ok(degraded.blockers.includes("CLAUDE_REVIEW_REQUIRED"));

  const codexOnly = deriveAuthorityEnsemble({
    authorityMode: "CODEX_ONLY",
    codexReview: { status: "FRESH", verdict: "PROMOTE", recommended_candidate_id: "AUTO_CORE" },
    claudeReview: { status: "FAILED", verdict: "HOLD" },
  });
  assert.strictEqual(codexOnly.owner, "CODEX");
  assert.strictEqual(codexOnly.verdict, "PROMOTE");

  const degradedPromote = deriveAuthorityEnsemble({
    authorityMode: "CODEX_CLAUDE_ENSEMBLE",
    codexReview: { fresh: true, status: "TIMEOUT_HOLD", verdict: "HOLD", reason: "CODEX_EXEC_TIMEOUT_HOLD", confidence: 0 },
    claudeReview: { fresh: true, status: "TIMEOUT_HOLD", verdict: "HOLD", reason: "CLAUDE_EXEC_TIMEOUT_HOLD", confidence: 0 },
    autonomyContract: {
      authority_policy: {
        degraded_timeout_policy: {
          enabled: true,
          min_timeout_streak: 3,
          allow_target_deploy_units: ["SERVER_SETTINGS", "ENGINE_POLICY_BUNDLE"],
          confidence_floor: 0.35,
        },
      },
    },
    recoveryGovernor: {
      summary: {
        target_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN",
        target_deploy_unit: "SERVER_SETTINGS",
        governor_status: "RECOVERY_PROMOTION_READY",
        degraded_authority_eligible: true,
      },
    },
    timeoutContext: {
      codex_timeout_streak: 4,
      claude_timeout_streak: 4,
      ensemble_timeout_streak: 4,
    },
  });
  assert.strictEqual(degradedPromote.verdict, "PROMOTE");
  assert.strictEqual(degradedPromote.recommended_candidate_id, "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN");
  assert.strictEqual(degradedPromote.degraded_authority_applied, true);

  const pendingAuthorityClosure = deriveAuthorityEnsemble({
    authorityMode: "CODEX_CLAUDE_ENSEMBLE",
    codexReview: {
      fresh: true,
      status: "LOCAL_HOLD",
      verdict: "HOLD",
      reason: "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK",
      confidence: 0.88,
    },
    claudeReview: {
      fresh: true,
      status: "LOCAL_HOLD",
      verdict: "HOLD",
      reason: "SELF_EVOLUTION_EXTERNAL_AUTHORITY_PENDING",
      confidence: 0.72,
    },
    autonomyContract: {
      current_status: {
        ops_healthy: true,
      },
      authority_policy: {
        degraded_timeout_policy: {
          enabled: true,
          allow_target_deploy_units: ["SERVER_SETTINGS", "ENGINE_POLICY_BUNDLE"],
          confidence_floor: 0.51,
        },
      },
      summary: {
        ops_status: "PASS",
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
  assert.strictEqual(pendingAuthorityClosure.verdict, "PROMOTE");
  assert.strictEqual(pendingAuthorityClosure.recommended_candidate_id, "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN");
  assert.strictEqual(pendingAuthorityClosure.pending_authority_closure_applied, true);

  const pendingAuthorityClosureByServerPrimaryRuntime = deriveAuthorityEnsemble({
    authorityMode: "CODEX_CLAUDE_ENSEMBLE",
    codexReview: {
      fresh: true,
      status: "LOCAL_HOLD",
      verdict: "HOLD",
      reason: "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK",
      confidence: 0.88,
    },
    claudeReview: {
      fresh: true,
      status: "LOCAL_HOLD",
      verdict: "HOLD",
      reason: "SELF_EVOLUTION_EXTERNAL_AUTHORITY_PENDING",
      confidence: 0.72,
    },
    autonomyContract: {
      current_status: {
        ops_healthy: true,
        phase_d_acceptance_ready: true,
      },
      authority_policy: {
        degraded_timeout_policy: {
          enabled: true,
          allow_target_deploy_units: ["SERVER_SETTINGS", "ENGINE_POLICY_BUNDLE"],
          confidence_floor: 0.51,
        },
      },
      summary: {
        ops_status: "PASS",
        phase_d_status: "READY",
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
  assert.strictEqual(pendingAuthorityClosureByServerPrimaryRuntime.verdict, "PROMOTE");
  assert.strictEqual(pendingAuthorityClosureByServerPrimaryRuntime.pending_authority_closure_applied, true);

  const pendingAuthorityClosureByAppliedActiveTarget = deriveAuthorityEnsemble({
    authorityMode: "CODEX_CLAUDE_ENSEMBLE",
    codexReview: {
      fresh: true,
      status: "LOCAL_HOLD",
      verdict: "HOLD",
      reason: "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK",
      confidence: 0.88,
    },
    claudeReview: {
      fresh: true,
      status: "LOCAL_HOLD",
      verdict: "HOLD",
      reason: "SELF_EVOLUTION_EXTERNAL_AUTHORITY_PENDING",
      confidence: 0.72,
    },
    autonomyContract: {
      current_status: {
        ops_healthy: true,
        phase_d_acceptance_ready: true,
      },
      authority_policy: {
        degraded_timeout_policy: {
          enabled: true,
          allow_target_deploy_units: ["SERVER_SETTINGS", "ENGINE_POLICY_BUNDLE"],
          confidence_floor: 0.51,
        },
      },
      summary: {
        ops_status: "PASS",
        phase_d_status: "READY",
      },
    },
    recoveryGovernor: {
      summary: {
        target_candidate_id: "EV_TP1_THRESHOLD_TUNE",
        target_deploy_unit: "ENGINE_POLICY_BUNDLE",
        governor_status: "RECOVERY_PROMOTION_READY",
        degraded_authority_eligible: true,
        replay_pass: true,
        canary_ready: true,
        deployment_guards_pass: true,
        target_memory_blocked: false,
      },
    },
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
        live_signal_confirmed: true,
        target_candidate_id: "EV_TP1_THRESHOLD_TUNE",
        recommended_target_candidate_id: "EV_TP1_THRESHOLD_TUNE",
        applied_origin_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN",
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
  assert.strictEqual(pendingAuthorityClosureByAppliedActiveTarget.verdict, "PROMOTE");
  assert.strictEqual(pendingAuthorityClosureByAppliedActiveTarget.pending_authority_closure_applied, true);
  assert.strictEqual(pendingAuthorityClosureByAppliedActiveTarget.recommended_candidate_id, "EV_TP1_THRESHOLD_TUNE");

  console.log("SELF_EVOLUTION_AUTHORITY_ENSEMBLE_TEST_OK");
})();
