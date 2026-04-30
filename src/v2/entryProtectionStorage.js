"use strict";

const { getFirestore } = require("../storage/firestore");
const { buildLatestPositionReadModelDoc } = require("../storage/positionReadModelLatest");
const { resolveV2CollectionName } = require("./storage");
const { buildProtectedActivePositionCycleDoc } = require("./entryBootstrap");
const { assertRuntimeExecutionChain } = require("./runtimeChainAudit");
const { buildEntryProtectionRepairRequests } = require("./entryProtectionRepairRequests");

function trimOrNull(value) {
  const text = String(value || "").trim();
  return text || null;
}

function upper(value) {
  return String(value || "").trim().toUpperCase() || null;
}

function toNumberOrNull(value) {
  if (value === null || value === undefined || value === "") return null;
  const num = Number(value);
  return Number.isFinite(num) ? num : null;
}

function validateRequiredObject(name, value) {
  if (!value || typeof value !== "object") throw new Error(`${name}_REQUIRED`);
  return value;
}

function resolveDb(db = null) {
  const firestore = db || getFirestore();
  if (!firestore || typeof firestore.collection !== "function") throw new Error("V2_FIRESTORE_REQUIRED");
  if (typeof firestore.batch !== "function") throw new Error("V2_FIRESTORE_BATCH_REQUIRED");
  return firestore;
}

function docRef({ firestore, env, collectionKey, docId }) {
  const resolvedDocId = trimOrNull(docId);
  if (!resolvedDocId) throw new Error(`V2_DOC_ID_REQUIRED:${collectionKey}`);
  const collectionName = resolveV2CollectionName(collectionKey, env);
  return Object.freeze({
    collectionKey,
    collectionName,
    docId: resolvedDocId,
    ref: firestore.collection(collectionName).doc(resolvedDocId),
  });
}

function buildProtectedEntryReadModelSnapshot({
  activatedPositionCycle,
  executedEntry,
  placementRequest,
  protectionWriteResult,
  activatedAt,
} = {}) {
  const cycle = validateRequiredObject("ACTIVATED_POSITION_CYCLE", activatedPositionCycle);
  const executed = validateRequiredObject("EXECUTED_ENTRY", executedEntry);
  const request = validateRequiredObject("PLACEMENT_REQUEST", placementRequest);
  const protection = validateRequiredObject("PROTECTION_WRITE_RESULT", protectionWriteResult);
  const runtimeDoc = validateRequiredObject("PROTECTION_RUNTIME_DOC", protection.runtimeDoc);
  const projection = validateRequiredObject("EXIT_RUNTIME_PROJECTION", executed.projection);
  const exchange = upper(cycle.exchange || request.exchange);
  const symbol = upper(cycle.symbol || request.symbol);
  const positionSide = upper(cycle.position_side || request.position_side);
  const entryQtyAbs = toNumberOrNull(cycle.entry_qty_abs != null ? cycle.entry_qty_abs : request.entry_qty_abs);
  const entryPrice = toNumberOrNull(cycle.entry_price != null ? cycle.entry_price : request.entry_price);
  const tp1QtyAbs = toNumberOrNull(request.tp1_qty_abs != null ? request.tp1_qty_abs : projection.tp1_target_qty_abs);
  const tp1QtyRatio = Number.isFinite(entryQtyAbs) && entryQtyAbs > 0 && Number.isFinite(tp1QtyAbs)
    ? tp1QtyAbs / entryQtyAbs
    : null;
  const at = trimOrNull(activatedAt)
    || trimOrNull(cycle.protection_activated_at)
    || trimOrNull(runtimeDoc.last_refresh_at)
    || new Date().toISOString();
  const stopPrice = toNumberOrNull(runtimeDoc.native_stop_price != null
    ? runtimeDoc.native_stop_price
    : request.sl_trigger_price);
  const tp1Price = toNumberOrNull(runtimeDoc.native_tp1_price != null
    ? runtimeDoc.native_tp1_price
    : request.tp1_trigger_price);
  const initialStopPrice = toNumberOrNull(projection.initial_stop_price != null
    ? projection.initial_stop_price
    : (runtimeDoc.initial_stop_price != null ? runtimeDoc.initial_stop_price : stopPrice));
  const entryRDistance = toNumberOrNull(projection.entry_r_distance != null
    ? projection.entry_r_distance
    : runtimeDoc.entry_r_distance);
  const meta = {
    position_cycle_id: cycle.position_cycle_id,
    entry_event_id: cycle.entry_event_id,
    entry_order_id: cycle.entry_order_id,
    entry_fill_group_id: cycle.entry_fill_group_id,
    entry_intent_id: cycle.entry_intent_id || null,
    signal_intent_id: cycle.signal_intent_id || null,
    openclaw_decision_id: cycle.openclaw_decision_id || null,
    entry_price: entryPrice,
    avg_price: entryPrice,
    entry_qty_base: entryQtyAbs,
    entry_qty_abs: entryQtyAbs,
    initial_stop_price: initialStopPrice,
    entry_r_distance: entryRDistance,
    final_effective_stop: stopPrice,
    tp1_target_price: tp1Price,
    tp1_target_qty_abs: tp1QtyAbs,
    tp_p1_target_price: tp1Price,
    tp_p1_target_qty_abs: tp1QtyAbs,
    tp_p1_done: false,
    trail_active: false,
    native_protection_stop_order_id: runtimeDoc.sl_order_id || null,
    native_protection_stop_price: stopPrice,
    native_protection_stop_status: upper(runtimeDoc.sl_order_status) === "PLACED" ? "OK" : upper(runtimeDoc.sl_order_status),
    native_protection_tp_order_id: runtimeDoc.tp1_order_id || null,
    native_protection_tp_price: tp1Price,
    native_protection_tp_qty_base: tp1QtyAbs,
    native_protection_tp_qty_ratio: Number.isFinite(tp1QtyRatio) ? tp1QtyRatio : null,
    native_protection_tp_status: upper(runtimeDoc.tp1_order_status) === "PLACED" ? "OK" : upper(runtimeDoc.tp1_order_status),
    native_protection_refresh_status: upper(runtimeDoc.native_refresh_status),
    native_protection_health_status: upper(runtimeDoc.health_status),
    native_protection_stale: false,
    protection_runtime_id: runtimeDoc.protection_runtime_id,
    protection_activated_at: at,
    simplified_exit_v2_enabled: true,
    v2_protected_entry_read_model: true,
  };

  return Object.freeze({
    exchange,
    symbol,
    symbol_or_pair_id: symbol,
    state: "ACTIVE",
    position_state: "ACTIVE",
    position_side: positionSide,
    size_pct: 100,
    qty_base: entryQtyAbs,
    entry_qty_base: entryQtyAbs,
    avg_price: entryPrice,
    entry_price: entryPrice,
    updated_at: at,
    meta,
  });
}

function buildProtectedEntryReadModelLatestDoc({
  activatedPositionCycle,
  executedEntry,
  placementRequest,
  protectionWriteResult,
  activatedAt,
} = {}) {
  const snapshot = buildProtectedEntryReadModelSnapshot({
    activatedPositionCycle,
    executedEntry,
    placementRequest,
    protectionWriteResult,
    activatedAt,
  });
  const at = trimOrNull(activatedAt) || trimOrNull(snapshot.updated_at) || new Date().toISOString();
  const parsedTs = Date.parse(at);
  return buildLatestPositionReadModelDoc({
    exchange: snapshot.exchange,
    symbol: snapshot.symbol,
    tsMs: Number.isFinite(parsedTs) ? parsedTs : Date.now(),
    createdAt: at,
    positionEventId: `V2_PROTECTED_ENTRY__${snapshot.meta.position_cycle_id}`,
    traceId: snapshot.meta.entry_event_id,
    requestId: snapshot.meta.entry_intent_id,
    runId: snapshot.meta.signal_intent_id,
    mutationKind: "V2_PROTECTED_ENTRY_ACTIVATED",
    source: "V2_PRODUCTION_ENTRY",
    afterSummary: snapshot,
    afterSnapshot: snapshot,
  });
}

async function commitEntryProtectionPendingBootstrap({
  db = null,
  executedEntry,
  env = process.env,
  committedAt = null,
} = {}) {
  const executed = validateRequiredObject("EXECUTED_ENTRY", executedEntry);
  const positionCycle = validateRequiredObject("POSITION_CYCLE", executed.positionCycle);
  const projection = validateRequiredObject("EXIT_RUNTIME_PROJECTION", executed.projection);
  if (upper(positionCycle.status) !== "PROTECTION_PENDING") {
    throw new Error("ENTRY_BOOTSTRAP_PROTECTION_PENDING_REQUIRED");
  }
  if (trimOrNull(projection.position_cycle_id) !== trimOrNull(positionCycle.position_cycle_id)) {
    throw new Error("ENTRY_BOOTSTRAP_PROJECTION_CYCLE_MISMATCH");
  }

  const firestore = resolveDb(db);
  const cycleRef = docRef({
    firestore,
    env,
    collectionKey: "POSITION_CYCLES",
    docId: positionCycle.position_cycle_id,
  });
  const projectionRef = docRef({
    firestore,
    env,
    collectionKey: "EXIT_RUNTIME_PROJECTIONS",
    docId: projection.exit_runtime_projection_id,
  });
  const batch = firestore.batch();
  const at = trimOrNull(committedAt) || new Date().toISOString();
  batch.set(cycleRef.ref, {
    ...positionCycle,
    entry_bootstrap_committed_at: at,
  }, { merge: false });
  batch.set(projectionRef.ref, {
    ...projection,
    entry_bootstrap_committed_at: at,
  }, { merge: false });
  await batch.commit();
  return Object.freeze({
    ok: true,
    write_mode: "BATCH",
    committed_at: at,
    position_cycle_id: positionCycle.position_cycle_id,
    position_cycle_status: positionCycle.status,
    writes: Object.freeze([
      Object.freeze({
        collectionKey: cycleRef.collectionKey,
        collectionName: cycleRef.collectionName,
        docId: cycleRef.docId,
      }),
      Object.freeze({
        collectionKey: projectionRef.collectionKey,
        collectionName: projectionRef.collectionName,
        docId: projectionRef.docId,
      }),
    ]),
  });
}

async function commitProtectedEntryActivation({
  db = null,
  executedEntry,
  placementRequest,
  protectionWriteResult,
  env = process.env,
  activatedAt = null,
} = {}) {
  const executed = validateRequiredObject("EXECUTED_ENTRY", executedEntry);
  const protection = validateRequiredObject("PROTECTION_WRITE_RESULT", protectionWriteResult);
  const request = validateRequiredObject("PLACEMENT_REQUEST", placementRequest);
  const runtimeDoc = validateRequiredObject("PROTECTION_RUNTIME_DOC", protection.runtimeDoc);
  const activatedPositionCycle = buildProtectedActivePositionCycleDoc({
    positionCycle: executed.positionCycle,
    protectionWriteResult: protection,
    activatedAt,
  });
  const chainAudit = assertRuntimeExecutionChain({
    executedEntry: {
      ...executed,
      positionCycle: activatedPositionCycle,
    },
    placementRequest: request,
    protectionWriteResult: protection,
  });

  const firestore = resolveDb(db);
  const cycleRef = docRef({
    firestore,
    env,
    collectionKey: "POSITION_CYCLES",
    docId: activatedPositionCycle.position_cycle_id,
  });
  const runtimeRef = docRef({
    firestore,
    env,
    collectionKey: "PROTECTION_RUNTIME",
    docId: runtimeDoc.protection_runtime_id,
  });
  const at = trimOrNull(activatedAt) || trimOrNull(activatedPositionCycle.protection_activated_at) || new Date().toISOString();
  const readModelDoc = buildProtectedEntryReadModelLatestDoc({
    activatedPositionCycle,
    executedEntry: executed,
    placementRequest: request,
    protectionWriteResult: protection,
    activatedAt: at,
  });
  const readModelRef = firestore.collection("position_read_model_latest").doc(readModelDoc.read_model_id);
  const batch = firestore.batch();
  batch.set(cycleRef.ref, {
    ...activatedPositionCycle,
    protection_activated_at: at,
  }, { merge: true });
  batch.set(runtimeRef.ref, {
    ...runtimeDoc,
    protection_activated_at: at,
  }, { merge: true });
  batch.set(readModelRef, readModelDoc, { merge: false });
  await batch.commit();
  return Object.freeze({
    ok: true,
    write_mode: "BATCH",
    activated_at: at,
    position_cycle_id: activatedPositionCycle.position_cycle_id,
    position_cycle_status: activatedPositionCycle.status,
    protection_runtime_id: runtimeDoc.protection_runtime_id,
    chainAudit,
    writes: Object.freeze([
      Object.freeze({
        collectionKey: cycleRef.collectionKey,
        collectionName: cycleRef.collectionName,
        docId: cycleRef.docId,
      }),
      Object.freeze({
        collectionKey: runtimeRef.collectionKey,
        collectionName: runtimeRef.collectionName,
        docId: runtimeRef.docId,
      }),
      Object.freeze({
        collectionKey: "POSITION_READ_MODEL_LATEST",
        collectionName: "position_read_model_latest",
        docId: readModelDoc.read_model_id,
      }),
    ]),
  });
}

async function commitEntryProtectionRepairQueue({
  db = null,
  executedEntry,
  placementRequest,
  protectionWriteResult,
  slAck = null,
  tp1Ack = null,
  env = process.env,
  committedAt = null,
} = {}) {
  const executed = validateRequiredObject("EXECUTED_ENTRY", executedEntry);
  const protection = validateRequiredObject("PROTECTION_WRITE_RESULT", protectionWriteResult);
  const runtimeDoc = validateRequiredObject("PROTECTION_RUNTIME_DOC", protection.runtimeDoc);
  const at = trimOrNull(committedAt) || new Date().toISOString();
  const requestBuild = buildEntryProtectionRepairRequests({
    executedEntry: executed,
    placementRequest,
    protectionWriteResult: protection,
    slAck,
    tp1Ack,
    createdAt: at,
  });

  if (requestBuild.enqueue_required !== true) {
    return Object.freeze({
      ok: true,
      write_mode: "SKIPPED",
      committed_at: at,
      skip_reason: requestBuild.skip_reason,
      position_cycle_id: runtimeDoc.position_cycle_id,
      protection_runtime_id: runtimeDoc.protection_runtime_id,
      repair_request_n: 0,
      repair_requests: Object.freeze([]),
      writes: Object.freeze([]),
    });
  }

  const firestore = resolveDb(db);
  const runtimeRef = docRef({
    firestore,
    env,
    collectionKey: "PROTECTION_RUNTIME",
    docId: runtimeDoc.protection_runtime_id,
  });
  const repairRefs = requestBuild.repair_requests.map((repairRequest) => docRef({
    firestore,
    env,
    collectionKey: "REPAIR_REQUESTS",
    docId: repairRequest.exit_repair_request_id,
  }));
  const batch = firestore.batch();
  batch.set(runtimeRef.ref, {
    ...runtimeDoc,
    repair_enqueue_committed_at: at,
  }, { merge: true });
  requestBuild.repair_requests.forEach((repairRequest, index) => {
    batch.set(repairRefs[index].ref, repairRequest, { merge: true });
  });
  await batch.commit();

  return Object.freeze({
    ok: true,
    write_mode: "BATCH",
    committed_at: at,
    position_cycle_id: runtimeDoc.position_cycle_id,
    protection_runtime_id: runtimeDoc.protection_runtime_id,
    repair_request_n: requestBuild.repair_requests.length,
    repair_requests: requestBuild.repair_requests,
    writes: Object.freeze([
      Object.freeze({
        collectionKey: runtimeRef.collectionKey,
        collectionName: runtimeRef.collectionName,
        docId: runtimeRef.docId,
      }),
      ...repairRefs.map((ref) => Object.freeze({
        collectionKey: ref.collectionKey,
        collectionName: ref.collectionName,
        docId: ref.docId,
      })),
    ]),
  });
}

module.exports = {
  commitEntryProtectionPendingBootstrap,
  commitProtectedEntryActivation,
  commitEntryProtectionRepairQueue,
  buildProtectedEntryReadModelSnapshot,
  buildProtectedEntryReadModelLatestDoc,
  __test: {
    trimOrNull,
    upper,
    toNumberOrNull,
    validateRequiredObject,
    resolveDb,
    docRef,
    buildProtectedEntryReadModelSnapshot,
    buildProtectedEntryReadModelLatestDoc,
  },
};
