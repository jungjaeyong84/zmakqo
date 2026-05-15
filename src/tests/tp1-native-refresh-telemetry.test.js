"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceTickExit");

function buildPosition(meta = {}) {
  return {
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    symbol_or_pair_id: "ETHUSDT",
    state: "OPEN",
    avg_price: 2320,
    leverage: 10,
    meta: {
      simplified_exit_v2_enabled: true,
      tp_p1_done: false,
      tp_p1_pending: false,
      trail_active: false,
      ...meta,
    },
  };
}

function run() {
  const refreshPlan = {
    needed: true,
    reason: "NATIVE_TP_MISSING",
    needsStop: false,
    needsTp: true,
  };

  assert.strictEqual(
    __test.shouldTrackTp1NativeRefreshLifecycle({
      position: buildPosition(),
      refreshPlan,
    }),
    true
  );

  assert.strictEqual(
    __test.shouldTrackTp1NativeRefreshLifecycle({
      position: {
        ...buildPosition(),
        meta: { simplified_exit_v2_enabled: false, tp_p1_done: false, tp_p1_pending: false, trail_active: false },
      },
      refreshPlan,
    }),
    false
  );

  const telemetry = __test.buildTp1NativeRefreshTelemetryPayload({
    symbol: "ETHUSDT",
    tf: "15m",
    position: buildPosition({
      native_protection_tp_order_id: null,
      native_protection_tp_status: null,
    }),
    refreshPlan,
    refreshResult: {
      ok: true,
      tp_order_id: "tp1-order-1",
      tp_status: "OK",
      tp_price: 2358.98,
      tp_qty_ratio: 0.5,
      attempts: 1,
      max_attempts: 3,
    },
    nativeProtectionState: { tpActive: false },
    phase: "RESULT",
  });
  assert.strictEqual(telemetry.symbol, "ETHUSDT");
  assert.strictEqual(telemetry.phase, "RESULT");
  assert.strictEqual(telemetry.refresh_needs_tp, true);
  assert.strictEqual(telemetry.refresh_tp_order_id, "tp1-order-1");
  assert.strictEqual(telemetry.refresh_tp_status, "OK");

  const missingMetaSync = __test.buildTp1MetaSyncTelemetryPayload({
    symbol: "ETHUSDT",
    tf: "15m",
    beforePosition: buildPosition(),
    afterPosition: buildPosition(),
    refreshPlan,
    refreshResult: {
      ok: true,
      tp_order_id: "tp1-order-1",
      tp_status: "OK",
    },
  });
  assert.strictEqual(missingMetaSync.meta_sync_ok, false);
  assert.ok(missingMetaSync.issue_codes.includes("TP1_META_SYNC_MISSING"));
  assert.ok(missingMetaSync.issue_codes.includes("TP1_META_SYNC_STATUS_NOT_OK"));

  const mismatchMetaSync = __test.buildTp1MetaSyncTelemetryPayload({
    symbol: "ETHUSDT",
    tf: "15m",
    beforePosition: buildPosition(),
    afterPosition: buildPosition({
      native_protection_tp_order_id: "tp1-order-2",
      native_protection_tp_status: "OK",
      native_protection_tp_price: 2358.98,
      native_protection_tp_qty_ratio: 0.5,
    }),
    refreshPlan,
    refreshResult: {
      ok: true,
      tp_order_id: "tp1-order-1",
      tp_status: "OK",
    },
  });
  assert.strictEqual(mismatchMetaSync.meta_sync_ok, false);
  assert.ok(mismatchMetaSync.issue_codes.includes("TP1_META_SYNC_ORDER_ID_MISMATCH"));

  const healthyMetaSync = __test.buildTp1MetaSyncTelemetryPayload({
    symbol: "ETHUSDT",
    tf: "15m",
    beforePosition: buildPosition(),
    afterPosition: buildPosition({
      native_protection_tp_order_id: "tp1-order-1",
      native_protection_tp_status: "OK",
      native_protection_tp_price: 2358.98,
      native_protection_tp_qty_ratio: 0.5,
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
  assert.strictEqual(healthyMetaSync.meta_sync_ok, true);
  assert.deepStrictEqual(healthyMetaSync.issue_codes, []);

  const livePaperSentinelMetaSync = __test.buildTp1MetaSyncTelemetryPayload({
    symbol: "ETHUSDT",
    tf: "15m",
    beforePosition: buildPosition({
      live_paper_mode: true,
      exchange_write_performed: false,
      canary_mode: "LIVE_PAPER_NO_EXCHANGE",
    }),
    afterPosition: buildPosition({
      live_paper_mode: true,
      exchange_write_performed: false,
      canary_mode: "LIVE_PAPER_NO_EXCHANGE",
      native_protection_tp_order_id: "TP1__NO_EXCHANGE__LIVE_PAPER__eth1",
      native_protection_tp_status: null,
      native_protection_tp_price: 2358.98,
      native_protection_tp_qty_ratio: 0.5,
    }),
    refreshPlan,
    refreshResult: {
      ok: true,
      tp_order_id: "TP1__NO_EXCHANGE__LIVE_PAPER__eth1",
      tp_status: "PLACED",
      tp_price: 2358.98,
      tp_qty_ratio: 0.5,
    },
  });
  assert.strictEqual(livePaperSentinelMetaSync.live_paper_internal, true);
  assert.strictEqual(livePaperSentinelMetaSync.after_tp_status, "OK");
  assert.strictEqual(livePaperSentinelMetaSync.meta_sync_ok, true);
  assert.deepStrictEqual(livePaperSentinelMetaSync.issue_codes, []);

  console.log("TP1_NATIVE_REFRESH_TELEMETRY_TEST_OK");
}

try {
  run();
} catch (err) {
  console.error("TP1_NATIVE_REFRESH_TELEMETRY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
}
