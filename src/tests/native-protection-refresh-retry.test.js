"use strict";

const assert = require("assert");
const { __test } = require("../engine/paperBinanceRunner");

async function run() {
  assert.ok(__test, "__test export missing");

  assert.strictEqual(
    __test.isRetryableNativeProtectionReason("TP1_NATIVE_PROTECTION_INCOMPLETE"),
    true,
    "incomplete TP1 native protection must retry"
  );
  assert.strictEqual(
    __test.isRetryableNativeProtectionReason("NATIVE_CANCEL_FAIL"),
    true,
    "cancel failures must retry"
  );
  assert.strictEqual(
    __test.isRetryableNativeProtectionReason("SOMETHING_ELSE"),
    false,
    "unknown reasons must not silently retry"
  );

  assert.deepStrictEqual(
    __test.resolveLiveNativeProtectionLifecycleFlags("ENTRY"),
    { opening: true, closing: false },
    "ENTRY must arm opening lifecycle"
  );
  assert.deepStrictEqual(
    __test.resolveLiveNativeProtectionLifecycleFlags("ADD"),
    { opening: true, closing: false },
    "ADD must reuse opening-side protection refresh"
  );
  assert.deepStrictEqual(
    __test.resolveLiveNativeProtectionLifecycleFlags("EXIT"),
    { opening: false, closing: true },
    "EXIT must arm closing lifecycle"
  );

  const writes = [];
  const updated = await __test.syncNativeProtectionMetaAfterRefresh({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    runId: "RUN__TEST__NATIVE_META_SYNC",
    executionMode: "LIVE",
    posMeta: {
      simplified_exit_v2_enabled: true,
      entry_exec_bar_ms: 1776500000000,
    },
    nativeProtection: {
      ok: true,
      attempts: 2,
      max_attempts: 3,
      stop_order_id: "STOP123",
      tp_order_id: "TP123",
      stop_price: 77798.1,
      tp_price: 76524.8,
      tp_qty_base: 0.012,
      tp_qty_ratio: 0.48,
      tp_status: "OK",
      tp_reason: null,
      position_side: "SHORT",
      entry_price: 77156.3,
    },
    readPosition: async () => ({
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      state: "OPEN",
      qty_base: 0.025,
      size_pct: 1,
      meta: {
        simplified_exit_v2_enabled: true,
      },
    }),
    writePositionMeta: async ({ meta }) => {
      writes.push(meta);
      return {
        exchange: "BINANCEFUT",
        symbol: "BTCUSDT",
        state: "OPEN",
        qty_base: 0.025,
        size_pct: 1,
        meta,
      };
    },
  });

  assert.strictEqual(writes.length, 1, "meta sync must write exactly once");
  assert.ok(updated && updated.meta, "meta sync must return updated position");
  assert.strictEqual(updated.meta.native_protection_stop_order_id, "STOP123");
  assert.strictEqual(updated.meta.native_protection_tp_order_id, "TP123");
  assert.strictEqual(updated.meta.native_protection_tp_status, "OK");
  assert.strictEqual(updated.meta.native_protection_refresh_status, "OK");
  assert.strictEqual(updated.meta.native_protection_side, "SHORT");

  console.log("NATIVE_PROTECTION_REFRESH_RETRY_TEST_OK");
}

run().catch((err) => {
  console.error("NATIVE_PROTECTION_REFRESH_RETRY_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
