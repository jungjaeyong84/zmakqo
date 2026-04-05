"use strict";

const assert = require("assert");
const { deriveObjectiveRecoveryEffect } = require("../../src/utils/objectiveRecoveryEffect");

(() => {
  const report = deriveObjectiveRecoveryEffect({
    autonomyContract: {
      current_status: { recovery_required: true, objective_score: -7.4059 },
    },
    objective: {
      global_objective_score: { objective_score: -7.4059 },
      market_concentration: {
        dominant_negative_market: { market: "AXSUSDT", objective_score: -8.0321 },
        dominant_negative_share: 0.5038,
      },
    },
    objectiveSupervisor: {
      promotion: { display_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN" },
    },
    objectiveRecoveryGovernor: {
      summary: {
        recovery_required: true,
        target_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN",
        display_candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN",
        target_deploy_unit: "SERVER_SETTINGS",
      },
    },
    candidates: {
      rows: [
        {
          candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN",
          display_candidate_id: "AUTO_AXSUSDT_REGIME_TIGHTEN",
          target_deploy_unit: "SERVER_SETTINGS",
          canonical_migration_class: "PINE_THRESHOLD",
          target_market: "AXSUSDT",
          ready_for_auto_apply: true,
          memory_blocked: false,
          failed_fingerprint_repeat: false,
        },
        {
          candidate_id: "EV_TP1_THRESHOLD_TUNE",
          display_candidate_id: null,
          canonical_candidate_id: "EV_COMPOSITE_THRESHOLD_TUNE",
          target_deploy_unit: "SERVER_SETTINGS",
          canonical_migration_class: "SERVER_POLICY",
          ready_for_auto_apply: false,
          memory_blocked: false,
          failed_fingerprint_repeat: false,
          status: "STALE_ARTIFACT_SHADOW_FALLBACK",
          risk_flags: ["EV_TUNER_STALE"],
        },
      ],
    },
    replay: {
      validations: [
        {
          candidate_id: "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN",
          display_candidate_id: "AUTO_AXSUSDT_REGIME_TIGHTEN",
          validation_verdict: "PASS",
          candidate_objective_delta: 1.2783,
          projected_objective_score: -6.1276,
          before_metrics: { executed_n: 14, realized_n: 9 },
          after_metrics: { executed_n: 11, realized_n: 6, win_rate: 0.6666666667, avg_ret_net: 0.0108206763 },
        },
        {
          candidate_id: "EV_TP1_THRESHOLD_TUNE",
          display_candidate_id: null,
          validation_verdict: "PASS",
          candidate_objective_delta: 2.7902,
          projected_objective_score: -4.6157,
          after_metrics: { executed_n: 31, realized_n: 26, win_rate: 0.6153846154, avg_ret_net: 0.0075704332 },
        },
      ],
    },
    retrospective: {
      periods: {
        MONTHLY: {
          objective: { failed_checks: ["MONTHLY_TARGET_NOT_MET", "NET_NOT_POSITIVE"] },
          drops: {
            top_reasons: [
              { display_reason: "TP0/TP1/시간청산을 함께 반영한 기대값 하한이 기준보다 낮아 진입을 보류했습니다." },
            ],
          },
        },
      },
    },
  });

  assert.strictEqual(report.summary.current_objective_score, -7.4059);
  assert.strictEqual(report.summary.current_objective_score_source, "OBJECTIVE");
  assert.strictEqual(report.summary.tracking_status, "PARTIAL_RECOVERY_ONLY");
  assert.strictEqual(report.summary.target_matches_dominant_negative_market, true);
  assert.strictEqual(report.summary.best_ready_candidate_id, "AUTO_MARKET_AXSUSDT_REGIME_TIGHTEN");
  assert.strictEqual(report.summary.best_ready_matches_target, true);
  assert.strictEqual(report.summary.best_replay_candidate_id, "EV_TP1_THRESHOLD_TUNE");
  assert.strictEqual(report.summary.best_replay_display_candidate_id, "EV_COMPOSITE_THRESHOLD_TUNE");
  assert.strictEqual(report.summary.higher_delta_candidate_available, true);
  assert.strictEqual(report.summary.higher_delta_candidate_hold_reason, "STALE_ARTIFACT_SHADOW_FALLBACK");
  assert.strictEqual(report.summary.projected_win_rate_target_pass, true);
  assert.strictEqual(report.summary.projected_expectancy_pass, true);
  assert.strictEqual(report.summary.retrospective_monthly_failed_checks.includes("MONTHLY_TARGET_NOT_MET"), true);
  assert.ok(report.summary.next_actions.some((row) => row.includes("higher-delta candidate")));
  console.log("OBJECTIVE_RECOVERY_EFFECT_TEST_OK");
})();
