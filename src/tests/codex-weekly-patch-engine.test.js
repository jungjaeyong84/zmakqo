"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/automation-codex-weekly-patch-engine");

(() => {
  const prompt = __test.buildPrompt({
    objectiveSupervisor: {
      verdict: "HOLD",
      reason: "OBJECTIVE_ON_TRACK",
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

  console.log("CODEX_WEEKLY_PATCH_ENGINE_TEST_OK");
})();
