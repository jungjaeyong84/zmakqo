"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-codex-weekly-patch-engine");

(() => {
  const prompt = __test.buildPrompt({
    objectiveSupervisor: {
      verdict: "HOLD",
      reason: "OBJECTIVE_ON_TRACK",
      best_febt_tuning_contract: {
        mode: "RECOVERY_FIRST",
        tightening_allowed: false,
        recovery_priority: true,
        projected_replacement_ratio: 0.78,
        projected_count_ratio_global: 0.96,
        projected_net_signal_delta_n: -2,
      },
      self_evolution_policy: {
        master_spec_path: "/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_MASTER_SPEC.md",
        objective_latest_path: "/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_objective_latest.json",
        attribution_latest_path: "/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_attribution_latest.json",
        canary_latest_path: "/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_canary_latest.json",
        deployment_guards_latest_path: "/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_deployment_guards_latest.json",
        deployment_plan_latest_path: "/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_deployment_plan_latest.json",
        loop_monitor_latest_path: "/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_loop_monitor_latest.json",
        weight_tuning_latest_path: "/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_weight_tuning_latest.json",
        memory_latest_path: "/Users/jeongjaeyong/Projects/donbeolja/ops/daily/best_self_evolution_memory_latest.json",
        linked_paths: [
          "/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_DATASET_SPEC.md",
          "/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_OBJECTIVE_SCORE_SPEC.md",
        ],
      },
      self_evolution_objective: {
        objective_score: 3.2145,
        count_floor_pass: false,
        replacement_floor_pass: true,
        latency_budget_pass: true,
        fire_win_rate: 0.58,
        tp1_first_rate: 0.61,
        projected_count_ratio_global: 0.96,
        projected_replacement_ratio: 0.78,
        top_market: { market: "BTCUSDT", objective_score: 4.5 },
        bottom_market: { market: "DOGEUSDT", objective_score: -0.8 },
      },
      self_evolution_attribution: {
        drop_top_layer: { key: "QUALITY", count: 12 },
        late_loss_top_market: { key: "DOGEUSDT", count: 5 },
        false_fire_top_market: { key: "ETHUSDT", count: 2 },
        missed_recovery_top_reason: { key: "DROP_WAIT_ONE_BAR_TIMING", count: 4 },
        fallback_cost_top_market: { key: "SOLUSDT", count: 1 },
      },
      self_evolution_candidates: {
        total_n: 6,
        ready_n: 2,
        blocked_n: 1,
        top_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
        top_scope: "PINE",
      },
      self_evolution_replay: {
        validation_mode: "OFFLINE_PROXY_V1",
        total_n: 6,
        pass_n: 1,
        warn_n: 3,
        block_n: 2,
        best_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
        best_verdict: "PASS",
        best_objective_delta: 0.62,
      },
      self_evolution_canary: {
        total_n: 6,
        shadow_n: 4,
        soft_n: 2,
        hard_n: 0,
        ready_n: 2,
        blocked_n: 4,
        rollback_ready_n: 1,
        apply_pass: true,
        current_open_wave: 1,
        open_wave: 2,
        scale_allowed: true,
        next_wave_candidate: 3,
        top_ready_market: "BTCUSDT",
        top_rollback_market: "DOGEUSDT",
      },
      self_evolution_deployment: {
        target_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
        deploy_pass: false,
        rollback_only: false,
        blockers: ["SELF_EVOLUTION_MEMORY_BLOCK"],
        replay_verdict: "PASS",
        canary_open_wave: 2,
        market_ready_n: 2,
        market_total_n: 6,
      },
      self_evolution_deployment_plan: {
        plan_status: "PREPARE_PROMOTION",
        prepare_pass: false,
        manual_step_required: false,
        display_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
        open_wave: 2,
        market_scope_ready_n: 2,
        market_scope_n: 6,
        prepared_file_path: "/tmp/prepared.pine",
        latest_generated_file_path: "/tmp/latest.pine",
        rollback_source_file_path: null,
      },
      self_evolution_memory: {
        total_n: 12,
        current_n: 6,
        success_n: 2,
        neutral_n: 5,
        fail_n: 3,
        rolled_back_n: 2,
        blocked_candidate_n: 1,
        blocked_candidate_ids: ["AUTO_CORE_REGIME_TIGHTEN"],
        top_success_candidate_id: "WAIT_ONE_BAR_TUNE",
        top_failed_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
      },
      self_evolution_weight_tuning: {
        summary: {
          advisory_mode: "HOLD",
          suggestion_n: 2,
          dominant_axis: "delay_cost_weight",
        },
        suggestions: [
          { axis: "delay_cost_weight", direction: "UP", delta: 0.05, reason: "LATE_LOSS_TOP_MARKET" },
        ],
      },
      codex_authority: {
        owner: "CODEX",
        authority_mode: "PREPARE_PROMOTION",
        status: "FRESH",
        verdict: "HOLD",
        display_candidate_id: "AUTO_CORE_REGIME_TIGHTEN",
        prepared_file_path: "/tmp/prepared.pine",
      },
      best_febt_market_contracts: [
        {
          market: "BTCUSDT",
          mode: "NORMAL",
          projected_replacement_ratio: 1.1,
          projected_count_ratio_global: 1.02,
          fire_n: 5,
          late_n: 1,
          disagreement_n: 1,
          dominant_disagreement_reason: "FEBT_ALLOW_LEGACY_WAIT",
        },
        {
          market: "DOGEUSDT",
          mode: "COUNT_GUARD_ACTIVE",
          projected_replacement_ratio: 0.5,
          projected_count_ratio_global: 0.85,
          fire_n: 1,
          late_n: 4,
          disagreement_n: 3,
          dominant_disagreement_reason: "FEBT_BLOCK_LEGACY_ALLOW",
        },
      ],
      filter_layers: {
        integrity: { server_mode: "INTEGRITY_GUARD_ONLY", coverage_pass: true },
        entry_quality: { pine_candidate_verdict: "WATCHLIST_ONLY", quality_actions: 2 },
        state_soft_sizing: { ml_action: "KEEP", physics_action: "REDUCE", qty_scale: 0.7 },
        ev_time_value: { tuner_reason: "KEEP", policy_version: "TP1_WEIGHT_V1", policy_source: "DEFAULT" },
        wait_timing: { tuner_reason: "KEEP", wait_action: "ALLOW" },
      },
    },
    governance: { current: { objective: { verdict: "PASS", monthly_run_rate_krw: 1800000 } } },
    changeControl: { auto_promotion: { ready: false, reason: "HOLD", candidate_id: null }, auto_rollback: { ready: false, reason: "NO_PATCHED_HISTORY" } },
    patchCandidates: { verdict: "WATCHLIST_ONLY", candidates: [] },
    ml: { recommendations: { QUALITY: [{ id: 1 }], MARKET: { action: "KEEP" }, EV: { action: "KEEP" } } },
    ev: { decision_reason: "KEEP" },
    wait: { reason: "KEEP" },
    canary: { shadow: { summary: { drift: 0 } } },
    stageAutopilot: { objective_verdict: "HOLD", actions: [] },
    deploymentPlan: { summary: { plan_status: "PREPARE_PROMOTION", target_candidate_id: "AUTO_CORE_REGIME_TIGHTEN" } },
    loopMonitor: { summary: { overall_status: "DEGRADED", fresh_loop_n: 8, loop_n: 10, critical_blockers: ["SELF_EVOLUTION_CANARY_APPLY_BLOCK"], ready_candidate_id: "AUTO_CORE_REGIME_TIGHTEN", canary_open_wave: 2 } },
    retrospective: { periods: { DAILY: { objective: { verdict: "PASS" }, realized_trades: { net_pnl_quote: 1000 } }, WEEKLY: { objective: { verdict: "PASS" }, realized_trades: { net_pnl_quote: 3000 } }, MONTHLY: { objective: { verdict: "PASS" }, realized_trades: { net_pnl_quote: 12000 } } } },
  });

  assert.ok(prompt.includes("1차 상태/무결성 -> 2차 진입 품질 -> 3차 상태 기반 Soft Sizing -> 4차 EV/시간가치층 -> 5차 WAIT 타이밍층"));
  assert.ok(prompt.includes("legacy mapping"));
  assert.ok(prompt.includes("layer 3 state soft sizing: KEEP / physics REDUCE / qty 0.7"));
  assert.ok(prompt.includes("layer 4 EV/time value: KEEP / policy TP1_WEIGHT_V1 / source DEFAULT"));
  assert.ok(prompt.includes("BEST/FEBT weekly tuning must follow"));
  assert.ok(prompt.includes("febt_lock_arm_min, febt_lock_fire_min, febt_fire_edge_min, febt_late_hard_max, febt_fail_max"));
  assert.ok(prompt.includes("If count_ratio_global < 1.00, tightening recommendations are disallowed"));
  assert.ok(prompt.includes("BEST/FEBT weekly tuning policy"));
  assert.ok(prompt.includes("BEST self-evolution master spec"));
  assert.ok(prompt.includes("Self-evolution policy docs:"));
  assert.ok(prompt.includes("BEST_SELF_EVOLUTION_DATASET_SPEC.md"));
  assert.ok(prompt.includes("BEST self-evolution memory ledger spec"));
  assert.ok(prompt.includes("BEST self-evolution deployment guards spec"));
  assert.ok(prompt.includes("BEST self-evolution deployment plan spec"));
  assert.ok(prompt.includes("BEST self-evolution loop monitor spec"));
  assert.ok(prompt.includes("BEST self-evolution weight tuning spec"));
  assert.ok(prompt.includes("self-evolution openclaw autonomy contract"));
  assert.ok(prompt.includes("self-evolution objective recovery governor"));
  assert.ok(prompt.includes("Self-evolution objective snapshot:"));
  assert.ok(prompt.includes("objective score: 3.2145"));
  assert.ok(prompt.includes("constraints count/replacement/latency: FAIL / PASS / PASS"));
  assert.ok(prompt.includes("top market: BTCUSDT 4.5 / bottom market: DOGEUSDT -0.8"));
  assert.ok(prompt.includes("Self-evolution attribution summary:"));
  assert.ok(prompt.includes("drop top layer: QUALITY 12"));
  assert.ok(prompt.includes("missed recovery top reason: DROP_WAIT_ONE_BAR_TIMING 4"));
  assert.ok(prompt.includes("Self-evolution candidate snapshot:"));
  assert.ok(prompt.includes("total / ready / blocked: 6 / 2 / 1"));
  assert.ok(prompt.includes("top candidate: AUTO_CORE_REGIME_TIGHTEN / scope PINE"));
  assert.ok(prompt.includes("Self-evolution replay snapshot:"));
  assert.ok(prompt.includes("mode: OFFLINE_PROXY_V1"));
  assert.ok(prompt.includes("best candidate: AUTO_CORE_REGIME_TIGHTEN / verdict PASS / delta 0.62"));
  assert.ok(prompt.includes("Self-evolution canary snapshot:"));
  assert.ok(prompt.includes("total/shadow/soft/hard: 6 / 4 / 2 / 0"));
  assert.ok(prompt.includes("ready/blocked/rollback: 2 / 4 / 1 / apply PASS"));
  assert.ok(prompt.includes("wave open/current/next: 2 / 1 / 3 / scale YES"));
  assert.ok(prompt.includes("top ready: BTCUSDT / top rollback: DOGEUSDT"));
  assert.ok(prompt.includes("Self-evolution deployment guards snapshot:"));
  assert.ok(prompt.includes("target/deploy/rollback_only: AUTO_CORE_REGIME_TIGHTEN / BLOCK / NO"));
  assert.ok(prompt.includes("Self-evolution deployment plan snapshot:"));
  assert.ok(prompt.includes("status/prepare/manual: PREPARE_PROMOTION / BLOCK / NO"));
  assert.ok(prompt.includes("Self-evolution weight tuning snapshot:"));
  assert.ok(prompt.includes("advisory/suggestions/dominant: HOLD / 2 / delay_cost_weight"));
  assert.ok(prompt.includes("Self-evolution memory ledger snapshot:"));
  assert.ok(prompt.includes("total/current/blocked: 12 / 6 / 1"));
  assert.ok(prompt.includes("success/neutral/fail/rolled_back: 2 / 5 / 3 / 2"));
  assert.ok(prompt.includes("blocked candidates: AUTO_CORE_REGIME_TIGHTEN"));
  assert.ok(prompt.includes("Never retry a blocked candidate"));
  assert.ok(prompt.includes("Codex authority snapshot:"));
  assert.ok(prompt.includes("owner/mode/status/verdict: CODEX / PREPARE_PROMOTION / FRESH / HOLD"));
  assert.ok(prompt.includes("Self-evolution loop monitor snapshot:"));
  assert.ok(prompt.includes("overall/fresh/blockers: DEGRADED / 8 / 10 / SELF_EVOLUTION_CANARY_APPLY_BLOCK"));
  assert.ok(prompt.includes("febt contract mode: RECOVERY_FIRST"));
  assert.ok(prompt.includes("febt tightening allowed: NO"));
  assert.ok(prompt.includes("BEST/FEBT market contracts:"));
  assert.ok(prompt.includes("market BTCUSDT: NORMAL"));
  assert.ok(prompt.includes("market DOGEUSDT: COUNT_GUARD_ACTIVE"));

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

  const activeByBundle = __test.deriveReviewReadiness({
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
    bundleActivation: {
      summary: { activation_confirmed: true, activation_pending: false },
    },
  });
  assert.strictEqual(activeByBundle.pendingSignalConfirmation, false);
  assert.strictEqual(activeByBundle.reviewReady, true);
  assert.strictEqual(activeByBundle.blockedReason, null);

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
          confidence_floor: 0.51,
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
  assert.strictEqual(pendingAuthorityClosure.reason, "PENDING_AUTHORITY_CLOSURE_READY");
  assert.strictEqual(pendingAuthorityClosure.target_candidate_id, "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN");

  const inlineLoopMonitor = __test.deriveInlineLoopMonitorSummary(
    {
      self_evolution_loop_monitor: {
        overall_status: "DEGRADED",
        critical_blockers: ["DAILY_NO_TRADE_ACTIVITY"],
        cycle_consistent: true,
      },
    },
    {
      summary: {
        overall_status: "BLOCKED",
        critical_blockers: ["SELF_EVOLUTION_CYCLE_MISMATCH"],
        cycle_consistent: false,
      },
    }
  );
  assert.deepStrictEqual(inlineLoopMonitor, {
    overall_status: "DEGRADED",
    critical_blockers: ["DAILY_NO_TRADE_ACTIVITY"],
    cycle_consistent: true,
  });

  console.log("CODEX_WEEKLY_PATCH_ENGINE_TEST_OK");
})();
