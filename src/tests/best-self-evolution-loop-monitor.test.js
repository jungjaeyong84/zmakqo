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
      canonicalParity: { fresh: true },
      canonicalProvenance: { fresh: true },
      serverPrimaryCanary: { fresh: true },
      objectiveRecoveryEffect: { fresh: true, exists: true },
      pineShadowDrift: { fresh: true },
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
      canonicalParity: { cycle_id: "cycle-1", summary: { shadow_observed_n: 7, source_parity_mismatch_n: 0, final_downstream_mismatch_n: 2, by_actual_drop_reason_family: [{ key: "EV_POLICY", count: 2 }] } },
      canonicalProvenance: { cycle_id: "cycle-1", summary: { eligible_n: 6, complete_n: 6, with_actual_source_decision_n: 6, with_bundle_version_n: 6 } },
      serverPrimaryCanary: { cycle_id: "cycle-1", summary: { server_primary_executed_n: 0, pine_shadow_observed_n: 0, pine_shadow_disagreement_n: 0, rollback_trigger_n: 0, apply_pass: null } },
      objectiveRecoveryEffect: { cycle_id: "cycle-1", summary: { tracking_status: "PARTIAL_RECOVERY_ONLY", target_candidate_id: "AUTO_CORE", target_candidate_objective_delta: 0.8, projected_objective_score: -0.4, gap_closure_rate: 0.5, higher_delta_candidate_id: "EV_TP1_THRESHOLD_TUNE" } },
      pineShadowDrift: { cycle_id: "cycle-1", summary: { audit_only: true, observed_n: 0, drift_n: 0, top_drift_market: null } },
      deployment: { cycle_id: "cycle-1", summary: { deploy_pass: true, target_candidate_id: "AUTO_CORE", blockers: [] } },
      deploymentPlan: { cycle_id: "cycle-1", summary: { plan_status: "READY_FOR_MANUAL_PASTE", manual_step_required: true, target_candidate_id: "AUTO_CORE" } },
      stageAutopilot: { cycle_id: "cycle-1", objective_verdict: "PATCH_CANDIDATE", actions: [] },
      weightTuning: { cycle_id: "cycle-1", summary: { advisory_mode: "HOLD", suggestion_n: 0, canary_blocked: false, autonomous_defer: false } },
      memory: { cycle_id: "cycle-1", summary: { blocked_candidate_n: 0, top_failed_candidate_id: null } },
      codexPatch: { cycle_id: "cycle-1", verdict: "PROMOTE", recommended_candidate_id: "AUTO_CORE" },
    },
  });

  assert.strictEqual(report.summary.overall_status, "READY_FOR_MANUAL_PASTE");
  assert.strictEqual(report.summary.manual_paste_ready, true);
  assert.strictEqual(report.summary.ready_candidate_id, "AUTO_CORE");
  assert.strictEqual(report.summary.cycle_consistent, true);
  const deploymentRow = report.rows.find((row) => row.loop === "DEPLOYMENT_GUARDS");
  const parityRow = report.rows.find((row) => row.loop === "CANONICAL_PARITY");
  const provenanceRow = report.rows.find((row) => row.loop === "CANONICAL_PROVENANCE");
  const serverPrimaryRow = report.rows.find((row) => row.loop === "SERVER_PRIMARY_CANARY");
  const recoveryEffectRow = report.rows.find((row) => row.loop === "OBJECTIVE_RECOVERY_EFFECT");
  const pineShadowDriftRow = report.rows.find((row) => row.loop === "PINE_SHADOW_DRIFT");
  assert.ok(deploymentRow);
  assert.ok(parityRow);
  assert.ok(provenanceRow);
  assert.ok(serverPrimaryRow);
  assert.ok(recoveryEffectRow);
  assert.ok(pineShadowDriftRow);
  assert.strictEqual(deploymentRow.status, "PASS");
  assert.strictEqual(parityRow.status, "PASS");
  assert.strictEqual(provenanceRow.status, "PASS");
  assert.strictEqual(serverPrimaryRow.status, "N/A");
  assert.strictEqual(recoveryEffectRow.status, "WARN");
  assert.strictEqual(pineShadowDriftRow.status, "N/A");

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
      objectiveRecoveryGovernor: { cycle_id: "cycle-new", summary: { memory_blocked: false, unrelated_memory_blocked_candidate_ids: ["AI_AI", "WAIT_ONE_BAR_TUNE"] } },
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
  assert.strictEqual(memoryRow.status, "WARN");
  assert.strictEqual(memoryRow.reason, "target_blocked=NO / blocked=2 / ids=AI_AI|WAIT_ONE_BAR_TUNE");

  const deferredWeight = deriveLoopMonitor({
    artifacts: {
      objectiveSupervisor: { fresh: true },
      weightTuning: { fresh: true },
    },
    reports: {
      objectiveSupervisor: { cycle_id: "cycle-w", verdict: "HOLD", reason: "DAILY_NO_TRADE_ACTIVITY" },
      weightTuning: { cycle_id: "cycle-w", summary: { advisory_mode: "ADVISORY_ONLY", suggestion_n: 3, canary_blocked: false, autonomous_defer: true, defer_reason: "MEMORY_BLOCKED", memory_defer_remaining_weeks_min: 1 } },
    },
  });
  const weightRow = deferredWeight.rows.find((row) => row.loop === "WEIGHT_TUNING");
  assert.ok(weightRow);
  assert.strictEqual(weightRow.status, "DEFERRED");
  assert.strictEqual(weightRow.reason, "suggestions=3 / defer=MEMORY_BLOCKED / eta_w=1");

  const appliedPending = deriveLoopMonitor({
    artifacts: {
      objectiveSupervisor: { fresh: true },
      deployment: { fresh: true },
      deploymentPlan: { fresh: true },
    },
    reports: {
      objectiveSupervisor: { cycle_id: "cycle-p", verdict: "PATCH_CANDIDATE", reason: "AUTONOMOUS_RECOVERY_PROMOTION_READY" },
      deployment: { cycle_id: "cycle-p", summary: { deploy_pass: true, target_candidate_id: "AUTO_CORE", blockers: [] } },
      deploymentPlan: { cycle_id: "cycle-p", summary: { plan_status: "APPLIED_PENDING_BUNDLE_ACTIVATION", manual_step_required: false, target_candidate_id: "AUTO_CORE" } },
    },
  });
  assert.strictEqual(appliedPending.summary.overall_status, "APPLIED_PENDING_BUNDLE_ACTIVATION");
  assert.strictEqual(appliedPending.summary.manual_paste_ready, false);
  assert.strictEqual(appliedPending.summary.applied_pending_bundle_activation, true);

  const appliedConfirmed = deriveLoopMonitor({
    artifacts: {
      objectiveSupervisor: { fresh: true },
      deployment: { fresh: true },
      deploymentPlan: { fresh: true },
    },
    reports: {
      objectiveSupervisor: { cycle_id: "cycle-c", verdict: "PATCH_CANDIDATE", reason: "AUTONOMOUS_RECOVERY_PROMOTION_READY" },
      deployment: { cycle_id: "cycle-c", summary: { deploy_pass: true, target_candidate_id: "AUTO_CORE", blockers: [] } },
      deploymentPlan: { cycle_id: "cycle-c", summary: { plan_status: "APPLIED_ACTIVE", manual_step_required: false, target_candidate_id: "AUTO_CORE" } },
    },
  });
  assert.strictEqual(appliedConfirmed.summary.overall_status, "APPLIED_ACTIVE");
  assert.strictEqual(appliedConfirmed.summary.applied_confirmed, true);
  assert.strictEqual(appliedConfirmed.summary.applied_pending_signal_confirmation, false);

  const appliedConfirmedAuthorityBypass = deriveLoopMonitor({
    artifacts: {
      objectiveSupervisor: { fresh: true },
      deployment: { fresh: true },
      deploymentPlan: { fresh: true },
    },
    reports: {
      objectiveSupervisor: { cycle_id: "cycle-b", verdict: "HOLD", reason: "SELF_EVOLUTION_LATENCY_BUDGET_FAIL" },
      deployment: { cycle_id: "cycle-b", summary: { deploy_pass: false, target_candidate_id: "AUTO_MARKET_AXS", blockers: ["SELF_EVOLUTION_LATENCY_BUDGET_FAIL"] } },
      deploymentPlan: { cycle_id: "cycle-b", summary: { plan_status: "APPLIED_ACTIVE_PENDING_AUTHORITY", manual_step_required: false, target_candidate_id: "AUTO_MARKET_AXS", recommended_target_candidate_id: "AUTO_MARKET_AXS", applied_origin_candidate_id: "AUTO_CORE", authority_bypass_active: true, external_authority_pending: true, authority_state: "PENDING" } },
    },
  });
  assert.strictEqual(appliedConfirmedAuthorityBypass.summary.overall_status, "APPLIED_ACTIVE_PENDING_AUTHORITY");
  assert.ok(appliedConfirmedAuthorityBypass.summary.critical_blockers.includes("SELF_EVOLUTION_EXTERNAL_AUTHORITY_PENDING"));

  const absent = deriveLoopMonitor({
    artifacts: {
      objectiveSupervisor: { fresh: true },
      canonicalParity: { fresh: true },
      serverPrimaryCanary: { fresh: true },
      pineShadowDrift: { fresh: true },
      codexPatch: { fresh: true },
    },
    reports: {
      objectiveSupervisor: { cycle_id: "cycle-z", verdict: "HOLD", reason: "X" },
      canonicalParity: { cycle_id: "cycle-z", summary: { shadow_observed_n: 4, source_parity_mismatch_n: 1, final_downstream_mismatch_n: 0, by_actual_drop_reason_family: [] } },
      serverPrimaryCanary: { cycle_id: "cycle-z", summary: { server_primary_executed_n: 2, pine_shadow_observed_n: 2, pine_shadow_disagreement_n: 1, rollback_trigger_n: 1, apply_pass: false } },
      pineShadowDrift: { cycle_id: "cycle-z", summary: { audit_only: true, observed_n: 2, drift_n: 1, top_drift_market: "AXSUSDT" } },
      codexPatch: { verdict: "HOLD", recommended_candidate_id: null },
    },
  });
  assert.strictEqual(absent.summary.cycle_id_absent_n, 1);
  assert.strictEqual(absent.summary.overall_status, "BLOCKED");
  assert.ok(absent.summary.critical_blockers.includes("SELF_EVOLUTION_CYCLE_ID_ABSENT"));
  assert.ok(absent.summary.critical_blockers.includes("SELF_EVOLUTION_CANONICAL_SOURCE_MISMATCH"));
  assert.ok(absent.summary.critical_blockers.includes("SELF_EVOLUTION_SERVER_PRIMARY_CANARY_BLOCK"));

  const postCutoverPending = deriveLoopMonitor({
    artifacts: {
      objectiveSupervisor: { fresh: true },
      canonicalProvenance: { fresh: true },
    },
    reports: {
      objectiveSupervisor: { cycle_id: "cycle-pc", verdict: "HOLD", reason: "X" },
      canonicalProvenance: {
        cycle_id: "cycle-pc",
        summary: {
          cutover_reference_source: "SOURCE_MODE",
          post_cutover_status: "NO_ENGINE_ROWS_AFTER_CUTOVER",
          post_cutover_engine_eligible_n: 0,
          post_cutover_complete_n: 0,
        },
      },
    },
  });
  const postCutoverProvenanceRow = postCutoverPending.rows.find((row) => row.loop === "CANONICAL_PROVENANCE");
  assert.ok(postCutoverProvenanceRow);
  assert.strictEqual(postCutoverProvenanceRow.status, "N/A");
  assert.strictEqual(postCutoverProvenanceRow.reason, "cutover=SOURCE_MODE / eligible=0");

  const activeButBlockedPromotion = deriveLoopMonitor({
    artifacts: {
      objectiveSupervisor: { fresh: true },
      serverSignalRuntime: { fresh: true },
      serverSignalCutoverReadiness: { fresh: true },
    },
    reports: {
      objectiveSupervisor: { cycle_id: "cycle-cutover", verdict: "HOLD", reason: "X" },
      serverSignalRuntime: {
        cycle_id: "cycle-cutover",
        summary: { runtime_status: "READY", canonical_engine_source_mode: "SERVER_PRIMARY", exec_tf: "15m", market_count: 4 },
      },
      serverSignalCutoverReadiness: {
        cycle_id: "cycle-cutover",
        summary: {
          readiness_status: "SERVER_PRIMARY_ACTIVE",
          source_mode: "SERVER_PRIMARY",
          promotion_gate_ready: false,
          promotion_gate_status: "BLOCKED",
          promotion_ready: false,
          already_server_primary: true,
          promotion_block_reasons: ["ARTIFACT_GENERATED_AT_SKEW_EXCEEDED", "COOLDOWN_POLICY_DRIFT_ACTIVE"],
        },
      },
    },
  });
  const cutoverRow = activeButBlockedPromotion.rows.find((row) => row.loop === "SERVER_SIGNAL_CUTOVER");
  assert.ok(cutoverRow);
  assert.strictEqual(cutoverRow.status, "WARN");
  assert.strictEqual(activeButBlockedPromotion.summary.server_signal_cutover_ready, false);
  assert.strictEqual(activeButBlockedPromotion.summary.server_signal_cutover_promotion_gate_status, "BLOCKED");
  assert.ok(activeButBlockedPromotion.summary.server_signal_cutover_blockers.includes("ARTIFACT_GENERATED_AT_SKEW_EXCEEDED"));
  assert.ok(activeButBlockedPromotion.summary.critical_blockers.includes("SERVER_SIGNAL_CUTOVER_NOT_READY"));

  const serverPrimaryLearningParityMonitorOnly = deriveLoopMonitor({
    artifacts: {
      objectiveSupervisor: { fresh: true },
      serverSignalAuthority: { fresh: true },
      serverSignalCutoverReadiness: { fresh: true },
      serverPrimaryLearningEpoch: { fresh: true },
      marketObjectiveScore: { fresh: true },
      objectiveRecoveryGovernor: { fresh: true },
    },
    reports: {
      objectiveSupervisor: { cycle_id: "cycle-s", verdict: "HOLD", reason: "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK" },
      serverSignalAuthority: { cycle_id: "cycle-s", summary: { drift_status: "PARITY_DRIFT", parity_mismatch_rate: 0.73 } },
      serverSignalCutoverReadiness: { cycle_id: "cycle-s", summary: { readiness_status: "SERVER_PRIMARY_ACTIVE", promotion_gate_status: "READY", promotion_ready: false, already_server_primary: true } },
      serverPrimaryLearningEpoch: { cycle_id: "cycle-s", summary: { status: "SERVER_PRIMARY_EPOCH_ACTIVE", age_days: 1.5 } },
      marketObjectiveScore: { cycle_id: "cycle-s", summary: { status: "RECOVERY_PRIORITY_ACTIVE", top_recovery_market: "SOLUSDT" } },
      objectiveRecoveryGovernor: { cycle_id: "cycle-s", summary: { recovery_required: true } },
    },
  });
  assert.strictEqual(serverPrimaryLearningParityMonitorOnly.summary.server_signal_drift_status, "PARITY_DRIFT");
  assert.strictEqual(serverPrimaryLearningParityMonitorOnly.summary.critical_blockers.includes("SERVER_SIGNAL_PARITY_DRIFT"), false);
  console.log("BEST_SELF_EVOLUTION_LOOP_MONITOR_TEST_OK");
})();
