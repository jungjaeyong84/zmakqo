"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-objective-supervisor");

(() => {
  const base = {
    governance: {
      current: {
        objective: {
          verdict: "PASS",
          pass: true,
          enough_sample: true,
          realized_n: 24,
          monthly_run_rate_krw: 1800000,
          monthly_pass: true,
          failed_checks: [],
        },
        overall: {
          win_rate: 0.62,
          avg_ret_net: 0.012,
          net_pnl_quote: 220,
        },
        febt_shadow: {
          projected_replacement_ratio: 0.91,
          projected_count_ratio: 1.03,
          projected_net_signal_delta_n: 1,
          candidate_recovered_n: 2,
          candidate_blocked_n: 1,
          candidate_wait_n: 0,
        },
        quality: {
          chain_rows: [
            {
              market: "BTCUSDT",
              febt_phase: "FIRE",
              febt_calc_ok: true,
              febt_payload_missing: false,
              febt_shadow_disagrees_legacy_wait: true,
              febt_shadow_disagreement_reason: "FEBT_ALLOW_LEGACY_WAIT",
              febt_shadow_fallback_to_legacy: false,
              febt_shadow_verdict: "ALLOW",
              febt_shadow_legacy_wait_action: "WAIT_HARD",
            },
            {
              market: "DOGEUSDT",
              febt_phase: "LATE",
              febt_calc_ok: true,
              febt_payload_missing: false,
              febt_shadow_disagrees_legacy_wait: true,
              febt_shadow_disagreement_reason: "FEBT_BLOCK_LEGACY_ALLOW",
              febt_shadow_fallback_to_legacy: false,
              febt_shadow_verdict: "BLOCK",
              febt_shadow_legacy_wait_action: "ALLOW",
            },
          ],
        },
      },
      objective: {
        min_monthly_net_krw: 1500000,
      },
    },
    changeControl: {
      verdict: "REVIEW",
      auto_promotion: {
        ready: true,
        reason: "AUTO_PROMOTION_READY",
        candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
        streak_current: 2,
        streak_required: 2,
      },
      auto_rollback: {
        ready: false,
        reason: "NO_PATCHED_HISTORY",
      },
      coverage_guard: {
        pass: true,
        ai: { pass: true },
        market: { pass: true },
      },
    },
    canary: {
      shadow: { summary: { drift: 0 } },
      golden: { summary: { drift: 0 } },
    },
    ml: { recommendations: { QUALITY: [], MARKET: { action: "KEEP" }, EV: { action: "KEEP" } } },
    ev: { decision_reason: "KEEP" },
    wait: { reason: "KEEP" },
  };

  const requireFresh = __test.evaluateSupervisor({
    ...base,
    codex: null,
  });
  assert.strictEqual(requireFresh.verdict, "HOLD");
  assert.strictEqual(requireFresh.reason, "SELF_EVOLUTION_REPLAY_MISSING");

  const seedCycle = __test.summarizeSelfEvolutionArtifactCycles({
    stage: "SEED",
    preferredCycleId: "cycle-1",
    artifacts: {
      dataset: { exists: true, fresh: true, data: { cycle_id: "cycle-1" } },
      objective: { exists: true, fresh: true, data: { cycle_id: "stale-cycle" } },
    },
  });
  assert.strictEqual(seedCycle.cycle_consistent, true);
  assert.strictEqual(seedCycle.missing_key_n, 0);

  const finalCycle = __test.summarizeSelfEvolutionArtifactCycles({
    stage: "FINAL",
    preferredCycleId: "cycle-1",
    artifacts: {
      dataset: { exists: true, fresh: true, data: { cycle_id: "cycle-1" } },
      objective: { exists: true, fresh: true, data: { cycle_id: "cycle-2" } },
      attribution: { exists: true, fresh: true, data: { cycle_id: "cycle-1" } },
      candidates: { exists: true, fresh: true, data: { cycle_id: "cycle-1" } },
      replay: { exists: true, fresh: true, data: { cycle_id: "cycle-1" } },
      canary: { exists: true, fresh: true, data: { cycle_id: "cycle-1" } },
      canonicalParity: { exists: true, fresh: true, data: { cycle_id: "cycle-1" } },
      canonicalProvenance: { exists: true, fresh: true, data: { cycle_id: "cycle-1" } },
      serverPrimaryCanary: { exists: true, fresh: true, data: { cycle_id: "cycle-1" } },
      pineShadowDrift: { exists: true, fresh: true, data: { cycle_id: "cycle-1" } },
      bundleActivation: { exists: true, fresh: true, data: { cycle_id: "cycle-1" } },
      memory: { exists: true, fresh: true, data: { cycle_id: "cycle-1" } },
      codex: { exists: true, fresh: true, data: { cycle_id: "cycle-1" } },
    },
  });
  assert.strictEqual(finalCycle.cycle_consistent, false);
  assert.strictEqual(finalCycle.cycle_mismatch_n, 1);
  assert.deepStrictEqual(finalCycle.cycle_mismatches[0], { key: "objective", cycle_id: "cycle-2" });

  const allowPromote = __test.evaluateSupervisor({
    ...base,
    phase0: {
      fresh: true,
      provider: "BINANCEFUT",
      tf: "15m",
      legacy_wait_baseline: {
        immediate_win_rate: 0.57,
        saved_loss_pct: 0.31,
        missed_gain_pct: 0.12,
        saved_loss_minus_missed_gain: 0.19,
      },
      bridge_latency: {
        webhook_to_fill_ms: { p95: 1420 },
        duplicate_count: 1,
        reject_count: 2,
      },
    },
    selfEvolutionDataset: {
      fresh: true,
      summary: {
        rows_n: 24,
        executed_n: 10,
        drop_n: 7,
        missed_n: 3,
        fallback_n: 2,
        rejected_n: 1,
        partial_n: 1,
        realized_n: 8,
        features_coverage_rate: 0.91,
        febt_coverage_rate: 0.83,
        febt_eligible_n: 12,
        febt_coverage_rate_eligible: 0.92,
        febt_active_eligible_n: 9,
        febt_coverage_rate_active_eligible: 0.89,
        febt_active_missing_n: 1,
        active_entry_n: 18,
        legacy_entry_n: 2,
        active_entry_family_counts: [{ key: "CORE_LONG", count: 8 }, { key: "EARLY_LONG", count: 6 }],
        entry_pending_total_n: 4,
        entry_executed_null_realized_n: 2,
        entry_fallback_pending_n: 2,
        entry_fallback_payload_missing_n: 2,
        entry_fallback_payload_missing_linked_n: 1,
        entry_fallback_pending_active_n: 1,
        entry_fallback_pending_active_by_family: [{ key: "CORE_LONG", count: 1 }],
        entry_exit_present_unlabeled_n: 1,
        entry_open_pending_n: 1,
        entry_link_missing_n: 0,
        avg_realized_ret_net: 0.014,
        avg_realized_pnl_quote: 1320,
        avg_hold_minutes: 47.5,
      },
    },
    selfEvolutionCandidates: {
      summary: { total_n: 1, ready_n: 1, blocked_n: 0, top_candidate_id: "AUTO_CORE_SCORE_TIGHTEN", top_scope: "PINE" },
      rows: [{ candidate_id: "AUTO_CORE_SCORE_TIGHTEN", scope: "PINE", ready_for_auto_apply: true }],
    },
    selfEvolutionReplay: {
      validation_mode: "OFFLINE_PROXY_V1",
      summary: { total_n: 1, pass_n: 1, warn_n: 0, block_n: 0, best_candidate_id: "AUTO_CORE_SCORE_TIGHTEN", best_verdict: "PASS", best_objective_delta: 0.8 },
      validations: [{ candidate_id: "AUTO_CORE_SCORE_TIGHTEN", validation_verdict: "PASS", candidate_objective_delta: 0.8 }],
    },
    selfEvolutionCanary: {
      summary: { total_n: 1, shadow_n: 0, soft_n: 1, hard_n: 0, ready_n: 1, blocked_n: 0, rollback_ready_n: 0, apply_pass: true, global_canary_pass: true, current_open_wave: 1, open_wave: 1, scale_allowed: false, next_wave_candidate: 2, top_ready_market: "BTCUSDT", top_rollback_market: null },
      rows: [{ market: "BTCUSDT", wave: 1, current_stage: "SOFT", candidate_id: "AUTO_CORE_SCORE_TIGHTEN", canary_verdict: "READY", blockers: [] }],
    },
    selfEvolutionLoopMonitor: {
      summary: { cycle_id: "cycle-1", overall_status: "READY_FOR_MANUAL_PASTE", cycle_consistent: true, stale_artifact_n: 0, cycle_mismatch_n: 0, critical_blocker_n: 0, critical_blockers: [], promotion_path_ready: true, manual_paste_ready: true, ready_candidate_id: "AUTO_CORE_SCORE_TIGHTEN", canary_open_wave: 1, loop_n: 10, fresh_loop_n: 10 },
      rows: [],
    },
    selfEvolutionMemory: {
      summary: { total_n: 0, current_n: 0, success_n: 0, neutral_n: 0, fail_n: 0, rolled_back_n: 0, blocked_candidate_n: 0, blocked_candidate_ids: [] },
      current_rows: [],
      rows: [],
    },
    codex: {
      status: "FRESH",
      verdict: "PROMOTE",
      recommended_candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
    },
    stageAutopilot: {
      fresh: true,
      objective_verdict: "HOLD",
      actions: [],
    },
  });
  assert.strictEqual(allowPromote.verdict, "PATCH_CANDIDATE");
  assert.strictEqual(allowPromote.reason, "AUTO_PROMOTION_READY");
  assert.strictEqual(allowPromote.filter_layers.integrity.label, "1차 상태/무결성");
  assert.strictEqual(allowPromote.filter_layers.state_soft_sizing.label, "3차 상태 기반 Soft Sizing");
  assert.strictEqual(allowPromote.filter_layers.ev_time_value.label, "4차 EV/시간가치층");
  assert.strictEqual(allowPromote.filter_layers.ev_time_value.fresh, true);
  assert.strictEqual(allowPromote.self_evolution_canonical_provenance.available, false);
  assert.strictEqual(allowPromote.self_evolution_pine_shadow_drift.available, false);

  const pendingRollbackHold = __test.evaluateSupervisor({
    ...base,
    codex: {
      status: "FRESH",
      verdict: "HOLD",
    },
    stageAutopilot: {
      fresh: true,
      objective_verdict: "HOLD",
      actions: [],
    },
    changeControl: {
      ...base.changeControl,
      auto_promotion: { ready: false, reason: "HOLD" },
      auto_rollback: { ready: true, reason: "AUTO_ROLLBACK_READY", rollback_file_path: "/tmp/rollback.pine" },
    },
    manualPasteAck: {
      acknowledged: true,
      acknowledged_at_iso: "2026-03-31T04:20:00.000Z",
      target_candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
      candidate_signature: "AUTO_CORE_SCORE_TIGHTEN",
      prepared_file_path: "/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.0.3.3.pine.txt",
      applied_strategy_id: "donbeolja_v6.0.3.3",
      live_signal_confirmed: false,
      live_signal_confirmation_pending: true,
      authority_bypass_active: true,
    },
    preparedOverride: {
      active: true,
      prepared_stage_ready: true,
      prepared_file_path: "/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.0.3.3.pine.txt",
      prepared_strategy_id: "donbeolja_v6.0.3.3",
      target_candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
      display_candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
      prepared_reason: "MANUAL_PREPARED_OVERRIDE",
      override_source: "MANUAL",
    },
    signalsCache: { docs: [] },
  });
  assert.strictEqual(pendingRollbackHold.verdict, "HOLD");
  assert.strictEqual(pendingRollbackHold.reason, "SELF_EVOLUTION_BUNDLE_ACTIVATION_PENDING");
  assert.ok(pendingRollbackHold.blockers.includes("SELF_EVOLUTION_BUNDLE_ACTIVATION_PENDING"));
  assert.strictEqual(allowPromote.phase0.available, true);
  assert.strictEqual(allowPromote.phase0.immediate_win_rate, 0.57);
  assert.strictEqual(allowPromote.self_evolution_policy.master_spec_path.endsWith("BEST_SELF_EVOLUTION_MASTER_SPEC.md"), true);
  assert.strictEqual(allowPromote.self_evolution_policy.dataset_latest_path.endsWith("best_self_evolution_dataset_latest.json"), true);
  assert.strictEqual(allowPromote.self_evolution_policy.objective_latest_path.endsWith("best_self_evolution_objective_latest.json"), true);
  assert.strictEqual(allowPromote.self_evolution_policy.attribution_latest_path.endsWith("best_self_evolution_attribution_latest.json"), true);
  assert.strictEqual(allowPromote.self_evolution_policy.candidates_latest_path.endsWith("best_self_evolution_candidates_latest.json"), true);
  assert.strictEqual(allowPromote.self_evolution_policy.replay_latest_path.endsWith("best_self_evolution_replay_latest.json"), true);
  assert.strictEqual(allowPromote.self_evolution_policy.canary_latest_path.endsWith("best_self_evolution_canary_latest.json"), true);
  assert.strictEqual(allowPromote.self_evolution_policy.deployment_guards_latest_path.endsWith("best_self_evolution_deployment_guards_latest.json"), true);
  assert.strictEqual(allowPromote.self_evolution_policy.deployment_plan_latest_path.endsWith("best_self_evolution_deployment_plan_latest.json"), true);
  assert.strictEqual(allowPromote.self_evolution_policy.loop_monitor_latest_path.endsWith("best_self_evolution_loop_monitor_latest.json"), true);
  assert.strictEqual(allowPromote.self_evolution_policy.loop_run_latest_path.endsWith("best_self_evolution_loop_run_latest.json"), true);
  assert.strictEqual(allowPromote.self_evolution_policy.weight_tuning_latest_path.endsWith("best_self_evolution_weight_tuning_latest.json"), true);
  assert.strictEqual(allowPromote.self_evolution_policy.memory_latest_path.endsWith("best_self_evolution_memory_latest.json"), true);
  assert.strictEqual(allowPromote.self_evolution_dataset.rows_n, 24);
  assert.strictEqual(allowPromote.self_evolution_dataset.features_coverage_rate, 0.91);
  assert.strictEqual(allowPromote.self_evolution_dataset.febt_coverage_rate_active_eligible, 0.89);
  assert.strictEqual(allowPromote.self_evolution_dataset.febt_active_missing_n, 1);
  assert.strictEqual(allowPromote.self_evolution_dataset.active_entry_n, 18);
  assert.strictEqual(allowPromote.self_evolution_dataset.legacy_entry_n, 2);
  assert.strictEqual(allowPromote.self_evolution_dataset.entry_fallback_pending_active_n, 1);
  assert.strictEqual(allowPromote.self_evolution_dataset.entry_fallback_payload_missing_n, 2);
  assert.strictEqual(allowPromote.self_evolution_dataset.active_entry_family_counts[0].key, "CORE_LONG");
  assert.strictEqual(typeof allowPromote.self_evolution_objective.objective_score, "number");
  assert.strictEqual(allowPromote.self_evolution_objective.count_floor_pass, true);
  assert.strictEqual(allowPromote.self_evolution_objective.replacement_floor_pass, true);
  assert.strictEqual(Array.isArray(allowPromote.self_evolution_objective.market_objective_scores), true);
  assert.strictEqual(allowPromote.self_evolution_attribution.drop_top_layer, null);
  assert.strictEqual(allowPromote.self_evolution_candidates.total_n, 1);
  assert.strictEqual(allowPromote.self_evolution_replay.total_n, 1);
  assert.strictEqual(allowPromote.self_evolution_canary.total_n, 1);
  assert.strictEqual(allowPromote.self_evolution_deployment.deploy_pass, true);
  assert.strictEqual(allowPromote.self_evolution_deployment_plan.prepare_pass, true);
  assert.strictEqual(allowPromote.self_evolution_loop_monitor.cycle_consistent, true);
  assert.strictEqual(allowPromote.codex_authority.owner, "CODEX");
  assert.strictEqual(typeof allowPromote.self_evolution_weight_tuning.summary.advisory_mode, "string");
  assert.strictEqual(allowPromote.self_evolution_memory.total_n, 0);
  assert.strictEqual(allowPromote.current_latest_context.latest_mode, "STANDALONE_RECOMPUTE");
  assert.strictEqual(allowPromote.current_latest_context.evaluation_scope, "STANDALONE");
  assert.strictEqual(allowPromote.filter_canary_drift_context.golden_drift, 0);
  assert.strictEqual(allowPromote.ev_tuner_context.stale, false);
  assert.strictEqual(allowPromote.operational_recovery_context.recommended_scheduler_policy, "NORMAL_4H");
  assert.strictEqual(allowPromote.autonomy_assessment.engine_autonomy, "YES");
  assert.strictEqual(allowPromote.autonomy_assessment.loop_autonomy, "YES");
  assert.strictEqual(allowPromote.autonomy_assessment.operational_autonomy_except_pine, "PARTIAL");
  assert.ok(Array.isArray(allowPromote.autonomy_assessment.manual_boundaries));
  assert.strictEqual(allowPromote.best_febt_tuning_contract.mode, "NORMAL");
  assert.strictEqual(allowPromote.best_febt_tuning_contract.tightening_allowed, true);
  assert.strictEqual(Array.isArray(allowPromote.best_febt_market_contracts), true);
  assert.strictEqual(allowPromote.best_febt_market_contracts[0].market, "BTCUSDT");
  assert.strictEqual(allowPromote.best_febt_market_contracts[1].market, "DOGEUSDT");
  assert.strictEqual(allowPromote.best_febt_market_contracts[1].mode, "COUNT_GUARD_ACTIVE");
  assert.strictEqual(allowPromote.sample_readiness.governance_monthly_source_realized_n, 0);
  assert.strictEqual(allowPromote.sample_readiness.governance_effective_realized_n, 24);
  assert.strictEqual(allowPromote.sample_readiness.governance_realized_min_sample, 8);

  const staleEv = __test.evaluateSupervisor({
    ...base,
    ev: { decision_reason: "KEEP", fresh: false, age_hours: 36 },
  });
  assert.strictEqual(staleEv.filter_layers.ev_time_value.tuner_reason, "STALE_ARTIFACT");
  assert.strictEqual(staleEv.filter_layers.ev_time_value.observed_tuner_reason, "KEEP");
  assert.strictEqual(staleEv.filter_layers.ev_time_value.policy_source, "STALE_TUNER_ARTIFACT");
  assert.strictEqual(staleEv.filter_layers.ev_time_value.fresh, false);
  assert.strictEqual(staleEv.filter_layers.ev_time_value.age_hours, 36);
  assert.strictEqual(staleEv.ev_tuner_context.stale, true);
  assert.strictEqual(staleEv.ev_tuner_context.observed_reason, "KEEP");
  assert.strictEqual(staleEv.action_plan.some((row) => row.includes("Refresh EV tuner artifact")), true);

  const replayBlockedPromotion = __test.evaluateSupervisor({
    ...base,
    phase0: {
      fresh: true,
      provider: "BINANCEFUT",
      tf: "15m",
      legacy_wait_baseline: {},
      bridge_latency: { webhook_to_fill_ms: { p95: 1420 }, duplicate_count: 0, reject_count: 0 },
    },
    selfEvolutionDataset: {
      fresh: true,
      summary: { rows_n: 10, executed_n: 5, drop_n: 3, missed_n: 1, features_coverage_rate: 0.9, febt_coverage_rate: 0.8 },
    },
    selfEvolutionReplay: {
      validation_mode: "OFFLINE_PROXY_V1",
      summary: { total_n: 1, pass_n: 0, warn_n: 0, block_n: 1, best_candidate_id: "AUTO_CORE_SCORE_TIGHTEN", best_verdict: "BLOCK", best_objective_delta: -0.7 },
      validations: [{ candidate_id: "AUTO_CORE_SCORE_TIGHTEN", validation_verdict: "BLOCK", candidate_objective_delta: -0.7, blockers: ["COUNT_GUARD_ACTIVE"] }],
    },
    codex: {
      status: "FRESH",
      verdict: "PROMOTE",
      recommended_candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
    },
    stageAutopilot: {
      fresh: true,
      objective_verdict: "HOLD",
      actions: [],
    },
  });
  assert.strictEqual(replayBlockedPromotion.verdict, "HOLD");
  assert.strictEqual(replayBlockedPromotion.reason, "SELF_EVOLUTION_REPLAY_BLOCK");
  assert.strictEqual(replayBlockedPromotion.promotion.replay_verdict, "BLOCK");
  assert.deepStrictEqual(replayBlockedPromotion.promotion.replay_blockers, ["COUNT_GUARD_ACTIVE"]);
  assert.strictEqual(replayBlockedPromotion.action_plan.some((row) => row.includes("COUNT_GUARD_ACTIVE")), true);

  const canaryBlockedPromotion = __test.evaluateSupervisor({
    ...base,
    phase0: {
      fresh: true,
      provider: "BINANCEFUT",
      tf: "15m",
      legacy_wait_baseline: {},
      bridge_latency: { webhook_to_fill_ms: { p95: 1420 }, duplicate_count: 0, reject_count: 0 },
    },
    selfEvolutionDataset: {
      fresh: true,
      summary: { rows_n: 10, executed_n: 5, drop_n: 3, missed_n: 1, features_coverage_rate: 0.9, febt_coverage_rate: 0.8 },
    },
    selfEvolutionCanary: {
      summary: { total_n: 2, ready_n: 0, blocked_n: 2, rollback_ready_n: 0, apply_pass: false, global_canary_pass: true, top_ready_market: null, top_rollback_market: null },
      rows: [],
    },
    codex: {
      status: "FRESH",
      verdict: "PROMOTE",
      recommended_candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
    },
    stageAutopilot: {
      fresh: true,
      objective_verdict: "HOLD",
      actions: [],
    },
  });
  assert.strictEqual(canaryBlockedPromotion.verdict, "HOLD");
  assert.strictEqual(canaryBlockedPromotion.reason, "SELF_EVOLUTION_CANARY_BLOCK");

  const canaryDrift = __test.evaluateSupervisor({
    ...base,
    canary: {
      shadow: { summary: { drift: 0, byMarket: {}, byStage: {} } },
      golden: { summary: { drift: 1, byMarket: { GLOBAL: { drift: 1 } }, byStage: { AI: { drift: 1 } } } },
    },
    phase0: {
      fresh: true,
      provider: "BINANCEFUT",
      tf: "15m",
      legacy_wait_baseline: {},
      bridge_latency: { webhook_to_fill_ms: { p95: 1420 }, duplicate_count: 0, reject_count: 0 },
    },
    selfEvolutionDataset: {
      fresh: true,
      summary: { rows_n: 10, executed_n: 5, drop_n: 3, missed_n: 1, features_coverage_rate: 0.9, febt_coverage_rate: 0.8 },
    },
  });
  assert.strictEqual(canaryDrift.blockers.includes("CANARY_DRIFT"), true);
  assert.strictEqual(canaryDrift.filter_canary_drift_context.golden_drift, 1);
  assert.strictEqual(canaryDrift.filter_canary_drift_context.primary_label, "AI:1");
  assert.strictEqual(canaryDrift.action_plan.some((row) => row.includes("shadow=0, golden=1, top=AI:1")), true);

  const aiOnlyShadowDrift = __test.evaluateSupervisor({
    ...base,
    canary: {
      shadow: { summary: { drift: 4, byMarket: { BNBUSDT: { drift: 2 }, ETHUSDT: { drift: 1 } }, byStage: { AI: { drift: 4 } } } },
      golden: { summary: { drift: 0, byMarket: {}, byStage: {} } },
    },
    phase0: {
      fresh: true,
      provider: "BINANCEFUT",
      tf: "15m",
      legacy_wait_baseline: {},
      bridge_latency: { webhook_to_fill_ms: { p95: 1420 }, duplicate_count: 0, reject_count: 0 },
    },
    selfEvolutionDataset: {
      fresh: true,
      summary: { rows_n: 10, executed_n: 5, drop_n: 3, missed_n: 1, features_coverage_rate: 0.9, febt_coverage_rate: 0.8 },
    },
  });
  assert.strictEqual(aiOnlyShadowDrift.filter_canary_drift_context.shadow_ai_only_drift, true);
  assert.strictEqual(aiOnlyShadowDrift.blockers.includes("CANARY_DRIFT"), false);

  const memoryBlockedPromotion = __test.evaluateSupervisor({
    ...base,
    phase0: {
      fresh: true,
      provider: "BINANCEFUT",
      tf: "15m",
      legacy_wait_baseline: {},
      bridge_latency: { webhook_to_fill_ms: { p95: 1420 }, duplicate_count: 0, reject_count: 0 },
    },
    selfEvolutionDataset: {
      fresh: true,
      summary: { rows_n: 10, executed_n: 5, drop_n: 3, missed_n: 1, features_coverage_rate: 0.9, febt_coverage_rate: 0.8 },
    },
    selfEvolutionMemory: {
      summary: {
        total_n: 3,
        current_n: 1,
        success_n: 1,
        neutral_n: 1,
        fail_n: 1,
        rolled_back_n: 0,
        blocked_candidate_n: 1,
        blocked_candidate_ids: ["AUTO_CORE_SCORE_TIGHTEN"],
        top_success_candidate_id: "WAIT_ONE_BAR_TUNE",
        top_failed_candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
      },
      current_rows: [],
      rows: [],
    },
    codex: {
      status: "FRESH",
      verdict: "PROMOTE",
      recommended_candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
    },
    stageAutopilot: {
      fresh: true,
      objective_verdict: "HOLD",
      actions: [],
    },
  });
  assert.strictEqual(memoryBlockedPromotion.verdict, "HOLD");
  assert.strictEqual(memoryBlockedPromotion.reason, "SELF_EVOLUTION_MEMORY_BLOCK");

  const promotionReadyArtifacts = {
    phase0: {
      fresh: true,
      provider: "BINANCEFUT",
      tf: "15m",
      legacy_wait_baseline: {},
      bridge_latency: { webhook_to_fill_ms: { p95: 1420 }, duplicate_count: 0, reject_count: 0 },
    },
    selfEvolutionDataset: {
      fresh: true,
      summary: { rows_n: 10, executed_n: 5, drop_n: 3, missed_n: 1, features_coverage_rate: 0.9, febt_coverage_rate: 0.8 },
    },
    selfEvolutionReplay: {
      validation_mode: "HISTORICAL_ENTRY_COHORT_V1",
      summary: { total_n: 1, pass_n: 1, warn_n: 0, block_n: 0, best_candidate_id: "AUTO_CORE_SCORE_TIGHTEN", best_verdict: "PASS", best_objective_delta: 0.8 },
      validations: [{ candidate_id: "AUTO_CORE_SCORE_TIGHTEN", validation_verdict: "PASS", candidate_objective_delta: 0.8, blockers: [] }],
    },
    selfEvolutionCanary: {
      summary: { total_n: 1, ready_n: 1, blocked_n: 0, rollback_ready_n: 0, apply_pass: true, global_canary_pass: true, current_open_wave: 1, open_wave: 1 },
      rows: [{ market: "BTCUSDT", wave: 1, current_stage: "SOFT", candidate_id: "AUTO_CORE_SCORE_TIGHTEN", canary_verdict: "READY", blockers: [] }],
    },
    selfEvolutionMemory: {
      summary: { total_n: 0, current_n: 0, success_n: 0, neutral_n: 0, fail_n: 0, rolled_back_n: 0, blocked_candidate_n: 0, blocked_candidate_ids: [] },
      current_rows: [],
      rows: [],
    },
    selfEvolutionLoopMonitor: {
      summary: { cycle_id: "cycle-1", overall_status: "READY_FOR_MANUAL_PASTE", cycle_consistent: true, stale_artifact_n: 0, cycle_mismatch_n: 0, critical_blocker_n: 0, critical_blockers: [], promotion_path_ready: true, manual_paste_ready: true, ready_candidate_id: "AUTO_CORE_SCORE_TIGHTEN", canary_open_wave: 1, loop_n: 10, fresh_loop_n: 10 },
      rows: [],
    },
  };

  const blockPromote = __test.evaluateSupervisor({
    ...base,
    ...promotionReadyArtifacts,
    codex: {
      status: "FRESH",
      verdict: "HOLD",
    },
    stageAutopilot: {
      fresh: true,
      objective_verdict: "HOLD",
      actions: [],
    },
  });
  assert.strictEqual(blockPromote.verdict, "HOLD");
  assert.strictEqual(blockPromote.reason, "EXTERNAL_AUTHORITY_BLOCK_PROMOTION");

  const stalePromote = __test.evaluateSupervisor({
    ...base,
    ...promotionReadyArtifacts,
    codex: {
      status: "STALE",
      verdict: "PROMOTE",
    },
    stageAutopilot: {
      fresh: true,
      objective_verdict: "HOLD",
      actions: [],
    },
  });
  assert.strictEqual(stalePromote.verdict, "HOLD");
  assert.strictEqual(stalePromote.reason, "EXTERNAL_AUTHORITY_REQUIRED_PROMOTION");

  const staleAutopilot = __test.evaluateSupervisor({
    ...base,
    ...promotionReadyArtifacts,
    codex: {
      status: "FRESH",
      verdict: "PROMOTE",
      recommended_candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
    },
    stageAutopilot: {
      fresh: false,
      objective_verdict: "HOLD",
      actions: [],
    },
  });
  assert.strictEqual(staleAutopilot.verdict, "HOLD");
  assert.strictEqual(staleAutopilot.reason, "STAGE_AUTOPILOT_REQUIRED_PROMOTION");

  const failedButNoAction = __test.evaluateSupervisor({
    ...base,
    changeControl: {
      verdict: "HOLD",
      auto_promotion: { ready: false, reason: "CANDIDATE_NOT_READY" },
      auto_rollback: { ready: false, reason: "NO_PATCHED_HISTORY" },
      coverage_guard: {
        pass: true,
        ai: { pass: true },
        market: { pass: true },
      },
    },
    codex: {
      status: "FAILED",
      verdict: "HOLD",
    },
  });
  assert.strictEqual(failedButNoAction.blockers.includes("CODEX_REVIEW_FAILED"), false);

  const noTradeRetro = __test.evaluateSupervisor({
    ...base,
    retrospective: {
      periods: {
        DAILY: {
          objective: {
            verdict: "FAIL",
            pass: false,
            executed_n: 0,
            realized_n: 0,
            failed_checks: ["NO_TRADE_ACTIVITY", "ZERO_KRW_IDLE"],
          },
          realized_trades: {
            net_pnl_quote: 0,
          },
        },
        WEEKLY: {
          objective: {
            verdict: "FAIL",
            pass: false,
            executed_n: 10,
            realized_n: 5,
            failed_checks: ["PERIOD_TARGET_NOT_MET"],
          },
          realized_trades: {
            net_pnl_quote: -10,
          },
        },
        MONTHLY: {
          objective: {
            verdict: "FAIL",
            pass: false,
            executed_n: 20,
            realized_n: 15,
            failed_checks: ["MONTHLY_TARGET_NOT_MET"],
          },
          realized_trades: {
            net_pnl_quote: -100,
          },
        },
      },
    },
  });
  assert.strictEqual(noTradeRetro.reason, "DAILY_NO_TRADE_ACTIVITY");
  assert.strictEqual(noTradeRetro.blockers.includes("DAILY_NO_TRADE_ACTIVITY"), true);
  assert.strictEqual(noTradeRetro.blockers.includes("ZERO_KRW_IDLE"), true);
  assert.strictEqual(noTradeRetro.retrospective.daily.executed_n, 0);
  assert.strictEqual(noTradeRetro.retrospective_activity_context.source, "RETROSPECTIVE_DAILY");
  assert.strictEqual(noTradeRetro.retrospective_activity_context.daily_no_trade, true);
  assert.strictEqual(noTradeRetro.retrospective_activity_context.daily_zero_idle, true);
  assert.strictEqual(noTradeRetro.operational_recovery_context.recommended_scheduler_policy, "ACTIVE_TRADING_HOURS_ONLY");
  assert.strictEqual(noTradeRetro.autonomy_assessment.operational_autonomy_except_pine, "PARTIAL");
  assert.strictEqual(noTradeRetro.action_plan.some((row) => row.includes("retrospective daily executed_n=0")), true);

  const weeklyOnlyNoTradeRetro = __test.evaluateSupervisor({
    ...base,
    retrospective: {
      periods: {
        DAILY: {
          objective: {
            verdict: "PASS",
            pass: true,
            executed_n: 1,
            realized_n: 1,
            failed_checks: [],
          },
          realized_trades: {
            net_pnl_quote: 10,
          },
        },
        WEEKLY: {
          objective: {
            verdict: "FAIL",
            pass: false,
            executed_n: 0,
            realized_n: 0,
            failed_checks: ["NO_TRADE_ACTIVITY", "PERIOD_TARGET_NOT_MET"],
          },
          realized_trades: {
            net_pnl_quote: 0,
          },
        },
        MONTHLY: {
          objective: {
            verdict: "FAIL",
            pass: false,
            executed_n: 20,
            realized_n: 15,
            failed_checks: ["MONTHLY_TARGET_NOT_MET"],
          },
          realized_trades: {
            net_pnl_quote: -100,
          },
        },
      },
    },
  });
  assert.strictEqual(weeklyOnlyNoTradeRetro.blockers.includes("DAILY_NO_TRADE_ACTIVITY"), false);
  assert.strictEqual(weeklyOnlyNoTradeRetro.retrospective_activity_context.daily_no_trade, false);

  const autonomousRecoveryPromotion = __test.evaluateSupervisor({
    ...base,
    changeControl: {
      verdict: "REVIEW",
      auto_promotion: {
        ready: false,
        reason: "CANDIDATE_NOT_READY",
        candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
        streak_current: 0,
        streak_required: 2,
      },
      auto_rollback: {
        ready: false,
        reason: "NO_PATCHED_HISTORY",
      },
      coverage_guard: {
        pass: true,
        ai: { pass: true },
        market: { pass: true },
      },
    },
    phase0: {
      fresh: true,
      provider: "BINANCEFUT",
      tf: "15m",
      legacy_wait_baseline: {},
      bridge_latency: { webhook_to_fill_ms: { p95: 1420 }, duplicate_count: 0, reject_count: 0 },
    },
    selfEvolutionDataset: {
      fresh: true,
      summary: { rows_n: 10, executed_n: 5, drop_n: 3, missed_n: 1, features_coverage_rate: 0.9, febt_coverage_rate: 0.8 },
    },
    selfEvolutionCandidates: {
      summary: { total_n: 1, ready_n: 1, blocked_n: 0, top_candidate_id: "AUTO_CORE_SCORE_TIGHTEN", top_scope: "PINE" },
      rows: [{ candidate_id: "AUTO_CORE_SCORE_TIGHTEN", scope: "PINE", ready_for_auto_apply: true }],
    },
    selfEvolutionReplay: {
      validation_mode: "HISTORICAL_ENTRY_COHORT_V1",
      summary: { total_n: 1, pass_n: 1, warn_n: 0, block_n: 0, best_candidate_id: "AUTO_CORE_SCORE_TIGHTEN", best_verdict: "PASS", best_objective_delta: 0.8 },
      validations: [{ candidate_id: "AUTO_CORE_SCORE_TIGHTEN", validation_verdict: "PASS", candidate_objective_delta: 0.8, blockers: [] }],
    },
    selfEvolutionCanary: {
      summary: { total_n: 1, ready_n: 1, blocked_n: 0, rollback_ready_n: 0, apply_pass: true, global_canary_pass: true, current_open_wave: 1, open_wave: 1 },
      rows: [{ market: "BTCUSDT", wave: 1, current_stage: "SOFT", candidate_id: "AUTO_CORE_SCORE_TIGHTEN", canary_verdict: "READY", blockers: [] }],
    },
    selfEvolutionMemory: {
      summary: { total_n: 0, current_n: 0, success_n: 0, neutral_n: 0, fail_n: 0, rolled_back_n: 0, blocked_candidate_n: 0, blocked_candidate_ids: [] },
      current_rows: [],
      rows: [],
    },
    selfEvolutionLoopMonitor: {
      summary: { cycle_id: "cycle-r", overall_status: "DEGRADED", cycle_consistent: true, stale_artifact_n: 0, cycle_mismatch_n: 0, critical_blocker_n: 0, critical_blockers: [], promotion_path_ready: false, manual_paste_ready: false, ready_candidate_id: "AUTO_CORE_SCORE_TIGHTEN", canary_open_wave: 1, loop_n: 10, fresh_loop_n: 10 },
      rows: [],
    },
    retrospective: {
      periods: {
        DAILY: {
          objective: {
            verdict: "FAIL",
            pass: false,
            executed_n: 0,
            realized_n: 0,
            failed_checks: ["NO_TRADE_ACTIVITY"],
          },
          realized_trades: { net_pnl_quote: 0 },
        },
        WEEKLY: {
          objective: {
            verdict: "FAIL",
            pass: false,
            executed_n: 3,
            realized_n: 2,
            failed_checks: ["PERIOD_TARGET_NOT_MET"],
          },
          realized_trades: { net_pnl_quote: -10 },
        },
        MONTHLY: {
          objective: {
            verdict: "FAIL",
            pass: false,
            executed_n: 8,
            realized_n: 7,
            failed_checks: ["MONTHLY_TARGET_NOT_MET"],
          },
          realized_trades: { net_pnl_quote: -20 },
        },
      },
    },
    codex: {
      status: "FRESH",
      verdict: "PROMOTE",
      recommended_candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
    },
    stageAutopilot: {
      fresh: true,
      objective_verdict: "HOLD",
      actions: [],
    },
  });
  assert.strictEqual(autonomousRecoveryPromotion.verdict, "PATCH_CANDIDATE");
  assert.strictEqual(autonomousRecoveryPromotion.reason, "AUTONOMOUS_RECOVERY_PROMOTION_READY");
  assert.strictEqual(autonomousRecoveryPromotion.promotion.ready, true);
  assert.strictEqual(autonomousRecoveryPromotion.promotion.recovery_mode, true);
  assert.strictEqual(autonomousRecoveryPromotion.promotion.reason, "AUTONOMOUS_RECOVERY_PROMOTION");

  const autonomousRecoveryPrefersBestReadyReplay = __test.evaluateSupervisor({
    ...base,
    changeControl: {
      verdict: "REVIEW",
      auto_promotion: {
        ready: false,
        reason: "CANDIDATE_NOT_READY",
        candidate_id: null,
        streak_current: 0,
        streak_required: 2,
      },
      auto_rollback: {
        ready: false,
        reason: "NO_PATCHED_HISTORY",
      },
      coverage_guard: {
        pass: true,
        ai: { pass: true },
        market: { pass: true },
      },
    },
    phase0: {
      fresh: true,
      provider: "BINANCEFUT",
      tf: "15m",
      legacy_wait_baseline: {},
      bridge_latency: { webhook_to_fill_ms: { p95: 1420 }, duplicate_count: 0, reject_count: 0 },
    },
    selfEvolutionDataset: {
      fresh: true,
      summary: { rows_n: 10, executed_n: 5, drop_n: 3, missed_n: 1, features_coverage_rate: 0.9, febt_coverage_rate: 0.8 },
    },
    selfEvolutionCandidates: {
      summary: { total_n: 2, ready_n: 2, blocked_n: 0, top_candidate_id: "ML_GATE_CORE_SCORE_ABS", top_scope: "ML" },
      rows: [
        { candidate_id: "ML_GATE_CORE_SCORE_ABS", scope: "ML", ready_for_auto_apply: true, memory_blocked: false, failed_fingerprint_repeat: false },
        { candidate_id: "EV_TP1_THRESHOLD_TUNE", display_candidate_id: "EV_COMPOSITE_THRESHOLD_TUNE", canonical_candidate_id: "EV_COMPOSITE_THRESHOLD_TUNE", scope: "EV", ready_for_auto_apply: true, memory_blocked: false, failed_fingerprint_repeat: false },
      ],
    },
    selfEvolutionReplay: {
      validation_mode: "HISTORICAL_ENTRY_COHORT_V1",
      summary: { total_n: 2, pass_n: 1, warn_n: 0, block_n: 1, best_candidate_id: "EV_TP1_THRESHOLD_TUNE", best_verdict: "PASS", best_objective_delta: 2.5 },
      validations: [
        { candidate_id: "ML_GATE_CORE_SCORE_ABS", validation_verdict: "BLOCK", candidate_objective_delta: 0.1, blockers: ["NO_HISTORICAL_TIGHTEN_MATCH"] },
        { candidate_id: "EV_TP1_THRESHOLD_TUNE", display_candidate_id: "EV_COMPOSITE_THRESHOLD_TUNE", validation_verdict: "PASS", candidate_objective_delta: 2.5, blockers: [] },
      ],
    },
    selfEvolutionCanary: {
      summary: { total_n: 1, ready_n: 1, blocked_n: 0, rollback_ready_n: 0, apply_pass: true, global_canary_pass: true, current_open_wave: 1, open_wave: 1 },
      rows: [{ market: "BTCUSDT", wave: 1, current_stage: "SOFT", candidate_id: "EV_TP1_THRESHOLD_TUNE", canary_verdict: "READY", blockers: [] }],
    },
    selfEvolutionMemory: {
      summary: { total_n: 0, current_n: 0, success_n: 0, neutral_n: 0, fail_n: 0, rolled_back_n: 0, blocked_candidate_n: 0, blocked_candidate_ids: [] },
      current_rows: [],
      rows: [],
    },
    selfEvolutionLoopMonitor: {
      summary: { cycle_id: "cycle-r2", overall_status: "DEGRADED", cycle_consistent: true, stale_artifact_n: 0, cycle_mismatch_n: 0, critical_blocker_n: 0, critical_blockers: [], promotion_path_ready: false, manual_paste_ready: false, ready_candidate_id: "EV_TP1_THRESHOLD_TUNE", canary_open_wave: 1, loop_n: 10, fresh_loop_n: 10 },
      rows: [],
    },
    retrospective: {
      periods: {
        DAILY: { objective: { verdict: "FAIL", pass: false, executed_n: 0, realized_n: 0, failed_checks: ["NO_TRADE_ACTIVITY"] }, realized_trades: { net_pnl_quote: 0 } },
        WEEKLY: { objective: { verdict: "FAIL", pass: false, executed_n: 3, realized_n: 2, failed_checks: ["PERIOD_TARGET_NOT_MET"] }, realized_trades: { net_pnl_quote: -10 } },
        MONTHLY: { objective: { verdict: "FAIL", pass: false, executed_n: 8, realized_n: 7, failed_checks: ["MONTHLY_TARGET_NOT_MET"] }, realized_trades: { net_pnl_quote: -20 } },
      },
    },
    codex: {
      status: "FRESH",
      verdict: "PROMOTE",
      recommended_candidate_id: "EV_TP1_THRESHOLD_TUNE",
    },
    stageAutopilot: {
      fresh: true,
      objective_verdict: "HOLD",
      actions: [],
    },
  });
  assert.strictEqual(autonomousRecoveryPrefersBestReadyReplay.promotion.candidate_id, "EV_TP1_THRESHOLD_TUNE");
  assert.strictEqual(autonomousRecoveryPrefersBestReadyReplay.promotion.replay_verdict, "PASS");
  assert.strictEqual(autonomousRecoveryPrefersBestReadyReplay.reason, "AUTONOMOUS_RECOVERY_PROMOTION_READY");
  assert.strictEqual(autonomousRecoveryPrefersBestReadyReplay.self_evolution_replay.best_display_candidate_id, "EV_COMPOSITE_THRESHOLD_TUNE");

  const activeApprovedRecoveryDoesNotReopenAuthorityBlock = __test.evaluateSupervisor({
    ...base,
    changeControl: {
      verdict: "REVIEW",
      auto_promotion: {
        ready: false,
        reason: "CANDIDATE_NOT_READY",
        candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
        streak_current: 0,
        streak_required: 2,
      },
      auto_rollback: {
        ready: true,
        reason: "AUTO_ROLLBACK_READY",
        rollback_file_path: "/tmp/rollback.pine",
      },
      coverage_guard: {
        pass: true,
        ai: { pass: true },
        market: { pass: true },
      },
    },
    phase0: {
      fresh: true,
      provider: "BINANCEFUT",
      tf: "15m",
      legacy_wait_baseline: {},
      bridge_latency: { webhook_to_fill_ms: { p95: 1420 }, duplicate_count: 0, reject_count: 0 },
    },
    selfEvolutionDataset: {
      fresh: true,
      summary: { rows_n: 10, executed_n: 5, drop_n: 3, missed_n: 1, features_coverage_rate: 0.9, febt_coverage_rate: 0.8 },
    },
    selfEvolutionCandidates: {
      summary: { total_n: 1, ready_n: 1, blocked_n: 0, top_candidate_id: "AUTO_CORE_SCORE_TIGHTEN", top_scope: "PINE" },
      rows: [{ candidate_id: "AUTO_CORE_SCORE_TIGHTEN", scope: "PINE", ready_for_auto_apply: true }],
    },
    selfEvolutionReplay: {
      validation_mode: "HISTORICAL_ENTRY_COHORT_V1",
      summary: { total_n: 1, pass_n: 1, warn_n: 0, block_n: 0, best_candidate_id: "AUTO_CORE_SCORE_TIGHTEN", best_verdict: "PASS", best_objective_delta: 0.8 },
      validations: [{ candidate_id: "AUTO_CORE_SCORE_TIGHTEN", validation_verdict: "PASS", candidate_objective_delta: 0.8, blockers: [] }],
    },
    selfEvolutionCanary: {
      summary: { total_n: 1, ready_n: 1, blocked_n: 0, rollback_ready_n: 0, apply_pass: true, global_canary_pass: true, current_open_wave: 1, open_wave: 1 },
      rows: [{ market: "BTCUSDT", wave: 1, current_stage: "SOFT", candidate_id: "AUTO_CORE_SCORE_TIGHTEN", canary_verdict: "READY", blockers: [] }],
    },
    selfEvolutionBundleActivation: {
      summary: {
        activation_confirmed: true,
        activation_pending: false,
        activation_status: "ACTIVE",
        activation_reason: "ACTIVE_BY_PROBE",
        engine_bundle_loaded: true,
        policy_bundle_loaded: true,
        market_data_flow_ok: true,
        probe_pass: true,
        probe_status: "PASS",
        probe_reason: "PROBE_PASS",
        engine_bundle_id: "strategy:donbeolja_v6.0.3.3",
        policy_bundle_id: "policy-1",
        threshold_bundle_signature: "threshold-1",
        source_mode_signature: "source-1",
        first_decision_seen: false,
      },
    },
    selfEvolutionMemory: {
      summary: { total_n: 0, current_n: 0, success_n: 0, neutral_n: 0, fail_n: 0, rolled_back_n: 0, blocked_candidate_n: 0, blocked_candidate_ids: [] },
      current_rows: [],
      rows: [],
    },
    selfEvolutionLoopMonitor: {
      summary: { cycle_id: "cycle-r", overall_status: "APPLIED_ACTIVE", cycle_consistent: true, stale_artifact_n: 0, cycle_mismatch_n: 0, critical_blocker_n: 0, critical_blockers: [], promotion_path_ready: true, manual_paste_ready: false, ready_candidate_id: "AUTO_CORE_SCORE_TIGHTEN", canary_open_wave: 1, loop_n: 10, fresh_loop_n: 10 },
      rows: [],
    },
    retrospective: {
      periods: {
        DAILY: {
          objective: {
            verdict: "FAIL",
            pass: false,
            executed_n: 0,
            realized_n: 0,
            failed_checks: ["NO_TRADE_ACTIVITY"],
          },
          realized_trades: { net_pnl_quote: 0 },
        },
        WEEKLY: {
          objective: {
            verdict: "FAIL",
            pass: false,
            executed_n: 3,
            realized_n: 2,
            failed_checks: ["PERIOD_TARGET_NOT_MET"],
          },
          realized_trades: { net_pnl_quote: -10 },
        },
        MONTHLY: {
          objective: {
            verdict: "FAIL",
            pass: false,
            executed_n: 8,
            realized_n: 7,
            failed_checks: ["MONTHLY_TARGET_NOT_MET"],
          },
          realized_trades: { net_pnl_quote: -20 },
        },
      },
    },
    codex: {
      status: "FRESH",
      verdict: "PROMOTE",
      recommended_candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
    },
    stageAutopilot: {
      fresh: true,
      objective_verdict: "HOLD",
      actions: [],
    },
    manualPasteAck: {
      acknowledged: true,
      acknowledged_at_iso: "2026-03-31T12:00:00.000Z",
      target_candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
      candidate_signature: "AUTO_CORE_SCORE_TIGHTEN",
      prepared_file_path: "/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.0.3.3.pine.txt",
      applied_strategy_id: "donbeolja_v6.0.3.3",
    },
    preparedOverride: {
      active: true,
      prepared_stage_ready: true,
      prepared_file_path: "/Users/jeongjaeyong/Projects/donbeolja/code/donbeolja_v6.0.3.3.pine.txt",
      prepared_strategy_id: "donbeolja_v6.0.3.3",
      target_candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
      display_candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
      prepared_reason: "MANUAL_PREPARED_OVERRIDE",
      override_source: "MANUAL",
    },
    signalsCache: { docs: [] },
  });
  assert.strictEqual(activeApprovedRecoveryDoesNotReopenAuthorityBlock.verdict, "PATCH_CANDIDATE");
  assert.strictEqual(activeApprovedRecoveryDoesNotReopenAuthorityBlock.reason, "AUTONOMOUS_RECOVERY_PROMOTION_READY");
  assert.notStrictEqual(activeApprovedRecoveryDoesNotReopenAuthorityBlock.reason, "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK");
  assert.strictEqual(activeApprovedRecoveryDoesNotReopenAuthorityBlock.self_evolution_deployment_plan.authority_approved, true);
  assert.strictEqual(activeApprovedRecoveryDoesNotReopenAuthorityBlock.self_evolution_deployment_plan.external_authority_pending, false);
  assert.strictEqual(activeApprovedRecoveryDoesNotReopenAuthorityBlock.blockers.includes("EXTERNAL_AUTHORITY_BLOCK_ROLLBACK"), false);

  const serverPrimaryRuntimeApprovedRecoveryDoesNotReopenAuthorityBlock = __test.evaluateSupervisor({
    ...base,
    changeControl: {
      verdict: "REVIEW",
      auto_promotion: {
        ready: false,
        reason: "CANDIDATE_NOT_READY",
        candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
        streak_current: 0,
        streak_required: 2,
      },
      auto_rollback: {
        ready: true,
        reason: "AUTO_ROLLBACK_READY",
        rollback_file_path: "/tmp/rollback.pine",
      },
      coverage_guard: {
        pass: true,
        ai: { pass: true },
        market: { pass: true },
      },
    },
    selfEvolutionCanary: {
      summary: { total_n: 1, ready_n: 1, blocked_n: 0, rollback_ready_n: 0, apply_pass: true, global_canary_pass: true, current_open_wave: 1, open_wave: 1 },
      rows: [{ market: "BTCUSDT", wave: 1, current_stage: "SOFT", candidate_id: "AUTO_CORE_SCORE_TIGHTEN", canary_verdict: "READY", blockers: [] }],
    },
    selfEvolutionBundleActivation: {
      summary: {
        activation_confirmed: false,
        activation_pending: false,
        activation_status: "N/A",
        activation_reason: "NO_ACKNOWLEDGEMENT",
        engine_bundle_loaded: true,
        policy_bundle_loaded: true,
        market_data_flow_ok: true,
        probe_pass: true,
        probe_status: "PASS",
        probe_reason: "PROBE_PASS_SERVER_PRIMARY",
        first_decision_seen: true,
        first_decision_kind: "SIGNAL",
        first_decision_id: "SIG__BINANCEFUT__BTCUSDT__15m__1774998000000__LONG",
        first_decision_created_at: "2026-04-01T01:07:18.958Z",
      },
    },
    manualPasteAck: {
      acknowledged: false,
      target_candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
      candidate_signature: "AUTO_CORE_SCORE_TIGHTEN",
      applied_strategy_id: "donbeolja_v6.1.1.0",
    },
    signalsCache: {
      docs: [
        {
          signal_id: "SIG__BINANCEFUT__BTCUSDT__15m__1774998000000__LONG",
          created_at: "2026-04-01T01:07:18.958Z",
          event: "LONG",
          features_json: { strategy_id: "donbeolja_v6.1.1.0", event: "LONG" },
        },
      ],
    },
    codex: {
      status: "FRESH",
      verdict: "PROMOTE",
      recommended_candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
    },
    stageAutopilot: {
      fresh: true,
      objective_verdict: "HOLD",
      actions: [],
    },
  });
  assert.strictEqual(serverPrimaryRuntimeApprovedRecoveryDoesNotReopenAuthorityBlock.verdict, "HOLD");
  assert.notStrictEqual(serverPrimaryRuntimeApprovedRecoveryDoesNotReopenAuthorityBlock.reason, "EXTERNAL_AUTHORITY_BLOCK_ROLLBACK");
  assert.strictEqual(serverPrimaryRuntimeApprovedRecoveryDoesNotReopenAuthorityBlock.self_evolution_deployment_plan.plan_status, "APPLIED_ACTIVE");
  assert.strictEqual(serverPrimaryRuntimeApprovedRecoveryDoesNotReopenAuthorityBlock.self_evolution_deployment_plan.authority_approved, true);
  assert.strictEqual(serverPrimaryRuntimeApprovedRecoveryDoesNotReopenAuthorityBlock.self_evolution_deployment_plan.external_authority_pending, false);
  assert.strictEqual(serverPrimaryRuntimeApprovedRecoveryDoesNotReopenAuthorityBlock.blockers.includes("EXTERNAL_AUTHORITY_BLOCK_ROLLBACK"), false);
  assert.strictEqual(serverPrimaryRuntimeApprovedRecoveryDoesNotReopenAuthorityBlock.blockers.includes("SELF_EVOLUTION_DEPLOYMENT_PLAN_BLOCK"), false);

  const autonomousRecoveryPromotionWithoutCodexPromote = __test.evaluateSupervisor({
    ...base,
    changeControl: {
      verdict: "REVIEW",
      auto_promotion: {
        ready: false,
        reason: "CANDIDATE_NOT_READY",
        candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
        streak_current: 0,
        streak_required: 2,
      },
      auto_rollback: {
        ready: false,
        reason: "NO_PATCHED_HISTORY",
      },
      coverage_guard: {
        pass: true,
        ai: { pass: true },
        market: { pass: true },
      },
    },
    phase0: {
      fresh: true,
      provider: "BINANCEFUT",
      tf: "15m",
      legacy_wait_baseline: {},
      bridge_latency: { webhook_to_fill_ms: { p95: 1420 }, duplicate_count: 0, reject_count: 0 },
    },
    selfEvolutionDataset: {
      fresh: true,
      summary: { rows_n: 10, executed_n: 5, drop_n: 3, missed_n: 1, features_coverage_rate: 0.9, febt_coverage_rate: 0.8 },
    },
    selfEvolutionCandidates: {
      summary: { total_n: 1, ready_n: 1, blocked_n: 0, top_candidate_id: "AUTO_CORE_SCORE_TIGHTEN", top_scope: "PINE" },
      rows: [{ candidate_id: "AUTO_CORE_SCORE_TIGHTEN", scope: "PINE", ready_for_auto_apply: true }],
    },
    selfEvolutionReplay: {
      validation_mode: "HISTORICAL_ENTRY_COHORT_V1",
      summary: { total_n: 1, pass_n: 1, warn_n: 0, block_n: 0, best_candidate_id: "AUTO_CORE_SCORE_TIGHTEN", best_verdict: "PASS", best_objective_delta: 0.8 },
      validations: [{ candidate_id: "AUTO_CORE_SCORE_TIGHTEN", validation_verdict: "PASS", candidate_objective_delta: 0.8, blockers: [] }],
    },
    selfEvolutionCanary: {
      summary: { total_n: 1, ready_n: 1, blocked_n: 0, rollback_ready_n: 0, apply_pass: true, global_canary_pass: true, current_open_wave: 1, open_wave: 1 },
      rows: [{ market: "BTCUSDT", wave: 1, current_stage: "SOFT", candidate_id: "AUTO_CORE_SCORE_TIGHTEN", canary_verdict: "READY", blockers: [] }],
    },
    selfEvolutionMemory: {
      summary: { total_n: 0, current_n: 0, success_n: 0, neutral_n: 0, fail_n: 0, rolled_back_n: 0, blocked_candidate_n: 0, blocked_candidate_ids: [] },
      current_rows: [],
      rows: [],
    },
    selfEvolutionLoopMonitor: {
      summary: { cycle_id: "cycle-r", overall_status: "DEGRADED", cycle_consistent: true, stale_artifact_n: 0, cycle_mismatch_n: 0, critical_blocker_n: 0, critical_blockers: [], promotion_path_ready: false, manual_paste_ready: false, ready_candidate_id: "AUTO_CORE_SCORE_TIGHTEN", canary_open_wave: 1, loop_n: 10, fresh_loop_n: 10 },
      rows: [],
    },
    retrospective: {
      periods: {
        DAILY: {
          objective: {
            verdict: "FAIL",
            pass: false,
            executed_n: 0,
            realized_n: 0,
            failed_checks: ["NO_TRADE_ACTIVITY"],
          },
          realized_trades: { net_pnl_quote: 0 },
        },
        WEEKLY: {
          objective: {
            verdict: "FAIL",
            pass: false,
            executed_n: 3,
            realized_n: 2,
            failed_checks: ["PERIOD_TARGET_NOT_MET"],
          },
          realized_trades: { net_pnl_quote: -10 },
        },
        MONTHLY: {
          objective: {
            verdict: "FAIL",
            pass: false,
            executed_n: 8,
            realized_n: 7,
            failed_checks: ["MONTHLY_TARGET_NOT_MET"],
          },
          realized_trades: { net_pnl_quote: -20 },
        },
      },
    },
    codex: {
      status: "FRESH",
      verdict: "HOLD",
      recommended_candidate_id: null,
    },
    stageAutopilot: {
      fresh: true,
      objective_verdict: "HOLD",
      actions: [],
    },
  });
  assert.strictEqual(autonomousRecoveryPromotionWithoutCodexPromote.verdict, "HOLD");
  assert.strictEqual(autonomousRecoveryPromotionWithoutCodexPromote.reason, "EXTERNAL_AUTHORITY_BLOCK_PROMOTION");
  assert.strictEqual(autonomousRecoveryPromotionWithoutCodexPromote.promotion.ready, true);
  assert.strictEqual(autonomousRecoveryPromotionWithoutCodexPromote.promotion.recovery_mode, true);
  assert.strictEqual(autonomousRecoveryPromotionWithoutCodexPromote.blockers.includes("EXTERNAL_AUTHORITY_BLOCK_PROMOTION"), true);
  assert.strictEqual(autonomousRecoveryPromotionWithoutCodexPromote.blockers.includes("EXTERNAL_AUTHORITY_REQUIRED_PROMOTION"), false);

  const monthlySourceSampleReady = __test.evaluateSupervisor({
    ...base,
    governance: {
      current: {
        objective: {
          verdict: "FAIL",
          pass: false,
          enough_sample: false,
          executed_n: 18,
          realized_n: 0,
          monthly_source_realized_n: 9,
          monthly_run_rate_krw: -471,
          monthly_pass: false,
          failed_checks: ["INSUFFICIENT_SAMPLE", "MONTHLY_TARGET_NOT_MET"],
        },
        overall: {
          win_rate: null,
          avg_ret_net: null,
          net_pnl_quote: null,
        },
      },
      objective: {
        min_monthly_net_krw: 1500000,
        realized_min_sample: 8,
      },
    },
    changeControl: {
      verdict: "HOLD",
      auto_promotion: { ready: false, reason: "CANDIDATE_NOT_READY" },
      auto_rollback: { ready: false, reason: "NO_PATCHED_HISTORY" },
      coverage_guard: { pass: true, ai: { pass: true }, market: { pass: true } },
    },
    retrospective: {
      periods: {
        DAILY: { objective: { verdict: "PASS", pass: true, executed_n: 1, realized_n: 1, failed_checks: [] }, realized_trades: { net_pnl_quote: 1 } },
        WEEKLY: { objective: { verdict: "PASS", pass: true, executed_n: 2, realized_n: 2, failed_checks: [] }, realized_trades: { net_pnl_quote: 1 } },
        MONTHLY: { objective: { verdict: "FAIL", pass: false, executed_n: 10, realized_n: 9, failed_checks: ["MONTHLY_TARGET_NOT_MET"] }, realized_trades: { net_pnl_quote: -1 } },
      },
    },
  });
  assert.strictEqual(monthlySourceSampleReady.sample_readiness.governance_realized_n, 0);
  assert.strictEqual(monthlySourceSampleReady.sample_readiness.governance_monthly_source_realized_n, 9);
  assert.strictEqual(monthlySourceSampleReady.sample_readiness.governance_effective_realized_n, 9);
  assert.strictEqual(monthlySourceSampleReady.sample_readiness.governance_enough_sample, true);
  assert.strictEqual(monthlySourceSampleReady.blockers.includes("GOVERNANCE_OBJECTIVE_SAMPLE_NOT_READY"), false);
  assert.strictEqual(monthlySourceSampleReady.blockers.includes("CHANGE_CONTROL_HOLD"), false);
  assert.deepStrictEqual(monthlySourceSampleReady.governance_objective.failed_checks, ["STRICT_SAMPLE_ONLY", "MONTHLY_TARGET_NOT_MET"]);

  const telegramSections = __test.buildObjectiveSupervisorTelegramSections({
    verdict: "HOLD",
    reason: "STAT_PHYSICS_CRITICAL",
    blockers: ["STAT_PHYSICS_CRITICAL", "EXTERNAL_AUTHORITY_REQUIRED_PROMOTION"],
    objective: {
      realized_n: 24,
      executed_n: 32,
      monthly_run_rate_krw: 1800000,
      min_monthly_net_krw: 1500000,
    },
    retrospective: {
      daily: { verdict: "PASS", executed_n: 3, realized_n: 2, net_pnl_quote: 12000 },
      weekly: { verdict: "PASS" },
      monthly: { verdict: "HOLD" },
    },
    promotion: { ready: false, reason: "BLOCKED", candidate_id: null, display_candidate_id: null },
    rollback: { ready: false, reason: "NO_PATCHED_HISTORY" },
    guards: { canary_pass: true, canary_golden_drift: 0, canary_shadow_drift: 0, coverage_pass: true },
    filter_layers: {
      integrity: { server_mode: "ENFORCED", coverage_pass: true },
      entry_quality: { pine_candidate_verdict: "READY", quality_actions: 1 },
      state_soft_sizing: { ml_action: "KEEP", physics_action: "DROP", qty_scale: 0.2 },
      ev_time_value: { tuner_reason: "KEEP", policy_version: "TP1_WEIGHT_V1", policy_source: "DEFAULT" },
      wait_timing: {
        tuner_reason: "KEEP",
        wait_action: "WAIT_HARD",
        febt_calc_ok_rate: 0.75,
        febt_phase_known: 0.75,
        febt_fire_n: 3,
        febt_late_n: 1,
        febt_void_n: 0,
        febt_disagreement_n: 2,
        febt_fallback_legacy_n: 1,
        febt_missing_rate: 0.25,
      },
    },
    physics: {
      display_state: "혼돈 임계",
      action: "DROP",
      qty_scale: 0,
      wait_hard: true,
      wait_assist: false,
      block_reason: "STAT_PHYSICS_CRITICAL",
      entropy: 0.82,
      coherence: 0.18,
      transition_risk: 0.91,
      field_alignment: 0.20,
      domain_wall_density: 0.71,
      free_energy: 0.77,
    },
    phase0: {
      available: true,
      fresh: true,
      immediate_win_rate: 0.57,
      saved_loss_pct: 0.31,
      missed_gain_pct: 0.12,
      saved_loss_minus_missed_gain: 0.19,
      webhook_to_fill_p95_ms: 1420,
      duplicate_count: 1,
      reject_count: 2,
    },
    self_evolution_policy: {
      master_spec_path: "/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_MASTER_SPEC.md",
      current_focus: "P0_DATASET,P1_OBJECTIVE,P2_ATTRIBUTION,P3_CANDIDATE_CHANGESET,P4_REPLAY,P5_CANARY,P6_AUTOROLLBACK,P7_MEMORY_LEDGER,CANARY_SCALE,DEPLOYMENT_GUARDS,DEPLOYMENT_HANDOFF,LOOP_MONITORING,MEMORY_PREBLOCK,WEIGHT_TUNING_ADVISORY",
      next_focus: "PINE_MANUAL_PASTE_HANDOFF",
      linked_paths: ["/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_DATASET_SPEC.md"],
    },
    best_febt_tuning_contract: {
      mode: "COUNT_GUARD_ACTIVE",
      tightening_allowed: false,
      recovery_priority: true,
      projected_replacement_ratio: 0.72,
      projected_count_ratio_global: 0.94,
      projected_net_signal_delta_n: -3,
      fire_n: 3,
      late_n: 2,
      disagreement_n: 4,
      fallback_legacy_n: 1,
    },
    best_febt_market_contracts: [
      {
        market: "BTCUSDT",
        mode: "NORMAL",
        projected_replacement_ratio: 1.2,
        projected_count_ratio_global: 1.05,
        fire_n: 4,
        late_n: 1,
        disagreement_n: 1,
        dominant_disagreement_reason: "FEBT_ALLOW_LEGACY_WAIT",
      },
    ],
    self_evolution_memory: {
      total_n: 4,
      current_n: 2,
      success_n: 1,
      neutral_n: 1,
      fail_n: 1,
      rolled_back_n: 1,
      blocked_candidate_n: 1,
      top_success_candidate_id: "WAIT_ONE_BAR_TUNE",
      top_failed_candidate_id: "AUTO_CORE_SCORE_TIGHTEN",
    },
    self_evolution_deployment: {
      target_candidate_id: "WAIT_ONE_BAR_TUNE",
      deploy_pass: false,
      rollback_only: false,
      blockers: ["SELF_EVOLUTION_MEMORY_BLOCK"],
      replay_verdict: "PASS",
      canary_open_wave: 2,
      market_ready_n: 1,
      market_total_n: 2,
    },
    self_evolution_deployment_plan: {
      plan_status: "PREPARE_PROMOTION",
      prepare_pass: true,
      manual_step_required: false,
      prepared_file_path: "/tmp/prepared.pine",
      latest_generated_file_path: "/tmp/latest.pine",
      rollback_source_file_path: null,
      blockers: [],
    },
    self_evolution_weight_tuning: {
      summary: {
        advisory_mode: "HOLD",
        suggestion_n: 2,
        dominant_axis: "delay_cost_weight",
        count_guard_blocked: true,
        memory_blocked: false,
        canary_blocked: false,
      },
      suggestions: [
        { axis: "delay_cost_weight", direction: "UP", delta: 0.05, reason: "LATE_LOSS_TOP_MARKET" },
      ],
    },
    codex_review: { status: "FRESH", verdict: "HOLD", reason: "BLOCKED" },
    codex_authority: { owner: "CODEX", authority_mode: "PREPARE_PROMOTION", status: "FRESH", verdict: "HOLD", manual_step_required: false, prepared_file_path: "/tmp/prepared.pine" },
    stage_autopilot: { status: "FRESH", objective_verdict: "HOLD", action_n: 0, action_types: [] },
  });
  assert.ok(Array.isArray(telegramSections));
  assert.ok(telegramSections.some((section) => section.header === "상태층(시장 물리)"));
  const physicsSection = telegramSections.find((section) => section.header === "상태층(시장 물리)");
  assert.ok(physicsSection.lines[0].includes("action DROP"));
  assert.ok(physicsSection.lines[0].includes("wait HARD"));
  const filterLayerSection = telegramSections.find((section) => section.header === "필터 계층");
  assert.ok(filterLayerSection.lines[4].includes("FEBT calc 75.00%"));
  assert.ok(filterLayerSection.lines[4].includes("fire 3"));
  assert.ok(filterLayerSection.lines[4].includes("disagree 2"));
  assert.ok(filterLayerSection.lines[4].includes("fallback 1"));
  assert.ok(telegramSections.some((section) => section.header === "FEBT Phase 0"));
  assert.ok(telegramSections.some((section) => section.header === "BEST/FEBT 공통 계약"));
  assert.ok(telegramSections.some((section) => section.header === "자기 진화 정책"));
  assert.ok(telegramSections.some((section) => section.header === "자기 진화 배포 가드"));
  assert.ok(telegramSections.some((section) => section.header === "자기 진화 배포 handoff"));
  assert.ok(telegramSections.some((section) => section.header === "외부 권한"));
  assert.ok(telegramSections.some((section) => section.header === "자기 진화 가중치 튜닝"));
  assert.ok(telegramSections.some((section) => section.header === "자기 진화 메모리"));
  assert.ok(telegramSections.some((section) => section.header === "시장별 BEST/FEBT 계약"));

  const derivedContract = __test.deriveBestFebtTuningContract({
    governance: {
      current: {
        febt_shadow: {
          projected_replacement_ratio: 0.72,
          projected_count_ratio: 0.94,
          projected_net_signal_delta_n: -3,
        },
      },
    },
    objectiveSupervisor: {
      filter_layers: {
        wait_timing: {
          tuner_reason: "KEEP",
          wait_action: "WAIT_HARD",
          febt_fire_n: 3,
          febt_late_n: 2,
          febt_void_n: 1,
          febt_disagreement_n: 4,
          febt_fallback_legacy_n: 1,
          febt_missing_rate: 0.25,
        },
      },
      phase0: {
        legacy_wait_coverage_rate: 0.08,
        legacy_wait_observed_chain_n: 12,
      },
    },
  });
  assert.strictEqual(derivedContract.mode, "COUNT_GUARD_ACTIVE");
  assert.strictEqual(derivedContract.tightening_allowed, false);
  assert.strictEqual(derivedContract.recovery_priority, true);

  const marketContracts = __test.deriveBestFebtMarketContracts({
    governance: base.governance,
    objectiveSupervisor: { verdict: "HOLD" },
  });
  const btcContract = marketContracts.find((row) => row.market === "BTCUSDT");
  const dogeContract = marketContracts.find((row) => row.market === "DOGEUSDT");
  assert.strictEqual(btcContract.mode, "NORMAL");
  assert.strictEqual(dogeContract.mode, "COUNT_GUARD_ACTIVE");

  const wrappedRetrospective = {
    display: {
      active_periods: ["DAILY"],
      periods: {
        DAILY: {
          objective: {
            verdict: "FAIL",
            pass: false,
            executed_n: 2,
            realized_n: 1,
            failed_checks: ["NO_TRADE_ACTIVITY"],
          },
          realized_trades: { net_pnl_quote: -12.5 },
        },
        WEEKLY: {
          objective: {
            verdict: "PASS",
            pass: true,
            executed_n: 8,
            realized_n: 4,
            failed_checks: [],
          },
          realized_trades: { net_pnl_quote: 21.5 },
        },
        MONTHLY: {
          objective: {
            verdict: "PASS",
            pass: true,
            executed_n: 16,
            realized_n: 7,
            failed_checks: [],
          },
          realized_trades: { net_pnl_quote: 48.1 },
        },
      },
    },
  };
  const retrospectiveSummary = __test.summarizeRetrospective(wrappedRetrospective);
  assert.strictEqual(retrospectiveSummary.available, true);
  assert.deepStrictEqual(retrospectiveSummary.active_periods, ["DAILY"]);
  assert.strictEqual(retrospectiveSummary.daily.pass, false);
  assert.strictEqual(retrospectiveSummary.weekly.pass, true);
  assert.strictEqual(retrospectiveSummary.monthly.pass, true);
  assert.strictEqual(retrospectiveSummary.daily_no_trade, true);

  const scopedRetrospectiveHold = __test.evaluateSupervisor({
    ...base,
    retrospective: {
      display: {
        active_periods: ["DAILY"],
        periods: {
          DAILY: { objective: { verdict: "FAIL", pass: false, executed_n: 1, realized_n: 1, failed_checks: ["PERIOD_TARGET_NOT_MET"] }, realized_trades: { net_pnl_quote: 12 } },
          WEEKLY: { objective: { verdict: "FAIL", pass: false, executed_n: 2, realized_n: 1, failed_checks: ["PERIOD_TARGET_NOT_MET"] }, realized_trades: { net_pnl_quote: -24 } },
          MONTHLY: { objective: { verdict: "FAIL", pass: false, executed_n: 4, realized_n: 2, failed_checks: ["PERIOD_TARGET_NOT_MET"] }, realized_trades: { net_pnl_quote: -48 } },
        },
      },
    },
    codex: null,
  });
  assert.strictEqual(scopedRetrospectiveHold.blockers.includes("DAILY_OBJECTIVE_FAIL"), true);
  assert.strictEqual(scopedRetrospectiveHold.blockers.includes("WEEKLY_OBJECTIVE_FAIL"), false);
  assert.strictEqual(scopedRetrospectiveHold.blockers.includes("RETROSPECTIVE_MONTHLY_FAIL"), false);

  const wrappedGovernanceHold = __test.evaluateSupervisor({
    ...base,
    governance: {
      display: base.governance,
    },
    retrospective: {
      display: {
        periods: {
          DAILY: { objective: { verdict: "PASS", pass: true, executed_n: 1, realized_n: 1, failed_checks: [] }, realized_trades: { net_pnl_quote: 12 } },
          WEEKLY: { objective: { verdict: "PASS", pass: true, executed_n: 2, realized_n: 1, failed_checks: [] }, realized_trades: { net_pnl_quote: 24 } },
          MONTHLY: { objective: { verdict: "PASS", pass: true, executed_n: 4, realized_n: 2, failed_checks: [] }, realized_trades: { net_pnl_quote: 48 } },
        },
      },
    },
    codex: null,
  });
  assert.strictEqual(wrappedGovernanceHold.blockers.includes("MONTHLY_TARGET_NOT_MET"), false);
  assert.strictEqual(wrappedGovernanceHold.blockers.includes("OBJECTIVE_NOT_MET"), false);
  assert.strictEqual(wrappedGovernanceHold.blockers.includes("DAILY_OBJECTIVE_FAIL"), false);
  assert.strictEqual(wrappedGovernanceHold.blockers.includes("WEEKLY_OBJECTIVE_FAIL"), false);
  assert.strictEqual(wrappedGovernanceHold.blockers.includes("RETROSPECTIVE_MONTHLY_FAIL"), false);

  const marketRegimeBoardEval = __test.evaluateSupervisor({
    ...base,
    selfEvolutionMarketObjectiveScore: {
      summary: {},
      by_market: [
        { market: "SOLUSDT", active: true, objective_score: -5.9, objective_band: "SEVERE_DRAG", drop_verdict: "FAVOR_RESCUE", drop_action: "RELAX_EV_POLICY_REVIEW" },
        { market: "AXSUSDT", active: true, objective_score: -8.5, objective_band: "SEVERE_DRAG", drop_verdict: "KEEP_DROP", drop_action: "KEEP_DROP_RULE" },
      ],
    },
    selfEvolutionServerVsPinePerformanceDelta: {
      summary: {},
      by_market: [
        { market: "SOLUSDT", active: true, verdict: "SHADOW_GAP_REVIEW", performance_delta_score: -11.2, recommended_action: "RELAX_EV_POLICY_REVIEW", mismatch_count: 1 },
        { market: "AXSUSDT", active: true, verdict: "SHADOW_GAP_REVIEW", performance_delta_score: -8.8, recommended_action: "KEEP_DROP_RULE", mismatch_count: 0 },
      ],
    },
    selfEvolutionDropValidation: {
      summary: {},
      by_market: [
        { market: "SOLUSDT", verdict: "FAVOR_RESCUE", recommended_action: "RELAX_EV_POLICY_REVIEW", dominant_family: "EV_POLICY", dominant_reason: "DROP_EV_GATE_TP1_PROB" },
        { market: "AXSUSDT", verdict: "KEEP_DROP", recommended_action: "KEEP_DROP_RULE", dominant_family: "EV_POLICY", dominant_reason: "DROP_EV_GATE_TP1_PROB" },
      ],
    },
    selfEvolutionExecutionQuality: {
      summary: {},
      by_market: [
        { market: "AXSUSDT", avg_created_to_fill_ms: 720000, partial_fill_rate_pct: 75 },
      ],
    },
    selfEvolutionReversePolicy: {
      summary: {},
      by_market: [
        { market: "SOLUSDT", verdict: "MONITOR", recommended_action: "MONITOR_REVERSE_POLICY" },
        { market: "AXSUSDT", verdict: "REVIEW_REVERSE_EXCEPTION_PATH", recommended_action: "REVIEW_REVERSE_EXCEPTION_PATH" },
      ],
    },
    selfEvolutionServerMarketCapitalAllocator: {
      summary: {
        by_market: [
          { market: "SOLUSDT", allocation_score: -1.68, recommended_action: "HOLD", execution_quality_penalty: false, reverse_policy_penalty: false, production_slot: true, exploration_slot: false },
          { market: "AXSUSDT", allocation_score: -8.57, recommended_action: "QUARANTINE", execution_quality_penalty: true, reverse_policy_penalty: true, production_slot: false, exploration_slot: true },
        ],
      },
    },
    selfEvolutionServerMarketQuarantine: {
      summary: {
        by_market: [
          { market: "AXSUSDT", quarantine_reason: "EXECUTION_QUALITY_PENALTY", quarantine_severity: "MEDIUM", recommended_action: "WATCH_ONLY_UNTIL_SERVER_EPOCH_MATURES", execution_quality_penalty: true, reverse_policy_penalty: true, learning_epoch_active: true },
        ],
      },
    },
    codex: null,
  });
  assert.strictEqual(marketRegimeBoardEval.self_evolution_market_regime_board.top_rescue_market, "SOLUSDT");
  assert.strictEqual(marketRegimeBoardEval.self_evolution_market_regime_board.top_keep_drop_market, "AXSUSDT");
  assert.strictEqual(marketRegimeBoardEval.self_evolution_market_regime_board.rescue_market_n, 1);
  assert.strictEqual(marketRegimeBoardEval.self_evolution_market_regime_board.keep_drop_market_n, 1);

  console.log("OBJECTIVE_SUPERVISOR_TEST_OK");
})();
