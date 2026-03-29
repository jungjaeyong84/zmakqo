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
    codex_review: { status: "FRESH", verdict: "HOLD", reason: "BLOCKED" },
    stage_autopilot: { status: "FRESH", objective_verdict: "HOLD", action_n: 0, action_types: [] },
  });
  assert.ok(Array.isArray(telegramSections));
  assert.ok(telegramSections.some((section) => section.header === "상태층(시장 물리)"));
  const physicsSection = telegramSections.find((section) => section.header === "상태층(시장 물리)");
  assert.ok(physicsSection.lines[0].includes("action DROP"));
  assert.ok(physicsSection.lines[0].includes("wait HARD"));
  assert.ok(telegramSections.some((section) => section.header === "FEBT Phase 0"));

  console.log("OBJECTIVE_SUPERVISOR_TEST_OK");
})();
