const assert = require("assert");
const { buildTradesFromFills } = require("../services/tradesFromFills");

function run() {
  const baseMs = 1_711_000_000_000;
  const fills = [
    {
      fill_id: "fill-entry",
      trade_id: "TRADE__BINANCEFUT__BTCUSDT__LONG__1711000000000__1711000000000",
      intent_id: "intent-entry",
      side: "BUY",
      event: "LONG",
      exec_price: 100,
      qty_fraction: 0.3,
      exec_bar_close_time_utc_ms: baseMs,
      entry_event_id: "ENTRY_EVT",
      entry_signal_type: "LONG",
      features_json: {
        febt_phase: "FIRE",
        ev_gate_policy_version: "TP1_WEIGHT_V1",
      },
    },
    {
      fill_id: "fill-exit",
      trade_id: "TRADE__BINANCEFUT__BTCUSDT__EXIT_TP_P1__1711000900000__1711000900000",
      intent_id: "intent-exit",
      side: "SELL",
      event: "EXIT_TP_P1",
      exec_price: 104,
      qty_fraction: 0.3,
      exec_bar_close_time_utc_ms: baseMs + 900_000,
    },
  ];

  const built = buildTradesFromFills(fills, { mode: "FULL_CLOSE" });
  assert.ok(Array.isArray(built.trades));
  assert.strictEqual(built.trades.length, 1);
  assert.strictEqual(built.trades[0].source_trade_id, fills[1].trade_id);
  assert.strictEqual(built.trades[0].source_intent_id, fills[1].intent_id);
  assert.strictEqual(built.trades[0].fill_id, "fill-exit");
  assert.strictEqual(built.trades[0].entry_event_id, "ENTRY_EVT");
  assert.strictEqual(built.trades[0].entry_signal_type, "LONG");
  assert.deepStrictEqual(built.trades[0].features_json, {
    febt_phase: "FIRE",
    ev_gate_policy_version: "TP1_WEIGHT_V1",
  });

  console.log("TRADE_LINKAGE_TEST_OK");
}

run();
