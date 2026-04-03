"use strict";

const assert = require("assert");
const { deriveChangeResultAttribution } = require("../utils/changeResultAttribution");

function wrapObjective({ t, score, entry, intent, fill, mismatch }) {
  return {
    raw: {
      generated_at_kst: t,
      self_evolution_objective: {
        objective_score: score,
      },
      self_evolution_server_signal_quality: {
        authoritative_entry_signal_24h_n: entry,
        order_intent_24h_n: intent,
        fill_24h_n: fill,
      },
      self_evolution_server_signal_authority: {
        parity_mismatch_n: mismatch,
      },
    },
  };
}

function wrapStage({ t, rows }) {
  return {
    raw: {
      generated_at_kst: t,
      stage_rows: rows,
    },
  };
}

(() => {
  const report = deriveChangeResultAttribution({
    stageReports: [
      wrapStage({
        t: "2026-04-01 09:00:00 KST",
        rows: [
          {
            stage: "EV",
            last_action: "AUTO_APPLY",
            reason: "RELAX",
            signature: "ev=0.53",
            source: "CANONICAL_PARITY_EV_POLICY_RESCUE",
          },
        ],
      }),
    ],
    objectiveReports: [
      wrapObjective({ t: "2026-04-01 08:30:00 KST", score: -5, entry: 4, intent: 2, fill: 1, mismatch: 6 }),
      wrapObjective({ t: "2026-04-02 09:30:00 KST", score: -3.5, entry: 6, intent: 4, fill: 3, mismatch: 5 }),
      wrapObjective({ t: "2026-04-04 10:00:00 KST", score: -2.9, entry: 7, intent: 5, fill: 4, mismatch: 4 }),
    ],
  });

  assert.strictEqual(report.status, "CHANGE_RESULT_TRACKING_ACTIVE");
  assert.strictEqual(report.tracked_change_n, 1);
  assert.strictEqual(report.evaluated_24h_n, 1);
  assert.strictEqual(report.evaluated_72h_n, 1);
  assert.ok(report.top_positive_change);
  assert.strictEqual(report.top_positive_change.stage, "EV");
  assert.strictEqual(report.top_positive_change.window_24h.impact_verdict, "POSITIVE");
  assert.strictEqual(report.top_positive_change.window_24h.server_signal_fill_24h_delta, 2);
  assert.strictEqual(report.top_positive_change.window_24h.parity_mismatch_n_delta, -1);
  assert.strictEqual(report.top_positive_change.window_72h.impact_verdict, "POSITIVE");
  assert.strictEqual(report.impact_weights.tuning_status, "INSUFFICIENT_SAMPLE");
  assert.strictEqual(report.positive_change_n, 1);
  assert.strictEqual(report.adverse_change_n, 0);

  const tunedWeights = require("../utils/changeResultAttribution").__test.deriveAdaptiveImpactWeights([
    { window_24h: { status: "COMPLETE", objective_score_delta: 1.2, server_signal_fill_24h_delta: 8, server_signal_intent_24h_delta: 5, server_signal_entry_24h_delta: 4, parity_mismatch_n_delta: 1 } },
    { window_24h: { status: "COMPLETE", objective_score_delta: 0.8, server_signal_fill_24h_delta: 7, server_signal_intent_24h_delta: 4, server_signal_entry_24h_delta: 3, parity_mismatch_n_delta: 0 } },
    { window_24h: { status: "COMPLETE", objective_score_delta: -0.9, server_signal_fill_24h_delta: 1, server_signal_intent_24h_delta: 0, server_signal_entry_24h_delta: 0, parity_mismatch_n_delta: 6 } },
    { window_24h: { status: "COMPLETE", objective_score_delta: -1.1, server_signal_fill_24h_delta: 2, server_signal_intent_24h_delta: 1, server_signal_entry_24h_delta: 0, parity_mismatch_n_delta: 7 } },
  ]);
  assert.strictEqual(tunedWeights.tuning_status, "ADAPTIVE");
  assert.ok(tunedWeights.server_signal_fill_24h_delta > require("../utils/changeResultAttribution").__test.BASE_IMPACT_WEIGHTS.server_signal_fill_24h_delta);
  assert.ok(tunedWeights.parity_mismatch_n_delta > require("../utils/changeResultAttribution").__test.BASE_IMPACT_WEIGHTS.parity_mismatch_n_delta);

  console.log("CHANGE_RESULT_ATTRIBUTION_TEST_OK");
})();
