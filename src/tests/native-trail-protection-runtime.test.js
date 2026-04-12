"use strict";

const assert = require("assert");
const { loadNativeTrailProtectionRuntime, __test } = require("../services/nativeTrailProtectionRuntime");

async function run() {
  assert.strictEqual(__test.isActivePosition({ state: "ACTIVE", size_pct: 1 }), true);
  assert.strictEqual(__test.isActivePosition({ state: "FLAT", size_pct: 1 }), false);

  const gap = __test.buildNativeTrailProtectionGapRecord({
    exchange: "BINANCEFUT",
    symbol_or_pair_id: "ETHUSDT",
    state: "ACTIVE",
    size_pct: 1,
    qty_base: 0.339,
    meta: {
      trail_active: true,
      tp_p1_done: true,
      native_protection_refresh_status: "MISSING",
      exchange_projection_invariants: ["NATIVE_STOP_MISSING"],
    },
  });
  assert.strictEqual(gap.gap, true);
  assert.strictEqual(gap.symbol, "ETHUSDT");

  const runtime = await loadNativeTrailProtectionRuntime({
    exchange: "BINANCEFUT",
    listPositions: async () => ([
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "ETHUSDT",
        state: "ACTIVE",
        size_pct: 1,
        qty_base: 0.339,
        meta: {
          trail_active: true,
          tp_p1_done: true,
          native_protection_refresh_status: "MISSING",
          exchange_projection_invariants: ["NATIVE_STOP_MISSING"],
        },
      },
      {
        exchange: "BINANCEFUT",
        symbol_or_pair_id: "BTCUSDT",
        state: "ACTIVE",
        size_pct: 1,
        qty_base: 0.01,
        meta: {
          trail_active: false,
          native_protection_refresh_status: "OK",
        },
      },
    ]),
  });
  assert.strictEqual(runtime.gap_count, 1);
  assert.strictEqual(runtime.active_position_count, 2);
  assert.strictEqual(runtime.top_symbols[0].symbol, "ETHUSDT");
}

run()
  .then(() => console.log("NATIVE_TRAIL_PROTECTION_RUNTIME_TEST_OK"))
  .catch((err) => {
    console.error("NATIVE_TRAIL_PROTECTION_RUNTIME_TEST_FAIL", err && err.stack ? err.stack : err);
    process.exit(1);
  });
