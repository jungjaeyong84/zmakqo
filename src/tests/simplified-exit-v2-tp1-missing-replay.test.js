"use strict";

const assert = require("assert");
const { __test: tickExitTest } = require("../services/binanceTickExit");
const { __test: liveFlowTest } = require("../../scripts/report-simplified-exit-v2-live-flow");

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
      native_protection_refresh_status: null,
      native_protection_stop_order_id: "stop-1",
      native_protection_stop_price: 2281.72,
      ...meta,
    },
  };
}

async function run() {
  tickExitTest._tp1MetaSyncGapAlertState.clear();

  const preTp1MissingTp = buildPosition({
    native_protection_tp_order_id: null,
    native_protection_tp_status: null,
    native_protection_tp_price: null,
    native_protection_tp_qty_ratio: null,
  });

  const refreshPlan = tickExitTest.shouldEagerRefreshNativeProtection({
    pos: preTp1MissingTp,
    nativeProtectionState: {
      stopActive: true,
      tpActive: false,
    },
  });
  assert.strictEqual(refreshPlan.needed, true);
  assert.strictEqual(refreshPlan.needsStop, false);
  assert.strictEqual(refreshPlan.needsTp, true);
  assert.strictEqual(refreshPlan.reason, "NATIVE_TP_MISSING");

  assert.strictEqual(
    tickExitTest.shouldTrackTp1NativeRefreshLifecycle({
      position: preTp1MissingTp,
      refreshPlan,
    }),
    true
  );

  const refreshAttemptTelemetry = tickExitTest.buildTp1NativeRefreshTelemetryPayload({
    symbol: "ETHUSDT",
    tf: "15m",
    position: preTp1MissingTp,
    refreshPlan,
    nativeProtectionState: {
      stopActive: true,
      tpActive: false,
    },
    phase: "ATTEMPT",
  });
  assert.strictEqual(refreshAttemptTelemetry.phase, "ATTEMPT");
  assert.strictEqual(refreshAttemptTelemetry.refresh_needs_tp, true);
  assert.strictEqual(refreshAttemptTelemetry.native_tp_active_before, false);
  assert.strictEqual(refreshAttemptTelemetry.native_tp_order_id_before, null);

  const missingMetaSync = tickExitTest.buildTp1MetaSyncTelemetryPayload({
    symbol: "ETHUSDT",
    tf: "15m",
    beforePosition: preTp1MissingTp,
    afterPosition: buildPosition({
      native_protection_tp_order_id: null,
      native_protection_tp_status: null,
      native_protection_tp_price: null,
      native_protection_tp_qty_ratio: null,
    }),
    refreshPlan,
    refreshResult: {
      ok: true,
      tp_order_id: "tp1-order-1",
      tp_status: "OK",
      tp_price: 2358.98,
      tp_qty_ratio: 0.5,
    },
  });
  assert.strictEqual(missingMetaSync.meta_sync_ok, false);
  assert.ok(missingMetaSync.issue_codes.includes("TP1_META_SYNC_MISSING"));
  assert.ok(missingMetaSync.issue_codes.includes("TP1_META_SYNC_STATUS_NOT_OK"));

  let alerted = 0;
  let repaired = 0;
  const handled = await tickExitTest.handleTp1MetaSyncGap({
    symbol: "ETHUSDT",
    tf: "15m",
    telemetry: missingMetaSync,
    sendAlertFn: async () => {
      alerted += 1;
      return { ok: true };
    },
    requestRepairFn: async () => {
      repaired += 1;
      return {
        reason: "TP1_META_SYNC_REPAIR_REQUESTED",
        request_id: "EXIT_REPAIR_REQUEST__ETHUSDT__TP1_META_SYNC",
        dispatch_ok: true,
      };
    },
  });
  assert.strictEqual(alerted, 1);
  assert.strictEqual(repaired, 1);
  assert.strictEqual(handled.reason, "TP1_META_SYNC_GAP");
  assert.strictEqual(handled.dispatch_ok, true);

  const flow = liveFlowTest.collectSymbolFlow({
    symbol: "ETHUSDT",
    position: liveFlowTest.summarizePosition(preTp1MissingTp),
    fills: [],
    alertAuditRows: [],
  });
  assert.strictEqual(flow.native_tp_armed, false);
  assert.strictEqual(flow.tp1_fill_seen, false);
  assert.strictEqual(flow.trail_fill_seen, false);
  assert.ok(flow.issues.some((issue) => issue.code === "V2_NATIVE_TP_MISSING_PRE_TP1"));

  console.log("SIMPLIFIED_EXIT_V2_TP1_MISSING_REPLAY_TEST_OK");
}

run().catch((err) => {
  console.error("SIMPLIFIED_EXIT_V2_TP1_MISSING_REPLAY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
