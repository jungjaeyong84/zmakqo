"use strict";

const assert = require("assert");

const { buildV2EntryBootstrap } = require("../v2/entryBootstrap");
const { buildProtectionRuntimeDoc } = require("../v2/contracts");
const { reduceCanonicalExit } = require("../v2/canonicalExitReducer");
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
            async set(payload, options = {}) {
              calls.push({ collection: name, docId: id, merge: options && options.merge === true });
              const prev = store[name][id];
              store[name][id] = options && options.merge === true && prev
                ? { ...prev, ...payload }
                : payload;
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

function seedTp1Done(store) {
  const base = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "BTCUSDT",
    entryEventId: "ENTRY__BTC__TRAIL",
    entryOrderId: "ORDER__BTC__ENTRY",
    entryFillGroupId: "FILL_GROUP__BTC__ENTRY",
    entryIntentId: "INTENT__BTC__ENTRY",
    signalIntentId: "SIGINT__BTC__ENTRY",
    openclawDecisionId: "OCD__BTC__ENTRY",
    positionSide: "LONG",
    entryPrice: 100000,
    entryQtyAbs: 0.01,
  });
  const tp1 = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "TP1_CONFIRMED",
      sourceFillId: "FILL__BTC__TP1",
      sourceOrderId: "ORDER__BTC__TP1",
      fillQtyAbs: base.projection.tp1_target_qty_abs,
    },
  });
  const protection = buildProtectionRuntimeDoc({
    positionCycleId: base.positionCycle.position_cycle_id,
    slOrderId: "STOP__BTC__1",
    tp1OrderId: "TP1__BTC__1",
    nativeStopPrice: 98350,
    nativeTp1Price: 101680,
    nativeRefreshStatus: "OK",
    healthStatus: "HEALTHY",
  });
  store["dbjv2__position_cycles_v2"] = {
    [base.positionCycle.position_cycle_id]: base.positionCycle,
  };
  store["dbjv2__exit_runtime_projection_v2"] = {
    [`ERPv2__${base.positionCycle.position_cycle_id}`]: tp1.nextProjection,
  };
  store["dbjv2__protection_runtime_v2"] = {
    [`PRTV2__${base.positionCycle.position_cycle_id}`]: protection,
  };
  return {
    base,
    tp1Projection: tp1.nextProjection,
  };
}

(async function disabledWriterSkips() {
  const store = {};
  const calls = [];
  const result = await writer.writeOpenClawShadowTrailActivation({
    db: buildFakeDb(store, calls),
    env: {
      DONBEOLJA_V2_ENABLED: "0",
      DONBEOLJA_V2_DRY_RUN: "0",
      DONBEOLJA_V2_SHADOW_EXIT_WRITE_ENABLED: "1",
    },
    symbol: "BTCUSDT",
    entryEventId: "ENTRY__BTC__TRAIL",
    positionSide: "LONG",
    sourceOrderId: "STOP__BTC__2",
    nextStopPrice: 100500,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.reason, "V2_DISABLED");
  assert.strictEqual(calls.length, 0);
})();

(async function missingProtectionContextSkips() {
  const store = {};
  const calls = [];
  const seeded = seedTp1Done(store);
  delete store["dbjv2__protection_runtime_v2"][`PRTV2__${seeded.base.positionCycle.position_cycle_id}`];
  const result = await writer.writeOpenClawShadowTrailActivation({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "BTCUSDT",
    entryEventId: "ENTRY__BTC__TRAIL",
    positionSide: "LONG",
    sourceOrderId: "STOP__BTC__2",
    nextStopPrice: 100500,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "V2_SHADOW_TRAIL_PROTECTION_CONTEXT_MISSING");
  assert.strictEqual(calls.length, 0);
})();

(async function trailActivationWritesTransitionProjectionAndProtection() {
  const store = {};
  const calls = [];
  const seeded = seedTp1Done(store);
  const result = await writer.writeOpenClawShadowTrailActivation({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "BTCUSDT",
    entryEventId: "ENTRY__BTC__TRAIL",
    positionSide: "LONG",
    sourceOrderId: "STOP__BTC__2",
    nextStopPrice: 100600,
    nativeStopPrice: 100600,
    observedAtMs: 1713571209999,
    exchangeEvidence: {
      event_type: "ORDER_TRADE_UPDATE",
      execution_type: "AMENDMENT",
      stop_price: "100600",
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, true);
  assert.strictEqual(result.reason, "V2_SHADOW_TRAIL_ACTIVATION_OK");
  assert.strictEqual(calls.length, 5);

  const transition = store["dbjv2__canonical_exit_transitions_v2"][result.canonical_transition_id];
  const projection = store["dbjv2__exit_runtime_projection_v2"][`ERPv2__${seeded.base.positionCycle.position_cycle_id}`];
  const protection = store["dbjv2__protection_runtime_v2"][`PRTV2__${seeded.base.positionCycle.position_cycle_id}`];
  const outbox = store["dbjv2__trade_alert_outbox_v2"][result.alert_outbox_id];
  assert.ok(transition);
  assert.ok(outbox);
  assertCanonicalOutboxBatchEvidence({ result, transition, outbox });
  assert.strictEqual(transition.transition_event, "TRAIL_ACTIVATED");
  assert.strictEqual(transition.source_exchange_evidence.evidence_kind, "TRAIL_ACTIVATION");
  assert.strictEqual(transition.source_exchange_evidence.raw_payload.execution_type, "AMENDMENT");
  assert.strictEqual(projection.stage, "TRAIL_ACTIVE");
  assert.strictEqual(projection.chosen_stop_source, "TRAIL");
  assert.strictEqual(projection.native_stop_price, 100600);
  assert.strictEqual(protection.native_stop_price, 100600);
  assert.strictEqual(protection.native_refresh_status, "OK");
  assert.strictEqual(protection.last_exchange_evidence.evidence_kind, "TRAIL_ACTIVATION");
  assert.strictEqual(protection.last_exchange_evidence.raw_payload.stop_price, "100600");
  assert.strictEqual(protection.last_evidence_observed_at, "2024-04-20T00:00:09.999Z");
  assert.strictEqual(result.alert_prepare_ok, true);
  assert.strictEqual(outbox.status, "FAILED");
  assert.strictEqual(result.alert_delivery.updatedOutbox.status, "FAILED");
})();

(async function unhealthyNativeRefreshSkipsTrailActivationFailClosed() {
  const store = {};
  const calls = [];
  const seeded = seedTp1Done(store);
  const result = await writer.writeOpenClawShadowTrailActivation({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "BTCUSDT",
    entryEventId: "ENTRY__BTC__TRAIL",
    positionSide: "LONG",
    sourceOrderId: "STOP__BTC__2",
    nextStopPrice: 100600,
    nativeStopPrice: 100600,
    nativeRefreshStatus: "ERROR",
    observedAtMs: 1713571209999,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "V2_SHADOW_TRAIL_NATIVE_REFRESH_UNHEALTHY");
  assert.deepStrictEqual(result.issue_codes, ["NATIVE_REFRESH_UNHEALTHY"]);
  assert.strictEqual(calls.length, 0);
  const projection = store["dbjv2__exit_runtime_projection_v2"][`ERPv2__${seeded.base.positionCycle.position_cycle_id}`];
  assert.strictEqual(projection.stage, "TP1_DONE");
})();

(async function duplicateTrailActivationSkips() {
  const store = {};
  const calls = [];
  const seeded = seedTp1Done(store);
  const first = await writer.writeOpenClawShadowTrailActivation({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "BTCUSDT",
    entryEventId: "ENTRY__BTC__TRAIL",
    positionSide: "LONG",
    sourceOrderId: "STOP__BTC__2",
    nextStopPrice: 100600,
    nativeStopPrice: 100600,
    observedAtMs: 1713571209999,
  });
  assert.strictEqual(first.written, true);
  const second = await writer.writeOpenClawShadowTrailActivation({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "BTCUSDT",
    entryEventId: "ENTRY__BTC__TRAIL",
    positionSide: "LONG",
    sourceOrderId: "STOP__BTC__3",
    nextStopPrice: 100650,
    nativeStopPrice: 100650,
    observedAtMs: 1713571219999,
  });
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.written, false);
  assert.strictEqual(second.skipped, true);
  assert.strictEqual(second.reason, "TRAIL_ALREADY_ACTIVE");
  const projection = store["dbjv2__exit_runtime_projection_v2"][`ERPv2__${seeded.base.positionCycle.position_cycle_id}`];
  assert.strictEqual(projection.native_stop_price, 100600);
})();

console.log("V2_OPENCLAW_SHADOW_TRAIL_WRITER_TEST_OK");
