"use strict";

const assert = require("assert");
const { __test: tickExitTest } = require("../services/binanceTickExit");
const { __test: liveFlowTest } = require("../../scripts/report-simplified-exit-v2-live-flow");
const { __test: tp1DrilldownTest } = require("../../scripts/report-simplified-exit-v2-tp1-drilldown");

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
  tickExitTest._tp1NativeProtectionGapState.clear();
  tickExitTest._tp1NativeProtectionGapAlertState.clear();
  tickExitTest._tp1MetaSyncGapAlertState.clear();

  const beforePosition = buildPosition();
  const refreshPlan = tickExitTest.shouldEagerRefreshNativeProtection({
    pos: beforePosition,
    nativeProtectionState: {
      stopActive: true,
      tpActive: false,
    },
  });
  const gapTelemetry = tickExitTest.resolveTp1NativeProtectionGap({
    symbol: "ETHUSDT",
    tf: "15m",
    position: beforePosition,
    refreshPlan,
    nativeProtectionState: {
      stopActive: true,
      tpActive: false,
    },
    now: Date.now(),
  });
  assert.strictEqual(gapTelemetry.escalated, true);

  let repaired = 0;
  const gapHandled = await tickExitTest.handleTp1NativeProtectionGap({
    symbol: "ETHUSDT",
    tf: "15m",
    telemetry: gapTelemetry,
    sendAlertFn: async () => ({ ok: true }),
    requestRepairFn: async () => {
      repaired += 1;
      return {
        reason: "TP1_NATIVE_PROTECTION_REPAIR_REQUESTED",
        request_id: "EXIT_REPAIR_REQUEST__ETHUSDT__TP1_NATIVE_GAP",
        dispatch_ok: true,
      };
    },
  });
  assert.strictEqual(repaired, 1);
  assert.strictEqual(gapHandled.reason, "TP1_NATIVE_PROTECTION_GAP");

  const afterPosition = buildPosition({
    native_protection_refresh_status: "OK",
    native_protection_refresh_at_ms: Date.now(),
    native_protection_tp_order_id: "tp1-order-7",
    native_protection_tp_status: "OK",
    native_protection_tp_price: 2358.98,
    native_protection_tp_qty_ratio: 0.5,
  });
  const refreshResult = {
    ok: true,
    reason: "OK",
    tp_order_id: "tp1-order-7",
    tp_status: "OK",
    tp_price: 2358.98,
    tp_qty_ratio: 0.5,
  };
  const metaSyncTelemetry = tickExitTest.buildTp1MetaSyncTelemetryPayload({
    symbol: "ETHUSDT",
    tf: "15m",
    beforePosition,
    afterPosition,
    refreshPlan,
    refreshResult,
  });
  assert.ok(metaSyncTelemetry);
  assert.strictEqual(metaSyncTelemetry.meta_sync_ok, true);
  assert.deepStrictEqual(metaSyncTelemetry.issue_codes, []);

  const healthyGapTelemetry = tickExitTest.resolveTp1NativeProtectionGap({
    symbol: "ETHUSDT",
    tf: "15m",
    position: afterPosition,
    refreshPlan: tickExitTest.shouldEagerRefreshNativeProtection({
      pos: afterPosition,
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
  assert.strictEqual(healthyGapTelemetry.active, false);

  const liveFlow = liveFlowTest.collectSymbolFlow({
    symbol: "ETHUSDT",
    position: liveFlowTest.summarizePosition(afterPosition),
    fills: [],
    alertAuditRows: [],
  });
  assert.deepStrictEqual(liveFlow.issues, []);
  assert.strictEqual(liveFlow.native_tp_armed, true);
  assert.strictEqual(liveFlow.native_tp_gap_escalated, false);

  const tp1Drilldown = tp1DrilldownTest.collectTp1Drilldown({
    symbol: "ETHUSDT",
    position: tp1DrilldownTest.summarizePosition(afterPosition),
    intents: [
      {
        symbol: "ETHUSDT",
        event: "EXIT_TP_P1_2.5P",
        status: "PENDING",
        created_at: "2026-04-17T00:02:00.000Z",
        live_submit_state: "ACKED",
        live_submit_ack_at_ms: Date.parse("2026-04-17T00:02:01.000Z"),
        live_submit_order_id: "tp1-order-7",
      },
    ],
    fills: [],
    alertRows: [],
  });
  assert.deepStrictEqual(tp1Drilldown.issues, []);
  assert.strictEqual(tp1Drilldown.native_tp_armed, true);
  assert.strictEqual(tp1Drilldown.native_tp_gap_escalated, false);

  console.log("SIMPLIFIED_EXIT_V2_TP1_REPAIR_REARM_REPLAY_TEST_OK");
}

run().catch((err) => {
  console.error("SIMPLIFIED_EXIT_V2_TP1_REPAIR_REARM_REPLAY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
