"use strict";

const assert = require("assert");
const { derivePolicyParameterEvolutionPlan } = require("../../src/utils/policyParameterEvolutionPlan");

(() => {
  const holdPlan = derivePolicyParameterEvolutionPlan({
    objectiveRecoveryGovernor: {
      summary: {
        governor_status: "RECOVERY_CANARY_BLOCKED",
        governor_reason: "RECOVERY_CANARY_BLOCKED",
        recovery_required: true,
        memory_blocked: false,
        degraded_authority_enabled: true,
        degraded_authority_eligible: false,
        drop_validation_ev_policy_action: "RELAX_EV_POLICY_REVIEW",
      },
    },
    objectiveRecoveryEffect: {
      summary: {
        current_objective_score: -10.5,
        projected_objective_score: -7.7,
        projected_on_track: false,
        gap_closure_rate: 0.27,
        higher_delta_candidate_id: "EV_TP1_THRESHOLD_TUNE",
      },
    },
    executionQuality: {
      summary: { status: "EXECUTION_QUALITY_REVIEW" },
      by_market: [
        { market: "AXSUSDT", partial_fill_rate_pct: 80, avg_created_to_fill_ms: 800000, avg_slippage_bps: 60 },
        { market: "BTCUSDT", partial_fill_rate_pct: 30, avg_created_to_fill_ms: 200000, avg_slippage_bps: 3 },
      ],
    },
    serverMarketCapitalAllocator: {
      summary: {
        by_market: [
          { market: "AXSUSDT", active: true, recommended_action: "QUARANTINE" },
          { market: "BTCUSDT", active: true, recommended_action: "INCREASE" },
        ],
      },
    },
    serverMarketQuarantine: {
      summary: {
        by_market: [{ market: "AXSUSDT" }],
      },
    },
    explorationApplyCandidate: {
      summary: {
        manual_confirm_required: true,
        auto_apply_allowed: false,
      },
    },
  });

  assert.strictEqual(holdPlan.summary.status, "HOLD");
  assert.strictEqual(holdPlan.summary.mode, "ADVISORY_ONLY");
  assert.ok(holdPlan.summary.blockers.includes("GOVERNOR_BLOCKED"));
  assert.ok(holdPlan.summary.blockers.includes("MANUAL_CONFIRM_REQUIRED"));
  assert.ok(holdPlan.summary.blockers.includes("DEGRADED_AUTHORITY_NOT_ELIGIBLE"));
  assert.strictEqual(holdPlan.summary.ev_policy_action, "PRIORITIZE_EV_TP1_THRESHOLD_TUNE");
  assert.ok(holdPlan.summary.global_qty_scale <= 0.8);
  assert.strictEqual(holdPlan.recommendations.by_market[0].market, "AXSUSDT");
  assert.strictEqual(holdPlan.recommendations.by_market[0].mode, "WATCH_ONLY");

  const readyPlan = derivePolicyParameterEvolutionPlan({
    objectiveRecoveryGovernor: {
      summary: {
        governor_status: "RECOVERY_ACTIVE",
        governor_reason: "RECOVERY_ACTIVE",
        recovery_required: false,
        memory_blocked: false,
        degraded_authority_enabled: false,
        degraded_authority_eligible: true,
        drop_validation_ev_policy_action: "HOLD",
      },
    },
    objectiveRecoveryEffect: {
      summary: {
        current_objective_score: 0.7,
        projected_objective_score: 1.1,
        projected_on_track: true,
        gap_closure_rate: 0.9,
        higher_delta_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN",
      },
    },
    executionQuality: {
      summary: { status: "EXECUTION_QUALITY_PASS" },
      by_market: [
        { market: "BNBUSDT", partial_fill_rate_pct: 20, avg_created_to_fill_ms: 150000, avg_slippage_bps: 2 },
      ],
    },
    serverMarketCapitalAllocator: {
      summary: {
        by_market: [
          { market: "BNBUSDT", active: true, recommended_action: "INCREASE" },
        ],
      },
    },
    serverMarketQuarantine: { summary: { by_market: [] } },
    explorationApplyCandidate: {
      summary: {
        manual_confirm_required: false,
        auto_apply_allowed: true,
      },
    },
  });

  assert.strictEqual(readyPlan.summary.status, "READY");
  assert.strictEqual(readyPlan.summary.mode, "APPLY_READY");
  assert.strictEqual(readyPlan.summary.ev_policy_action, "HOLD_EV_POLICY");
  assert.ok(readyPlan.summary.global_qty_scale >= 0.95);
  assert.strictEqual(readyPlan.recommendations.by_market[0].qty_scale, 1.1);

  const driftWatchPlan = derivePolicyParameterEvolutionPlan({
    objectiveRecoveryGovernor: {
      summary: {
        governor_status: "RECOVERY_ACTIVE",
        governor_reason: "RECOVERY_ACTIVE",
        recovery_required: false,
        memory_blocked: false,
        degraded_authority_enabled: false,
        degraded_authority_eligible: true,
      },
    },
    objectiveRecoveryEffect: { summary: { current_objective_score: 0.2, projected_objective_score: 0.4, projected_on_track: true } },
    executionQuality: { summary: { status: "EXECUTION_QUALITY_PASS" }, by_market: [] },
    serverMarketCapitalAllocator: { summary: { by_market: [{ market: "ETHUSDT", active: true, recommended_action: "INCREASE" }] } },
    serverMarketQuarantine: { summary: { by_market: [] } },
    explorationApplyCandidate: { summary: { manual_confirm_required: false, auto_apply_allowed: true } },
    serverSignalDriftRemediationPlan: {
      recommendations: {
        settings_patch: {
          watch_only_review_markets_by_family: {
            OTHER_SERVER_POLICY: ["ETHUSDT", "XRPUSDT"],
          },
          watch_only_review_markets_by_subreason: {
            OTHER_SERVER_POLICY: {
              LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED: ["ETHUSDT"],
            },
          },
        },
      },
    },
  });
  const byMarket = driftWatchPlan.recommendations.by_market;
  const eth = byMarket.find((row) => row.market === "ETHUSDT");
  const xrp = byMarket.find((row) => row.market === "XRPUSDT");
  assert.ok(eth);
  assert.strictEqual(eth.mode, "WATCH_ONLY");
  assert.strictEqual(eth.qty_scale, 0);
  assert.ok(xrp);
  assert.strictEqual(xrp.mode, "WATCH_ONLY");
  assert.strictEqual(xrp.qty_scale, 0);
  assert.strictEqual(driftWatchPlan.summary.other_server_policy_watch_only_market_n, 2);
  assert.strictEqual(driftWatchPlan.summary.other_server_policy_watch_only_reason_n, 1);
  assert.strictEqual(driftWatchPlan.summary.top_other_server_policy_watch_only_reasons[0].reason, "LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED");

  console.log("POLICY_PARAMETER_EVOLUTION_PLAN_TEST_OK");
})();
