"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-stage-autopilot");

(() => {
  const aiCandidate = __test.buildAiStageCandidate({
    data: {
      generated_at_kst: "2026-03-28 10:00:00 KST",
      self_validation: { ok: true },
      stage_samples: { ai_n: 64 },
      recommendations: {
        AI: {
          action: "REVIEW_UPDATE",
          key: "ai_missing_policy",
          next: "REDUCE",
          next_reduce_pct: 0.35,
          reason: "tighten ai missing",
          support_n: 24,
          support_rate: 0.41,
        },
      },
    },
  }, {
    ai_missing_policy: "ALLOW",
    ai_missing_reduce_pct: 0.5,
  }, {
    objective: { enough_sample: true },
  });
  assert.strictEqual(aiCandidate.actionable, true);
  assert.strictEqual(aiCandidate.nextSettings.ai_missing_policy, "REDUCE");
  assert.strictEqual(aiCandidate.nextSettings.ai_missing_reduce_pct, 0.35);

  const marketCandidate = __test.buildMarketStageCandidate({
    data: {
      self_validation: { ok: true },
      stage_samples: { market_n: 40 },
      coverage: { ai_bias_rate: 0.12 },
      recommendations: {
        MARKET: {
          action: "REVIEW_TIGHTEN",
          key: "ai_bias_gate_opposite_mult",
          next: 0.30,
          reason: "tighten opposite mult",
        },
      },
    },
  }, {
    ai_bias_gate_opposite_mult: 0.35,
  }, {
    objective: { enough_sample: true },
    guards: { market_coverage_pass: true },
  });
  assert.strictEqual(marketCandidate.actionable, true);
  assert.strictEqual(marketCandidate.nextSettings.ai_bias_gate_opposite_mult, 0.30);

  const canonicalGlobal = __test.applyCanonicalThresholdChanges({
    currentSys: {
      canonical_engine_core_score_abs: 33,
      canonical_engine_transition_core_score_abs: 29,
    },
    candidate: {
      changes: [
        { key: "entry_core_score_abs", current: 0, next: 1 },
        { key: "shared_regime_transition_confirmation", current: 0, next: 1 },
      ],
      markets: ["ALL"],
    },
  });
  assert.strictEqual(canonicalGlobal.nextSettings.canonical_engine_core_score_abs, 34);
  assert.strictEqual(canonicalGlobal.nextSettings.canonical_engine_transition_core_score_abs, 30);
  assert.deepStrictEqual(canonicalGlobal.unsupportedKeys, []);

  const canonicalMarketCandidate = __test.buildCanonicalPolicyStageCandidate({
    data: {
      rows: [
        {
          candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN",
          display_candidate_id: "AUTO_AXSUSDT_REGIME_TIGHTEN",
          canonical_migration_class: "PINE_THRESHOLD",
          target_deploy_unit: "SERVER_SETTINGS",
          ready_for_auto_apply: true,
          memory_blocked: false,
          direction: "TIGHTEN",
          status: "MARKET_CONCENTRATION_RECOVERY",
          source: "MARKET_CONCENTRATION_RECOVERY",
          markets: ["AXSUSDT"],
          changes: [
            { key: "entry_core_score_abs", current: 0, next: 1 },
            { key: "shared_regime_transition_confirmation", current: 0, next: 1 },
          ],
          evidence: { priority_score: 7.2, support_n: 5 },
        },
      ],
    },
  }, {
    canonical_engine_market_overrides: {
      AXSUSDT: {
        core_score_abs: 35,
        transition_core_score_abs: 31,
      },
    },
  }, {
    objective: { enough_sample: true },
  });
  assert.strictEqual(canonicalMarketCandidate.actionable, true);
  assert.strictEqual(canonicalMarketCandidate.candidate_id, "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN");
  assert.strictEqual(canonicalMarketCandidate.nextSettings.canonical_engine_market_overrides.AXSUSDT.core_score_abs, 36);
  assert.strictEqual(canonicalMarketCandidate.nextSettings.canonical_engine_market_overrides.AXSUSDT.transition_core_score_abs, 32);

  const sourceModePatch = __test.applyCanonicalSourceModeChanges({
    currentSys: {
      canonical_engine_source_mode: "PINE_PRIMARY",
      canonical_engine_market_overrides: {
        AXSUSDT: {
          core_score_abs: 36,
          transition_core_score_abs: 32,
        },
      },
    },
    candidate: {
      markets: ["AXSUSDT"],
    },
    nextSourceMode: "SERVER_PRIMARY",
  });
  assert.strictEqual(sourceModePatch.nextSettings.canonical_engine_market_overrides.AXSUSDT.source_mode, "SERVER_PRIMARY");
  assert.deepStrictEqual(sourceModePatch.nextSettings.canonical_engine_market_overrides.AXSUSDT, {
    source_mode: "SERVER_PRIMARY",
  });
  assert.deepStrictEqual(sourceModePatch.current_modes, [
    { market: "AXSUSDT", current_source_mode: "PINE_PRIMARY", next_source_mode: "SERVER_PRIMARY" },
  ]);

  const mergedCanonicalPatch = __test.mergeStageNextSettings({
    canonical_engine_market_overrides: {
      AXSUSDT: {
        core_score_abs: 34,
        transition_core_score_abs: 30,
      },
    },
  }, sourceModePatch.nextSettings);
  assert.deepStrictEqual(mergedCanonicalPatch.canonical_engine_market_overrides.AXSUSDT, {
    core_score_abs: 34,
    transition_core_score_abs: 30,
    source_mode: "SERVER_PRIMARY",
  });

  const sourceModeCandidate = __test.buildSourceModeStageCandidate({
    candidatesArtifact: {
      data: {
        rows: [
          {
            candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN",
            display_candidate_id: "AUTO_AXSUSDT_REGIME_TIGHTEN",
            canonical_migration_class: "PINE_THRESHOLD",
            target_deploy_unit: "SERVER_SETTINGS",
            ready_for_auto_apply: true,
            memory_blocked: false,
            direction: "TIGHTEN",
            markets: ["AXSUSDT"],
          },
        ],
      },
    },
    parityArtifact: {
      data: {
        summary: {
          source_parity_mismatch_n: 0,
          shadow_observed_n: 7,
        },
      },
    },
    currentSys: {
      canonical_engine_source_mode: "PINE_PRIMARY",
      canonical_engine_market_overrides: {
        AXSUSDT: {
          core_score_abs: 36,
          transition_core_score_abs: 32,
        },
      },
    },
    objectiveSupervisor: {
      objective: { enough_sample: true },
    },
  });
  assert.strictEqual(sourceModeCandidate.actionable, true);
  assert.strictEqual(sourceModeCandidate.reason, "SERVER_PRIMARY_PROMOTION_READY");
  assert.strictEqual(sourceModeCandidate.source, "CANONICAL_PARITY_SOURCE_MODE_PROMOTION");
  assert.strictEqual(sourceModeCandidate.support_n, 7);
  assert.strictEqual(sourceModeCandidate.nextSettings.canonical_engine_market_overrides.AXSUSDT.source_mode, "SERVER_PRIMARY");

  const sourceModeActiveCandidate = __test.buildSourceModeStageCandidate({
    candidatesArtifact: {
      data: {
        rows: [
          {
            candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN",
            display_candidate_id: "AUTO_AXSUSDT_REGIME_TIGHTEN",
            canonical_migration_class: "PINE_THRESHOLD",
            target_deploy_unit: "SERVER_SETTINGS",
            ready_for_auto_apply: true,
            memory_blocked: false,
            direction: "TIGHTEN",
            markets: ["AXSUSDT"],
          },
        ],
      },
    },
    parityArtifact: {
      data: { summary: { source_parity_mismatch_n: 0, shadow_observed_n: 7 } },
    },
    serverPrimaryCanaryArtifact: {
      data: {
        summary: {
          server_primary_executed_n: 3,
          apply_pass: true,
          acceptance_ready: true,
          acceptance_reason: "SERVER_PRIMARY_ACCEPTANCE_READY",
          rollback_trigger_n: 0,
        },
      },
    },
    currentSys: {
      canonical_engine_market_overrides: {
        AXSUSDT: {
          core_score_abs: 36,
          transition_core_score_abs: 32,
          source_mode: "SERVER_PRIMARY",
        },
      },
    },
    objectiveSupervisor: {
      objective: { enough_sample: true },
    },
  });
  assert.strictEqual(sourceModeActiveCandidate.actionable, false);
  assert.strictEqual(sourceModeActiveCandidate.reason, "SERVER_PRIMARY_ACTIVE");

  const sourceModeRollbackInputs = __test.resolveStageRollbackInputs({
    stage: "SOURCE_MODE",
    candidate: {
      server_primary_apply_pass: null,
      server_primary_rollback_trigger_n: 0,
    },
    objectiveArtifact: {
      data: { objective: { enough_sample: true, pass: false, monthly_pass: false } },
    },
    canaryPass: true,
    selfEvolutionRollbackReady: false,
  });
  assert.strictEqual(sourceModeRollbackInputs.objectiveSupervisor.objective.enough_sample, false);
  assert.strictEqual(sourceModeRollbackInputs.canaryPass, true);
  assert.strictEqual(sourceModeRollbackInputs.selfEvolutionRollbackReady, false);

  const sourceModeRollbackTriggered = __test.resolveStageRollbackInputs({
    stage: "SOURCE_MODE",
    candidate: {
      server_primary_apply_pass: false,
      server_primary_rollback_trigger_n: 1,
    },
    objectiveArtifact: {
      data: { objective: { enough_sample: true, pass: false, monthly_pass: false } },
    },
    canaryPass: true,
    selfEvolutionRollbackReady: false,
  });
  assert.strictEqual(sourceModeRollbackTriggered.canaryPass, false);
  assert.strictEqual(sourceModeRollbackTriggered.selfEvolutionRollbackReady, true);
  assert.strictEqual(sourceModeActiveCandidate.support_n, 3);
  assert.strictEqual(sourceModeActiveCandidate.server_primary_acceptance_ready, true);

  const evParityCandidate = __test.buildEvParityCandidate({
    data: {
      summary: {
        shadow_observed_n: 7,
        source_parity_mismatch_n: 0,
        parity_mismatch_rate: 0.57,
        by_actual_drop_reason_family: [
          { key: "EV_POLICY", count: 2 },
          { key: "COOLDOWN_POLICY", count: 1 },
        ],
      },
    },
  }, {
    ev_gate_tp1_prob_min: 0.55,
    ev_gate_tp1_prob_full: 0.60,
  }, {
    objective: { enough_sample: false },
  });
  assert.strictEqual(evParityCandidate.actionable, true);
  assert.strictEqual(evParityCandidate.nextSettings.ev_gate_tp1_prob_min, 0.54);
  assert.strictEqual(evParityCandidate.nextSettings.ev_gate_tp1_prob_full, 0.59);
  assert.strictEqual(evParityCandidate.support_n, 2);

  const pinePromote = __test.buildPineCandidate(
    { data: { verdict: "PATCH_CANDIDATE", promotion: { candidate_id: "AUTO_CORE_SCORE_TIGHTEN" }, codex_authority: { status: "FRESH", verdict: "PROMOTE", recommended_candidate_id: "AUTO_CORE_SCORE_TIGHTEN" }, reason: "AUTO_PROMOTION_READY" } },
    { data: { verdict: "PROMOTE" }, fresh: true },
    { data: {} },
  );
  assert.strictEqual(pinePromote.actionable, true);
  assert.strictEqual(pinePromote.kind, "PROMOTE");

  const pineRecoveryPromote = __test.buildPineCandidate(
    { data: { verdict: "PATCH_CANDIDATE", promotion: { candidate_id: "AUTO_CORE_SCORE_TIGHTEN", display_candidate_id: "AUTO_LONG_SHORT_SCORE_TIGHTEN", recovery_mode: true }, codex_authority: { status: "FRESH", verdict: "HOLD" }, reason: "AUTONOMOUS_RECOVERY_PROMOTION_READY" } },
    { data: { verdict: "HOLD" }, fresh: true },
    { data: {} },
  );
  assert.strictEqual(pineRecoveryPromote.actionable, false);
  assert.strictEqual(pineRecoveryPromote.kind, "PROMOTE");
  assert.strictEqual(pineRecoveryPromote.signature, "AUTO_CORE_SCORE_TIGHTEN");
  assert.strictEqual(pineRecoveryPromote.display_signature, "AUTO_LONG_SHORT_SCORE_TIGHTEN");

  const pineRollbackBlocked = __test.buildPineCandidate(
    { data: { verdict: "ROLLBACK_CANDIDATE", rollback: { rollback_file_path: "/tmp/rb.pine" }, reason: "AUTO_ROLLBACK_READY" } },
    { data: { verdict: "HOLD" }, fresh: true },
    { data: {} },
  );
  assert.strictEqual(pineRollbackBlocked.actionable, false);
  assert.strictEqual(pineRollbackBlocked.kind, "ROLLBACK");

  const pendingLoopMonitor = __test.buildLoopMonitorView({
    cycleMeta: { cycle_id: "cycle-new" },
    objectiveArtifact: {
      data: {
        cycle_id: "cycle-old",
        self_evolution_loop_monitor: {
          cycle_id: "cycle-old",
          overall_status: "BLOCKED",
          cycle_consistent: false,
          stale_artifact_n: 1,
          critical_blockers: ["SELF_EVOLUTION_CYCLE_MISMATCH"],
        },
      },
    },
  });
  assert.strictEqual(pendingLoopMonitor.available, false);
  assert.strictEqual(pendingLoopMonitor.source, "PENDING_FINAL_LOOP_MONITOR");
  assert.strictEqual(pendingLoopMonitor.cycle_id, "cycle-new");
  assert.strictEqual(pendingLoopMonitor.cycle_consistent, null);

  const resolvedCycleId = __test.resolveReportCycleId({
    objectiveArtifact: { data: { source_cycle_id: "cycle-source", cycle_id: "cycle-objective" } },
    deploymentPlan: { cycle_id: "cycle-plan" },
    loopMonitor: { cycle_id: "cycle-monitor" },
    fallbackCycleId: "cycle-fallback",
  });
  assert.strictEqual(resolvedCycleId, "cycle-source");

  const overrideApplied = __test.applyPreparedOverrideToPineArtifacts({
    pineHandoff: {
      stage_ready: false,
      target_candidate_id: "AUTO_OLD",
      prepared_strategy_id: "donbeolja_v6.0.3.2",
    },
    pineStageRow: {
      machine_state: "HOLD",
      reason: "SELF_EVOLUTION_CANARY_BLOCK",
      prepared_strategy_id: "donbeolja_v6.0.3.2",
      signature: "AUTO_OLD",
    },
    preparedOverride: {
      active: true,
      target_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
      display_candidate_id: "AUTO_LONG_SHORT_REGIME_TIGHTEN",
      prepared_strategy_id: "donbeolja_v6.0.3.3",
      prepared_file_path: "/tmp/donbeolja_v6.0.3.3.pine.txt",
    },
  });
  assert.strictEqual(overrideApplied.pineHandoff.stage_ready, true);
  assert.strictEqual(overrideApplied.pineHandoff.prepared_strategy_id, "donbeolja_v6.0.3.3");
  assert.strictEqual(overrideApplied.pineStageRow.machine_state, "READY");
  assert.strictEqual(overrideApplied.pineStageRow.reason, "MANUAL_PREPARED_OVERRIDE");
  assert.strictEqual(overrideApplied.pineStageRow.signature, "AUTO_CORE_REGIME_TIGHTEN");

  const budgetBlocked = __test.stageChangeBudgetOk([
    { stage: "AI", action: "AUTO_APPLY", run_key: "2026-03-31 10:00:00 KST__AUTO_APPLY", ts_ms: 1_000_000 },
  ], 1_000_000 + (12 * 60 * 60 * 1000), "AI");
  assert.strictEqual(budgetBlocked, false);

  const scopedBudgetAllowed = __test.stageChangeBudgetOk([
    { stage: "PINE", action: "PINE_PREPARE", ts_ms: 1_000_000, budget_scope: "PINE_OVERLAY" },
    { stage: "EV", action: "AUTO_APPLY", ts_ms: 1_100_000, budget_scope: "POLICY_TUNING" },
    { stage: "CANONICAL_POLICY", action: "AUTO_APPLY", ts_ms: 1_200_000, budget_scope: "CANONICAL_ENGINE" },
  ], 1_200_000 + (12 * 60 * 60 * 1000), "SOURCE_MODE");
  assert.strictEqual(scopedBudgetAllowed, true);

  const scopedBudgetBlocked = __test.stageChangeBudgetOk([
    { stage: "CANONICAL_POLICY", action: "AUTO_APPLY", run_key: "2026-03-31 10:00:00 KST__AUTO_APPLY", ts_ms: 1_000_000, budget_scope: "CANONICAL_ENGINE" },
    { stage: "SOURCE_MODE", action: "AUTO_APPLY", run_key: "2026-03-31 11:00:00 KST__AUTO_APPLY", ts_ms: 1_100_000, budget_scope: "CANONICAL_ENGINE" },
  ], 1_100_000 + (12 * 60 * 60 * 1000), "SOURCE_MODE");
  assert.strictEqual(scopedBudgetBlocked, false);

  const proposedActionIgnored = __test.stageChangeBudgetOk([
    { stage: "SOURCE_MODE", action: "PROPOSED_AUTO_APPLY", ts_ms: 1_000_000, budget_scope: "CANONICAL_ENGINE" },
  ], 1_000_000 + (12 * 60 * 60 * 1000), "SOURCE_MODE");
  assert.strictEqual(proposedActionIgnored, true);

  const legacyFalseApplyIgnored = __test.stageChangeBudgetOk([
    { stage: "SOURCE_MODE", action: "AUTO_APPLY", run_key: "2026-03-31 17:55:52 KST", ts_ms: 1_000_000, budget_scope: "CANONICAL_ENGINE" },
  ], 1_000_000 + (12 * 60 * 60 * 1000), "SOURCE_MODE");
  assert.strictEqual(legacyFalseApplyIgnored, true);

  const stableSig = __test.stableSignature({ b: 2, a: 1 });
  assert.strictEqual(stableSig, 'a=1|b=2');

  assert.strictEqual(__test.isAiAutopilotTightening(
    { ai_missing_policy: "ALLOW", ai_missing_reduce_pct: 0.5 },
    { ai_missing_policy: "REDUCE", ai_missing_reduce_pct: 0.35 }
  ), true);
  assert.strictEqual(__test.isAiAutopilotTightening(
    { ai_missing_policy: "REDUCE", ai_missing_reduce_pct: 0.35 },
    { ai_missing_policy: "REDUCE", ai_missing_reduce_pct: 0.45 }
  ), false);

  const aiGuard = __test.bestFebtAutopilotGuard({
    stage: "AI",
    candidate: {
      actionable: true,
      nextSettings: { ai_missing_policy: "REDUCE", ai_missing_reduce_pct: 0.35 },
    },
    currentSys: { ai_missing_policy: "ALLOW", ai_missing_reduce_pct: 0.5 },
    bestFebtContract: { tightening_allowed: false, recovery_priority: false },
  });
  assert.strictEqual(aiGuard.blocked, true);
  assert.strictEqual(aiGuard.reason, "BEST_FEBT_COUNT_GUARD_BLOCK");

  const pineGuard = __test.bestFebtAutopilotGuard({
    stage: "PINE",
    candidate: { actionable: true, kind: "PROMOTE" },
    currentSys: {},
    bestFebtContract: { tightening_allowed: true, recovery_priority: true },
  });
  assert.strictEqual(pineGuard.blocked, true);
  assert.strictEqual(pineGuard.reason, "BEST_FEBT_RECOVERY_GUARD_BLOCK");

  const canonicalGuard = __test.bestFebtAutopilotGuard({
    stage: "CANONICAL_POLICY",
    candidate: { actionable: true, direction: "TIGHTEN" },
    currentSys: {},
    bestFebtContract: { tightening_allowed: false, recovery_priority: false },
  });
  assert.strictEqual(canonicalGuard.blocked, true);
  assert.strictEqual(canonicalGuard.reason, "BEST_FEBT_COUNT_GUARD_BLOCK");

  console.log("STAGE_AUTOPILOT_TEST_OK");
})();
