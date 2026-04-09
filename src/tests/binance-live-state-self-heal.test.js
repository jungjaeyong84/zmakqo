const assert = require("assert");
const { __test } = require("../services/binanceLiveStateSelfHeal");

async function run() {
  assert.strictEqual(typeof __test.isActivePaperPosition, "function", "isActivePaperPosition export missing");
  assert.strictEqual(typeof __test.shouldRepairBinanceLivePosition, "function", "shouldRepairBinanceLivePosition export missing");

  assert.strictEqual(__test.isActivePaperPosition({
    position_state: "COMMIT",
    qty_base: 1,
    size_pct: 0.5,
  }), true);

  assert.strictEqual(__test.isActivePaperPosition({
    position_state: "FLAT",
    qty_base: 0,
    size_pct: 0,
  }), false);

  assert.strictEqual(__test.shouldRepairBinanceLivePosition({
    exchange_projection_in_sync: false,
  }), true);

  assert.strictEqual(__test.shouldRepairBinanceLivePosition({
    native_protection_refresh_status: "MISSING",
  }), true);

  assert.strictEqual(__test.shouldRepairBinanceLivePosition({
    tp_p1_done: false,
    trail_active: false,
    native_protection_refresh_status: "OK",
    native_protection_tp0_order_id: "tp0",
    native_protection_tp_order_id: "tp1",
    exchange_projection_in_sync: true,
    exchange_projection_invariants: [],
  }), false);

  assert.strictEqual(__test.shouldRepairBinanceLivePosition({
    tp_p1_done: true,
    trail_active: true,
    native_protection_refresh_status: "OK",
    native_protection_stop_order_id: "stop",
    exchange_projection_in_sync: true,
    exchange_projection_invariants: ["TP1_DONE_WITH_TP_ORDER"],
  }), true);

  console.log("BINANCE_LIVE_STATE_SELF_HEAL_TEST_OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
