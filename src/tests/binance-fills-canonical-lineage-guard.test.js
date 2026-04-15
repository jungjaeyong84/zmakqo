"use strict";

const assert = require("assert");
const { __test } = require("../services/binanceFuturesFillsSync");

async function run() {
  const authorityMap = new Map();
  const rules = {
    TP_P0: 0.008,
    TP_P0_QTY: 0.25,
    TP_P1: 0.0165,
    TP_P1_QTY: 0.5,
  };

  const blocked = __test.resolveCanonicalExternalExitEvent({
    authorityMap,
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TP_P0_0.8P",
    entryEventId: null,
    signalDocId: "SIG__ETH",
    orderMeta: { orderId: 12345 },
    positionCtx: {
      state: "ACTIVE",
      qty_base: 0.75,
      entry_qty_base: 1,
      meta: { tp_p0_done: false, tp_p1_done: false, trail_active: false },
    },
    rules,
  });
  assert.strictEqual(blocked.stage, null);
  assert.strictEqual(blocked.event, null);
  assert.strictEqual(blocked.reason, "ENTRY_LINEAGE_REQUIRED");
  assert.strictEqual(blocked.entryLineageMissing, true);
  assert.strictEqual(__test.shouldPromoteCanonicalExternalExit(blocked), false);

  const allowed = __test.resolveCanonicalExternalExitEvent({
    authorityMap,
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    event: "EXIT_TP_P0_0.8P",
    entryEventId: "ENTRY__ETH",
    signalDocId: "SIG__ETH",
    orderMeta: { orderId: 12345 },
    positionCtx: {
      state: "ACTIVE",
      qty_base: 1,
      entry_qty_base: 1,
      meta: { entry_event_id: "ENTRY__ETH", tp_p0_done: false, tp_p1_done: false, trail_active: false },
    },
    rules,
  });
  assert.strictEqual(allowed.stage, "TP0");
  assert.strictEqual(allowed.event, "EXIT_TP_P0_0.8P");
  assert.strictEqual(allowed.entryLineageMissing, false);
  assert.strictEqual(__test.shouldPromoteCanonicalExternalExit(allowed), true);

  console.log("BINANCE_FILLS_CANONICAL_LINEAGE_GUARD_TEST_OK");
}

run().catch((err) => {
  console.error("BINANCE_FILLS_CANONICAL_LINEAGE_GUARD_TEST_FAIL", err && err.stack ? err.stack : err);
  process.exit(1);
});
