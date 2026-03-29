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
  assert.strictEqual(requireFresh.reason, "CODEX_REVIEW_REQUIRED_PROMOTION");

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
        avg_realized_ret_net: 0.014,
        avg_realized_pnl_quote: 1320,
        avg_hold_minutes: 47.5,
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
  assert.strictEqual(allowPromote.verdict, "PATCH_CANDIDATE");
  assert.strictEqual(allowPromote.reason, "AUTO_PROMOTION_READY");
  assert.strictEqual(allowPromote.filter_layers.integrity.label, "1차 상태/무결성");
  assert.strictEqual(allowPromote.filter_layers.state_soft_sizing.label, "3차 상태 기반 Soft Sizing");
  assert.strictEqual(allowPromote.filter_layers.ev_time_value.label, "4차 EV/시간가치층");
  assert.strictEqual(allowPromote.phase0.available, true);
  assert.strictEqual(allowPromote.phase0.immediate_win_rate, 0.57);
  assert.strictEqual(allowPromote.self_evolution_policy.master_spec_path.endsWith("BEST_SELF_EVOLUTION_MASTER_SPEC.md"), true);
  assert.strictEqual(allowPromote.self_evolution_policy.dataset_latest_path.endsWith("best_self_evolution_dataset_latest.json"), true);
  assert.strictEqual(allowPromote.self_evolution_dataset.rows_n, 24);
  assert.strictEqual(allowPromote.self_evolution_dataset.features_coverage_rate, 0.91);
  assert.strictEqual(allowPromote.best_febt_tuning_contract.mode, "NORMAL");
  assert.strictEqual(allowPromote.best_febt_tuning_contract.tightening_allowed, true);
  assert.strictEqual(Array.isArray(allowPromote.best_febt_market_contracts), true);
  assert.strictEqual(allowPromote.best_febt_market_contracts[0].market, "BTCUSDT");
  assert.strictEqual(allowPromote.best_febt_market_contracts[1].market, "DOGEUSDT");
  assert.strictEqual(allowPromote.best_febt_market_contracts[1].mode, "COUNT_GUARD_ACTIVE");

  const blockPromote = __test.evaluateSupervisor({
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
  });
  assert.strictEqual(blockPromote.verdict, "HOLD");
  assert.strictEqual(blockPromote.reason, "CODEX_REVIEW_BLOCK_PROMOTION");

  const stalePromote = __test.evaluateSupervisor({
    ...base,
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
  assert.strictEqual(stalePromote.reason, "CODEX_REVIEW_REQUIRED_PROMOTION");

  const staleAutopilot = __test.evaluateSupervisor({
    ...base,
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

  const telegramSections = __test.buildObjectiveSupervisorTelegramSections({
    verdict: "HOLD",
    reason: "STAT_PHYSICS_CRITICAL",
    blockers: ["STAT_PHYSICS_CRITICAL", "CODEX_REVIEW_REQUIRED_PROMOTION"],
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
      current_focus: "P0_DATASET,P1_OBJECTIVE,P2_ATTRIBUTION",
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
    codex_review: { status: "FRESH", verdict: "HOLD", reason: "BLOCKED" },
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
  assert.strictEqual(marketContracts[0].market, "BTCUSDT");
  assert.strictEqual(marketContracts[0].mode, "NORMAL");
  assert.strictEqual(marketContracts[1].market, "DOGEUSDT");
  assert.strictEqual(marketContracts[1].mode, "COUNT_GUARD_ACTIVE");

  console.log("OBJECTIVE_SUPERVISOR_TEST_OK");
})();
