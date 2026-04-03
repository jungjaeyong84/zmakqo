const assert = require("assert");
const { deriveServerSignalDriftRemediationPlan } = require("../utils/serverSignalDriftRemediationPlan");

(() => {
  const out = deriveServerSignalDriftRemediationPlan({
    parity: {
      rows: [
        { parity_match: false, market: "SOLUSDT", actual_drop_reason_family: "EV_POLICY", actual_drop_reason: "DROP_EV_GATE_TP1_PROB" },
        { parity_match: false, market: "SOLUSDT", actual_drop_reason_family: "EV_POLICY", actual_drop_reason: "DROP_EV_GATE_TP1_PROB" },
        { parity_match: false, market: "XRPUSDT", actual_drop_reason_family: "COOLDOWN_POLICY", actual_drop_reason: "DROP_OPPOSITE_COOLDOWN" },
      ],
    },
    evGateRescue: {
      by_market: [
        { market: "SOLUSDT", rescue_rate: 0.35, point_pass_lower_fail: 7, point_fail: 3 },
      ],
    },
    systemSettings: {
      ev_gate_tp1_prob_min: 0.55,
      ev_gate_tp1_prob_kill: 0.50,
      opposite_signal_cooldown_bars: 3,
      ev_gate_tp1_prob_min_by_market: { SOLUSDT: 0.55 },
      opposite_signal_cooldown_bars_by_market: { XRPUSDT: 3 },
    },
  });
  const patch = out.recommendations && out.recommendations.settings_patch ? out.recommendations.settings_patch : {};
  assert.strictEqual(out.summary.status, "PLAN_READY");
  assert.ok(Number.isFinite(Number(patch.ev_gate_tp1_prob_min_by_market && patch.ev_gate_tp1_prob_min_by_market.SOLUSDT)));
  assert.strictEqual(patch.opposite_signal_cooldown_bars_by_market && patch.opposite_signal_cooldown_bars_by_market.XRPUSDT, 2);
})();

(() => {
  const out = deriveServerSignalDriftRemediationPlan({
    parity: {
      rows: [
        { parity_match: false, market: "ETHUSDT", actual_drop_reason_family: "OTHER_SERVER_POLICY", actual_drop_reason: "LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED" },
        { parity_match: false, market: "ETHUSDT", actual_drop_reason_family: "OTHER_SERVER_POLICY", actual_drop_reason: "LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED" },
      ],
    },
    evGateRescue: { by_market: [] },
    systemSettings: { ev_gate_tp1_prob_min: 0.55, ev_gate_tp1_prob_kill: 0.5, opposite_signal_cooldown_bars: 3 },
  });
  assert.strictEqual(out.summary.status, "PLAN_READY");
  assert.strictEqual(out.summary.other_server_policy_watch_only_market_n, 1);
  assert.deepStrictEqual(
    out.recommendations.settings_patch.watch_only_review_markets_by_family.OTHER_SERVER_POLICY,
    ["ETHUSDT"]
  );
  assert.deepStrictEqual(
    out.recommendations.settings_patch.watch_only_review_markets_by_subreason.OTHER_SERVER_POLICY,
    { LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED: ["ETHUSDT"] }
  );
  assert.strictEqual(out.recommendations.other_server_policy_by_reason[0].reason, "LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED");
  assert.strictEqual(out.recommendations.other_server_policy_by_reason[0].recommended_action, "WATCH_ONLY_REVIEW");
})();

(() => {
  const out = deriveServerSignalDriftRemediationPlan({
    parity: {
      rows: [
        { parity_match: false, market: "BNBUSDT", actual_drop_reason_family: "OTHER_SERVER_POLICY", actual_drop_reason: "LIVE_RESCUE_ADD_POST_TP1_BLOCKED" },
      ],
    },
    evGateRescue: { by_market: [] },
    systemSettings: { ev_gate_tp1_prob_min: 0.55, ev_gate_tp1_prob_kill: 0.5, opposite_signal_cooldown_bars: 3 },
  });
  assert.strictEqual(out.recommendations.other_server_policy_by_reason[0].reason, "LIVE_RESCUE_ADD_POST_TP1_BLOCKED");
  assert.strictEqual(out.recommendations.other_server_policy_by_reason[0].recommended_action, "MONITOR_POST_TP1_GUARD");
  assert.deepStrictEqual(
    out.recommendations.settings_patch.watch_only_review_markets_by_subreason.OTHER_SERVER_POLICY,
    {}
  );
})();

(() => {
  const out = deriveServerSignalDriftRemediationPlan({
    parity: { rows: [] },
    evGateRescue: { by_market: [] },
    systemSettings: { ev_gate_tp1_prob_min: 0.55, ev_gate_tp1_prob_kill: 0.5, opposite_signal_cooldown_bars: 3 },
  });
  assert.strictEqual(out.summary.status, "NO_CHANGE");
  assert.deepStrictEqual(out.recommendations.settings_patch.ev_gate_tp1_prob_min_by_market, {});
  assert.deepStrictEqual(out.recommendations.settings_patch.opposite_signal_cooldown_bars_by_market, {});
})();

console.log("SERVER_SIGNAL_DRIFT_REMEDIATION_PLAN_TEST_OK");
