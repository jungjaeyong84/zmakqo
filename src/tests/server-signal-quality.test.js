"use strict";

const assert = require("assert");
const { deriveServerSignalQuality } = require("../utils/serverSignalQuality");

(() => {
  const signalsRecent = {
    docs: [
      {
        id: "SIG__BINANCEFUT__BNBUSDT__15m__1775082600000__SHORT",
        signal_id: "SIG__BINANCEFUT__BNBUSDT__15m__1775082600000__SHORT",
        source: "SERVER",
        authoritative: true,
        reason: "SERVER_NATIVE_INITIAL_SIGNAL",
        event_intent: "ENTRY",
        created_at: "2026-04-01T23:57:19.662Z",
        symbol_or_pair_id: "BNBUSDT",
      },
    ],
  };

  const intentsRecent = {
    docs: [
      {
        id: "INTENT__BINANCEFUT__BNBUSDT__15m__1775082600000__SHORT",
        intent_id: "INTENT__BINANCEFUT__BNBUSDT__15m__1775082600000__SHORT",
        created_at: "2026-04-01T23:57:19.861Z",
        signal_doc_id: null,
        features_json: {
          server_native_initial_signal: true,
        },
      },
    ],
  };

  const fillsRecent = {
    docs: [
      {
        id: "HwdJw5ydBWcch1lzPEyK",
        fill_id: "HwdJw5ydBWcch1lzPEyK",
        intent_id: "INTENT__BINANCEFUT__BNBUSDT__15m__1775082600000__SHORT",
        signal_doc_id: "SIG__BINANCEFUT__BNBUSDT__15m__1775082600000__SHORT",
        trade_id: "TRADE__BINANCEFUT__BNBUSDT__SHORT__1775082600000__1775087839861",
      },
    ],
  };

  const tradesRecent = {
    docs: [
      {
        id: "TRADE__BINANCEFUT__BNBUSDT__SHORT__1775082600000__1775087839861",
        trade_id: "TRADE__BINANCEFUT__BNBUSDT__SHORT__1775082600000__1775087839861",
      },
    ],
  };

  const report = deriveServerSignalQuality({
    signalsRecent,
    intentsRecent,
    fillsRecent,
    tradesRecent,
    parityReport: {
      summary: {
        parity_mismatch_rate: 0.2,
        parity_mismatch_n: 3,
        by_mismatch_scope: {
          FINAL_DOWNSTREAM_MISMATCH: 3,
        },
      },
      rows: [
        { parity_match: false, mismatch_scope: "FINAL_DOWNSTREAM_MISMATCH", actual_drop_reason_family: "EV_POLICY" },
        { parity_match: false, mismatch_scope: "FINAL_DOWNSTREAM_MISMATCH", actual_drop_reason_family: "EV_POLICY" },
        { parity_match: false, mismatch_scope: "FINAL_DOWNSTREAM_MISMATCH", actual_drop_reason_family: "COOLDOWN_POLICY" },
        { parity_match: false, mismatch_scope: "FINAL_DOWNSTREAM_MISMATCH", market: "ETHUSDT", actual_drop_reason_family: "OTHER_SERVER_POLICY", actual_drop_reason: "LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED" },
        { parity_match: false, mismatch_scope: "FINAL_DOWNSTREAM_MISMATCH", market: "BNBUSDT", actual_drop_reason_family: "OTHER_SERVER_POLICY", actual_drop_reason: "LIVE_RESCUE_ADD_POST_TP1_BLOCKED" },
      ],
    },
    nowMs: Date.parse("2026-04-02T00:00:00.000Z"),
  });

  assert.strictEqual(report.summary.authoritative_entry_signal_24h_n, 1);
  assert.strictEqual(report.summary.order_intent_24h_n, 1);
  assert.strictEqual(report.summary.fill_24h_n, 1);
  assert.strictEqual(report.summary.trade_24h_n, 1);
  assert.strictEqual(report.summary.quality_status, "OK");
  assert.strictEqual(report.summary.final_downstream_mismatch_n, 3);
  assert.strictEqual(report.summary.top_final_downstream_drop_reason_family.key, "EV_POLICY");
  assert.strictEqual(report.rows.final_downstream_family_actions[0].family, "EV_POLICY");
  assert.strictEqual(report.rows.final_downstream_family_actions[0].recommended_action, "RELAX_EV_POLICY_REVIEW");
  const cooldownFamily = report.rows.final_downstream_family_actions.find((row) => row.family === "COOLDOWN_POLICY");
  assert.ok(cooldownFamily);
  assert.strictEqual(cooldownFamily.recommended_action, "RELAX_OPPOSITE_COOLDOWN_REVIEW");
  assert.strictEqual(report.summary.other_server_policy_mismatch_n, 2);
  assert.strictEqual(report.summary.top_other_server_policy_reason_action.reason, "LIVE_RESCUE_ADD_LOSS_WINDOW_BLOCKED");
  assert.strictEqual(report.rows.other_server_policy_reason_actions[0].recommended_action, "WATCH_ONLY_REVIEW");
  assert.strictEqual(report.rows.other_server_policy_reason_actions[1].recommended_action, "MONITOR_POST_TP1_GUARD");

  console.log("SERVER_SIGNAL_QUALITY_TEST_OK");
})();
