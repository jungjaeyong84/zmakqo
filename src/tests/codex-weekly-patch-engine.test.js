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
        linked_paths: [
          "/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_DATASET_SPEC.md",
          "/Users/jeongjaeyong/Projects/donbeolja/docs/BEST_SELF_EVOLUTION_OBJECTIVE_SCORE_SPEC.md",
        ],
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
  assert.ok(prompt.includes("febt contract mode: RECOVERY_FIRST"));
  assert.ok(prompt.includes("febt tightening allowed: NO"));
  assert.ok(prompt.includes("BEST/FEBT market contracts:"));
  assert.ok(prompt.includes("market BTCUSDT: NORMAL"));
  assert.ok(prompt.includes("market DOGEUSDT: COUNT_GUARD_ACTIVE"));

  console.log("CODEX_WEEKLY_PATCH_ENGINE_TEST_OK");
})();
