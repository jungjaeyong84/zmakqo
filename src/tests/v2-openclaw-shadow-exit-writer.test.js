"use strict";

const assert = require("assert");

const {
  buildProtectedActivePositionCycleDoc,
  buildV2EntryBootstrap,
} = require("../v2/entryBootstrap");
const { buildEntryProtectionPlacementRequest } = require("../v2/entryProtectionHandoff");
const { buildProtectionRuntimeWriteResult } = require("../v2/protectionRuntimeWriter");
const writer = require("../v2/openclawShadowExitWriter");

function buildFakeDb(store, calls) {
  return {
    batch() {
      const writes = [];
      return {
        set(ref, payload, options = {}) {
          writes.push({ ref, payload, options });
        },
        async commit() {
          for (const write of writes) {
            await write.ref.set(write.payload, write.options);
          }
        },
      };
    },
    collection(name) {
      if (!store[name]) store[name] = {};
      return {
        doc(id) {
          return {
            async get() {
              const payload = store[name][id];
              return {
                exists: !!payload,
                data() {
                  return payload;
                },
              };
            },
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

function buildEnv() {
  return {
    DONBEOLJA_V2_ENABLED: "1",
    DONBEOLJA_V2_DRY_RUN: "0",
    DONBEOLJA_V2_SHADOW_EXIT_WRITE_ENABLED: "1",
    DONBEOLJA_V2_SHADOW_ALERT_DELIVERY_ENABLED: "0",
    DONBEOLJA_V2_COLLECTION_PREFIX: "dbjv2__",
  };
}

function assertCanonicalOutboxBatchEvidence({ result, transition, outbox }) {
  assert.strictEqual(result.write_mode, "BATCH");
  assert.strictEqual(outbox.alert_outbox_id, result.alert_outbox_id);
  assert.strictEqual(outbox.canonical_transition_id, result.canonical_transition_id);
  assert.strictEqual(outbox.prepared_payload.canonical_transition_id, result.canonical_transition_id);
  assert.strictEqual(outbox.delivery_request.dedupeFingerprint, result.canonical_transition_id);
  assert.strictEqual(transition.canonical_transition_id, result.canonical_transition_id);
  assert.ok(result.writes.some((row) => row.collectionKey === "CANONICAL_EXIT_TRANSITIONS" && row.docId === result.canonical_transition_id));
  assert.ok(result.writes.some((row) => row.collectionKey === "EXIT_RUNTIME_PROJECTIONS"));
  assert.ok(result.writes.some((row) => row.collectionKey === "TRADE_ALERT_OUTBOX" && row.docId === result.alert_outbox_id));
}

function seedBase(store) {
  const base = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__TP1",
    entryOrderId: "ORDER__ETH__ENTRY",
    entryFillGroupId: "FILL_GROUP__ETH__ENTRY",
    entryIntentId: "INTENT__ETH__ENTRY",
    signalIntentId: "SIGINT__ETH__ENTRY",
    openclawDecisionId: "OCD__ETH__ENTRY",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
  });
  const executed = {
    entryContract: {
      entry_intent_id: "INTENT__ETH__ENTRY",
      signal_intent_id: "SIGINT__ETH__ENTRY",
      openclaw_decision_id: "OCD__ETH__ENTRY",
      signal_source_mode: "SERVER_NATIVE_ML_AI",
      decision_mode: "CANARY",
      policy_scope: "ETH_15M",
      symbol: "ETHUSDT",
      side: "LONG",
    },
    ...base,
  };
  const placementRequest = buildEntryProtectionPlacementRequest(executed);
  const protectionWriteResult = buildProtectionRuntimeWriteResult({
    placementRequest,
    slAck: {
      status: "PLACED",
      order_id: "STOP__ETH__ENTRY",
      trigger_price: base.protectionPlan.sl_trigger_price,
      ack_at: "2026-04-21T05:00:00.100Z",
    },
    tp1Ack: {
      status: "PLACED",
      order_id: "TP1__ETH__ENTRY",
      trigger_price: base.protectionPlan.tp1_trigger_price,
      ack_at: "2026-04-21T05:00:00.200Z",
    },
    observedAt: "2026-04-21T05:00:00.300Z",
  });
  const activeCycle = buildProtectedActivePositionCycleDoc({
    positionCycle: base.positionCycle,
    protectionWriteResult,
    activatedAt: "2026-04-21T05:00:00.300Z",
  });
  store["dbjv2__position_cycles_v2"] = {
    [base.positionCycle.position_cycle_id]: activeCycle,
  };
  store["dbjv2__exit_runtime_projection_v2"] = {
    [`ERPv2__${base.positionCycle.position_cycle_id}`]: base.projection,
  };
  store["dbjv2__protection_runtime_v2"] = {
    [protectionWriteResult.runtimeDoc.protection_runtime_id]: protectionWriteResult.runtimeDoc,
  };
  return base;
}

function seedPendingBaseWithoutProtection(store) {
  const base = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__TP1",
    entryOrderId: "ORDER__ETH__ENTRY",
    entryFillGroupId: "FILL_GROUP__ETH__ENTRY",
    entryIntentId: "INTENT__ETH__ENTRY",
    signalIntentId: "SIGINT__ETH__ENTRY",
    openclawDecisionId: "OCD__ETH__ENTRY",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
  });
  store["dbjv2__position_cycles_v2"] = {
    [base.positionCycle.position_cycle_id]: base.positionCycle,
  };
  store["dbjv2__exit_runtime_projection_v2"] = {
    [`ERPv2__${base.positionCycle.position_cycle_id}`]: base.projection,
  };
  return base;
}

(async function disabledWriterSkips() {
  const store = {};
  const calls = [];
  const result = await writer.writeOpenClawShadowTp1Transition({
    db: buildFakeDb(store, calls),
    env: {
      DONBEOLJA_V2_ENABLED: "0",
      DONBEOLJA_V2_DRY_RUN: "0",
      DONBEOLJA_V2_SHADOW_EXIT_WRITE_ENABLED: "1",
    },
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__TP1",
    positionSide: "LONG",
    sourceFillId: "FILL__TP1__1",
    sourceOrderId: "ORDER__TP1__1",
    fillQtyAbs: 0.5,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "V2_DISABLED");
  assert.strictEqual(calls.length, 0);
})();

(async function missingDocsSkipsWithoutMutation() {
  const store = {};
  const calls = [];
  const result = await writer.writeOpenClawShadowTp1Transition({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__TP1",
    positionSide: "LONG",
    sourceFillId: "FILL__TP1__1",
    sourceOrderId: "ORDER__TP1__1",
    fillQtyAbs: 0.5,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "V2_SHADOW_TP1_POSITION_CONTEXT_MISSING");
  assert.strictEqual(calls.length, 0);
})();

(async function tp1TransitionRequiresProtectionRuntimeEvidence() {
  const store = {};
  const calls = [];
  seedPendingBaseWithoutProtection(store);
  const result = await writer.writeOpenClawShadowTp1Transition({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__TP1",
    positionSide: "LONG",
    sourceFillId: "FILL__TP1__NO_PROTECTION",
    sourceOrderId: "ORDER__TP1__NO_PROTECTION",
    fillQtyAbs: 0.5,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "V2_SHADOW_TP1_PROTECTION_CONTEXT_MISSING");
  assert.strictEqual(calls.length, 0);
})();

(async function tp1TransitionRejectsDegradedProtectionRuntime() {
  const store = {};
  const calls = [];
  const base = seedBase(store);
  const runtimeId = `PRTV2__${base.positionCycle.position_cycle_id}`;
  store["dbjv2__protection_runtime_v2"][runtimeId] = {
    ...store["dbjv2__protection_runtime_v2"][runtimeId],
    health_status: "DEGRADED_REPAIRABLE",
    native_refresh_status: "PARTIAL",
    tp1_order_id: null,
    tp1_order_status: "FAILED",
  };
  const result = await writer.writeOpenClawShadowTp1Transition({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__TP1",
    positionSide: "LONG",
    sourceFillId: "FILL__TP1__DEGRADED",
    sourceOrderId: "ORDER__TP1__DEGRADED",
    fillQtyAbs: 0.5,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "V2_SHADOW_TP1_PROTECTION_RUNTIME_NOT_HEALTHY");
  assert.ok(result.issue_codes.includes("TP1_ORDER_MISSING"));
  assert.strictEqual(calls.length, 0);
})();

(async function exactFillWritesTp1TransitionAndProjection() {
  const store = {};
  const calls = [];
  const base = seedBase(store);
  const result = await writer.writeOpenClawShadowTp1Transition({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__TP1",
    positionSide: "LONG",
    sourceFillId: "FILL__TP1__1",
    sourceOrderId: "ORDER__TP1__1",
    fillQtyAbs: 0.5,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, true);
  assert.strictEqual(result.reason, "V2_SHADOW_TP1_TRANSITION_OK");
  assert.strictEqual(calls.length, 4);

  const transition = store["dbjv2__canonical_exit_transitions_v2"][result.canonical_transition_id];
  const projection = store["dbjv2__exit_runtime_projection_v2"][`ERPv2__${base.positionCycle.position_cycle_id}`];
  const outbox = store["dbjv2__trade_alert_outbox_v2"][result.alert_outbox_id];
  assert.ok(transition);
  assert.ok(projection);
  assert.ok(outbox);
  assert.ok(outbox.prepared_payload);
  assert.ok(outbox.delivery_request);
  assertCanonicalOutboxBatchEvidence({ result, transition, outbox });
  assert.strictEqual(transition.transition_event, "TP1_REACHED");
  assert.strictEqual(transition.source_exchange_evidence.evidence_kind, "TP1_FILL");
  assert.strictEqual(transition.source_exchange_evidence.source_fill_id, "FILL__TP1__1");
  assert.strictEqual(projection.stage, "TP1_DONE");
  assert.strictEqual(projection.tp1_done, true);
  assert.strictEqual(projection.tp1_filled_qty_abs, 0.5);
  assert.strictEqual(projection.runner_remaining_qty_abs, 0.5);
  assert.strictEqual(result.alert_prepare_ok, true);
  assert.strictEqual(outbox.status, "FAILED");
  assert.strictEqual(result.alert_delivery.updatedOutbox.status, "FAILED");
})();

(async function consumedQtyAggregateClosesSplitFill() {
  const store = {};
  const calls = [];
  const base = seedBase(store);
  const result = await writer.writeOpenClawShadowTp1Transition({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__TP1",
    positionSide: "LONG",
    sourceFillId: "FILL__TP1__2",
    sourceOrderId: "ORDER__TP1__1",
    fillQtyAbs: 0.2,
    positionMeta: {
      native_protection_consumed_tp_qty_base: 0.5,
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, true);
  const projection = store["dbjv2__exit_runtime_projection_v2"][`ERPv2__${base.positionCycle.position_cycle_id}`];
  assert.strictEqual(projection.stage, "TP1_DONE");
  assert.strictEqual(projection.tp1_filled_qty_abs, 0.5);
})();

(async function incompleteAggregateSkipsAndWritesNothing() {
  const store = {};
  const calls = [];
  seedBase(store);
  const result = await writer.writeOpenClawShadowTp1Transition({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__TP1",
    positionSide: "LONG",
    sourceFillId: "FILL__TP1__3",
    sourceOrderId: "ORDER__TP1__1",
    fillQtyAbs: 0.2,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "V2_SHADOW_TP1_AGGREGATE_INCOMPLETE");
  assert.strictEqual(calls.length, 0);
})();

console.log("V2_OPENCLAW_SHADOW_EXIT_WRITER_TEST_OK");
