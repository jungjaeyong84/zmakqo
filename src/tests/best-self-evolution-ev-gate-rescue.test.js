"use strict";

const assert = require("assert");
const { __test } = require("../../scripts/report-best-self-evolution-ev-gate-rescue");

function run() {
  assert.strictEqual(__test.marketOf({ signal_id: "SIG__BINANCEFUT__XRPUSDT__15m__1774860300000__LONG" }), "XRPUSDT");
  assert.strictEqual(__test.classifyCounterfactual({ matured_n: 8, avg_horizon_ret_net: 0.01, tp1_first_rate: 0.6, sl_first_rate: 0.3 }), "FAVOR_RESCUE");
  assert.strictEqual(__test.classifyCounterfactual({ matured_n: 8, avg_horizon_ret_net: -0.01, sl_first_rate: 0.6 }), "KEEP_DROP");
  assert.strictEqual(__test.classifyCounterfactual({ matured_n: 2, avg_horizon_ret_net: 0.02 }), "HOLD_SAMPLE");

  const report = __test.buildReport({
    dropsWrapper: {
      docs: [
        {
          reason: "DROP_EV_GATE_TP1_PROB",
          event: "LONG",
          execution_mode: "LIVE",
          signal_id: "SIG__BINANCEFUT__XRPUSDT__15m__1774860300000__LONG",
          features_json: {
            entry_grade: "EARLY",
            ev_gate_tp1_reach_prob: 0.6005,
            ev_gate_tp1_reach_prob_lower_bound: 0.4699,
            ev_gate_tp1_prob_min: 0.55,
            ev_gate_tp1_prob_kill: 0.5,
            ev_gate_point_pass_kill_rescue_enabled: true,
            ev_gate_point_pass_kill_rescue_margin: 0.06,
            ev_gate_qty_scale_kill_rescue: 0.25,
          },
        },
        {
          reason: "DROP_EV_GATE_TP1_PROB",
          event: "SHORT",
          execution_mode: "LIVE",
          signal_id: "SIG__BINANCEFUT__ETHUSDT__15m__1774860300000__SHORT",
          features_json: {
            entry_grade: "CORE",
            ev_gate_tp1_reach_prob: 0.48,
            ev_gate_tp1_reach_prob_lower_bound: 0.40,
            ev_gate_tp1_prob_min: 0.55,
            ev_gate_tp1_prob_kill: 0.5,
          },
        },
      ],
    },
    governance: {
      raw: {
        current: {
          drop_counterfactual: {
            top_reasons: [
              {
                reason: "DROP_EV_GATE_TP1_PROB",
                matured_n: 10,
                tp1_first_rate: 0.6,
                sl_first_rate: 0.3,
                horizon_pos_rate: 0.7,
                avg_horizon_ret_net: 0.012,
              },
            ],
            by_reason_market: [
              {
                reason: "DROP_EV_GATE_TP1_PROB",
                market: "XRPUSDT",
                matured_n: 6,
                tp1_first_rate: 0.67,
                sl_first_rate: 0.17,
                horizon_pos_rate: 0.83,
                avg_horizon_ret_net: 0.02,
              },
            ],
          },
        },
      },
    },
    nowMeta: { kst: "2026-03-30 21:00:00 KST" },
    cycleMeta: { cycle_id: "best_self_evolution_test", generation_id: "best_self_evolution_test" },
  });

  assert.strictEqual(report.total_live_active_ev_tp1_drops, 2);
  assert.strictEqual(report.rescue_count, 1);
  assert.strictEqual(report.hard_drop_count, 1);
  assert.strictEqual(report.by_market[0].market, "XRPUSDT");
  assert.strictEqual(report.by_market[0].actual_verdict, "FAVOR_RESCUE");
  assert.strictEqual(report.by_event[0].event, "LONG");
  assert.ok(__test.renderMarkdown(report).includes("counterfactual_overall"));
}

try {
  run();
  console.log("BEST_SELF_EVOLUTION_EV_GATE_RESCUE_TEST_OK");
} catch (err) {
  console.error("BEST_SELF_EVOLUTION_EV_GATE_RESCUE_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
