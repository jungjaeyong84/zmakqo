"use strict";

const assert = require("assert");

const writer = require("../v2/openclawShadowPositionWriter");

function buildFakeDb(store, calls) {
  return {
    collection(name) {
      if (!store[name]) store[name] = {};
      return {
        doc(id) {
          return {
            async set(payload) {
              calls.push({ collection: name, docId: id });
              store[name][id] = payload;
            },
          };
        },
      };
    },
  };
}

(async function disabledWriterSkips() {
  const store = {};
  const calls = [];
  const result = await writer.writeOpenClawShadowEntryBootstrap({
    db: buildFakeDb(store, calls),
    env: {
      DONBEOLJA_V2_ENABLED: "0",
      DONBEOLJA_V2_DRY_RUN: "0",
      DONBEOLJA_V2_SHADOW_POSITION_WRITE_ENABLED: "1",
    },
    input: {
      exchange: "BINANCEFUT",
      symbol: "BTCUSDT",
      side: "LONG",
    },
    fillContext: {},
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "V2_DISABLED");
  assert.strictEqual(calls.length, 0);
})();

(async function incompleteProtectionSkipsActiveBootstrap() {
  const store = {};
  const calls = [];
  const env = {
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_SHADOW_SIGNAL_WRITE_ENABLED: "1",
    DONBEOLJA_V2_SHADOW_POSITION_WRITE_ENABLED: "1",
    DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
  };
  const result = await writer.writeOpenClawShadowEntryBootstrap({
    db: buildFakeDb(store, calls),
    env,
    input: {
      exchange: "BINANCEFUT",
      symbol: "ETHUSDT",
      side: "LONG",
      signalTf: "15m",
      signalId: "SIG__ETH__1",
      barCloseMs: 1713571200000,
      features: {},
    },
    fillContext: {
      positionSide: "LONG",
      entryPrice: 2000,
      entryQtyAbs: 0.5,
      entryEventId: "ENTRY__ETH__1",
      entryOrderId: "ORDER__ETH__1",
      entryFillGroupId: "FILL__ETH__1",
      entryIntentId: "INTENT__ETH__1",
      protectionMeta: {
        native_protection_stop_order_id: "STOP__ETH__1",
        native_protection_stop_price: 1967,
      },
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "V2_SHADOW_BOOTSTRAP_PROTECTION_INCOMPLETE");
  assert.strictEqual(calls.length, 0);
})();

(async function completeProtectionWritesBootstrapAndShadowDocs() {
  const store = {};
  const calls = [];
  const env = {
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_SHADOW_SIGNAL_WRITE_ENABLED: "1",
    DONBEOLJA_V2_SHADOW_POSITION_WRITE_ENABLED: "1",
    DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
  };
  const result = await writer.writeOpenClawShadowEntryBootstrap({
    db: buildFakeDb(store, calls),
    env,
    input: {
      exchange: "BINANCEFUT",
      symbol: "BNBUSDT",
      side: "LONG",
      signalTf: "15m",
      signalId: "SIG__BNB__15m__1",
      signalDocId: "SIG__BNB__15m__1",
      barCloseMs: 1713571200000,
      features: {
        policy_scope: "BNBUSDT_15M",
      },
    },
    fillContext: {
      positionSide: "LONG",
      entryPrice: 600,
      entryQtyAbs: 2,
      entryEventId: "ENTRY__BNB__1",
      entryOrderId: "ORDER__BNB__1",
      entryFillGroupId: "FILL__BNB__1",
      entryIntentId: "INTENT__BNB__1",
      protectionMeta: {
        native_protection_stop_order_id: "STOP__BNB__1",
        native_protection_tp_order_id: "TP1__BNB__1",
        native_protection_stop_price: 590.1,
        native_protection_tp_price: 610.08,
        native_protection_tp_qty_base: 1,
        native_protection_refresh_status: "OK",
        native_protection_refresh_at_ms: 1713571201234,
        native_protection_unprotected_window_ms: 25,
      },
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, true);
  assert.strictEqual(result.reason, "V2_SHADOW_ENTRY_BOOTSTRAP_OK");
  assert.strictEqual(calls.length, 5);

  const intents = store["dbjv2__signal_intents_v2"];
  const decisions = store["dbjv2__openclaw_decisions_v2"];
  const cycles = store["dbjv2__position_cycles_v2"];
  const projections = store["dbjv2__exit_runtime_projection_v2"];
  const protections = store["dbjv2__protection_runtime_v2"];

  const intent = intents[result.signal_intent_id];
  const decision = decisions[result.openclaw_decision_id];
  const cycle = cycles[result.position_cycle_id];
  const projection = projections[`ERPv2__${result.position_cycle_id}`];
  const protection = protections[`PRTV2__${result.position_cycle_id}`];

  assert.ok(intent);
  assert.ok(decision);
  assert.ok(cycle);
  assert.ok(projection);
  assert.ok(protection);
  assert.strictEqual(intent.signal_lineage_id, "SIG__BNB__15m__1");
  assert.strictEqual(cycle.signal_intent_id, result.signal_intent_id);
  assert.strictEqual(cycle.openclaw_decision_id, result.openclaw_decision_id);
  assert.strictEqual(projection.stage, "PRE_TP1");
  assert.strictEqual(projection.native_stop_price, 590.1);
  assert.strictEqual(protection.sl_order_id, "STOP__BNB__1");
  assert.strictEqual(protection.tp1_order_id, "TP1__BNB__1");
  assert.strictEqual(protection.health_status, "HEALTHY");
})();

console.log("V2_OPENCLAW_SHADOW_POSITION_WRITER_TEST_OK");
