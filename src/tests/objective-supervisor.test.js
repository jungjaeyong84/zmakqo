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

  console.log("OBJECTIVE_SUPERVISOR_TEST_OK");
})();
