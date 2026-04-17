"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceTickExit");

function buildPosition(meta = {}) {
  return {
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    symbol_or_pair_id: "ETHUSDT",
    state: "OPEN",
    position_state: "OPEN",
    position_side: "LONG",
    avg_price: 2320,
    qty_base: 0.646,
    leverage: 10,
    meta: {
      simplified_exit_v2_enabled: true,
      tp_p1_done: false,
      tp_p1_pending: false,
      trail_active: false,
      native_protection_refresh_status: "FAILED",
      native_protection_refresh_at_ms: Date.now() - 20_000,
      native_protection_stop_order_id: "stop-1",
      native_protection_stop_price: 2281.72,
      native_protection_tp_order_id: null,
      native_protection_tp_status: null,
      native_protection_tp_price: null,
      native_protection_tp_qty_ratio: null,
      ...meta,
    },
  };
}

async function run() {
  __test._tp1NativeProtectionGapState.clear();
  __test._tp1NativeProtectionGapAlertState.clear();

  const staleGapPosition = buildPosition();
  const refreshPlan = __test.shouldEagerRefreshNativeProtection({
    pos: staleGapPosition,
    nativeProtectionState: {
      stopActive: true,
      tpActive: false,
    },
  });
  const staleGap = __test.resolveTp1NativeProtectionGap({
    symbol: "ETHUSDT",
    tf: "15m",
    position: staleGapPosition,
    refreshPlan,
    nativeProtectionState: {
      stopActive: true,
      tpActive: false,
    },
    now: Date.now(),
  });
  assert.strictEqual(staleGap.active, true);
  assert.strictEqual(staleGap.escalated, true);
  assert.ok(staleGap.gap_age_ms >= staleGap.escalation_ms);
  assert.ok(staleGap.issue_codes.includes("NATIVE_TP_MISSING"));
  assert.ok(staleGap.issue_codes.includes("TP1_NATIVE_GAP_STALE"));

  const payload = __test.buildTp1NativeProtectionGapAlertPayload({
    symbol: "ETHUSDT",
    tf: "15m",
    telemetry: staleGap,
  });
  assert.strictEqual(payload.title, "[P0] ETHUSDT TP1 native protection gap");
  assert.ok(payload.body.includes("reason: TP1_NATIVE_PROTECTION_GAP"));

  const first = __test.shouldSendTp1NativeProtectionGapAlert({
    symbol: "ETHUSDT",
    issueCodes: staleGap.issue_codes,
  });
  const second = __test.shouldSendTp1NativeProtectionGapAlert({
    symbol: "ETHUSDT",
    issueCodes: staleGap.issue_codes,
  });
  assert.strictEqual(first, true);
  assert.strictEqual(second, false);

  let alerted = 0;
  let repaired = 0;
  const handled = await __test.handleTp1NativeProtectionGap({
    symbol: "ETHUSDT",
    tf: "15m",
    telemetry: staleGap,
    sendAlertFn: async () => {
      alerted += 1;
      return { ok: true };
    },
    requestRepairFn: async () => {
      repaired += 1;
      return {
        reason: "TP1_NATIVE_PROTECTION_REPAIR_REQUESTED",
        request_id: "EXIT_REPAIR_REQUEST__TP1_NATIVE_GAP",
        dispatch_ok: true,
      };
    },
  });
  assert.strictEqual(alerted, 1);
  assert.strictEqual(repaired, 1);
  assert.strictEqual(handled.reason, "TP1_NATIVE_PROTECTION_GAP");
  assert.strictEqual(handled.dispatch_ok, true);

  const repairedPosition = buildPosition({
    native_protection_refresh_status: "OK",
    native_protection_tp_order_id: "tp1-order-1",
    native_protection_tp_status: "OK",
    native_protection_tp_price: 2358.98,
    native_protection_tp_qty_ratio: 0.5,
  });
  const clearedGap = __test.resolveTp1NativeProtectionGap({
    symbol: "ETHUSDT",
    tf: "15m",
    position: repairedPosition,
    refreshPlan: __test.shouldEagerRefreshNativeProtection({
      pos: repairedPosition,
      nativeProtectionState: {
        stopActive: true,
        tpActive: true,
      },
    }),
    nativeProtectionState: {
      stopActive: true,
      tpActive: true,
    },
    now: Date.now(),
  });
  assert.strictEqual(clearedGap.active, false);
  assert.strictEqual(clearedGap.reason, "TP_ACTIVE");
  assert.strictEqual(__test._tp1NativeProtectionGapState.has("ETHUSDT"), false);

  console.log("TP1_NATIVE_PROTECTION_GAP_WATCHDOG_TEST_OK");
}

run().catch((err) => {
  console.error("TP1_NATIVE_PROTECTION_GAP_WATCHDOG_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
