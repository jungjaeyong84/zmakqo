"use strict";

const assert = require("assert");
const { buildMlEvReplayStalePosDiagnostics } = require("../utils/mlEvReplayStalePosDiagnostics");

(() => {
  const report = buildMlEvReplayStalePosDiagnostics({
    dataset: {
      rows: [
        {
          market: "XRPUSDT",
          entry_grade: "EARLY",
          event: "LONG",
          febt_phase: "PREPARE",
          source_row_type: "DROP",
          features_json: {
            reason: "PINE_DROP_STALE_POS_TO_ENTRY",
            ev_gate_tp1_reach_prob_lower_bound: 0.45,
            ev_gate_tp1_reach_prob: 0.58,
            ev_gate_effective_n: 8.48,
            ev_gate_same_dir_streak: 2,
            cost_shield_block_add: true,
            pro_conflict: false,
          },
          febt_delay_cost: 0.23,
          febt_late_risk: 0.25,
          febt_failure_risk: 0.61,
          febt_edge: -0.03,
        },
        {
          market: "SOLUSDT",
          entry_grade: "EARLY",
          event: "SHORT",
          febt_phase: "ARMED",
          source_row_type: "DROP",
          features_json: {
            reason: "PINE_DROP_STALE_POS_TO_ENTRY",
            ev_gate_tp1_reach_prob_lower_bound: 0.40,
            ev_gate_tp1_reach_prob: 0.56,
            ev_gate_effective_n: 8.48,
            ev_gate_same_dir_streak: 4,
            cost_shield_block_add: true,
            pro_conflict: false,
          },
          febt_delay_cost: 0.44,
          febt_late_risk: 0.36,
          febt_failure_risk: 0.35,
          febt_edge: 0.07,
        },
      ],
    },
    mlEvReplayProfileContribution: {
      summary: {
        top_return_drag_market: "XRPUSDT",
        top_return_drag_profile: "EARLY|LONG|PINE_DROP_STALE_POS_TO_ENTRY|PREPARE",
        top_mixed_market: "SOLUSDT",
        top_mixed_profile: "EARLY|SHORT|PINE_DROP_STALE_POS_TO_ENTRY|ARMED",
      },
    },
  });

  assert.strictEqual(report.status, "ML_EV_REPLAY_STALE_POS_DIAGNOSTICS_READY");
  assert.strictEqual(report.top_return_drag_profile, "EARLY|LONG|PINE_DROP_STALE_POS_TO_ENTRY|PREPARE");
  assert.strictEqual(report.top_return_drag_avg_ev_lb, 0.45);
  assert.strictEqual(report.top_mixed_profile, "EARLY|SHORT|PINE_DROP_STALE_POS_TO_ENTRY|ARMED");
  assert.strictEqual(report.top_mixed_avg_same_dir_streak, 4);
  assert.strictEqual(report.top_mixed_cost_shield_block_add_rate, 1);

  console.log("ML_EV_REPLAY_STALE_POS_DIAGNOSTICS_TEST_OK");
})();
