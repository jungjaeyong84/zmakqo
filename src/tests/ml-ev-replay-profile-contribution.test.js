"use strict";

const assert = require("assert");
const { buildMlEvReplayProfileContribution } = require("../utils/mlEvReplayProfileContribution");

(() => {
  const candidates = {
    rows: [
      {
        candidate_id: "EV_TP1_THRESHOLD_TUNE",
        display_candidate_id: "EV_COMPOSITE_THRESHOLD_TUNE",
        scope: "EV",
        markets: ["ALL"],
        changes: [{ key: "ev_gate_tp1_prob_full", current: 0.6, next: 0.58, direction: "LOOSEN" }],
        direction: "LOOSEN",
      },
    ],
  };

  const dataset = {
    rows: [
      { market: "XRPUSDT", event: "LONG", entry_grade: "EARLY", febt_phase: "PREPARE", source_row_type: "DROP", drop_stage_key: "EV", ev_verdict: "DROP", features_json: { reason: "PINE_DROP_STALE_POS_TO_ENTRY" }, realized_ret_net: -0.0083 },
      { market: "XRPUSDT", event: "LONG", entry_grade: "EARLY", febt_phase: "PREPARE", source_row_type: "DROP", drop_stage_key: "EV", ev_verdict: "DROP", features_json: { reason: "PINE_DROP_STALE_POS_TO_ENTRY" }, realized_ret_net: -0.0083 },
      { market: "SOLUSDT", event: "SHORT", entry_grade: "EARLY", febt_phase: "ARMED", source_row_type: "DROP", drop_stage_key: "EV", ev_verdict: "DROP", features_json: { reason: "PINE_DROP_STALE_POS_TO_ENTRY" }, realized_ret_net: -0.0083 },
      { market: "SOLUSDT", event: "SHORT", entry_grade: "EARLY", febt_phase: "ARMED", source_row_type: "DROP", drop_stage_key: "EV", ev_verdict: "DROP", features_json: { reason: "PINE_DROP_STALE_POS_TO_ENTRY" }, realized_ret_net: -0.0083 },
      { market: "DOGEUSDT", event: "LONG", entry_grade: "EARLY", febt_phase: "PREPARE", source_row_type: "DROP", drop_stage_key: "EV", ev_verdict: "DROP", features_json: { reason: "PINE_DROP_STALE_POS_TO_ENTRY" }, realized_ret_net: 0.01 },
    ],
  };

  const report = buildMlEvReplayProfileContribution({
    candidates,
    dataset,
    mlEvReplayMarketContribution: {
      summary: {
        candidate_id: "EV_TP1_THRESHOLD_TUNE",
        display_candidate_id: "EV_COMPOSITE_THRESHOLD_TUNE",
        top_return_drag_market: "XRPUSDT",
        top_mixed_market: "SOLUSDT",
      },
    },
  });

  assert.strictEqual(report.status, "ML_EV_REPLAY_PROFILE_CONTRIBUTION_READY");
  assert.strictEqual(report.evidence_status, "PROFILE_CONTRIBUTION_READY");
  assert.strictEqual(report.top_return_drag_market, "XRPUSDT");
  assert.strictEqual(report.top_return_drag_profile, "EARLY|LONG|PINE_DROP_STALE_POS_TO_ENTRY|PREPARE");
  assert.strictEqual(report.top_return_drag_profile_rows_delta, 2);
  assert.strictEqual(report.top_mixed_market, "SOLUSDT");
  assert.strictEqual(report.top_mixed_profile, "EARLY|SHORT|PINE_DROP_STALE_POS_TO_ENTRY|ARMED");
  assert.strictEqual(report.top_mixed_profile_rows_delta, 2);

  console.log("ML_EV_REPLAY_PROFILE_CONTRIBUTION_TEST_OK");
})();
