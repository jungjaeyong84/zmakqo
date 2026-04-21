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

function seedPreTp1(store) {
  const base = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "SOLUSDT",
    entryEventId: "ENTRY__SOL__SL",
    entryOrderId: "ORDER__SOL__ENTRY",
    entryFillGroupId: "FILL_GROUP__SOL__ENTRY",
    positionSide: "LONG",
    entryPrice: 150,
    entryQtyAbs: 10,
  });
  const protection = buildProtectionRuntimeDoc({
    positionCycleId: base.positionCycle.position_cycle_id,
    slOrderId: "STOP__SOL__1",
    tp1OrderId: "TP1__SOL__1",
    nativeStopPrice: 147.52,
    nativeTp1Price: 152.52,
    nativeRefreshStatus: "OK",
    healthStatus: "HEALTHY",
    slOrderStatus: "PLACED",
    tp1OrderStatus: "PLACED",
  });
  store["dbjv2__position_cycles_v2"] = {
    [base.positionCycle.position_cycle_id]: {
      ...base.positionCycle,
      status: "ACTIVE_PROTECTED",
      protection_runtime_id: protection.protection_runtime_id,
    },
  };
  store["dbjv2__exit_runtime_projection_v2"] = {
    [`ERPv2__${base.positionCycle.position_cycle_id}`]: base.projection,
  };
  store["dbjv2__protection_runtime_v2"] = {
    [`PRTV2__${base.positionCycle.position_cycle_id}`]: protection,
  };
  return base;
}

function seedTrailActive(store) {
  const base = buildV2EntryBootstrap({
    exchange: "BINANCEFUT",
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__TRAIL_EXIT",
    entryOrderId: "ORDER__ETH__ENTRY",
    entryFillGroupId: "FILL_GROUP__ETH__ENTRY",
    positionSide: "LONG",
    entryPrice: 2000,
    entryQtyAbs: 1,
  });
  const tp1 = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: base.projection,
    evidence: {
      kind: "TP1_CONFIRMED",
      sourceFillId: "FILL__ETH__TP1",
      sourceOrderId: "ORDER__ETH__TP1",
      fillQtyAbs: 0.5,
    },
  });
  const trail = reduceCanonicalExit({
    positionCycle: base.positionCycle,
    projection: tp1.nextProjection,
    evidence: {
      kind: "TRAIL_ACTIVATION_CONFIRMED",
      sourceFillId: "TRAIL_ACTIVATION__1",
      sourceOrderId: "STOP__ETH__TRAIL",
      nextStopPrice: 2010,
    },
  });
  const protection = buildProtectionRuntimeDoc({
    positionCycleId: base.positionCycle.position_cycle_id,
    slOrderId: "STOP__ETH__1",
    tp1OrderId: "TP1__ETH__1",
    nativeStopPrice: 2010,
    nativeTp1Price: 2033.6,
    nativeRefreshStatus: "OK",
    healthStatus: "HEALTHY",
    slOrderStatus: "PLACED",
    tp1OrderStatus: "PLACED",
  });
  store["dbjv2__position_cycles_v2"] = {
    [base.positionCycle.position_cycle_id]: {
      ...base.positionCycle,
      status: "ACTIVE_PROTECTED",
      protection_runtime_id: protection.protection_runtime_id,
    },
  };
  store["dbjv2__exit_runtime_projection_v2"] = {
    [`ERPv2__${base.positionCycle.position_cycle_id}`]: trail.nextProjection,
  };
  store["dbjv2__protection_runtime_v2"] = {
    [`PRTV2__${base.positionCycle.position_cycle_id}`]: protection,
  };
  return {
    base,
    projection: trail.nextProjection,
  };
}

(async function disabledWriterSkips() {
  const store = {};
  const calls = [];
  const result = await writer.writeOpenClawShadowStopExit({
    db: buildFakeDb(store, calls),
    env: {
      DONBEOLJA_V2_ENABLED: "0",
      DONBEOLJA_V2_DRY_RUN: "0",
      DONBEOLJA_V2_SHADOW_EXIT_WRITE_ENABLED: "1",
    },
    symbol: "SOLUSDT",
    entryEventId: "ENTRY__SOL__SL",
    positionSide: "LONG",
    sourceFillId: "FILL__SL__1",
    sourceOrderId: "STOP__SOL__1",
    fillPrice: 147.52,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.reason, "V2_DISABLED");
  assert.strictEqual(calls.length, 0);
})();

(async function stopExitFromPreTp1WritesSlHit() {
  const store = {};
  const calls = [];
  const base = seedPreTp1(store);
  const result = await writer.writeOpenClawShadowStopExit({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "SOLUSDT",
    entryEventId: "ENTRY__SOL__SL",
    positionSide: "LONG",
    sourceFillId: "FILL__SL__1",
    sourceOrderId: "STOP__SOL__1",
    fillPrice: 147.52,
    event: "EXIT_SL",
    fullExit: true,
    observedAtMs: 1713571234567,
    exchangeEvidence: {
      event_type: "ORDER_TRADE_UPDATE",
      execution_type: "TRADE",
      realized_pnl: "-24.8",
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, true);
  assert.strictEqual(result.reason, "V2_SHADOW_STOP_EXIT_OK");
  const transition = store["dbjv2__canonical_exit_transitions_v2"][result.canonical_transition_id];
  const projection = store["dbjv2__exit_runtime_projection_v2"][`ERPv2__${base.positionCycle.position_cycle_id}`];
  const protection = store["dbjv2__protection_runtime_v2"][`PRTV2__${base.positionCycle.position_cycle_id}`];
  const outbox = store["dbjv2__trade_alert_outbox_v2"][result.alert_outbox_id];
  assert.strictEqual(transition.transition_event, "SL_HIT");
  assert.strictEqual(transition.ledger_patch.final_exit_qty_abs, 10);
  assert.strictEqual(transition.source_exchange_evidence.evidence_kind, "STOP_EXIT");
  assert.strictEqual(transition.source_exchange_evidence.raw_payload.realized_pnl, "-24.8");
  assertCanonicalOutboxBatchEvidence({ result, transition, outbox });
  assert.strictEqual(projection.stage, "EXITED_SL");
  assert.strictEqual(projection.native_stop_price, 147.52);
  assert.strictEqual(protection.health_status, "TERMINAL_EXITED");
  assert.strictEqual(protection.last_exchange_evidence.evidence_kind, "STOP_EXIT");
  assert.strictEqual(protection.last_exchange_evidence.raw_payload.execution_type, "TRADE");
  assert.strictEqual(result.alert_prepare_ok, true);
  assert.strictEqual(outbox.status, "FAILED");
  assert.strictEqual(result.alert_delivery.updatedOutbox.status, "FAILED");
})();

(async function stopExitFromTrailActiveWritesTrailHit() {
  const store = {};
  const calls = [];
  const seeded = seedTrailActive(store);
  const result = await writer.writeOpenClawShadowStopExit({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__TRAIL_EXIT",
    positionSide: "LONG",
    sourceFillId: "FILL__TRAIL__1",
    sourceOrderId: "STOP__ETH__TRAIL",
    fillPrice: 2015.25,
    event: "EXIT_TRAIL",
    fullExit: true,
    observedAtMs: 1713572234567,
    exchangeEvidence: {
      event_type: "ORDER_TRADE_UPDATE",
      execution_type: "TRADE",
      stop_price: "2015.25",
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, true);
  const transition = store["dbjv2__canonical_exit_transitions_v2"][result.canonical_transition_id];
  const projection = store["dbjv2__exit_runtime_projection_v2"][`ERPv2__${seeded.base.positionCycle.position_cycle_id}`];
  const outbox = store["dbjv2__trade_alert_outbox_v2"][result.alert_outbox_id];
  assert.strictEqual(transition.transition_event, "TRAIL_HIT");
  assert.strictEqual(transition.ledger_patch.final_exit_qty_abs, 0.5);
  assert.strictEqual(transition.source_exchange_evidence.raw_payload.stop_price, "2015.25");
  assertCanonicalOutboxBatchEvidence({ result, transition, outbox });
  assert.strictEqual(projection.stage, "EXITED_TRAIL");
  assert.strictEqual(outbox.status, "FAILED");
  assert.strictEqual(result.alert_delivery.updatedOutbox.status, "FAILED");
})();

(async function terminalProjectionSkipsDuplicateExit() {
  const store = {};
  const calls = [];
  const base = seedPreTp1(store);
  const first = await writer.writeOpenClawShadowStopExit({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "SOLUSDT",
    entryEventId: "ENTRY__SOL__SL",
    positionSide: "LONG",
    sourceFillId: "FILL__SL__1",
    sourceOrderId: "STOP__SOL__1",
    fillPrice: 147.52,
    event: "EXIT_SL",
    fullExit: true,
    exchangeEvidence: {
      execution_type: "TRADE",
      order_type: "STOP_MARKET",
    },
  });
  assert.strictEqual(first.written, true);
  const second = await writer.writeOpenClawShadowStopExit({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "SOLUSDT",
    entryEventId: "ENTRY__SOL__SL",
    positionSide: "LONG",
    sourceFillId: "FILL__SL__2",
    sourceOrderId: "STOP__SOL__2",
    fillPrice: 147.1,
    event: "EXIT_SL",
    fullExit: true,
    exchangeEvidence: {
      execution_type: "TRADE",
      order_type: "STOP_MARKET",
    },
  });
  assert.strictEqual(second.ok, true);
  assert.strictEqual(second.written, false);
  assert.strictEqual(second.skipped, true);
  assert.strictEqual(second.reason, "V2_SHADOW_STOP_EXIT_ALREADY_TERMINAL");
  const projection = store["dbjv2__exit_runtime_projection_v2"][`ERPv2__${base.positionCycle.position_cycle_id}`];
  assert.strictEqual(projection.stage, "EXITED_SL");
})();

(async function stopExitRejectsPartialStopFill() {
  const store = {};
  const calls = [];
  seedPreTp1(store);
  const result = await writer.writeOpenClawShadowStopExit({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "SOLUSDT",
    entryEventId: "ENTRY__SOL__SL",
    positionSide: "LONG",
    sourceFillId: "FILL__SL__PARTIAL",
    sourceOrderId: "STOP__SOL__1",
    fillPrice: 147.52,
    event: "EXIT_SL",
    fullExit: false,
    exchangeEvidence: {
      event_type: "ORDER_TRADE_UPDATE",
      execution_type: "TRADE",
      order_type: "STOP_MARKET",
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "V2_SHADOW_STOP_EXIT_STOP_FULL_EXIT_NOT_CONFIRMED");
  assert.deepStrictEqual(result.issue_codes, ["STOP_FULL_EXIT_NOT_CONFIRMED"]);
})();

(async function stopExitRejectsWeakStopFillEvidence() {
  const store = {};
  const calls = [];
  seedPreTp1(store);
  const result = await writer.writeOpenClawShadowStopExit({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "SOLUSDT",
    entryEventId: "ENTRY__SOL__SL",
    positionSide: "LONG",
    sourceFillId: "FILL__SL__WEAK",
    sourceOrderId: "STOP__SOL__1",
    fillPrice: 147.52,
    event: "UNKNOWN",
    fullExit: true,
    exchangeEvidence: {
      event_type: "ORDER_TRADE_UPDATE",
      execution_type: "TRADE",
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "V2_SHADOW_STOP_EXIT_STOP_FILL_EVIDENCE_MISSING");
  assert.deepStrictEqual(result.issue_codes, ["STOP_FILL_EVIDENCE_MISSING"]);
})();

(async function stopExitRequiresProtectionRuntimeContext() {
  const store = {};
  const calls = [];
  const base = seedPreTp1(store);
  delete store["dbjv2__protection_runtime_v2"][`PRTV2__${base.positionCycle.position_cycle_id}`];
  const result = await writer.writeOpenClawShadowStopExit({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "SOLUSDT",
    entryEventId: "ENTRY__SOL__SL",
    positionSide: "LONG",
    sourceFillId: "FILL__SL__NO_RUNTIME",
    sourceOrderId: "STOP__SOL__1",
    fillPrice: 147.52,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "V2_SHADOW_STOP_EXIT_PROTECTION_CONTEXT_MISSING");
})();

(async function stopExitRejectsInactivePositionCycle() {
  const store = {};
  const calls = [];
  const base = seedPreTp1(store);
  store["dbjv2__position_cycles_v2"][base.positionCycle.position_cycle_id] = {
    ...store["dbjv2__position_cycles_v2"][base.positionCycle.position_cycle_id],
    status: "PROTECTION_PENDING",
  };
  const result = await writer.writeOpenClawShadowStopExit({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "SOLUSDT",
    entryEventId: "ENTRY__SOL__SL",
    positionSide: "LONG",
    sourceFillId: "FILL__SL__PENDING",
    sourceOrderId: "STOP__SOL__1",
    fillPrice: 147.52,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "V2_SHADOW_STOP_EXIT_POSITION_NOT_ACTIVE_PROTECTED");
  assert.deepStrictEqual(result.issue_codes, ["POSITION_NOT_ACTIVE_PROTECTED"]);
})();

(async function stopExitRejectsMissingNativeStopEvidence() {
  const store = {};
  const calls = [];
  const base = seedPreTp1(store);
  store["dbjv2__protection_runtime_v2"][`PRTV2__${base.positionCycle.position_cycle_id}`] = {
    ...store["dbjv2__protection_runtime_v2"][`PRTV2__${base.positionCycle.position_cycle_id}`],
    sl_order_id: null,
    sl_order_status: "FAILED",
  };
  const result = await writer.writeOpenClawShadowStopExit({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "SOLUSDT",
    entryEventId: "ENTRY__SOL__SL",
    positionSide: "LONG",
    sourceFillId: "FILL__SL__NO_STOP",
    sourceOrderId: "STOP__SOL__MISSING",
    fillPrice: 147.52,
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "V2_SHADOW_STOP_EXIT_SL_ORDER_MISSING");
  assert.deepStrictEqual(result.issue_codes, ["SL_ORDER_MISSING"]);
})();

(async function externalCloseWritesTerminalExternalSync() {
  const store = {};
  const calls = [];
  const base = seedPreTp1(store);
  const result = await writer.writeOpenClawShadowExternalClose({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "SOLUSDT",
    entryEventId: "ENTRY__SOL__SL",
    positionSide: "LONG",
    sourceFillId: "FILL__EXT__1",
    sourceOrderId: "ORDER__EXT__1",
    event: "EXIT_EXTERNAL_SYNC",
    fullExit: true,
    observedAtMs: 1713573234567,
    exchangeEvidence: {
      event_type: "ACCOUNT_UPDATE",
      reason: "EXTERNAL_FILL_RECONCILED",
      position_amt_after: "0",
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, true);
  assert.strictEqual(result.reason, "V2_SHADOW_EXTERNAL_CLOSE_OK");
  const transition = store["dbjv2__canonical_exit_transitions_v2"][result.canonical_transition_id];
  const projection = store["dbjv2__exit_runtime_projection_v2"][`ERPv2__${base.positionCycle.position_cycle_id}`];
  const protection = store["dbjv2__protection_runtime_v2"][`PRTV2__${base.positionCycle.position_cycle_id}`];
  const outbox = store["dbjv2__trade_alert_outbox_v2"][result.alert_outbox_id];
  assert.strictEqual(transition.transition_event, "EXTERNAL_CLOSE_SYNC");
  assert.strictEqual(transition.ledger_patch.final_exit_qty_abs, 10);
  assert.strictEqual(transition.source_exchange_evidence.evidence_kind, "EXTERNAL_CLOSE");
  assert.strictEqual(transition.source_exchange_evidence.raw_payload.reason, "EXTERNAL_FILL_RECONCILED");
  assertCanonicalOutboxBatchEvidence({ result, transition, outbox });
  assert.strictEqual(projection.stage, "EXITED_EXTERNAL");
  assert.strictEqual(protection.health_status, "TERMINAL_EXITED");
  assert.strictEqual(protection.last_exchange_evidence.evidence_kind, "EXTERNAL_CLOSE");
  assert.strictEqual(outbox.status, "FAILED");
})();

(async function externalCloseRejectsPartialCloseEvidence() {
  const store = {};
  const calls = [];
  seedPreTp1(store);
  const result = await writer.writeOpenClawShadowExternalClose({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "SOLUSDT",
    entryEventId: "ENTRY__SOL__SL",
    positionSide: "LONG",
    sourceFillId: "FILL__EXT__PARTIAL",
    sourceOrderId: "ORDER__EXT__PARTIAL",
    event: "EXIT_EXTERNAL_SYNC",
    fullExit: false,
    observedAtMs: 1713573234567,
    exchangeEvidence: {
      event_type: "ACCOUNT_UPDATE",
      reason: "EXTERNAL_PARTIAL_RECONCILED",
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, false);
  assert.strictEqual(result.skipped, true);
  assert.strictEqual(result.reason, "V2_SHADOW_EXTERNAL_CLOSE_FULL_EXIT_NOT_CONFIRMED");
  assert.deepStrictEqual(result.issue_codes, ["EXTERNAL_CLOSE_FULL_EXIT_NOT_CONFIRMED"]);
})();

(async function manualCloseAfterTp1WritesResidualManualSync() {
  const store = {};
  const calls = [];
  const seeded = seedTrailActive(store);
  const result = await writer.writeOpenClawShadowExternalClose({
    db: buildFakeDb(store, calls),
    env: buildEnv(),
    symbol: "ETHUSDT",
    entryEventId: "ENTRY__ETH__TRAIL_EXIT",
    positionSide: "LONG",
    sourceFillId: "FILL__MANUAL__1",
    sourceOrderId: "ORDER__MANUAL__1",
    event: "EXIT_EXTERNAL_SYNC",
    closeKind: "MANUAL",
    fullExit: true,
    observedAtMs: 1713574234567,
    exchangeEvidence: {
      full_exit: true,
    },
  });
  assert.strictEqual(result.ok, true);
  assert.strictEqual(result.written, true);
  const transition = store["dbjv2__canonical_exit_transitions_v2"][result.canonical_transition_id];
  const projection = store["dbjv2__exit_runtime_projection_v2"][`ERPv2__${seeded.base.positionCycle.position_cycle_id}`];
  const outbox = store["dbjv2__trade_alert_outbox_v2"][result.alert_outbox_id];
  assert.strictEqual(transition.transition_event, "MANUAL_CLOSE_SYNC");
  assert.strictEqual(transition.ledger_patch.final_exit_qty_abs, 0.5);
  assert.strictEqual(transition.source_exchange_evidence.evidence_kind, "MANUAL_CLOSE");
  assertCanonicalOutboxBatchEvidence({ result, transition, outbox });
  assert.strictEqual(projection.stage, "EXITED_MANUAL");
})();

console.log("V2_OPENCLAW_SHADOW_STOP_EXIT_WRITER_TEST_OK");
