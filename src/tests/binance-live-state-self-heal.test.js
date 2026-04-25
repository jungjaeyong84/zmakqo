const assert = require("assert");
const { __test } = require("../services/binanceLiveStateSelfHeal");

async function run() {
  assert.strictEqual(typeof __test.isActivePaperPosition, "function", "isActivePaperPosition export missing");
  assert.strictEqual(typeof __test.shouldRepairBinanceLivePosition, "function", "shouldRepairBinanceLivePosition export missing");
  assert.strictEqual(typeof __test.shouldForceImmediateSelfHealNativeProtection, "function", "shouldForceImmediateSelfHealNativeProtection export missing");
  assert.strictEqual(typeof __test.buildSelfHealFailureMetaPatch, "function", "buildSelfHealFailureMetaPatch export missing");
  assert.strictEqual(typeof __test.buildExternalActiveScanFailureSummary, "function", "buildExternalActiveScanFailureSummary export missing");
  assert.strictEqual(typeof __test.extractExternalActiveSymbolsFromAccount, "function", "extractExternalActiveSymbolsFromAccount export missing");
  assert.strictEqual(typeof __test.buildSelfHealTargetSymbols, "function", "buildSelfHealTargetSymbols export missing");
  assert.strictEqual(typeof __test.listExternalActiveBinanceSymbols, "function", "listExternalActiveBinanceSymbols export missing");

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
    simplified_exit_v2_enabled: true,
    tp_p1_done: false,
    trail_active: false,
    native_protection_refresh_status: "OK",
    native_protection_tp0_order_id: null,
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

  assert.strictEqual(__test.shouldForceImmediateSelfHealNativeProtection({
    tp_p1_done: false,
    trail_active: false,
    native_protection_refresh_status: "MISSING",
    native_protection_tp_order_id: null,
    native_protection_stop_order_id: null,
  }), true);

  assert.strictEqual(__test.shouldForceImmediateSelfHealNativeProtection({
    tp_p1_done: false,
    trail_active: false,
    native_protection_refresh_status: "OK",
    native_protection_tp_order_id: "tp1",
    native_protection_stop_order_id: "stop",
  }), false);

  assert.strictEqual(__test.shouldForceImmediateSelfHealNativeProtection({
    tp_p1_done: true,
    trail_active: true,
    native_protection_refresh_status: "OK",
    native_protection_stop_order_id: null,
  }), true);

  assert.deepStrictEqual(__test.buildSelfHealFailureMetaPatch({
    reason: "repair_exception",
    error: "boom",
    atMs: 123,
  }), {
    native_protection_refresh_status: "FAILED",
    native_protection_refresh_reason: "REPAIR_EXCEPTION",
    last_self_heal_error: "boom",
    last_self_heal_at_ms: 123,
  });

  assert.deepStrictEqual(__test.buildExternalActiveScanFailureSummary({
    exchange: "binancefut",
    error: new Error("account fetch failed"),
    atMs: 456,
  }), {
    ok: false,
    reason: "EXTERNAL_ACTIVE_SCAN_FAILED",
    exchange: "BINANCEFUT",
    error: "account fetch failed",
    at_ms: 456,
  });

  assert.deepStrictEqual(__test.extractExternalActiveSymbolsFromAccount({
    positions: [
      { symbol: "DOGEUSDT", positionAmt: "152" },
      { symbol: "BNBUSDT", positionAmt: "0.02" },
      { symbol: "SOLUSDT", positionAmt: "0" },
      { symbol: "", positionAmt: "1" },
    ],
  }), ["DOGEUSDT", "BNBUSDT"]);

  assert.deepStrictEqual(__test.buildSelfHealTargetSymbols({
    internalRows: [
      { symbol_or_pair_id: "BNBUSDT", position_state: "COMMIT", qty_base: 0.02, updated_at: "2026-04-25T07:00:00.000Z" },
      { symbol_or_pair_id: "XRPUSDT", position_state: "FLAT", qty_base: 0, updated_at: "2026-04-25T07:01:00.000Z" },
    ],
    externalSymbols: ["DOGEUSDT", "BNBUSDT"],
    maxPositions: 10,
  }), ["DOGEUSDT", "BNBUSDT"]);

  console.log("BINANCE_LIVE_STATE_SELF_HEAL_TEST_OK");
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
